import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import {
  APP_CHANNELS,
  DIALOG_CHANNELS,
  FILE_CHANNELS,
  IMAGE_CHANNELS,
  WINDOW_CHANNELS,
} from '../shared/channels';
import type {
  AutoCropOptions,
  CompressOptions,
  CompressResult,
  CropOptions,
  CropProbe,
  CropResult,
  IpcResponse,
  OpenFilesOptions,
  PickedFile,
  RenameBatchResult,
  RenamePair,
  SaveTextOptions,
  ScanOptions,
  ScanProgress,
  ScanResult,
  StylizeOptions,
  StylizePreviewOptions,
  StylizeResult,
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

  /** 文件统计与文件系统操作。 */
  file: {
    /**
     * 递归扫描目录，收集文件信息。
     * @param options 扫描选项（含 scanId，用于取消与进度关联）。
     * @returns 统一响应，data 为扫描结果。
     */
    scan: (options: ScanOptions): Promise<IpcResponse<ScanResult>> =>
      ipcRenderer.invoke(FILE_CHANNELS.scan, options),
    /**
     * 取消进行中的扫描。
     * @param scanId 扫描 id。
     * @returns 统一响应，data 为是否找到并取消了对应扫描。
     */
    cancelScan: (scanId: string): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke(FILE_CHANNELS.cancelScan, scanId),
    /**
     * 在系统资源管理器中定位文件。
     * @param filePath 文件绝对路径。
     * @returns 统一响应，data 为 void。
     */
    showInFolder: (filePath: string): Promise<IpcResponse<void>> =>
      ipcRenderer.invoke(FILE_CHANNELS.showInFolder, filePath),
    /**
     * 弹出保存对话框并写入文本文件。
     * @param options 保存选项。
     * @returns 统一响应，data 为写入路径（取消为 null）。
     */
    saveText: (options: SaveTextOptions): Promise<IpcResponse<string | null>> =>
      ipcRenderer.invoke(FILE_CHANNELS.saveText, options),
    /**
     * 批量重命名（主进程先做 pre-flight，冲突则整批不动）。
     * @param pairs 源路径与新文件名的配对。
     * @returns 统一响应，data 为执行结果（已改/冲突/失败）。
     */
    renameBatch: (pairs: RenamePair[]): Promise<IpcResponse<RenameBatchResult>> =>
      ipcRenderer.invoke(FILE_CHANNELS.renameBatch, pairs),
    /**
     * 订阅扫描进度。
     * @param callback 进度回调。
     * @returns 取消订阅的函数。
     */
    onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: ScanProgress): void => callback(progress);
      ipcRenderer.on(FILE_CHANNELS.scanProgress, listener);
      return () => ipcRenderer.off(FILE_CHANNELS.scanProgress, listener);
    },
  },

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
    /**
     * 探测自动裁剪的包围盒（只算不写盘）。
     * @param filePath 图片路径。
     * @param auto 自动裁剪参数。
     * @returns 统一响应，data 为原图尺寸与包围盒。
     */
    probeCrop: (filePath: string, auto: AutoCropOptions): Promise<IpcResponse<CropProbe>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.probeCrop, filePath, auto),
    /**
     * 裁剪单张图片。
     * @param sourcePath 源文件路径。
     * @param options 裁剪选项。
     * @returns 统一响应，data 为裁剪结果。
     */
    crop: (sourcePath: string, options: CropOptions): Promise<IpcResponse<CropResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.crop, sourcePath, options),
    /**
     * 生成风格化预览（缩放后处理，不写盘）。
     * @param filePath 图片路径。
     * @param options 预览选项。
     * @returns 统一响应，data 为预览 data URL。
     */
    stylizePreview: (
      filePath: string,
      options: StylizePreviewOptions,
    ): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.stylizePreview, filePath, options),
    /**
     * 风格化单张图片。
     * @param sourcePath 源文件路径。
     * @param options 风格化选项。
     * @returns 统一响应，data 为处理结果。
     */
    stylize: (sourcePath: string, options: StylizeOptions): Promise<IpcResponse<StylizeResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.stylize, sourcePath, options),
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
