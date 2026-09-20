import type {
  WebTestFlow,
  WebTestFormat,
  WebTestRecordOptions,
  WebTestReplayOptions,
  WebTestSnapshot,
  WebTestVideo,
} from '@shared/webtest';
import { unwrap } from './ipc';

/** @returns 主进程当前录制 / 回放快照。 */
export function getWebTestSnapshotApi(): Promise<WebTestSnapshot> {
  return unwrap(window.api.webtest.snapshot());
}
/** @returns 缓存目录及旧版数据目录中的录制视频，不依赖当前用例。 */
export function getWebTestVideosApi(): Promise<WebTestVideo[]> {
  return unwrap(window.api.webtest.videos(), { silent: true });
}
/** @param path 录制视频路径。 @returns 用户保存的路径，取消返回 null。 */
export function saveWebTestVideoApi(path: string): Promise<string | null> {
  return unwrap(window.api.webtest.saveVideo(path), { errorPrefix: '保存视频失败' });
}
/** @param path 用户确认删除的录制视频路径。 */
export function deleteWebTestVideoApi(path: string): Promise<void> {
  return unwrap(window.api.webtest.deleteVideo(path), { errorPrefix: '删除视频失败' });
}
/** @param options 录制参数。 @returns 启动后的快照。 */
export function recordWebTestApi(options: WebTestRecordOptions): Promise<WebTestSnapshot> {
  return unwrap(window.api.webtest.record(options));
}
/** @param options 回放参数，flow 必须是纯对象。 @returns 启动后的快照。 */
export function replayWebTestApi(options: WebTestReplayOptions): Promise<WebTestSnapshot> {
  return unwrap(window.api.webtest.replay(options));
}
/** @returns 视频封装和会话停止后的快照。 */
export function stopWebTestApi(): Promise<WebTestSnapshot> {
  return unwrap(window.api.webtest.stop());
}
/** @param flow 更新后的纯数据用例。 @returns 已保存的快照。 */
export function updateWebTestApi(flow: WebTestFlow): Promise<WebTestSnapshot> {
  return unwrap(window.api.webtest.update(flow));
}
/** @returns 文件导入后的快照，取消返回 null。 */
export function importWebTestApi(): Promise<WebTestSnapshot | null> {
  return unwrap(window.api.webtest.import());
}
/** @param flow 用例数据。 @param format 输出格式。 @returns 保存路径，取消返回 null。 */
export function exportWebTestApi(flow: WebTestFlow, format: WebTestFormat): Promise<string | null> {
  return unwrap(window.api.webtest.export(flow, format));
}
/** @param callback 会话状态回调。 @returns 退订函数。 */
export function onWebTestChangedApi(callback: (snapshot: WebTestSnapshot) => void): () => void {
  return window.api.webtest.onChanged(callback);
}
