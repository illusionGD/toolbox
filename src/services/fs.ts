import type { OpenFilesOptions, PickedFile } from '@shared/types';
import { unwrap } from './ipc';

/**
 * 文件系统相关服务：封装 window.api.dialog，供渲染进程业务调用。
 * 统一入口便于后续替换实现或加日志/权限校验。
 */

/**
 * 打开文件选择对话框。
 * @param options 过滤、多选等选项。
 * @returns 选中文件信息数组；取消返回空数组。
 */
export function pickFilesApi(options?: OpenFilesOptions): Promise<PickedFile[]> {
  return unwrap(window.api.dialog.openFiles(options), { errorPrefix: '选择文件失败' });
}

/**
 * 打开文件夹选择对话框。
 * @param title 对话框标题。
 * @returns 选中目录路径；取消返回 null。
 */
export function pickDirectoryApi(title?: string): Promise<string | null> {
  return unwrap(window.api.dialog.openDirectory(title), { errorPrefix: '选择文件夹失败' });
}
