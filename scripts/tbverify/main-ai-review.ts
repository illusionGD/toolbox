/**
 * 主进程侧桩测入口：`describeWarning` 的文本 / `copyKey` 的行为 /
 * AI 窗口的位置尺寸数学 / `ai:chat` 按发送方推流与发送方销毁时取消 /
 * 工具的注册与包装 + 确认往返（23b）。
 *
 * 生产代码逐字保留，只桩 `electron`（`app.getPath` + safeStorage 的 AES 替身 +
 * 记录 handler 的 `ipcMain`）。
 * 上一轮这里漏掉的正是「断言 warning 的文本」——只断言了「有没有 warning」，
 * 于是 `describeWarning` 匹配错字段这件事一路漏到了界面上。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ToolSet } from 'ai';
import { AI_CHANNELS } from '../../electron/shared/channels';
import {
  AI_PANEL_MIN_HEIGHT,
  AI_PANEL_MIN_WIDTH,
  clampPanelBounds,
  defaultPanelBounds,
  parsePanelBounds,
} from '../../electron/shared/aiPanel';
import { cancelChat, describeWarning, runChat } from '../../electron/main/ai/chat';
import {
  buildTools,
  denyPending,
  replyConfirm,
  requestConfirm,
  trackTask,
} from '../../electron/main/ai/tools';
import { TOOLS } from '../../electron/main/ai/tools/registry';
import { runFfmpeg } from '../../electron/main/ffmpeg/run';
import {
  clearAllKeys,
  copyKey,
  deleteKey,
  getKey,
  listKeyStatus,
  setKey,
} from '../../electron/main/ai/keys';
import { registerAiIpc } from '../../electron/main/ipc/ai';
import type {
  AiChatRequest,
  AiConfig,
  AiToolCall,
  AiToolMode,
  IpcResponse,
} from '../../electron/shared/types';
import { invokeIpc, registeredChannels, setEncryptionAvailable } from './stub-electron';

let passed = 0;
const failures: string[] = [];

/**
 * 断言相等。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 断言说明。
 */
function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push(
    `${label}\n    实际: ${JSON.stringify(actual)}\n    期望: ${JSON.stringify(expected)}`,
  );
}

/**
 * 断言深相等（矩形对象）。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 说明。
 */
function deepEq(actual: unknown, expected: unknown, label: string): void {
  eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

/* ------------------ describeWarning：三种真实形状 × 认得出/认不出 × 有无 details ------------------ */

// 截图里那条：认得出 feature，details 说的是同一件事，中文句已经说完，不再括号一遍
eq(
  describeWarning({
    type: 'unsupported',
    feature: 'temperature',
    details: 'temperature is not supported by claude-opus-4-8 and will be ignored',
  }),
  '该模型不支持采样温度，已忽略',
  'unsupported + 认得出 feature + 有 details：只出中文句，不带 details',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'temperature' }),
  '该模型不支持采样温度，已忽略',
  'unsupported + 认得出 feature + 无 details',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'tools' }),
  '该模型不支持工具调用，已忽略',
  'unsupported + tools → 工具调用',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'someNewKnob', details: 'not supported here' }),
  '该模型不支持someNewKnob，已忽略（not supported here）',
  'unsupported + 认不出 feature + 有 details：必须带上 details，否则信息全丢',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'someNewKnob' }),
  '该模型不支持someNewKnob，已忽略',
  'unsupported + 认不出 feature + 无 details',
);
eq(
  describeWarning({ type: 'compatibility', feature: 'responseFormat' }),
  '以兼容模式使用结构化输出，结果可能不理想',
  'compatibility + 认得出 feature',
);
eq(
  describeWarning({ type: 'compatibility', feature: 'weirdThing', details: 'emulated' }),
  '以兼容模式使用weirdThing，结果可能不理想（emulated）',
  'compatibility + 认不出 feature + 有 details',
);
eq(
  describeWarning({ type: 'other', message: '这台机器上的时钟不对' }),
  '这台机器上的时钟不对',
  'other：原文照出',
);

// 形状再变时不能静默丢：兜底仍是 JSON，丑但不丢信息
eq(
  describeWarning({ type: 'brand-new-shape', payload: 1 }),
  '{"type":"brand-new-shape","payload":1}',
  '认不出的形状 → JSON 兜底',
);
eq(describeWarning(null), 'null', 'null → JSON 兜底不抛');
// 上一轮写错的那两个名字现在必须走兜底（回归：确认不是把错的改成另一个错的）
eq(
  describeWarning({ type: 'unsupported-setting', setting: 'temperature' }),
  '{"type":"unsupported-setting","setting":"temperature"}',
  'SDK 里不存在的 unsupported-setting 不该被特殊对待',
);

