import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import { registerExternalLinkGuards } from './externalLinks';
import { registerWindowControlIpc } from './ipc/window';
import { registerDialogIpc } from './ipc/dialog';
import { registerFileIpc } from './ipc/file';
import { registerFileDiffIpc } from './ipc/fileDiff';
import { registerImageIpc } from './ipc/image';
import { registerVideoIpc } from './ipc/video';
import { registerAudioIpc } from './ipc/audio';
import { registerFontIpc } from './ipc/font';
import { registerBitmapFontIpc } from './ipc/bitmapFont';
import { registerExcelIpc } from './ipc/excel';
import { registerStorageIpc } from './ipc/storage';
import { registerAiIpc } from './ipc/ai';
import { registerPetIpc } from './ipc/pet';
import { registerAppCloseIpc } from './ipc/appClose';
import { registerWebTestIpc } from './ipc/webtest';
import { initPanelWindow } from './ai/panelWindow';
import { initPetWindow, restorePetWindow } from './pet/petWindow';
import { initAppClose } from './appClose';
import { initWindowNav } from './windowNav';
import { registerMediaProtocol, registerMediaScheme } from './protocol/media';
import { initStoragePaths } from './storage/paths';
import { registerAppStateSuspender } from './storage/appState';
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

  // 外链兜底两道口子（window.open + 普通 a href），见 externalLinks.ts
  registerExternalLinkGuards(mainWindow.webContents);

  registerWindowControlIpc(mainWindow);
  registerDialogIpc(mainWindow);
  registerFileIpc(mainWindow);
  registerFileDiffIpc(mainWindow);
  registerImageIpc();
  registerVideoIpc(mainWindow);
  registerAudioIpc(mainWindow);
  registerFontIpc(mainWindow);
  registerBitmapFontIpc(mainWindow);
  registerExcelIpc();
  registerStorageIpc();
  registerAiIpc();
  registerPetIpc();
  registerAppCloseIpc();
  registerWebTestIpc(mainWindow);
  // 主窗口的引用两个子窗口都要摸（AI 窗口跳设置页、桌宠把它藏起来再拿回来），存一处
  initWindowNav(mainWindow);
  // AI 对话是独立窗口：把主窗口交给它当宿主（默认位置 + 设置页跳转 + 跟着一起关）
  initPanelWindow(mainWindow);
  // 桌宠同理，但它还会把主窗口 hide() 掉——所以主窗口关掉时必须连它一起销毁，
  // 否则进程里会剩一个 skipTaskbar 的窗口，任务栏上连个能点的图标都没有
  initPetWindow(mainWindow);
  // 关闭行为（退出 / 收进托盘 / 每次询问）。**排在 initPetWindow 之后**：两个 close 监听器
  // 各管自己那一支（桌宠开着时这里直接早退，让桌宠那条 hide() 规则赢），顺序写死好读
  initAppClose(mainWindow);

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.toolbox.app');
  registerMediaProtocol();

  // 存储路径必须在建窗口之前定下来：渲染进程一挂载就会读应用状态。
  // 但它绝不能挡住建窗口——catch 掉之后渲染进程会自己降级，总比双击图标毫无反应好。
  try {
    await initStoragePaths();
    registerAppStateSuspender();
  } catch (error) {
    console.error('[main] 存储初始化失败，继续启动：', error);
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 示例 IPC：用于验证主/渲染进程通信是否打通。
  ipcMain.handle(APP_CHANNELS.ping, () => 'pong');

  createWindow();
  // 上次退出时停在桌宠模式的话，这次也直接进桌宠。放在 createWindow() 之后：
  // 它要拿主窗口当默认位置的参照，还要把主窗口 hide() 掉
  void restorePetWindow().catch((error) => {
    console.error('[main] 恢复桌宠模式失败，留在主窗口：', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
