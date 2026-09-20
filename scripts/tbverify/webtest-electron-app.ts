import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { registerWebTestIpc } from '../../electron/main/ipc/webtest';
import { initStoragePaths } from '../../electron/main/storage/paths';
import { registerStorageIpc } from '../../electron/main/ipc/storage';
import { registerFileIpc } from '../../electron/main/ipc/file';
import { registerMediaScheme, registerMediaProtocol } from '../../electron/main/protocol/media';
import { WEBTEST_TOOLS } from '../../electron/main/ai/tools/webtest';

const root = resolve('out-tbverify/webtest-electron');
registerMediaScheme();
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
mkdirSync(root, { recursive: true });
app.setPath('userData', root);
app.setPath('temp', root);
// 系统对话框只替换用户选择；生产导入解析、导出写盘与 IPC 契约照常运行。
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: [resolve(root, 'import.json')],
});
dialog.showSaveDialog = async (_window, options) => ({
  canceled: false,
  filePath: resolve(root, options?.title === '保存录制视频' ? 'saved-video.webm' : 'export.js'),
});
app.whenReady().then(async () => {
  await initStoragePaths();
  registerStorageIpc();
  registerMediaProtocol();
  ipcMain.handle('window:isMaximized', () => false);
  ipcMain.handle('pet:isOpen', () => ({ code: 0, data: false, message: '' }));
  const window = new BrowserWindow({
    show: false,
    width: 1120,
    height: 720,
    webPreferences: {
      preload: resolve('out/preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  registerWebTestIpc(window);
  registerFileIpc(window);
  // 仅测试宿主提供适配器调用入口，生产工具仍通过 SDK 的确认包装层执行。
  Object.assign(globalThis, {
    __verifyWebTestTool: async (name: string, input: unknown) => {
      const tool = WEBTEST_TOOLS.find((item) => item.name === name);
      if (!tool) throw new Error('unknown tool');
      return tool.run(tool.inputSchema.parse(input), {
        requestId: 'ui-review',
        mode: 'auto',
        emit: () => {},
        trackTask: () => {},
      });
    },
  });
  await window.loadFile(resolve('out/renderer/index.html'), { hash: '/dev/webtest' });
});
