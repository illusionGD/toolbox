/**
 * 一次对话的执行：`streamText` + 分片推送 + 取消 + 错误归一化。
 *
 * 实测决定的四处写法（详见 `.claude/skills/ai-chat`）：
 * - **`maxOutputTokens` 必须显式下发**：不传时 anthropic 协议由 SDK 按 model id 猜
 *   `max_tokens`，`claude-opus-5` 之类会猜到 128000，真实上限低于此值就直接 400。
 * - **必须自己接 `onError`**：默认实现会把错误打到 `console.error` / 走 SDK 自带的
 *   warning 通道，探针阶段就因此在管道被关时炸出过 EPIPE。
 * - **`result.usage` / `result.finishReason` 在取消后会 reject（AbortError）**，
 *   只能包在 catch 里取。
 * - **取消有专门的 `abort` 分片且 `fullStream` 正常结束**，不抛错，所以取消不是错误路径。
 */
import { readFile } from 'node:fs/promises';
import { stepCountIs, streamText, type ModelMessage } from 'ai';
import { supportsVision } from '../../shared/ai';
import type {
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiSendMessage,
  AiStreamEvent,
  AiTestResult,
  AiUsage,
} from '../../shared/types';
import { createModel } from './provider';
import { describeAiError, isAbortError } from './errors';
import { buildTools, denyPending, killTasks, trackTask } from './tools';

/**
 * 重试次数。**选定值不是实测值**：SDK 默认 2 次重试（共 3 次请求），撞上 429 时用户
 * 要干等两轮指数退避才看到提示，而退避期间能否即时取消尚未验证。设 1 次是折中：
 * 网络抖动还能救回来，反馈又不至于慢到看着像卡死。
 */
const MAX_RETRIES = 1;

/**
 * 一次请求里允许的最大步数（**选定值**）。
 *
 * 多步循环的每一步都是一次**真实请求**（上一步的工具结果拼进上下文再发一遍），所以这
 * 个数直接乘在 token 账单上。8 步足够走完「探测 → 处理 → 汇报」，再多就该让用户看一眼
 * 再说下一句了。撞上限时实测 `finishReason === 'tool-calls'` 且 `text === ''`——**助手
 * 气泡会是空白的**，所以那时必须补一条告警说明发生了什么。
 */
const MAX_TOOL_STEPS = 8;

/** 进行中的请求，按 requestId 索引，供取消用。 */
const running = new Map<string, AbortController>();

/**
 * SDK 告警里 `feature` 字段 → 中文功能名。
 *
 * 认不出的 feature 直接用原字段名（英文），并把 `details` 一起带上——那时中文句里
 * 只有一个英文标识符，没有 details 用户根本不知道发生了什么。
 */
const WARNING_FEATURES: Record<string, string> = {
  temperature: '采样温度',
  topP: 'topP 采样',
  topK: 'topK 采样',
  seed: '随机种子',
  frequencyPenalty: '频率惩罚',
  presencePenalty: '重复惩罚',
  maxOutputTokens: '回复长度上限',
  stopSequences: '停止序列',
  responseFormat: '结构化输出',
  tools: '工具调用',
  toolChoice: '工具选择',
  reasoningEffort: '推理强度',
};

/**
 * 把 SDK 的告警对象转成一句中文。
 *
 * **形状按 `SharedV3Warning` 的三种真实变体**（`@ai-sdk/provider` 的 d.ts）：
 * `{type:'unsupported', feature, details?}` / `{type:'compatibility', feature, details?}` /
 * `{type:'other', message}`。
 *
 * 上一轮这里写的是 `type==='unsupported-setting'` + `setting` 字段——**SDK 里没有这两个
 * 名字**，于是每条告警都落到 `JSON.stringify` 兜底，界面上直接显示原始 JSON。漏掉的原因
 * 是探针只断言了「有没有 warning」而没断言文本，所以本文件的桩测断言的是**输出文本**。
 *
 * @param warning SDK 的 CallWarning。
 * @returns 可显示的文本。
 */
export function describeWarning(warning: unknown): string {
  const w = warning as {
    type?: string;
    feature?: string;
    details?: string;
    message?: string;
  };
  if ((w?.type === 'unsupported' || w?.type === 'compatibility') && w.feature) {
    const known = WARNING_FEATURES[w.feature];
    const name = known ?? w.feature;
    const head =
      w.type === 'unsupported'
        ? `该模型不支持${name}，已忽略`
        : `以兼容模式使用${name}，结果可能不理想`;
    // details 只在认不出 feature 时附上：认得出时中文句已经说完整了，再括号一遍是噪音。
    return known || !w.details ? head : `${head}（${w.details}）`;
  }
  if (w?.type === 'other' && w.message) return w.message;
  if (w?.message) return w.message;
  // 形状再变时不至于静默丢——宁可显示得丑，也不要什么都不说。
  return JSON.stringify(warning);
}