/* --------------------------------- copyKey --------------------------------- */

clearAllKeys();
setEncryptionAvailable(true);

setKey('src', 'sk-source-1234567890');
const copied = copyKey('src', 'dst');
eq(copied.configId, 'dst', 'copyKey 回的是目标配置 id');
eq(copied.hasKey, true, 'copyKey 后目标有 key');
eq(copied.encrypted, true, 'safeStorage 可用时目标是加密的');
eq(getKey('dst'), 'sk-source-1234567890', 'copyKey 后目标的明文与源一致');
eq(getKey('src'), 'sk-source-1234567890', 'copyKey 不动源');
eq(copied.hint, listKeyStatus(['src'])[0].hint, 'copyKey 后掩码提示与源相同');

// 源没有 key：不许把目标已有的抹掉
setKey('dst2', 'sk-target-abcdefghij');
const noSource = copyKey('missing', 'dst2');
eq(noSource.hasKey, true, '源没 key 时目标原有的 key 还在');
eq(getKey('dst2'), 'sk-target-abcdefghij', '源没 key 时目标明文没被清掉');

// 源没 key 且目标也没 key
const bothEmpty = copyKey('missing', 'dst3');
eq(bothEmpty.hasKey, false, '源与目标都没 key 时回 hasKey:false');
eq(bothEmpty.hint, '', '没 key 时掩码为空串');

// 目标已有 key：覆盖
setKey('dst4', 'sk-old-0000000000');
copyKey('src', 'dst4');
eq(getKey('dst4'), 'sk-source-1234567890', '目标已有 key 时被源覆盖');

// safeStorage 不可用：不许假装加密
setEncryptionAvailable(false);
const plain = copyKey('src', 'dst5');
eq(plain.hasKey, true, 'safeStorage 不可用时仍然复制得动');
eq(plain.encrypted, false, 'safeStorage 不可用时 encrypted:false，不许假装加密');
eq(getKey('dst5'), 'sk-source-1234567890', '降级明文也读得回来');
setEncryptionAvailable(true);

// 删掉源之后目标不受影响（两条独立记录，不是引用）
deleteKey('src');
eq(getKey('dst'), 'sk-source-1234567890', '删源不影响已复制出去的目标');

clearAllKeys();

/* ------------------------- AI 窗口的位置尺寸数学 ------------------------- */

/** 主显示器的工作区（1080p 减去任务栏）。 */
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
/** 副屏在主屏左边（负坐标），这是最容易算错的一种摆法。 */
const leftScreen = { x: -1920, y: 0, width: 1920, height: 1080 };

// 默认位置：贴主窗口右侧、宽 380、高度基本与主窗口一致（顶栏 48 + 8 起算）
deepEq(
  defaultPanelBounds({ x: 400, y: 100, width: 1120, height: 720 }, workArea),
  { x: 400 + 1120 - 380 - 12, y: 100 + 56, width: 380, height: 720 - 56 - 12 },
  '默认位置：贴主窗口右侧、宽 380、从标题栏下方起、高度到底部留白',
);

// 主窗口在负坐标的副屏上：窗口要跟去那块屏，不能被拉回主屏
const onLeft = defaultPanelBounds({ x: -1500, y: 80, width: 1120, height: 720 }, leftScreen);
eq(onLeft.x, -1500 + 1120 - 380 - 12, '主窗口在负坐标副屏时，AI 窗口跟着算在那块屏上');
eq(onLeft.x < 0, true, '负坐标副屏上的 x 保持为负（没被夹回主屏）');

// 工作区比默认宽度还窄：宽度退到最小值而不是算出负数
const narrow = defaultPanelBounds(
  { x: 0, y: 0, width: 300, height: 400 },
  { x: 0, y: 0, width: 300, height: 400 },
);
eq(narrow.width, AI_PANEL_MIN_WIDTH, '工作区比默认宽度还窄时，宽度退到最小宽');
eq(narrow.height, AI_PANEL_MIN_HEIGHT, '工作区比最小高度还矮时，高度退到最小高');

// 夹紧：小于最小尺寸
deepEq(
  clampPanelBounds({ x: 100, y: 100, width: 10, height: 10 }, workArea),
  { x: 100, y: 100, width: AI_PANEL_MIN_WIDTH, height: AI_PANEL_MIN_HEIGHT },
  '尺寸小于 min 320×360 时被顶回最小值',
);

// 夹紧：不许比工作区还大（否则底部输入框会被挤到屏幕外）
deepEq(
  clampPanelBounds({ x: 0, y: 0, width: 5000, height: 5000 }, workArea),
  { x: 0, y: 0, width: 1920, height: 1040 },
  '尺寸大于工作区时被压到工作区大小',
);

