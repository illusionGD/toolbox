/**
 * 主进程与预加载共享的 IPC 通道名。
 * 单一来源，避免字符串在两侧不一致。
 */

/** 窗口控制通道。 */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggleMaximize',
  close: 'window:close',
  isMaximized: 'window:isMaximized',
  onMaximizeChange: 'window:maximizeChange',
} as const;

/** 应用级通道。 */
export const APP_CHANNELS = {
  ping: 'app:ping',
} as const;

/** 文件对话框与文件系统通道。 */
export const DIALOG_CHANNELS = {
  openFiles: 'dialog:openFiles',
  openDirectory: 'dialog:openDirectory',
} as const;

/** 文件统计/文件系统操作通道。 */
export const FILE_CHANNELS = {
  scan: 'file:scan',
  cancelScan: 'file:cancelScan',
  /** 主进程 → 渲染进程：扫描进度推送。 */
  scanProgress: 'file:scanProgress',
  showInFolder: 'file:showInFolder',
  saveText: 'file:saveText',
  /** 批量重命名（含 pre-flight 校验，冲突则整批不动）。 */
  renameBatch: 'file:renameBatch',
} as const;

/** 图片处理通道。 */
export const IMAGE_CHANNELS = {
  thumbnail: 'image:thumbnail',
  dataUrl: 'image:dataUrl',
  compress: 'image:compress',
  /** 只算不写：探测自动裁剪的包围盒。 */
  probeCrop: 'image:probeCrop',
  crop: 'image:crop',
  /** 只算不写：按缩放尺寸生成风格化预览 data URL。 */
  stylizePreview: 'image:stylizePreview',
  stylize: 'image:stylize',
  /** 合并多图为精灵表 + 坐标数据。 */
  spriteMerge: 'image:spriteMerge',
  /** 只算不写：合并预览 data URL。 */
  spriteMergePreview: 'image:spriteMergePreview',
  /** 只算不写：探测精灵表将切出的单元。 */
  spriteSliceProbe: 'image:spriteSliceProbe',
  /** 切割精灵表为多张小图。 */
  spriteSlice: 'image:spriteSlice',
  /** 批量生成二维码。 */
  qrGenerate: 'image:qrGenerate',
  /** 只算不写：二维码预览 data URL。 */
  qrPreview: 'image:qrPreview',
  /** 解析单张图片的二维码。 */
  qrDecode: 'image:qrDecode',
} as const;

/** 视频处理通道（ffmpeg）。 */
export const VIDEO_CHANNELS = {
  /** 探测当前 ffmpeg 构建实际可用的编码器。 */
  capabilities: 'video:capabilities',
  /** ffprobe 读元信息，顺带把路径登记进 tb-media 播放白名单。 */
  probe: 'video:probe',
  /** 抽一帧作缩略图。 */
  thumbnail: 'video:thumbnail',
  transcode: 'video:transcode',
  cancelTranscode: 'video:cancelTranscode',
  /** 主进程 → 渲染进程：转码进度推送。 */
  transcodeProgress: 'video:transcodeProgress',
} as const;
