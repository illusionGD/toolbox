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
import { unwrap } from './ipc';

/**
 * AI 对话服务：封装 window.api.ai，供渲染进程业务调用。
 *
 * **所有网络调用都在主进程**，这里只是转发。明文 API Key 是单向的：写得进去、读不出来，
 * 读只能拿到 {@link AiKeyStatus}（是否存在 + 掩码 + 是否真加密）。
 */

/**
 * 打开 AI 对话窗口（没开就建，开着就聚焦）。
 *
 * 对话框是**独立的无边框窗口**而不是 app 内的浮动面板：DOM 面板拖不出 app 边界，
 * 也盖不住其他程序。
 */
export async function openAiWindowApi(): Promise<void> {
  await unwrap(window.api.ai.openWindow(), { errorPrefix: '打开 AI 对话失败' });
}

/**
 * 切换 AI 窗口置顶。
 * @param top 是否置顶。
 * @returns 切换后的状态。
 */
export function setAiWindowTopApi(top: boolean): Promise<boolean> {
  return unwrap(window.api.ai.setWindowTop(top), { silent: true });
}

/**
 * 最小化 AI 窗口。
 *
 * **不能用 `useWindowControls().minimize()`**：那条通道闭包的是主窗口，在这个窗口里调
 * 会把主窗口最小化。收回来的窗口从任务栏点回来，或者再点一次首页的 AI 入口
 * （`openPanelWindow` 会先 `restore()`）。
 */
export async function minimizeAiWindowApi(): Promise<void> {
  await unwrap(window.api.ai.minimizeWindow(), { silent: true });
}

/** AI 窗口里点 ⚙：聚焦主窗口并让它跳到设置页。 */
export async function openAiSettingsApi(): Promise<void> {
  await unwrap(window.api.ai.openSettings(), { silent: true });
}

/**
 * 订阅「跳到设置页」推送（只有主窗口会收到）。
 * @param callback 回调。
 * @returns 取消订阅函数。
 */
export function onAiNavigateSettings(callback: () => void): () => void {
  return window.api.ai.onNavigateSettings(callback);
}

/**
 * 查若干配置的 key 状态。
 * @param configIds 配置 id 列表。
 * @returns 与入参同序的状态数组。
 */
export function listAiKeyStatusApi(configIds: string[]): Promise<AiKeyStatus[]> {
  // 设置页每次打开都刷一遍，失败没必要弹窗打断
  return unwrap(window.api.ai.listKeyStatus(configIds), { silent: true });
}

/**
 * 写入某份配置的 API Key。
 * @param configId 配置 id。
 * @param key 明文 key；空串等同于删除。
 * @returns 写入后的状态。
 */
export function setAiKeyApi(configId: string, key: string): Promise<AiKeyStatus> {
  return unwrap(window.api.ai.setKey(configId, key), { errorPrefix: '保存 API Key 失败' });
}

/**
 * 删除某份配置的 API Key。
 * @param configId 配置 id。
 * @returns 删除后的空状态。
 */
export function deleteAiKeyApi(configId: string): Promise<AiKeyStatus> {
  return unwrap(window.api.ai.deleteKey(configId), { errorPrefix: '删除 API Key 失败' });
}

/**
 * 把一份配置的 API Key 复制给另一份。
 *
 * 「复制配置」必须走主进程：明文拿不到渲染进程，界面自己抄不了。源没 key 时是空操作。
 * @param fromId 源配置 id。
 * @param toId 目标配置 id。
 * @returns 目标配置的 key 状态。
 */
export function copyAiKeyApi(fromId: string, toId: string): Promise<AiKeyStatus> {
  return unwrap(window.api.ai.copyKey(fromId, toId), { errorPrefix: '复制 API Key 失败' });
}

/**
 * 测试连接：真发一次最小请求。
 *
 * **这是「配置对不对」唯一靠得住的验证手段**：内置的接口地址只是种子值，没有各家真
 * key 量不出来。因此失败原因原样回显（含状态码与响应体片段），不做二次包装。
 * @param config 配置（必须是纯对象，reactive 代理跨 IPC 会抛 could not be cloned）。
 * @param key 可选的临时 key（还没保存就想测时用）。
 * @returns 测试结果；连接失败也是正常返回，不抛错。
 */
export function testAiConnectionApi(config: AiConfig, key?: string): Promise<AiTestResult> {
  // silent：结果显示在配置卡上，弹窗会和卡内提示重复
  return unwrap(window.api.ai.testConnection(config, key), { silent: true });
}

/**
 * 发起一次对话。**流结束才 resolve**，过程中的增量走 {@link onAiStream}。
 * @param request 请求体（必须是纯对象）。
 * @returns 最终结果。
 */
export function chatAiApi(request: AiChatRequest): Promise<AiChatResult> {
  // silent：错误已经通过流式分片写进那条消息了，再弹一次是重复
  return unwrap(window.api.ai.chat(request), { silent: true });
}

/**
 * 取消一个进行中的请求。
 * @param requestId 请求 id。
 * @returns 是否真的取消到（已结束返回 false）。
 */
export function cancelAiApi(requestId: string): Promise<boolean> {
  return unwrap(window.api.ai.cancel(requestId), { silent: true });
}

/**
 * 回答一次工具确认。
 * @param callId 工具调用 id。
 * @param approved 允许还是拒绝。
 * @returns 是否有人在等这个回答；对着历史记录里的卡片点则为 false。
 */
export function replyAiToolApi(callId: string, approved: boolean): Promise<boolean> {
  // silent：结果就写在那张卡片上，弹窗是重复
  return unwrap(window.api.ai.toolReply(callId, approved), { silent: true });
}

/**
 * 订阅流式分片。
 * @param callback 分片回调。
 * @returns 取消订阅函数。
 */
export function onAiStream(callback: (event: AiStreamEvent) => void): () => void {
  return window.api.ai.onStream(callback);
}

/**
 * 暂存一张图片（主进程降采样后落到数据目录）。
 * @param source 文件绝对路径，或粘贴得到的 data URL。
 * @returns 图片引用。
 */
export function stageAiImageApi(source: string): Promise<AiImageRef> {
  return unwrap(window.api.ai.stageImage(source), { errorPrefix: '添加图片失败' });
}

/**
 * 读全部会话（AI 窗口打开时调）。
 * @returns 会话数组，按更新时间倒序。
 */
export function loadAiConversationsApi(): Promise<AiConversation[]> {
  return unwrap(window.api.ai.loadConversations(), { silent: true });
}

/**
 * 覆盖写全部会话，并清理没人引用的图片。
 * @param conversations 全量会话（必须是纯对象数组）。
 * @returns 清掉的图片文件数。
 */
export function saveAiConversationsApi(conversations: AiConversation[]): Promise<number> {
  // 防抖里调用，失败弹窗会连成一串
  return unwrap(window.api.ai.saveConversations(conversations), { silent: true });
}
