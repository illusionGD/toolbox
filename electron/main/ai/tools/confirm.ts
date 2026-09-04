/**
 * 写盘工具的确认往返。
 *
 * 形状是一个 `Map<callId, {requestId, resolve}>`：`execute` 里 `await requestConfirm(...)`
 * 挂住，渲染进程点「允许 / 拒绝」经 `ai:toolReply` 回来 `replyConfirm` 才放行。
 *
 * **本文件最重要的一条是 {@link denyPending}**：`streamText` 的 `abortSignal` 管不到我们
 * 自己 await 的这个 promise，取消请求时不主动判掉，`execute` 就永远挂着——请求既不结束
 * 也不报错，界面上是一条永远在转的消息。这是本轮唯一一处「漏了不报错、只挂死」的地方。
 *
 * **不设超时**：用户可能离开电脑，超时自动拒绝比一直等更糟（他回来只看到一句「已拒绝」，
 * 还得重问一遍）。唯一出路是「停止」按钮，它走 `cancelChat` → `denyPending`。
 */

/** 一条等待回答的确认。 */
interface PendingConfirm {
  /** 归属的请求 id，取消时按它批量判掉。 */
  requestId: string;
  /** 兑现 `requestConfirm` 返回的那个 promise。 */
  resolve: (approved: boolean) => void;
}

/** callId → 等待中的确认。 */
const pending = new Map<string, PendingConfirm>();

/**
 * 登记一次确认并等待回答。
 * @param requestId 所属请求 id。
 * @param callId 这次调用的 id。
 * @returns 用户是否允许。
 */
export function requestConfirm(requestId: string, callId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pending.set(callId, { requestId, resolve });
  });
}

/**
 * 回答一次确认。
 * @param callId 调用 id。
 * @param approved 是否允许。
 * @returns 找到并兑现了为 true；未知或已回答过的 callId 返回 false（**不抛**：界面上
 * 那张卡片可能是从磁盘读回来的历史记录，点了没人接是正常的）。
 */
export function replyConfirm(callId: string, approved: boolean): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;
  pending.delete(callId);
  entry.resolve(approved);
  return true;
}

/**
 * 把某个请求下所有等待中的确认一律判为拒绝。
 *
 * 取消请求（用户点「停止」、AI 窗口被关掉）时**必须**调，见文件头。
 * @param requestId 请求 id。
 * @returns 判掉的条数。
 */
export function denyPending(requestId: string): number {
  let count = 0;
  for (const [callId, entry] of pending) {
    if (entry.requestId !== requestId) continue;
    pending.delete(callId);
    entry.resolve(false);
    count += 1;
  }
  return count;
}
