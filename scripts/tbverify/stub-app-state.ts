/**
 * `@/services/appState` 的桩：一个内存 blob + 记录写入次数。
 *
 * 生产实现是「启动时 await 一次 IPC 读进内存 → readState 同步读 → writeState 防抖 300ms
 * 经 IPC 写」。这里保留同步读与「写会 JSON 往返一次去掉 Vue 代理」这两条关键语义——
 * 后者是本仓库踩了五次的坑，桩要是不做往返，测试就测不出代理泄漏。
 */

/** 内存里的状态 blob。 */
const blob: Record<string, unknown> = {};
/** 每个命名空间的写入次数（断言持久化确实发生过）。 */
export const writeCounts: Record<string, number> = {};
/** 最近一次写入的值（已脱掉代理）。 */
export const lastWritten: Record<string, unknown> = {};

/**
 * 同步读一个命名空间。
 * @param ns 命名空间。
 * @returns 值；没有返回 undefined。
 */
export function readState<T>(ns: string): T | undefined {
  return blob[ns] as T | undefined;
}

/**
 * 写一个命名空间。
 * @param ns 命名空间。
 * @param value 值。
 * @returns 是否写下（桩里恒 true）。
 */
export function writeState(ns: string, value: unknown): boolean {
  // 生产实现在这里 JSON 往返一次去掉 Vue 响应式代理；桩必须照做，否则测不出代理泄漏
  blob[ns] = JSON.parse(JSON.stringify(value));
  writeCounts[ns] = (writeCounts[ns] ?? 0) + 1;
  lastWritten[ns] = blob[ns];
  return true;
}

/**
 * 直接塞一份状态（模拟「上次启动存下来的东西」）。
 * @param ns 命名空间。
 * @param value 值。
 */
export function seedState(ns: string, value: unknown): void {
  blob[ns] = value;
}

/** 清空整个 blob 与计数。 */
export function resetState(): void {
  for (const key of Object.keys(blob)) delete blob[key];
  for (const key of Object.keys(writeCounts)) delete writeCounts[key];
  for (const key of Object.keys(lastWritten)) delete lastWritten[key];
}

/**
 * 把在途写盘排空（桩是同步写，这里只是为了和生产签名一致）。
 * @returns 是否成功。
 */
export async function flushAppState(): Promise<boolean> {
  return true;
}
