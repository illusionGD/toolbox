import type { MessageApi } from 'naive-ui';

/**
 * 全局反馈（message）持有器。
 * naive-ui 的 useMessage 只能在 MessageProvider 内使用，
 * 这里在布局组件中注册实例，供 services 等非组件上下文调用。
 */

let messageApi: MessageApi | null = null;

/**
 * 注册全局 message 实例（在 MessageProvider 内的组件中调用）。
 * @param api useMessage() 返回的实例。
 */
export function setMessageApi(api: MessageApi): void {
  messageApi = api;
}

/**
 * 显示错误提示。未注册实例时降级为 console.error。
 * @param content 错误内容。
 */
export function showError(content: string): void {
  if (messageApi) {
    messageApi.error(content);
  } else {
    console.error('[feedback]', content);
  }
}

/**
 * 显示成功提示。
 * @param content 内容。
 */
export function showSuccess(content: string): void {
  messageApi?.success(content);
}

/**
 * 显示普通信息提示。
 * @param content 内容。
 */
export function showInfo(content: string): void {
  messageApi?.info(content);
}
