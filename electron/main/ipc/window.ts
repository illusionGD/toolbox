import { type BrowserWindow, ipcMain } from 'electron';
import { WINDOW_CHANNELS } from '../../shared/channels';

/**
 * 注册窗口控制 IPC，并在最大化状态变化时通知渲染进程。
 * 供无边框窗口的自绘窗控按钮使用。
 * @param win 目标主窗口。
 */
export function registerWindowControlIpc(win: BrowserWindow): void {
  ipcMain.handle(WINDOW_CHANNELS.minimize, () => win.minimize());

  ipcMain.handle(WINDOW_CHANNELS.toggleMaximize, () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return win.isMaximized();
  });

  ipcMain.handle(WINDOW_CHANNELS.close, () => win.close());

  ipcMain.handle(WINDOW_CHANNELS.isMaximized, () => win.isMaximized());

  // 最大化/还原状态变化时推送给渲染进程，用于切换按钮图标
  const notify = (): void => {
    win.webContents.send(WINDOW_CHANNELS.onMaximizeChange, win.isMaximized());
  };
  win.on('maximize', notify);
  win.on('unmaximize', notify);
}
