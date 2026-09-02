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
  /** 读取文本文件内容（utf-8）。 */
  readText: 'file:readText',
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
  /** 抽任意时间点的一帧（胶片条时间轴用）。 */
  frame: 'video:frame',
  transcode: 'video:transcode',
  cancelTranscode: 'video:cancelTranscode',
  /** 主进程 → 渲染进程：转码进度推送。 */
  transcodeProgress: 'video:transcodeProgress',
} as const;

/**
 * 音频处理通道（ffmpeg）。
 *
 * 与 VIDEO_CHANNELS 分开：那组是视频语义（分辨率/帧率/调色板），且音频要自己的
 * 波形图与静音检测通道。但**能力探测复用 `VIDEO_CHANNELS.capabilities`**——
 * `probeCapabilities()` 返回的结构里本来就有 audioEncoders，再开一条是重复。
 */
export const AUDIO_CHANNELS = {
  /** ffprobe 读音频元信息，顺带把路径登记进 tb-media 播放白名单。 */
  probe: 'audio:probe',
  /** 画波形图（PNG data URL，不落盘）。 */
  waveform: 'audio:waveform',
  /** 转码 / 剪切单个音频。 */
  convert: 'audio:convert',
  /** 检测静音区间（按静音分割用）。 */
  detectSilence: 'audio:detectSilence',
  /** 按区间列表切成多段。 */
  split: 'audio:split',
  cancel: 'audio:cancel',
  /** 主进程 → 渲染进程：处理进度推送。 */
  progress: 'audio:progress',
} as const;

/** 字体处理通道（subset-font + fontkit）。 */
export const FONT_CHANNELS = {
  /** 读字体元信息（字体名/字形数/大小）。 */
  probe: 'font:probe',
  /** 只裁不写盘：返回裁剪后 woff2 的 data URL 供页面预览。 */
  subsetPreview: 'font:subsetPreview',
  /** 按字符集裁剪字体并落盘。 */
  subset: 'font:subset',
  /** 网页分包：一个字体切成多个 unicode-range 分包 + CSS。 */
  split: 'font:split',
  /** 纯容器格式转换（fontverter，无损不裁剪）。 */
  convert: 'font:convert',
  /** 取消正在进行的格式转换。 */
  cancelConvert: 'font:cancelConvert',
  /** 主进程 → 渲染进程：格式转换进度推送。 */
  convertProgress: 'font:convertProgress',
} as const;

/**
 * 位图字体通道（fontkit 取字形路径 + sharp 栅格化）。
 *
 * 与 FONT_CHANNELS 分开：那组是「字体文件进、字体文件出」，这里产出的是 PNG 图集 +
 * 描述文件，且有自己的进度与取消，混在一起会让两组的语义都变模糊。
 */
export const BITMAP_FONT_CHANNELS = {
  /** 从字体生成图集 + 描述文件。 */
  generate: 'bitmapFont:generate',
  /** 生成预览（只算不写盘）。 */
  preview: 'bitmapFont:preview',
  /** 从字符图片打包成位图字体。 */
  packImages: 'bitmapFont:packImages',
  /** 取消正在进行的生成。 */
  cancel: 'bitmapFont:cancel',
  /** 主进程 → 渲染进程：生成进度推送。 */
  progress: 'bitmapFont:progress',
} as const;

/** Excel 多语言表转 i18n JSON 通道（exceljs）。 */
export const EXCEL_CHANNELS = {
  /** 读工作簿结构：sheet 名 / 指定表头行的各列文字 / 行列数。 */
  probe: 'excel:probe',
  /** 只算不写：按当前配置统计各语言列，并序列化其中一列的 JSON 供预览。 */
  preview: 'excel:preview',
  /** 转换并落盘：一种语言一个 JSON。 */
  toJson: 'excel:toJson',
} as const;
