import type { WebTestVideo } from '../../shared/webtest';
import type { WebTestSession } from './session';

/** UI 与 AI 共用同一主进程会话及持久化队列，禁止另外创建浏览器控制器。 */
export interface WebTestAccess {
  session: WebTestSession;
  ready: Promise<void>;
  flush: () => Promise<void>;
  videos: () => Promise<WebTestVideo[]>;
}

let access: WebTestAccess | null = null;

/** @param value 主窗口初始化网页测试 IPC 时注册的业务入口。 */
export function registerWebTestAccess(value: WebTestAccess): void {
  access = value;
}

/** @returns 已加载持久化用例的共享业务入口。 */
export async function getWebTestAccess(): Promise<WebTestAccess> {
  if (!access) throw new Error('网页测试尚未初始化，请先打开工具箱主窗口');
  await access.ready;
  return access;
}
