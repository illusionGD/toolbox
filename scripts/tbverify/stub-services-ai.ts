/**
 * `@/services/ai` 的桩。
 *
 * **桩得真的记住哪些配置有 key**——上一轮的假红就出在这：面板打开时会调
 * `refreshKeyStatus()`，桩一律回 `hasKey:false` 时会把测试刚设好的状态刷掉，`send` 于是
 * 被「还没有填 API Key」拦住，看着像生产代码的 bug。
 */
import type {
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiConversation,
  AiImageRef,
  AiKeyStatus,
  AiStreamEvent,
  AiTestResult,
} from '@shared/types';

/** 桩里的密钥库：configId → 明文。 */
const keys = new Map<string, string>();
/** safeStorage 是否可用（影响回的 encrypted）。 */
let canEncrypt = true;
/** `copyKey` 的调用记录，供断言「复制确实走了主进程通道」。 */
export const copyCalls: { fromId: string; toId: string }[] = [];
/** `cancelAiApi` 的调用记录，供断言「取消确实发到了主进程」。 */
export const cancelCalls: string[] = [];
/** `replyAiToolApi` 的调用记录，供断言确认按钮真的打到了 `ai:toolReply`。 */
export const toolReplyCalls: { callId: string; approved: boolean }[] = [];
/** 会话落盘记录。 */
export const savedConversations: AiConversation[][] = [];
/** 「磁盘上」已有的会话，`loadAiConversationsApi` 回它（测重开窗口的净化）。 */
let storedConversations: AiConversation[] = [];
/** 流式分片订阅者。 */
const listeners = new Set<(event: AiStreamEvent) => void>();
/** 每次 chat 的 resolve 钩子，测试自己控制何时结束。 */
export const chatCalls: {
  request: AiChatRequest;
  resolve: (result: AiChatResult) => void;
  cloneOk: boolean;
}[] = [];

/**
 * 直接塞一个 key（准备测试前置状态）。
 * @param configId 配置 id。
 * @param key 明文。
 */
export function seedKey(configId: string, key: string): void {
  keys.set(configId, key);
}

/**
 * 切换加密可用性。
 * @param value 是否可用。
 */
export function setCanEncrypt(value: boolean): void {
  canEncrypt = value;
}

/**
 * 直接塞「磁盘上」的会话（测 `ensureLoaded()` 读回来之后的净化）。
 * @param list 会话数组。
 */
export function seedConversations(list: AiConversation[]): void {
  storedConversations = list;
}

/** 清空桩状态。 */
export function resetAiStub(): void {
  keys.clear();
  copyCalls.length = 0;
  cancelCalls.length = 0;
  toolReplyCalls.length = 0;
  savedConversations.length = 0;
  chatCalls.length = 0;
  listeners.clear();
  storedConversations = [];
  canEncrypt = true;
}

/**
 * 掩码。
 * @param key 明文。
 * @returns 掩码提示。
 */
function mask(key: string): string {
  return key.length <= 12 ? '*'.repeat(key.length) : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * 某配置的状态。
 * @param configId 配置 id。
 * @returns key 状态。
 */
function statusOf(configId: string): AiKeyStatus {
  const key = keys.get(configId);
  return {
    configId,
    hasKey: Boolean(key),
    hint: key ? mask(key) : '',
    encrypted: canEncrypt,
  };
}

/**
 * 查若干配置的 key 状态。
 * @param configIds 配置 id 列表。
 * @returns 状态数组。
 */
export async function listAiKeyStatusApi(configIds: string[]): Promise<AiKeyStatus[]> {
  return configIds.map(statusOf);
}

/**
 * 写 key。
 * @param configId 配置 id。
 * @param key 明文；空串等同删除。
 * @returns 写入后的状态。
 */
export async function setAiKeyApi(configId: string, key: string): Promise<AiKeyStatus> {
  if (key) keys.set(configId, key);
  else keys.delete(configId);
  return statusOf(configId);
}

/**
 * 删 key。
 * @param configId 配置 id。
 * @returns 删除后的状态。
 */
export async function deleteAiKeyApi(configId: string): Promise<AiKeyStatus> {
  keys.delete(configId);
  return statusOf(configId);
}

/**
 * 复制 key（主进程行为的镜像：源没 key 时不动目标）。
 * @param fromId 源配置 id。
 * @param toId 目标配置 id。
 * @returns 目标状态。
 */
export async function copyAiKeyApi(fromId: string, toId: string): Promise<AiKeyStatus> {
  copyCalls.push({ fromId, toId });
  const plain = keys.get(fromId);
  if (plain) keys.set(toId, plain);
  return statusOf(toId);
}

/**
 * 测试连接。
 * @param config 配置（会断言它是纯对象）。
 * @param key 临时 key。
 * @returns 结果。
 */
export async function testAiConnectionApi(config: AiConfig, key?: string): Promise<AiTestResult> {
  // structuredClone 就是「跨 IPC 是不是纯对象」的判据：Vue 代理在它下面抛 DataCloneError
  structuredClone(config);
  const usable = Boolean(key?.trim() || keys.get(config.id));
  return { ok: usable, message: usable ? 'ok' : '没有 key', latencyMs: 1 };
}

/**
 * 发起对话（不自动结束，由测试调 chatCalls 里的 resolve）。
 * @param request 请求。
 * @returns 结果 promise。
 */
export function chatAiApi(request: AiChatRequest): Promise<AiChatResult> {
  let cloneOk = true;
  try {
    structuredClone(request);
  } catch {
    cloneOk = false;
  }
  return new Promise<AiChatResult>((resolve) => {
    chatCalls.push({ request, resolve, cloneOk });
  });
}

/**
 * 取消。
 * @param requestId 请求 id。
 * @returns 是否取消到。
 */
export async function cancelAiApi(requestId: string): Promise<boolean> {
  cancelCalls.push(requestId);
  return true;
}

/**
 * 回答一次工具确认。
 * @param callId 调用 id。
 * @param approved 是否允许。
 * @returns 桩里恒 true（真实实现里未知 callId 回 false，那条在主进程侧桩测里断言）。
 */
export async function replyAiToolApi(callId: string, approved: boolean): Promise<boolean> {
  toolReplyCalls.push({ callId, approved });
  return true;
}

/**
 * 订阅分片。
 * @param callback 回调。
 * @returns 退订函数。
 */
export function onAiStream(callback: (event: AiStreamEvent) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * 推一条分片给所有订阅者。
 * @param event 分片。
 */
export function emitStream(event: AiStreamEvent): void {
  for (const listener of listeners) listener(event);
}

/**
 * 暂存图片。
 * @param source 来源。
 * @returns 图片引用。
 */
export async function stageAiImageApi(source: string): Promise<AiImageRef> {
  return {
    id: `img-${source.length}`,
    path: `/tmp/${source.length}.png`,
    mediaType: 'image/png',
    width: 100,
    height: 100,
    bytes: 1000,
    thumbnailDataUrl: 'data:image/png;base64,',
  };
}

/**
 * 读会话。
 * @returns 「磁盘上」的会话（默认空，测试用 `seedConversations` 塞）。
 */
export async function loadAiConversationsApi(): Promise<AiConversation[]> {
  // 深拷贝：生产代码会就地改状态，回同一个引用会让测试自己的期望值跟着变
  return structuredClone(storedConversations);
}

/**
 * 写会话。
 * @param conversations 全量会话。
 * @returns 清掉的图片数。
 */
export async function saveAiConversationsApi(conversations: AiConversation[]): Promise<number> {
  // 同上：纯对象是硬约束
  structuredClone(conversations);
  savedConversations.push(conversations);
  return 0;
}
