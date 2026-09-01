import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import {
  APP_CHANNELS,
  BITMAP_FONT_CHANNELS,
  DIALOG_CHANNELS,
  EXCEL_CHANNELS,
  FILE_CHANNELS,
  FONT_CHANNELS,
  IMAGE_CHANNELS,
  VIDEO_CHANNELS,
  WINDOW_CHANNELS,
} from '../shared/channels';
import type {
  AutoCropOptions,
  BitmapFontOptions,
  BitmapFontPackOptions,
  BitmapFontPreview,
  BitmapFontProgress,
  BitmapFontResult,
  CompressOptions,
  CompressResult,
  CropOptions,
  CropProbe,
  CropResult,
  ExcelI18nOptions,
  ExcelI18nPreviewResult,
  ExcelI18nWriteResult,
  ExcelProbeResult,
  FontConvertOptions,
  FontConvertProgress,
  FontConvertResult,
  FontMeta,
  FontSplitOptions,
  FontSplitResult,
  FontSubsetOptions,
  FontSubsetResult,
  IpcResponse,
  OpenFilesOptions,
  PickedFile,
  QrDecodeResult,
  QrGenerateOptions,
  QrGenerateResult,
  QrPreviewOptions,
  RenameBatchResult,
  RenamePair,
  SaveTextOptions,
  ScanOptions,
  ScanProgress,
  ScanResult,
  SpriteMergeOptions,
  SpriteMergePreview,
  SpriteMergeResult,
  SpriteSliceOptions,
  SpriteSliceProbe,
  SpriteSliceProbeOptions,
  SpriteSliceResult,
  StylizeOptions,
  StylizePreviewOptions,
  StylizeResult,
  TranscodeOptions,
  TranscodeResult,
  VideoCapabilities,
  VideoMeta,
  VideoProgress,
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
     * 读取文本文件内容（utf-8）。
     * @param filePath 文件路径。
     * @returns 统一响应，data 为文本内容。
     */
    readText: (filePath: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(FILE_CHANNELS.readText, filePath),
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
    /**
     * 合并多图为精灵表 + 坐标数据。
     * @param options 合并选项。
     * @returns 统一响应，data 为合并结果。
     */
    spriteMerge: (options: SpriteMergeOptions): Promise<IpcResponse<SpriteMergeResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.spriteMerge, options),
    /**
     * 合并预览（只算不写盘）。
     * @param options 合并选项。
     * @returns 统一响应，data 为预览 data URL 与图集尺寸。
     */
    spriteMergePreview: (options: SpriteMergeOptions): Promise<IpcResponse<SpriteMergePreview>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.spriteMergePreview, options),
    /**
     * 探测精灵表将切出的单元（只算不写盘）。
     * @param filePath 精灵表路径。
     * @param options 探测选项。
     * @returns 统一响应，data 为表尺寸与切割单元。
     */
    spriteSliceProbe: (
      filePath: string,
      options: SpriteSliceProbeOptions,
    ): Promise<IpcResponse<SpriteSliceProbe>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.spriteSliceProbe, filePath, options),
    /**
     * 切割精灵表为多张小图。
     * @param filePath 精灵表路径。
     * @param options 切割选项。
     * @returns 统一响应，data 为切割结果。
     */
    spriteSlice: (
      filePath: string,
      options: SpriteSliceOptions,
    ): Promise<IpcResponse<SpriteSliceResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.spriteSlice, filePath, options),
    /**
     * 批量生成二维码。
     * @param options 生成选项。
     * @returns 统一响应，data 为成功路径与失败数。
     */
    qrGenerate: (options: QrGenerateOptions): Promise<IpcResponse<QrGenerateResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.qrGenerate, options),
    /**
     * 二维码预览（只算不写盘）。
     * @param options 预览选项。
     * @returns 统一响应，data 为 png data URL。
     */
    qrPreview: (options: QrPreviewOptions): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.qrPreview, options),
    /**
     * 解析单张图片的二维码。
     * @param filePath 图片路径。
     * @returns 统一响应，data 为解析结果。
     */
    qrDecode: (filePath: string): Promise<IpcResponse<QrDecodeResult>> =>
      ipcRenderer.invoke(IMAGE_CHANNELS.qrDecode, filePath),
  },

  /** 视频处理（ffmpeg）。 */
  video: {
    /**
     * 探测当前 ffmpeg 构建可用的编码器。
     * @returns 统一响应，data 为版本与编码器集合。
     */
    capabilities: (): Promise<IpcResponse<VideoCapabilities>> =>
      ipcRenderer.invoke(VIDEO_CHANNELS.capabilities),
    /**
     * 读取视频元信息，同时把该路径登记进 tb-media 播放白名单。
     * @param filePath 视频路径。
     * @returns 统一响应，data 为元信息。
     */
    probe: (filePath: string): Promise<IpcResponse<VideoMeta>> =>
      ipcRenderer.invoke(VIDEO_CHANNELS.probe, filePath),
    /**
     * 抽一帧作缩略图。
     * @param filePath 视频路径。
     * @returns 统一响应，data 为 jpeg data URL。
     */
    thumbnail: (filePath: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(VIDEO_CHANNELS.thumbnail, filePath),
    /**
     * 转码单个视频。
     * @param sourcePath 源文件路径。
     * @param options 转码选项（含 taskId，用于取消与进度关联）。
     * @returns 统一响应，data 为转码结果。
     */
    transcode: (
      sourcePath: string,
      options: TranscodeOptions,
    ): Promise<IpcResponse<TranscodeResult>> =>
      ipcRenderer.invoke(VIDEO_CHANNELS.transcode, sourcePath, options),
    /**
     * 取消进行中的转码。
     * @param taskId 任务 id。
     * @returns 统一响应，data 为是否杀掉了对应进程。
     */
    cancel: (taskId: string): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke(VIDEO_CHANNELS.cancelTranscode, taskId),
    /**
     * 订阅转码进度。
     * @param callback 进度回调。
     * @returns 取消订阅的函数。
     */
    onProgress: (callback: (progress: VideoProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: VideoProgress): void => callback(progress);
      ipcRenderer.on(VIDEO_CHANNELS.transcodeProgress, listener);
      return () => ipcRenderer.off(VIDEO_CHANNELS.transcodeProgress, listener);
    },
  },

  /** 字体处理（subset-font + fontkit）。 */
  font: {
    /**
     * 读字体元信息（字体名/字形数/大小）。
     * @param filePath 字体路径。
     * @returns 统一响应，data 为元信息。
     */
    probe: (filePath: string): Promise<IpcResponse<FontMeta>> =>
      ipcRenderer.invoke(FONT_CHANNELS.probe, filePath),
    /**
     * 裁剪预览（只裁不写盘）。
     * @param filePath 字体路径。
     * @param chars 要保留的字符集。
     * @returns 统一响应，data 为 woff2 的 data URL。
     */
    subsetPreview: (filePath: string, chars: string): Promise<IpcResponse<string>> =>
      ipcRenderer.invoke(FONT_CHANNELS.subsetPreview, filePath, chars),
    /**
     * 按字符集裁剪字体并落盘。
     * @param sourcePath 源字体路径。
     * @param options 裁剪选项。
     * @returns 统一响应，data 为裁剪结果。
     */
    subset: (
      sourcePath: string,
      options: FontSubsetOptions,
    ): Promise<IpcResponse<FontSubsetResult>> =>
      ipcRenderer.invoke(FONT_CHANNELS.subset, sourcePath, options),
    /**
     * 网页分包：一个字体切成多个 unicode-range 分包 + CSS。
     * @param sourcePath 源字体路径。
     * @param options 分包选项。
     * @returns 统一响应，data 为产物摘要。
     */
    split: (sourcePath: string, options: FontSplitOptions): Promise<IpcResponse<FontSplitResult>> =>
      ipcRenderer.invoke(FONT_CHANNELS.split, sourcePath, options),
    /**
     * 纯容器格式转换（fontverter，无损不裁剪），一次可产出多个格式。
     * @param sourcePath 源字体路径。
     * @param options 转换选项。
     * @returns 统一响应，data 为转换结果。
     */
    convert: (
      sourcePath: string,
      options: FontConvertOptions,
    ): Promise<IpcResponse<FontConvertResult>> =>
      ipcRenderer.invoke(FONT_CHANNELS.convert, sourcePath, options),
    /**
     * 取消进行中的格式转换。
     * @param taskId 任务 id。
     * @returns 统一响应，data 恒为 true（只置标记，正在编码的格式仍会跑完）。
     */
    cancelConvert: (taskId: string): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke(FONT_CHANNELS.cancelConvert, taskId),
    /**
     * 订阅格式转换进度。
     * @param callback 进度回调。
     * @returns 取消订阅的函数。
     */
    onConvertProgress: (callback: (progress: FontConvertProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: FontConvertProgress): void => callback(progress);
      ipcRenderer.on(FONT_CHANNELS.convertProgress, listener);
      return () => ipcRenderer.off(FONT_CHANNELS.convertProgress, listener);
    },
  },
  /** 位图字体（图集 + BMFont 描述文件）。 */
  bitmapFont: {
    /**
     * 从字体生成图集 + 描述文件并落盘。
     * @param options 生成选项。
     * @returns 统一响应，data 为产物摘要。
     */
    generate: (options: BitmapFontOptions): Promise<IpcResponse<BitmapFontResult>> =>
      ipcRenderer.invoke(BITMAP_FONT_CHANNELS.generate, options),
    /**
     * 生成预览（只算不写盘）。
     * @param options 生成选项。
     * @returns 统一响应，data 为各页预览。
     */
    preview: (options: BitmapFontOptions): Promise<IpcResponse<BitmapFontPreview>> =>
      ipcRenderer.invoke(BITMAP_FONT_CHANNELS.preview, options),
    /**
     * 把一组字符图片打包成位图字体。
     * @param options 打包选项。
     * @returns 统一响应，data 为产物摘要。
     */
    packImages: (options: BitmapFontPackOptions): Promise<IpcResponse<BitmapFontResult>> =>
      ipcRenderer.invoke(BITMAP_FONT_CHANNELS.packImages, options),
    /**
     * 取消进行中的生成。
     * @param taskId 任务 id。
     * @returns 统一响应，data 恒为 true（只置标记，正在栅格化的页会跑完）。
     */
    cancel: (taskId: string): Promise<IpcResponse<boolean>> =>
      ipcRenderer.invoke(BITMAP_FONT_CHANNELS.cancel, taskId),
    /**
     * 订阅生成进度。
     * @param callback 进度回调。
     * @returns 取消订阅的函数。
     */
    onProgress: (callback: (progress: BitmapFontProgress) => void): (() => void) => {
      const listener = (_event: unknown, progress: BitmapFontProgress): void => callback(progress);
      ipcRenderer.on(BITMAP_FONT_CHANNELS.progress, listener);
      return () => ipcRenderer.off(BITMAP_FONT_CHANNELS.progress, listener);
    },
  },
  /** Excel 多语言表转 i18n JSON。 */
  excel: {
    /**
     * 探测工作簿结构（sheet 名 / 表头行各列文字 / 行列数）。
     * @param filePath 表格路径。
     * @param headerRow 表头行行号（1-based）。
     * @returns 统一响应，data 为结构信息。
     */
    probe: (filePath: string, headerRow: number): Promise<IpcResponse<ExcelProbeResult>> =>
      ipcRenderer.invoke(EXCEL_CHANNELS.probe, filePath, headerRow),
    /**
     * 转换预览（只算不写盘）：全部列的统计 + 指定列的 JSON 文本。
     * @param filePath 表格路径。
     * @param options 转换选项。
     * @param previewColumn 要预览的列号（1-based）。
     * @returns 统一响应，data 为统计与单列 JSON。
     */
    preview: (
      filePath: string,
      options: ExcelI18nOptions,
      previewColumn: number,
    ): Promise<IpcResponse<ExcelI18nPreviewResult>> =>
      ipcRenderer.invoke(EXCEL_CHANNELS.preview, filePath, options, previewColumn),
    /**
     * 转换并落盘：一种语言一个 JSON。
     * @param filePath 表格路径。
     * @param options 转换选项。
     * @returns 统一响应，data 为产物摘要。
     */
    toJson: (
      filePath: string,
      options: ExcelI18nOptions,
    ): Promise<IpcResponse<ExcelI18nWriteResult>> =>
      ipcRenderer.invoke(EXCEL_CHANNELS.toJson, filePath, options),
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
