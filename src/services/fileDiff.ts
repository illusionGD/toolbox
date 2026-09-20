import type {
  FileDiffDetail,
  FileDiffOptions,
  FileDiffProgress,
  FileDiffResult,
} from '@shared/fileDiff';
import { unwrap } from './ipc';

/** @param options 路径与过滤规则。 @returns 完整或明确标记的部分结果。 */
export function compareFilesApi(options: FileDiffOptions): Promise<FileDiffResult> {
  return unwrap(window.api.fileDiff.compare(options), { silent: true });
}

/** @param jobId 本次对比任务。 @returns 是否发出取消信号。 */
export function cancelFileDiffApi(jobId: string): Promise<boolean> {
  return unwrap(window.api.fileDiff.cancel(jobId), { silent: true });
}

/** @param jobId 对比任务。 @param entryId 结果条目。 @returns 只读差异预览。 */
export function getFileDiffDetailApi(jobId: string, entryId: string): Promise<FileDiffDetail> {
  return unwrap(window.api.fileDiff.detail(jobId, entryId), { silent: true });
}

/** @param callback 进度回调。 @returns 退订方法。 */
export function onFileDiffProgressApi(callback: (value: FileDiffProgress) => void): () => void {
  return window.api.fileDiff.onProgress(callback);
}
