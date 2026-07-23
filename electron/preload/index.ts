import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { APP_CHANNELS, DIALOG_CHANNELS, IMAGE_CHANNELS, WINDOW_CHANNELS } from '../shared/channels';
import type {
  CompressOptions,
  CompressResult,
  IpcResponse,
  OpenFilesOptions,
  PickedFile,
} from '../shared/types';

/** 暴露给渲染进程的自定义 API。 */
const api = {
  /**
   * 向主进程发送 ping，验证 IPC 通道连通。
   * @returns 主进程返回的 'pong' 字符串。
   */
  ping: (): Promise<string> => ipcRenderer.invoke(APP_CHANNELS.ping),

  /** 无边框窗口的窗控能力。 */
  window: {
    /** 最小化窗口。 */
    minimize: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.minimize),
    /**
     * 切换最大化/还原。
     * @returns 切换后是否处于最大化。
     */
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(WINDOW_CHANNELS.toggleMaximize),
    /** 关闭窗口。 */
    close: (): Promise<void> => ipcRenderer.invoke(WINDOW_CHANNELS.close),
    /**
     * 查询当前是否最大化。
     * @returns 是否最大化。
     */
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(WINDOW_CHANNELS.isMaximized),
    /**
     * 订阅最大化状态变化。
     * @param callback 状态变化回调，参数为是否最大化。
     * @returns 取消订阅的函数。
     */
    onMaximizeChange: (callback: (maximized: boolean) => void): (() => void) => {
      const listener = (_event: unknown, maximized: boolean): void => callback(maximized);
      ipcRenderer.on(WINDOW_CHANNELS.onMaximizeChange, listener);
      return () => ipcRenderer.off(WINDOW_CHANNELS.onMaximizeChange, listener);
    },
  },

  /** 文件对话框。 */
  dialog: {
    /**
     * 打开文件选择对话框。
     * @param options 过滤、多选等选项。
     * @returns 统一响应，data 为选中文件信息数组（取消为空数组）。
     */
    openFiles: (options?: OpenFilesOptions): Promise<IpcResponse<PickedFile[]>> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.openFiles, options),
    /**
     * 打开文件夹选择对话框。
     * @param title 对话框标题。
     * @returns 统一响应，data 为目录路径（取消为 null）。
     */
    openDirectory: (title?: string): Promise<IpcResponse<string | null>> =>
      ipcRenderer.invoke(DIALOG_CHANNELS.openDirectory, title),
  },

  /**
   * 获取拖拽进来的 File 对象在磁盘上的绝对路径。
   * Electron 中 File.path 已废弃，须用 webUtils.getPathForFile。
   * @param file 拖拽事件得到的 File 对象。
   * @returns 文件绝对路径。
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** 图片处理。 */
  image: {
    /**
     * 生成缩略图 data URL。
     * @param filePath 图片路径。
     * @returns 统一响应，data 为 webp 缩略图 data URL。
     */
    thumbnail: (filePath: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.thumbnail, filePath),
    /**
     * 读取原图 data URL（对比大图用）。
     * @param filePath 图片路径。
     * @returns 统一响应，data 为原图 data URL。
     */
    dataUrl: (filePath: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.dataUrl, filePath),
    /**
     * 压缩单张图片。
     * @param sourcePath 源文件路径。
     * @param options 压缩选项。
     * @returns 统一响应，data 为压缩结果。
     */
    compress: (
      sourcePath: string,
      options: CompressOptions,
    ): Promise<IpcResponse<CompressResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.compress, sourcePath, options),
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
    contextBridge.exposeInMainWorld('api', api);
  } catch (error) {
    console.error(error);
  }
} else {
  Object.assign(window, { electron: electronAPI, api });
}

export type ExposedApi = typeof api;
