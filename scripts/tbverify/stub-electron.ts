/**
 * `electron` 的桩：`app.getPath` 指到临时目录，`safeStorage` 用 AES 做替身，
 * `ipcMain` 记下注册的 handler 供测试直接 invoke。
 *
 * **不是真加密的验证**——真 DPAPI 的跨进程/跨重启实测另有其事（见 ai-chat 技能）。
 * 这里只需要「可用时密文能解回来 / 不可用时落明文并如实标记」这两条行为。
 *
 * `BrowserWindow` / `screen` / `shell` / `session` / `dialog` / `protocol` 是**导入期需要
 * 存在的最小替身**：`ipc/ai.ts` 连上了 `ai/panelWindow.ts`，23b 起又经 `ai/tools/registry.ts`
 * 连上了 `ipc/{file,image,video,audio,font,excel}.ts`（`dialog` 在 file.ts 的另存里、
 * `protocol` 在 `protocol/media.ts` 里）。这些桩测都不碰，只是别让 bundle 断。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** 本次运行的临时 userData。 */
const userData = mkdtempSync(path.join(tmpdir(), 'tbverify-ai-'));

/** AES 替身的固定密钥（桩，不是安全设计）。 */
const AES_KEY = randomBytes(32);

/** 加密能力开关，测试可切换。 */
let encryptionAvailable = true;

/**
 * 切换 safeStorage 的可用性（测降级明文路径）。
 * @param value 是否可用。
 */
export function setEncryptionAvailable(value: boolean): void {
  encryptionAvailable = value;
}

export const app = {
  /** 打包标记。`@electron-toolkit/utils` 的 `is.dev` 在模块加载时就读它。 */
  isPackaged: false,
  /**
   * 取路径。
   * @param name 路径名。
   * @returns 目录绝对路径。
   */
  getPath(name: string): string {
    return name === 'userData' ? userData : tmpdir();
  },
};

/** 已注册的 IPC handler：通道名 → 处理函数。 */
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

export const ipcMain = {
  /**
   * 注册一个 handler（`ipc/helper.ts` 的 `handle` 走这里）。
   * @param channel 通道名。
   * @param fn 处理函数。
   */
  handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void {
    handlers.set(channel, fn);
  },
};

/**
 * 像渲染进程那样调一次已注册的通道。
 *
 * **这样才测得到生产代码里 `e.sender` 那两处**（按发送方推分片、发送方销毁时取消），
 * 自己在测试里重写一遍逻辑等于什么都没验证。
 * @param channel 通道名。
 * @param event 假的 IpcMainInvokeEvent（至少要有 sender）。
 * @param args 入参。
 * @returns handler 的返回值（统一响应）。
 * @throws 通道没注册时抛。
 */
export function invokeIpc(channel: string, event: unknown, ...args: unknown[]): unknown {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`通道未注册：${channel}`);
  return fn(event, ...args);
}

/** 已注册的通道名列表（断言注册齐了）。 */
export function registeredChannels(): string[] {
  return [...handlers.keys()];
}

/**
 * 最小 BrowserWindow 替身。
 *
 * 桩测不真开窗口（`openPanelWindow` 不在断言范围内），但 `panelWindow.ts` 里有
 * `new BrowserWindow(...)`，导入时这个绑定必须存在。
 */
export class BrowserWindow {
  /**
   * @param options 窗口选项（桩里只记下来）。
   */
  constructor(public options: unknown = {}) {}
}

export const screen = {
  /**
   * 取主显示器。
   * @returns 显示器信息。
   */
  getPrimaryDisplay() {
    return { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  },
  /**
   * 取与某矩形重叠最多的显示器。
   * @returns 显示器信息。
   */
  getDisplayMatching() {
    return { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  },
};

/**
 * 最小 `Tray` / `Menu` / `nativeImage` 替身。
 *
 * `main/tray.ts` 的行为（空图标先挡、换 owner 先清监听、「退出 app」由模块自己追加）
 * 是**源码哨兵**在守的，不是这里跑出来的——这三个绑定只为「导入期不炸」而存在。
 * 真机上那几条结论都是真 Electron 探针量的，桩里模拟一个 Tray 反而会给出假的安全感。
 */
export class Tray {
  /**
   * @param icon 托盘图标（桩里只记下来）。
   */
  constructor(public icon: unknown = {}) {}
  /** 设置悬浮提示。 */
  setToolTip(): void {}
  /** 设置右键菜单。 */
  setContextMenu(): void {}
  /** 清掉某个事件的全部监听。 */
  removeAllListeners(): void {}
  /** 挂监听。 */
  on(): void {}
  /**
   * 是否已销毁。
   * @returns 恒为 false。
   */
  isDestroyed(): boolean {
    return false;
  }
  /** 销毁。 */
  destroy(): void {}
}

export const Menu = {
  /**
   * 由模板建菜单。
   * @param template 菜单项数组（桩里原样带回）。
   * @returns 菜单替身。
   */
  buildFromTemplate(template: unknown) {
    return { template };
  },
};

export const nativeImage = {
  /**
   * 从路径读图（桩里恒为空图）。
   * @returns 图片替身。
   */
  createFromPath() {
    return {
      /**
       * 是否空图。
       * @returns 恒为 true（桩测不带图标文件）。
       */
      isEmpty: () => true,
      /**
       * 缩放。
       * @returns 自身。
       */
      resize() {
        return this;
      },
    };
  },
  /**
   * 空图。
   * @returns 图片替身。
   */
  createEmpty() {
    return {
      /**
       * 是否空图。
       * @returns 恒为 true。
       */
      isEmpty: () => true,
    };
  },
};

export const shell = {
  /**
   * 用系统浏览器打开链接。
   * @param _url 链接。
   */
  async openExternal(_url: string): Promise<void> {},
};

export const session = {
  defaultSession: {
    /**
     * 设置代理。
     */
    async setProxy(): Promise<void> {},
  },
};

export const dialog = {
  /**
   * 选文件（桩里恒为取消）。
   * @returns 取消结果。
   */
  async showOpenDialog(): Promise<{ canceled: boolean; filePaths: string[] }> {
    return { canceled: true, filePaths: [] };
  },
  /**
   * 另存（桩里恒为取消）。
   * @returns 取消结果。
   */
  async showSaveDialog(): Promise<{ canceled: boolean; filePath?: string }> {
    return { canceled: true };
  },
};

export const protocol = {
  /**
   * 注册自定义协议（桩里空操作）。
   */
  handle(): void {},
  /**
   * 声明协议特权（桩里空操作）。
   */
  registerSchemesAsPrivileged(): void {},
};

export const safeStorage = {
  /**
   * 加密能力是否可用。
   * @returns 是否可用。
   */
  isEncryptionAvailable(): boolean {
    return encryptionAvailable;
  },
  /**
   * 加密一段明文。
   * @param plain 明文。
   * @returns iv + 密文。
   */
  encryptString(plain: string): Buffer {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', AES_KEY, iv);
    return Buffer.concat([iv, cipher.update(plain, 'utf8'), cipher.final()]);
  },
  /**
   * 解密一段密文。
   * @param buffer iv + 密文。
   * @returns 明文。
   */
  decryptString(buffer: Buffer): string {
    const iv = buffer.subarray(0, 16);
    const decipher = createDecipheriv('aes-256-cbc', AES_KEY, iv);
    return Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]).toString('utf8');
  },
};
