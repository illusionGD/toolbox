import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { registerWindowControlIpc } from './ipc/window';
import { registerDialogIpc } from './ipc/dialog';
import { registerImageIpc } from './ipc/image';
import { APP_CHANNELS } from '../shared/channels';

/** 创建主窗口。开发环境加载 dev server，生产加载打包后的 index.html。 */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1120,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  registerWindowControlIpc(mainWindow);
  registerDialogIpc(mainWindow);
  registerImageIpc();

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.toolbox.app');

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 示例 IPC：用于验证主/渲染进程通信是否打通。
  ipcMain.handle(APP_CHANNELS.ping, () => 'pong');

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
