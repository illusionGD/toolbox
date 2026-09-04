/**
 * 一次请求登记过的 ffmpeg 任务。
 *
 * 存在的理由：转码工具跑起来之后，真正在干活的是**一个 ffmpeg 子进程**。取消对话只是
 * abort 了 HTTP 请求，子进程会一路把文件转完（CPU 满载、输出文件照样落盘），用户点了
 * 「停止」却发现任务管理器里还有 ffmpeg.exe。所以 `cancelChat` 要连它一起杀。
 */
import { cancelFfmpeg } from '../../ffmpeg/run';

/** requestId → 该请求下进行中的 ffmpeg taskId。 */
const tasks = new Map<string, Set<string>>();

/**
 * 登记一个 taskId。
 * @param requestId 请求 id。
 * @param taskId ffmpeg 任务 id。
 */
export function trackTask(requestId: string, taskId: string): void {
  const set = tasks.get(requestId) ?? new Set<string>();
  set.add(taskId);
  tasks.set(requestId, set);
}

/**
 * 撤销登记（任务正常结束时调，免得 Map 只涨不减）。
 * @param requestId 请求 id。
 * @param taskId ffmpeg 任务 id。
 */
export function untrackTask(requestId: string, taskId: string): void {
  const set = tasks.get(requestId);
  if (!set) return;
  set.delete(taskId);
  if (set.size === 0) tasks.delete(requestId);
}

/**
 * 杀掉某个请求登记过的全部 ffmpeg 任务。
 * @param requestId 请求 id。
 * @returns 真的杀掉了几个（`cancelFfmpeg` 对已结束的任务回 false）。
 */
export function killTasks(requestId: string): number {
  const set = tasks.get(requestId);
  if (!set) return 0;
  tasks.delete(requestId);
  let killed = 0;
  for (const taskId of set) {
    if (cancelFfmpeg(taskId)) killed += 1;
  }
  return killed;
}
