/**
 * 「关闭主窗口时」的 IPC 封装。
 *
 * 为什么关闭行为要过主进程，而不是渲染进程自己读写 `appWindow` 命名空间：`close` 事件的
 * 处理器是**同步**的，`preventDefault()` 等不了一次 `await readAppState()`，所以生效的动作
 * 在主进程里有一份缓存，这几条就是刷新它的唯一入口。见 electron/main/appClose.ts。
 */
import type { AppCloseAction, AppCloseChoice } from '@shared/appWindow';
import { unwrap } from './ipc';

/**
 * 改「关闭主窗口时」这个设置（设置页的 radio 与弹窗的「记住我的选择」共用）。
 * @param action 三态之一。
 * @returns 归一化之后真正生效的动作。
 */
export function setCloseActionApi(action: AppCloseAction): Promise<AppCloseAction> {
  return unwrap(window.api.appWindow.setCloseAction(action), { errorPrefix: '保存关闭行为失败' });
}

/**
 * 按用户在确认弹窗里点的那一下关。
 *
 * `silent`：三条路各有各的收尾——「退出」成功了进程就没了、「最小化到托盘」失败由弹窗自己
 * 显示那行 `n-alert`（比一个转瞬就没的 toast 醒目），「取消」什么都不做。
 * @param choice 取消 / 退出 / 最小化到托盘。
 * @param remember 是否把这次的选择记成设置。
 * @returns 是否真做到了；false 只出现在「最小化到托盘」但托盘不可用时。
 */
export function resolveCloseApi(choice: AppCloseChoice, remember: boolean): Promise<boolean> {
  return unwrap(window.api.appWindow.resolveClose(choice, remember), { silent: true });
}

/**
 * 订阅主进程的「请弹关闭确认弹窗」。
 * @param callback 收到请求时的回调。
 * @returns 取消订阅的函数。
 */
export function onClosePrompt(callback: () => void): () => void {
  return window.api.appWindow.onClosePrompt(callback);
}