/**
 * 渲染进程的消息 → SDK 的 ModelMessage。
 *
 * 图片在这里才读成 Buffer：**渲染进程不碰 base64**，各家的 part 格式（OpenAI 的
 * `image_url` data URL、anthropic 的 `source.base64`、google 的 `inlineData`）由 SDK 转。
 * @param messages 渲染进程下发的消息。
 * @param allowImages 该模型是否支持图片。
 * @param onWarn 丢弃图片时的告警回调。
 * @returns SDK 消息数组。
 */
async function toModelMessages(
  messages: AiSendMessage[],
  allowImages: boolean,
  onWarn: (text: string) => void,
): Promise<ModelMessage[]> {
  const result: ModelMessage[] = [];
  let droppedImages = 0;

  for (const message of messages) {
    const images = message.images ?? [];
    if (message.role === 'assistant' || images.length === 0) {
      result.push({ role: message.role, content: message.text });
      continue;
    }
    if (!allowImages) {
      // 不静默丢：告警一条，让用户知道图片没发出去
      droppedImages += images.length;
      result.push({ role: 'user', content: message.text });
      continue;
    }

    const parts: Extract<ModelMessage, { role: 'user' }>['content'] = [];
    if (message.text) parts.push({ type: 'text', text: message.text });
    for (const image of images) {
      parts.push({
        type: 'image',
        image: await readFile(image.path),
        mediaType: image.mediaType,
      });
    }
    result.push({ role: 'user', content: parts });
  }

  if (droppedImages > 0) {
    onWarn(`当前模型不支持图片输入，已忽略 ${droppedImages} 张图片`);
  }
  return result;
}

/**
 * 取用量（取消时一定取不到，所以整块包在 catch 里）。
 * @param promise SDK 的 usage promise（是 PromiseLike，得先 Promise.resolve 包一层）。
 * @returns 用量；取不到返回 undefined。
 */