// 夹紧：四个方向都至少留 120×60 在工作区内
eq(
  clampPanelBounds({ x: 9999, y: 200, width: 380, height: 400 }, workArea).x,
  1920 - 120,
  '往右出界时至少留 120px 宽在工作区内',
);
eq(
  clampPanelBounds({ x: -9999, y: 200, width: 380, height: 400 }, workArea).x,
  120 - 380,
  '往左出界时至少留 120px 宽在工作区内',
);
eq(
  clampPanelBounds({ x: 10, y: -9999, width: 380, height: 400 }, workArea).y,
  0,
  'y 不许小于工作区上边（顶栏是唯一的拖拽把手，滑上去就再也拖不回来）',
);
eq(
  clampPanelBounds({ x: 10, y: 9999, width: 380, height: 400 }, workArea).y,
  1040 - 60,
  '往下出界时至少留 60px 高在工作区内',
);

// 夹紧要认工作区的原点：副屏在负坐标时不能拿 0 当左边界
const backFromUnplugged = clampPanelBounds({ x: 500, y: 200, width: 380, height: 400 }, leftScreen);
eq(backFromUnplugged.x, -1920 + 1920 - 120, '目标屏在负坐标时，右边界按该屏的 x + width 算');

// 存下来的坏值：一律当没存过（`setBounds` 吃到 NaN 会抛，窗口根本开不出来）
eq(parsePanelBounds(undefined), undefined, 'undefined → 当没存过');
eq(parsePanelBounds(null), undefined, 'null → 当没存过');
eq(parsePanelBounds('380x652'), undefined, '字符串 → 当没存过');
eq(parsePanelBounds({ x: 0, y: 0, width: 380 }), undefined, '缺 height → 当没存过');
eq(parsePanelBounds({ x: NaN, y: 0, width: 380, height: 400 }), undefined, 'NaN → 当没存过');
eq(
  parsePanelBounds({ x: Infinity, y: 0, width: 380, height: 400 }),
  undefined,
  'Infinity → 当没存过',
);
eq(
  parsePanelBounds({ x: '10', y: 0, width: 380, height: 400 }),
  undefined,
  '字符串数字 → 当没存过（不做隐式转换）',
);
deepEq(
  parsePanelBounds({ x: 10, y: 20, width: 380, height: 400, extra: 'x' }),
  { x: 10, y: 20, width: 380, height: 400 },
  '合法值只取四个字段，回的是纯对象副本',
);

/* ---------------- ai:chat 按发送方推流 + 发送方销毁时取消 ---------------- */

registerAiIpc();

const channels = registeredChannels();
for (const channel of [
  AI_CHANNELS.openWindow,
  AI_CHANNELS.setWindowTop,
  AI_CHANNELS.minimizeWindow,
  AI_CHANNELS.openSettings,
  AI_CHANNELS.chat,
  AI_CHANNELS.toolReply,
]) {
  eq(channels.includes(channel), true, `通道已注册：${channel}`);
}
// navigateSettings 是主 → 渲染的推送，不该占一个 invoke handler
eq(
  channels.includes(AI_CHANNELS.navigateSettings),
  false,
  'navigateSettings 是推送通道，不注册 invoke handler',
);

// 最小化必须**有一条自己的通道**：DOM 的 window 没有 minimize，而 window.api.window.*
// 闭包的是主窗口，在 AI 窗口里调它会把主窗口收起来。窗口没开时是 false 而不是抛错
// （桩里 panel 恒为 null，走的就是这条分支）。
// **invokeIpc 要包一层 try**：通道没注册它是直接抛，裸脚本没有测试框架兜底，一抛就是
// 整个套件挂死、一条失败名都不打（[[ai-chat]] 记过这条），包起来才变成一条红断言。
{
  let response: IpcResponse<boolean>;
  try {
    response = (await invokeIpc(AI_CHANNELS.minimizeWindow, {})) as IpcResponse<boolean>;
  } catch (error) {
    response = { code: -1, data: null, message: error instanceof Error ? error.message : '' };
  }
  eq(response.code, 0, '最小化：窗口没开也回成功码，不抛错');
  eq(response.data, false, '最小化：窗口没开时回 false');
}

/** 一个假的 webContents，记下收到的分片与注册的一次性监听。 */
interface FakeSender {
  /** 收到的 `(channel, payload)`。 */
  sent: { channel: string; payload: unknown }[];
  /** 一次性监听：事件名 → 回调。 */
  once: (event: string, listener: () => void) => void;
  /** 触发已注册的一次性监听。 */
  fire: (event: string) => boolean;
  /** 是否已销毁。 */
  isDestroyed: () => boolean;
  /** 推一条消息。 */
  send: (channel: string, payload: unknown) => void;
}

