import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { registerWindowControlIpc } from './ipc/window';
import { registerDialogIpc } from './ipc/dialog';
import { registerFileIpc } from './ipc/file';
import { registerImageIpc } from './ipc/image';
import { registerVideoIpc } from './ipc/video';
import { registerFontIpc } from './ipc/font';
import { registerBitmapFontIpc } from './ipc/bitmapFont';
import { registerExcelIpc } from './ipc/excel';
import { registerMediaProtocol, registerMediaScheme } from './protocol/media';
import { APP_CHANNELS } from '../shared/channels';

// 特权协议必须在 app ready 之前注册，放在模块顶层是最稳的时机
registerMediaScheme();

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
    // 任务栏/窗口图标：用 renderer 产物里的 icon.png（来自 public/icon.png），dev/prod 路径一致
    icon: join(__dirname, '../renderer/icon.png'),
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
  registerFileIpc(mainWindow);
  registerImageIpc();
  registerVideoIpc(mainWindow);
  registerFontIpc(mainWindow);
  registerBitmapFontIpc(mainWindow);
  registerExcelIpc();

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.toolbox.app');
  registerMediaProtocol();

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
