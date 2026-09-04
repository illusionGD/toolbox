/**
 * 配置 → Vercel AI SDK 的 LanguageModel。
 *
 * 这一层刻意做得很薄：**协议差异全归 SDK**（SSE 跨分片解析、system prompt 的三种
 * 位置、图片 part 的三种写法、错误归一化、第二轮的 tool_call 翻译），我们只负责
 * 「选哪个工厂、给什么 baseURL」。原先打算手写三套适配器的方案已作废。
 *
 * 版本被**钉死**在 `ai@6` 线（见 `.claude/skills/ai-chat`）：`ai@7` 的
 * `engines.node` 是 `>=22`，而实测 Electron 33.4.11 自带的是 Node 20.18.3。
 * provider 包的大版本与 `ai` 不同步，照「装 latest」会装出跑不起来的组合。
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import { findProvider } from '../../shared/ai';
import type { AiConfig } from '../../shared/types';

/**
 * 取该配置实际生效的接口地址。
 *
 * 配置留空就用厂商种子值；`minimax` 与 `openai-compat` 的种子值是**空串**（故意不猜，
 * 猜错只会让报错更难查），这时必须让用户自己填，否则 SDK 会拿着相对地址去请求。
 * @param config AI 配置。
 * @returns 去掉尾部斜杠的 base URL。
 * @throws 地址为空时抛中文错误。
 */
export function resolveBaseUrl(config: AiConfig): string {
  const info = findProvider(config.provider);
  const raw = (config.baseUrl || info?.defaultBaseUrl || '').trim();
  if (!raw) {
    throw new Error(`配置「${config.name}」没有接口地址：${info?.keyHint ?? '请在设置页填写'}`);
  }
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(`配置「${config.name}」的接口地址必须以 http:// 或 https:// 开头`);
  }
  // 尾斜杠要去掉：SDK 是在 baseURL 后直接拼 `/messages` 之类，留着会拼出 `//messages`
  return raw.replace(/\/+$/, '');
}

/**
 * 按配置造出 SDK 的 model 实例。
 *
 * @param config AI 配置。
 * @param apiKey 明文 key（只在主进程内流转）。
 * @param fetchImpl 可注入的 fetch，**桩测靠它**；不传则用运行时自带的。
 * @returns LanguageModel 实例。
 * @throws 厂商未登记 / 地址为空时抛中文错误。
 */
export function createModel(
  config: AiConfig,
  apiKey: string,
  fetchImpl?: typeof globalThis.fetch,
): LanguageModel {
  const info = findProvider(config.provider);
  if (!info) throw new Error(`未知厂商：${config.provider}`);

  const baseURL = resolveBaseUrl(config);
  // fetch 传 undefined 与不传等价，SDK 内部是 `fetch ?? globalThis.fetch`
  const common = { apiKey, baseURL, fetch: fetchImpl };

  switch (info.protocol) {
    case 'anthropic':
      return createAnthropic(common)(config.model);

    case 'openai':
      // **必须显式 .chat()**：实测默认的 `createOpenAI(...)(id)` 走的是 Responses API
      // （`POST /v1/responses`），拿 Chat Completions 的流喂它会报
      // 「Received a Chat Completions stream while using the OpenAI Responses API」。
      // 用 .chat() 才是 `POST /v1/chat/completions`，官方端点与各种反代都吃这套。
      return createOpenAI(common).chat(config.model);

    case 'google':
      return createGoogleGenerativeAI(common)(config.model);

    case 'openai-compat':
      // name 只用于错误信息里的来源标注，不进请求
      return createOpenAICompatible({ ...common, name: config.provider })(config.model);

    default: {
      // 穷尽检查：以后加协议时这里会编译报错
      const exhaustive: never = info.protocol;
      throw new Error(`未支持的协议：${String(exhaustive)}`);
    }
  }
}