/**
 * 造一个假 sender。
 * @returns 假 sender。
 */
function fakeSender(): FakeSender {
  const listeners = new Map<string, () => void>();
  const sent: { channel: string; payload: unknown }[] = [];
  return {
    sent,
    once: (event, listener) => void listeners.set(event, listener),
    fire: (event) => {
      const listener = listeners.get(event);
      if (!listener) return false;
      listener();
      return true;
    },
    isDestroyed: () => false,
    send: (channel, payload) => void sent.push({ channel, payload }),
  };
}

setKey('cfg-stream', 'sk-stream-1234567890');

/** 指向本机 1 端口：秒级拒绝连接，不出网也不依赖任何真 key。 */
const refusedConfig: AiConfig = {
  id: 'cfg-stream',
  name: '连不上的配置',
  provider: 'openai-compat',
  model: 'whatever',
  baseUrl: 'http://127.0.0.1:1/v1',
  systemPrompt: '',
  temperature: 0.7,
  maxOutputTokens: 128,
  createdAt: 0,
};

{
  const sender = fakeSender();
  const bystander = fakeSender();
  const request: AiChatRequest = {
    requestId: 'req-stream',
    config: refusedConfig,
    messages: [{ role: 'user', text: '你好' }],
    // 这一组测的是错误分片，不需要工具声明跟着下发
    toolMode: 'off',
  };
  const response = (await invokeIpc(AI_CHANNELS.chat, { sender }, request)) as IpcResponse<unknown>;

  eq(response.code, 1, '连不上时 ai:chat 回错误码');
  // 这一条就是「分片必须按 event.sender 推」：以前推给注册时闭包的那个窗口，
  // 对话搬进独立的 AI 窗口后一个分片都收不到
  const streamed = sender.sent.filter((s) => s.channel === AI_CHANNELS.chatStream);
  eq(streamed.length > 0, true, '分片推给了发起这次对话的那个 sender');
  eq(
    streamed.some((s) => (s.payload as { type?: string }).type === 'error'),
    true,
    '推过去的分片里有 error',
  );
  eq(
    (streamed[0]?.payload as { requestId?: string } | undefined)?.requestId,
    'req-stream',
    '分片带着本次的 requestId',
  );
  eq(bystander.sent.length, 0, '没发起对话的其他窗口一条都收不到');
}

/**
 * 一个永远不返回、只在 abort 时 reject 的 fetch。
 *
 * `signal.aborted` 那条分支不能省：取消可能发生在 fetch 还没被调用之前，那时 `abort`
 * 事件早已过去，只挂监听就会永远挂住（桩测直接超时，看不出是哪儿的问题）。
 * @param _input 请求。
 * @param init 请求选项（要用它的 signal）。
 * @returns 永不 resolve、只会因 abort 而 reject 的 promise。
 */
const hangingFetch = ((_input: unknown, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    /**
     * 抛一个 AbortError。
     */
    const bail = (): void => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init?.signal?.aborted) {
      bail();
      return;
    }
    init?.signal?.addEventListener('abort', bail);
  })) as unknown as typeof globalThis.fetch;

/**
 * 起一个挂住不返回的请求。
 * @param requestId 请求 id。
 * @returns runChat 的 promise。
 */
function startHanging(requestId: string): Promise<{ canceled: boolean }> {
  return runChat(
    { requestId, config: refusedConfig, messages: [{ role: 'user', text: 'hi' }], toolMode: 'off' },
    'sk-stream-1234567890',
    () => {},
    hangingFetch,
  );
}

/**
 * 等一个 promise 落定，但**最多等 1 秒**。
 *
 * 不设上限的话，「取消那条线断了」的表现是整个桩测挂死在 top-level await
 * 上（node 只会打一句 unsettled await 警告），看不出是哪条断言坏了。
 * 工具确认也共用它：`denyPending` 漏了同样是挂死而不是报错。
 * @param promise 要等的 promise。
 * @returns 落定了就回结果，超时回 `'timeout'`。
 */
async function settledWithin<T>(promise: Promise<T>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), 1000);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  // 超时的那条 promise 还挂着，得让它有人接，否则是未处理拒绝
  void promise.catch(() => {});
  return result;
}