async function safeUsage(promise: PromiseLike<unknown>): Promise<AiUsage | undefined> {
  try {
    const usage = (await promise) as Record<string, unknown>;
    const pick = (key: string): number | undefined =>
      typeof usage?.[key] === 'number' ? (usage[key] as number) : undefined;
    const result: AiUsage = {
      inputTokens: pick('inputTokens'),
      outputTokens: pick('outputTokens'),
      totalTokens: pick('totalTokens'),
    };
    // 三项全空就别回一个空壳，界面据此不显示用量
    return (result.inputTokens ?? result.outputTokens ?? result.totalTokens) ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 跑一次对话，流结束才 resolve。
 *
 * @param request 请求体（requestId + 配置 + 完整上下文）。
 * @param apiKey 明文 key（只在主进程内流转）。
 * @param onEvent 分片回调，转发给渲染进程。
 * @param fetchImpl 可注入的 fetch，桩测用。
 * @returns 最终结果。
 */
export async function runChat(
  request: AiChatRequest,
  apiKey: string,
  onEvent: (event: AiStreamEvent) => void,
  fetchImpl?: typeof globalThis.fetch,
): Promise<AiChatResult> {
  const config = request.config;
  if (running.has(request.requestId)) {
    throw new Error(`请求 ${request.requestId} 已在进行中`);
  }

  const controller = new AbortController();
  running.set(request.requestId, controller);

  const warnings: string[] = [];
  /** 已报过的错误文本，用于去重：同一次失败会在 onError 与 error 分片各来一次。 */
  const reported = new Set<string>();
  let errorMessage = '';
  let canceled = false;

  /**
   * 记一条告警并推给渲染进程。
   * @param text 告警文本。
   */
  const warn = (text: string): void => {
    warnings.push(text);
    onEvent({ requestId: request.requestId, type: 'warning', message: text });
  };

  /**
   * 记一条错误并推给渲染进程（同文本只报一次）。
   * @param error 任意错误。
   */
  const report = (error: unknown): void => {
    if (isAbortError(error)) {
      canceled = true;
      return;
    }
    const text = describeAiError(error);
    if (reported.has(text)) return;
    reported.add(text);
    if (!errorMessage) errorMessage = text;
    onEvent({ requestId: request.requestId, type: 'error', message: text });
  };

  let text = '';
  let reasoning = '';
  let finishReason = 'unknown';

  try {
    const model = createModel(config, apiKey, fetchImpl);
    const messages = await toModelMessages(
      request.messages,
      supportsVision(config.provider, config.model),
      warn,
    );

    const tools = buildTools({
      requestId: request.requestId,
      mode: request.toolMode,
      // 工具事件搭现成的流式通道走：渲染进程那边一处订阅就全收了
      emit: (toolCall) =>
        onEvent({ requestId: request.requestId, type: 'tool', toolCall: { ...toolCall } }),
      trackTask: (taskId) => trackTask(request.requestId, taskId),
    });

    const result = streamText({
      model,
      // 留空就不下发 system：有些兼容端点对空字符串的 system 报 400
      ...(config.systemPrompt.trim() ? { system: config.systemPrompt.trim() } : {}),
      messages,
      abortSignal: controller.signal,
      maxRetries: MAX_RETRIES,
      maxOutputTokens: config.maxOutputTokens,
      ...(Number.isFinite(config.temperature) ? { temperature: config.temperature } : {}),
      // 默认实现会往 console 打，还会走 SDK 自带的 warning 通道；接过来自己处理
      onError: ({ error }) => report(error),
      // toolMode 为 off 时 buildTools 回 undefined，展开后等于压根没传 tools
      ...(tools ? { tools, stopWhen: stepCountIs(MAX_TOOL_STEPS) } : {}),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          text += part.text;
          onEvent({ requestId: request.requestId, type: 'text', delta: part.text });
          break;
        case 'reasoning-delta':
          reasoning += part.text;
          onEvent({ requestId: request.requestId, type: 'reasoning', delta: part.text });
          break;
        case 'error':
          report(part.error);
          break;
        case 'abort':
          canceled = true;
          onEvent({ requestId: request.requestId, type: 'abort' });
          break;
        default:
          // start / start-step / text-start / text-end / finish-step / finish 等
          // 对界面没有信息量，忽略。
          // 工具那几种（tool-input-start / tool-input-delta / tool-input-end /
          // tool-call / tool-result / tool-error）同样落在这里：界面要的东西已经由
          // 我们自己在 execute 包装里 emit 过了，而且那份记录更好用——SDK 的
          // tool-error 里 error 字段序列化出来是 `{}`（实测）。
          break;
      }
    }

    // 这几个都是 PromiseLike（没有 catch），得先 Promise.resolve 包一层再兜错——
    // 实测取消后 usage / finishReason 会 reject(AbortError)，不兜就是未处理拒绝
    const sdkWarnings = await Promise.resolve(result.warnings).catch(() => []);
    for (const warning of sdkWarnings ?? []) {
      warn(describeWarning(warning));
    }

    const usage = await safeUsage(result.usage);
    const finish = await Promise.resolve(result.finishReason).catch(() =>
      canceled ? 'abort' : 'error',
    );
    finishReason = finish;

    // 撞上步数上限时**没有收尾文字**（实测 finishReason 'tool-calls' + text 空），
    // 不说一句的话用户看到的就是一个空气泡加几张工具卡片
    if (finish === 'tool-calls' && !canceled) {
      warn(`已达到工具调用步数上限（${MAX_TOOL_STEPS} 步），模型还没来得及给出结论`);
    }

    if (errorMessage && !canceled) throw new Error(errorMessage);
    return { text, reasoning, usage, finishReason, canceled, warnings };
  } catch (error) {
    if (isAbortError(error)) {
      return { text, reasoning, finishReason: 'abort', canceled: true, warnings };
    }
    // 已经推过 error 分片的，就原样把同一句话抛出去；否则先归一化
    throw error instanceof Error && errorMessage === error.message
      ? error
      : new Error(describeAiError(error));
  } finally {
    running.delete(request.requestId);
  }
}

/**
 * 取消一个进行中的请求。
 *
 * 三件事都要做，**少一件都不是「取消」**：
 * 1. abort HTTP 请求；
 * 2. `denyPending` 判掉等着确认的工具调用——`abortSignal` 管不到我们自己 await 的那个
 *    promise，漏了它 `execute` 永远挂着，请求既不结束也不报错；
 * 3. 杀掉登记过的 ffmpeg 子进程——它不看 HTTP，会一路把文件转完。
 * @param requestId 请求 id。
 * @returns 找到并取消了为 true；已结束返回 false。
 */
export function cancelChat(requestId: string): boolean {
  denyPending(requestId);
  killTasks(requestId);
  const controller = running.get(requestId);
  if (!controller) return false;
  controller.abort();
  running.delete(requestId);
  return true;
}

/**
 * 测试连接：真发一次最小请求。
 *
 * **这是「配置对不对」唯一靠得住的验证手段**——内置的 base URL 只是种子值，没有各家
 * 真 key 量不出来。因此失败时把归一化后的原始原因（含状态码与响应体片段）如实回显。
 * @param config 要测的配置。
 * @param apiKey 明文 key。
 * @param fetchImpl 可注入的 fetch，桩测用。
 * @returns 测试结果。
 */
export async function testConnection(
  config: AiConfig,
  apiKey: string,
  fetchImpl?: typeof globalThis.fetch,
): Promise<AiTestResult> {
  const started = Date.now();
  const requestId = `test-${Date.now()}`;
  try {
    const result = await runChat(
      {
        requestId,
        config,
        messages: [{ role: 'user', text: '你好，请只回复「连接正常」四个字。' }],
        // 「测试连接」不该带上十几个工具声明：既费 token，又可能因为端点不吃 tools
        // 而把一次本来能通的连接测成失败
        toolMode: 'off',
      },
      apiKey,
      () => {},
      fetchImpl,
    );
    const reply = result.text.trim().replace(/\s+/g, ' ').slice(0, 60);
    return {
      ok: true,
      message: reply ? `已连通，模型回复：${reply}` : '已连通，但模型没有返回文本',
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return { ok: false, message: describeAiError(error), latencyMs: Date.now() - started };
  }
}
