import type {
  RenameBatchResult,
  RenamePair,
  SaveTextOptions,
  ScanOptions,
  ScanProgress,
  ScanResult,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 文件统计服务：封装 window.api.file，供渲染进程业务调用。
 */

/**
 * 递归扫描目录。
 * @param options 扫描选项（含 scanId）。
 * @returns 扫描结果。
 */
export function scanDirApi(options: ScanOptions): Promise<ScanResult> {
  return unwrap(window.api.file.scan(options), { errorPrefix: '扫描失败' });
}

/**
 * 取消进行中的扫描。
 * @param scanId 扫描 id。
 * @returns 是否成功取消（扫描已结束时为 false）。
 */
export function cancelScanApi(scanId: string): Promise<boolean> {
  // 取消失败无需打扰用户，扫描本身会正常收尾
  return unwrap(window.api.file.cancelScan(scanId), { silent: true });
}

/**
 * 在系统资源管理器中定位文件。
 * @param filePath 文件绝对路径。
 */
export function showInFolderApi(filePath: string): Promise<void> {
  return unwrap(window.api.file.showInFolder(filePath), { errorPrefix: '定位文件失败' });
}

/**
 * 保存文本到用户选择的路径。
 * @param options 保存选项。
 * @returns 写入路径；用户取消返回 null。
 */
export function saveTextApi(options: SaveTextOptions): Promise<string | null> {
  return unwrap(window.api.file.saveText(options), { errorPrefix: '保存失败' });
}

/**
 * 批量重命名。
 * 主进程 pre-flight 不过时整批不执行，结果里的 conflicts 由调用方逐行展示。
 * @param pairs 源路径与新文件名的配对。
 * @returns 执行结果。
 */
export function renameBatchApi(pairs: RenamePair[]): Promise<RenameBatchResult> {
  return unwrap(window.api.file.renameBatch(pairs), { errorPrefix: '重命名失败' });
}

/**
 * 订阅扫描进度。
 * @param callback 进度回调。
 * @returns 取消订阅函数。
 */
export function onScanProgress(callback: (progress: ScanProgress) => void): () => void {
  return window.api.file.onScanProgress(callback);
}