{
  // 对照组：一个没有窗口销毁的进行中请求本来就取消得动。
  // 没有这一组，下面那条「cancelChat 回 false」是废断言——请求压根没注册时也回 false。
  const control = startHanging('req-control');
  eq(cancelChat('req-control'), true, '进行中的请求取消得动（对照组）');
  const settled = await settledWithin(control);
  eq(settled !== 'timeout' && settled.canceled, true, '对照组：取消后 canceled 为 true');
  eq(cancelChat('req-control'), false, '已取消的请求不在进行中列表里（对照组）');
}

{
  // 真起一个挂住的请求，再让 IPC handler 注册的 destroyed 监听去取消它——
  // 只断言「监听装上了」证明不了它真的会取消，必须让它作用在一个在跑的请求上
  const inflight = startHanging('req-destroy');

  const sender = fakeSender();
  // 同一个 requestId 再 invoke 一次：runChat 会以「已在进行中」失败，但 handler 在调它
  // **之前**就把 destroyed 监听装上了，正好用来验证那条线
  const response = (await invokeIpc(
    AI_CHANNELS.chat,
    { sender },
    { requestId: 'req-destroy', config: refusedConfig, messages: [], toolMode: 'off' },
  )) as IpcResponse<unknown>;
  eq(response.code, 1, '同一 requestId 重复发起被拒');

  eq(sender.fire('destroyed'), true, 'handler 给 sender 装了 destroyed 一次性监听');
  const result = await settledWithin(inflight);
  eq(
    result !== 'timeout' && result.canceled,
    true,
    'sender 销毁 → 进行中的请求被取消（不再替没人接收的流烧 token）',
  );
  eq(cancelChat('req-destroy'), false, '取消过的请求已从进行中列表里摘掉');
}

/* --------------------- 工具的注册与包装（23b） --------------------- */

/** 一次 buildTools 的上下文 + 它 emit 出来的记录。 */
interface ToolProbe {
  /** 建好的工具集（`off` 时为 undefined）。 */
  tools: ToolSet | undefined;
  /** emit 出来的完整记录，按到达顺序。 */
  emitted: AiToolCall[];
  /** 登记过的 ffmpeg taskId。 */
  tracked: string[];
  /** 是否每条记录都过得了 structuredClone。 */
  cloneOk: () => boolean;
}

/**
 * 按某个模式建一套工具，并把 emit 出来的记录收下来。
 * @param mode 审批策略。
 * @param requestId 请求 id。
 * @returns 探针。
 */
function probeTools(mode: AiToolMode, requestId = `req-${mode}`): ToolProbe {
  const emitted: AiToolCall[] = [];
  const tracked: string[] = [];
  let cloneOk = true;
  const tools = buildTools({
    requestId,
    mode,
    emit: (call) => {
      // 记录要跨 IPC 推给渲染进程：不是纯对象的话运行期抛 DataCloneError，
      // 而 typecheck 和 build 都发现不了（本仓库踩过五次）
      try {
        structuredClone(call);
      } catch {
        cloneOk = false;
      }
      emitted.push(call);
    },
    trackTask: (taskId) => void tracked.push(taskId),
  });
  return { tools, emitted, tracked, cloneOk: () => cloneOk };
}

/**
 * 像 SDK 那样调一个工具的 `execute`。
 *
 * **抛出来的会被接住换成 `{ threw: 原因 }`**：包装层的硬约束就是「拒绝与失败都 return
 * 不 throw」，而裸 await 一个会抛的 promise 只会让整个桩测进程当场死掉——退出码是红的，
 * 但一条断言名都不打，跟 `settledWithin` 兜挂死是同一个理由。
 * @param tools 工具集。
 * @param name 工具名。
 * @param input 入参。
 * @returns 回给模型的值；`execute` 抛了的话是 `{ threw: 原因 }`。
 */
