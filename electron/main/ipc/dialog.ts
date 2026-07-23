import { type BrowserWindow, dialog } from 'electron';
import { basename, extname } from 'path';
import { stat } from 'fs/promises';
import { DIALOG_CHANNELS } from '../../shared/channels';
import type { OpenFilesOptions, PickedFile } from '../../shared/types';
import { handle } from './helper';

/**
 * 读取文件路径的元信息，组装成 PickedFile。
 * @param filePath 文件绝对路径。
 * @returns 文件信息；读取失败返回 size 为 0。
 */
async function toPickedFile(filePath: string): Promise<PickedFile> {
  const name = basename(filePath);
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  try {
    const info = await stat(filePath);
    return { path: filePath, name, size: info.size, ext };
  } catch {
    return { path: filePath, name, size: 0, ext };
  }
}

/**
 * 注册文件对话框 IPC：选择文件、选择文件夹。
 * @param win 关联的父窗口，用于模态定位。
 */
export function registerDialogIpc(win: BrowserWindow): void {
  handle(DIALOG_CHANNELS.openFiles, async (_event, options: OpenFilesOptions = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: options.title,
      filters: options.filters,
      properties: options.multiple === false ? ['openFile'] : ['openFile', 'multiSelections'],
    });
    if (canceled) return [];
    return Promise.all(filePaths.map(toPickedFile));
  });

  handle(DIALOG_CHANNELS.openDirectory, async (_event, title?: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });
}