async function callTool(
  tools: ToolSet | undefined,
  name: string,
  input: unknown,
): Promise<unknown> {
  const entry = tools?.[name] as
    { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
  if (!entry?.execute) throw new Error(`工具未注册：${name}`);
  try {
    // 第二个参数实测有 toolCallId / messages / abortSignal / experimental_context，
    // 我们的包装一个都不用，给足前两个就行
    return await entry.execute(input, { toolCallId: 'tc-1', messages: [] });
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 取最后一条 emit 出来的记录。
 * @param probe 探针。
 * @returns 记录；一条都没有时 undefined。
 */
function lastCall(probe: ToolProbe): AiToolCall | undefined {
  return probe.emitted[probe.emitted.length - 1];
}

/** 本组用的临时目录。 */
const toolDir = mkdtempSync(joinPath(tmpdir(), 'tbverify-tools-'));

eq(
  probeTools('off').tools,
  undefined,
  'toolMode 为 off 时 buildTools 回 undefined（压根不下发 tools）',
);

{
  const names = TOOLS.map((t) => t.name);
  eq(names.length, 13, '工具总数 13 个');
  eq(TOOLS.filter((t) => t.kind === 'read').length, 8, '只读工具 8 个');
  eq(TOOLS.filter((t) => t.kind === 'write').length, 5, '写盘工具 5 个');
  eq(new Set(names).size, names.length, '工具名不重复（重名会被后者顶掉，静默少一个能力）');
  deepEq(
    [...names].sort(),
    [
      'compress_images',
      'convert_audio',
      'convert_video',
      'list_files',
      'probe_audio',
      'probe_excel',
      'probe_font',
      'probe_image',
      'probe_video',
      'read_text_file',
      'rename_files',
      'storage_info',
      'write_text_file',
    ],
    '工具清单与约定的 8 读 + 5 写完全一致',
  );
  // 硬规则：没有删除、没有 shell、没有网络抓取。加工具时手滑最容易破的就是这条
  eq(
    names.some((n) => /delete|remove|shell|exec|spawn|fetch|http|download/i.test(n)),
    false,
    '工具名里没有删除 / shell / 网络抓取这类能力',
  );

  const ask = probeTools('ask');
  eq(Object.keys(ask.tools ?? {}).length, 13, 'ask 模式下 13 个工具都注册给了 SDK');
  eq(
    names.every((n) => typeof (ask.tools?.[n] as { execute?: unknown })?.execute === 'function'),
    true,
    '每个工具都有 execute',
  );
  eq(
    typeof (ask.tools?.list_files as { inputSchema?: unknown })?.inputSchema,
    'object',
    '工具带着 inputSchema 下发（SDK 靠它翻成各家的 JSON Schema）',
  );
}

// 只读工具：不确认、直接跑；返回值必须封顶
{
  const listDir = mkdtempSync(joinPath(tmpdir(), 'tbverify-list-'));
  for (let i = 0; i < 500; i += 1) writeFileSync(joinPath(listDir, `f${i}.txt`), 'x');

  const probe = probeTools('ask', 'req-read');
  const result = (await callTool(probe.tools, 'list_files', { dir: listDir })) as {
    total: number;
    listed: number;
    truncated: boolean;
    entries: { path: string; size: number; ext: string }[];
  };

  eq(probe.emitted[0]?.status, 'running', '只读工具第一条事件就是 running（没有 pending）');
  eq(
    probe.emitted.some((c) => c.status === 'pending'),
    false,
    '只读工具在 ask 模式下也不弹确认',
  );
  eq(lastCall(probe)?.status, 'done', '只读工具跑完是 done');
  eq(lastCall(probe)?.kind, 'read', '记录里带着 kind:read');
  eq(typeof lastCall(probe)?.elapsed, 'number', 'done 的记录带上了耗时');
  eq(probe.cloneOk(), true, 'emit 出去的记录都是纯对象（structuredClone 过得去）');
  eq(new Set(probe.emitted.map((c) => c.callId)).size, 1, '一次调用只用一个 callId');

  eq(result.total, 500, 'total 是真实总数');
  eq(result.entries.length, 200, `500 个文件只回 200 条（返回值就是 token，必须封顶）`);
  eq(result.listed, 200, 'listed 与实际条数一致');
  eq(result.truncated, true, '截断了就如实置 truncated');
  eq(result.entries[0]?.path.startsWith(listDir), true, '条目给的是绝对路径（模型下一步要用它）');
  eq(result.entries[0]?.ext, 'txt', '条目带扩展名');
  eq('files' in result, false, '不把 ScanResult.files 原样回给模型');
}

// 只读工具出错：也是 return { error }，不抛
{
  const probe = probeTools('ask', 'req-read-error');
  const result = (await callTool(probe.tools, 'probe_image', {
    path: joinPath(toolDir, '不存在.png'),
  })) as { error?: string };
  eq(typeof result.error, 'string', '读工具失败时 resolve 出 { error }，不 reject');
  eq(lastCall(probe)?.status, 'error', '失败的记录是 error 状态');
  eq(lastCall(probe)?.result, result.error, '卡片上的原因就是回给模型的那句');
}

// 写盘工具 + ask：先 pending，等回答才动手
{
  const probe = probeTools('ask', 'req-write-ask');
  const target = joinPath(toolDir, 'ask-approved.txt');
  const pending = callTool(probe.tools, 'write_text_file', { path: target, content: '同意后写入' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  eq(probe.emitted.length, 1, 'ask 模式下写工具先只发一条 pending');
  eq(probe.emitted[0]?.status, 'pending', '第一条事件是 pending');
  eq(probe.emitted[0]?.kind, 'write', '记录里带着 kind:write');
  eq(
    probe.emitted[0]?.summary.includes('ask-approved.txt'),
    true,
    'pending 卡片上的摘要说得出动的是哪个文件',
  );
  eq(
    await readFile(target, 'utf-8').then(
      () => true,
      () => false,
    ),
    false,
    '没回答之前不许动盘',
  );

  const callId = probe.emitted[0]?.callId ?? '';
  eq(replyConfirm(callId, true), true, 'replyConfirm 找到了这条等待中的确认');
  const result = (await settledWithin(pending)) as { path?: string } | 'timeout';
  eq(result !== 'timeout', true, '回答之后 execute 落定（不挂死）');
  eq(await readFile(target, 'utf-8'), '同意后写入', '允许之后文件真的写进去了');
  eq(lastCall(probe)?.status, 'done', '允许后的终态是 done');
  eq(replyConfirm(callId, true), false, '同一条确认回答第二次回 false');
}

// 写盘工具 + 拒绝：resolve 出 { denied:true }，不 reject，也不动盘
{
  const probe = probeTools('ask', 'req-write-deny');
  const target = joinPath(toolDir, 'denied.txt');
  const pendingCall = callTool(probe.tools, 'write_text_file', { path: target, content: '不该写' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(replyConfirm(probe.emitted[0]?.callId ?? '', false), true, '拒绝也走 replyConfirm');

  const settled = await settledWithin(pendingCall);
  const denied = settled as { denied?: boolean; message?: string };
  eq(settled !== 'timeout', true, '拒绝后 execute 也落定');
  eq(denied.denied, true, '拒绝是 resolve 出 { denied:true }，不是 reject（否则整条消息报错）');
  eq(typeof denied.message, 'string', '连一句给模型看的中文一起回（让它改口径问用户）');
  eq(
    await readFile(target, 'utf-8').then(
      () => true,
      () => false,
    ),
    false,
    '拒绝后一个字节都没写',
  );
  eq(lastCall(probe)?.status, 'denied', '拒绝后的终态是 denied');
  eq(lastCall(probe)?.result, '已拒绝', '卡片上写着已拒绝');
}

// auto + 不覆盖：直接跑
{
  const probe = probeTools('auto', 'req-auto');
  const target = joinPath(toolDir, 'auto.txt');
  const result = (await callTool(probe.tools, 'write_text_file', {
    path: target,
    content: 'auto',
  })) as { path?: string };
  eq(result.path, target, 'auto 模式下写工具直接跑完');
  eq(
    probe.emitted.some((c) => c.status === 'pending'),
    false,
    'auto 模式下不覆盖原文件就不问',
  );
  eq(probe.emitted[0]?.status, 'running', 'auto 模式下第一条事件就是 running');
}

// auto + overwrite:true：**仍然确认**（不可逆的数据丢失，而模型是会被文件内容带偏的）
{
  const probe = probeTools('auto', 'req-auto-overwrite');
  const target = joinPath(toolDir, 'auto.txt');
  const pendingCall = callTool(probe.tools, 'write_text_file', {
    path: target,
    content: '覆盖内容',
    overwrite: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(probe.emitted[0]?.status, 'pending', 'auto 模式 + overwrite 仍然发 pending');

  eq(replyConfirm(probe.emitted[0]?.callId ?? '', true), true, '这条确认真的在等回答');
  await settledWithin(pendingCall);
  eq(await readFile(target, 'utf-8'), '覆盖内容', '确认之后才覆盖');
}

// rename_files 的 forceConfirm 恒为 true：改名是原地改动，任何模式都问
{
  const probe = probeTools('auto', 'req-auto-rename');
  const source = joinPath(toolDir, 'rename-me.txt');
  writeFileSync(source, 'x');
  const pendingCall = callTool(probe.tools, 'rename_files', {
    renames: [{ path: source, newName: 'renamed.txt' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(probe.emitted[0]?.status, 'pending', 'auto 模式下 rename_files 也要确认');
  replyConfirm(probe.emitted[0]?.callId ?? '', false);
  await settledWithin(pendingCall);
  eq(
    await readFile(source, 'utf-8').then(
      () => true,
      () => false,
    ),
    true,
    '拒绝改名后原文件还在原处',
  );
}

// 写盘工具出错：resolve 出 { error } 且卡片是 error
{
  const probe = probeTools('auto', 'req-write-error');
  const result = (await callTool(probe.tools, 'write_text_file', {
    path: 'relative/path.txt',
    content: 'x',
  })) as { error?: string };
  eq(result.error, '必须是绝对路径', '底层守卫的中文原因原样回给模型');
  eq(lastCall(probe)?.status, 'error', '失败的记录是 error');
}

/* --------------------------- 确认往返（23b） --------------------------- */

{
  // 对照组：先证明「在等的 callId 回 true」，否则下面那些 false 全是废断言
  const waiting = requestConfirm('req-confirm', 'call-1');
  eq(replyConfirm('call-1', true), true, '在等的 callId → replyConfirm 回 true（对照组）');
  eq(await settledWithin(waiting), true, '回答 true 时 requestConfirm 就 resolve 出 true');
  eq(replyConfirm('call-1', true), false, '同一个 callId 第二次回 false');
  eq(replyConfirm('unknown-call', true), false, '未知 callId 回 false 而不是抛');

  const denied = requestConfirm('req-confirm', 'call-2');
  eq(replyConfirm('call-2', false), true, '拒绝也算回答到了');
  eq(await settledWithin(denied), false, '回答 false 时 resolve 出 false');
}

{
  // denyPending 只判自己那一个请求下的
  const mine = requestConfirm('req-a', 'call-a');
  const others = requestConfirm('req-b', 'call-b');
  eq(denyPending('req-a'), 1, 'denyPending 判掉了本请求下的 1 条');
  eq(await settledWithin(mine), false, '被判掉的确认 resolve 出 false');
  eq(denyPending('req-a'), 0, '同一个请求再判一次是 0 条');
  eq(replyConfirm('call-b', true), true, '别的请求下的确认没被连带判掉');
  await settledWithin(others);
}

{
  // **本轮最容易漏、且漏了不报错只挂死的一条**：cancelChat 必须 denyPending
  const waiting = requestConfirm('req-cancel', 'call-cancel');
  eq(cancelChat('req-cancel'), false, '这个 requestId 没有在跑的请求（只测确认那条线）');
  eq(
    await settledWithin(waiting),
    false,
    'cancelChat 把等着的确认判成拒绝（漏了这条会挂死，不会报错）',
  );
}

{
  // cancelChat 还要杀掉登记过的 ffmpeg 任务：只 abort HTTP 请求的话子进程会转完
  trackTask('req-ff', 'task-ff-killed');
  trackTask('req-ff-other', 'task-ff-alive');
  cancelChat('req-ff');
  // 判据不是「函数被调过」而是行为：被取消过的 taskId 再跑会直接回 canceled，不起进程
  eq(
    (await runFfmpeg(['-version'], { taskId: 'task-ff-killed' })).canceled,
    true,
    'cancelChat 杀掉了本请求登记的 ffmpeg 任务',
  );
  eq(
    (await runFfmpeg(['-version'], { taskId: 'task-ff-alive' })).canceled,
    false,
    '别的请求登记的 ffmpeg 任务没被连带杀掉（对照组）',
  );
}

{
  // ai:toolReply 通道：界面上的「允许 / 拒绝」走它
  const waiting = requestConfirm('req-ipc', 'call-ipc');
  const ok = (await invokeIpc(
    AI_CHANNELS.toolReply,
    { sender: fakeSender() },
    'call-ipc',
    true,
  )) as IpcResponse<boolean>;
  eq(ok.code, 0, 'ai:toolReply 正常返回');
  eq(ok.data, true, '在等的 callId 经通道回 true');
  eq(await settledWithin(waiting), true, '经通道的允许也真的兑现了那个 promise');

  const stale = (await invokeIpc(
    AI_CHANNELS.toolReply,
    { sender: fakeSender() },
    'call-from-disk',
    true,
  )) as IpcResponse<boolean>;
  eq(stale.code, 0, '对着历史记录里的卡片点，通道不报错');
  eq(stale.data, false, '没人在等的 callId 回 false');
}

{
  // 关掉 AI 窗口时也不许留下悬空的确认：ipc 层的 destroyed 监听 → cancelChat → denyPending
  const inflight = startHanging('req-tool-destroy');
  const sender = fakeSender();
  await invokeIpc(
    AI_CHANNELS.chat,
    { sender },
    { requestId: 'req-tool-destroy', config: refusedConfig, messages: [], toolMode: 'ask' },
  );
  const waiting = requestConfirm('req-tool-destroy', 'call-destroy');
  eq(sender.fire('destroyed'), true, 'handler 装上了 destroyed 监听');
  eq(
    await settledWithin(waiting),
    false,
    'AI 窗口被关掉 → 等着的确认判成拒绝（否则 execute 里那个 await 再没人能兑现）',
  );
  await settledWithin(inflight);
}

/* ---------------------------------- 汇总 ---------------------------------- */

console.log(`\n主进程桩测：${passed} 条通过，${failures.length} 条失败`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length > 0) process.exit(1);
