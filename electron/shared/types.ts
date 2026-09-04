/**
 * 主进程与渲染进程共享的 IPC 数据类型。
 */

/** IPC 统一返回码。0 成功，非 0 为各类错误。 */
export const IPC_CODE = {
  /** 成功。 */
  ok: 0,
  /** 未捕获的通用错误。 */
  error: 1,
  /** 参数非法。 */
  invalidParam: 2,
} as const;

/** IPC 统一返回码类型。 */
export type IpcCode = (typeof IPC_CODE)[keyof typeof IPC_CODE];

/**
 * IPC 统一返回格式。
 * 所有业务型 IPC 都返回此结构，渲染进程经 unwrap 解包并按需提示。
 */
export interface IpcResponse<T> {
  /** 返回码，0 表示成功。 */
  code: IpcCode;
  /** 成功时的数据；失败时为 null。 */
  data: T | null;
  /** 提示信息（成功可为空，失败为错误描述）。 */
  message: string;
}

/** 打开文件对话框的选项。 */
export interface OpenFilesOptions {
  /** 文件类型过滤，如 [{ name: '图片', extensions: ['png','jpg'] }]。 */
  filters?: Array<{ name: string; extensions: string[] }>;
  /** 是否允许多选，默认 true。 */
  multiple?: boolean;
  /** 对话框标题。 */
  title?: string;
}

/** 选中文件的基本信息。 */
export interface PickedFile {
  /** 绝对路径。 */
  path: string;
  /** 文件名（含扩展名）。 */
  name: string;
  /** 文件大小（字节）。 */
  size: number;
  /** 扩展名（小写，不含点），无扩展名为空串。 */
  ext: string;
  /** 最后修改时间（毫秒时间戳）；读取失败为 0。 */
  mtime: number;
}

/**
 * 图片输出格式。'original' 表示保持原格式。
 * 仅列 sharp 当前构建**可编码**的格式（jp2/jxl/heic-hevc 编码器未编入 libvips，故不提供）。
 */
export type ImageOutputFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff';

/** 目录扫描选项。 */
export interface ScanOptions {
  /** 本次扫描的唯一 id，用于取消与进度关联。 */
  scanId: string;
  /** 待扫描的根目录绝对路径。 */
  root: string;
  /** 是否包含隐藏文件/目录（以 . 开头），默认 true。 */
  includeHidden: boolean;
  /** 是否跳过常见忽略目录（node_modules/.git 等）。 */
  skipIgnoredDirs: boolean;
  /** 需跳过的目录名列表（仅 skipIgnoredDirs 为 true 时生效）。 */
  ignoreDirs: string[];
  /** 最多扫描的文件数，超出即截断；缺省用主进程默认值。 */
  maxFiles?: number;
  /** 最大递归深度，1 = 只取根目录当前层；缺省不限制。 */
  maxDepth?: number;
  /**
   * 只收这些扩展名（小写、不含点）；缺省或空数组表示不过滤。
   * 在**遍历时**就过滤掉，所以 maxFiles 与 truncated 都只针对匹配的文件——
   * 否则「从文件夹添加图片」会先被一个代码目录里的几千个 .js 填满上限，一张图都拿不到。
   */
  extensions?: string[];
}

/**
 * 扫描到的单个文件。
 * 目录路径经 dirIndex 指向 ScanResult.dirs，避免十万级条目重复存储长路径。
 */
export interface ScanFileEntry {
  /** 文件名（含扩展名）。 */
  name: string;
  /** 所在目录在 ScanResult.dirs 中的下标。 */
  dirIndex: number;
  /** 文件大小（字节）。 */
  size: number;
  /** 最后修改时间（毫秒时间戳）。 */
  mtime: number;
  /** 扩展名（小写，不含点）；无扩展名为空串。 */
  ext: string;
}

/** 目录扫描结果。 */
export interface ScanResult {
  /** 扫描的根目录。 */
  root: string;
  /** 去重后的目录路径表，供 ScanFileEntry.dirIndex 引用。 */
  dirs: string[];
  /** 扫描到的全部文件。 */
  files: ScanFileEntry[];
  /** 遍历到的目录数量（不含根目录）。 */
  dirCount: number;
  /** 耗时（毫秒）。 */
  elapsed: number;
  /** 是否因达到 maxFiles 上限而截断。 */
  truncated: boolean;
  /** 是否被用户取消（结果为部分数据）。 */
  canceled: boolean;
  /** 读取失败的目录描述（权限不足等），不影响整体成功。 */
  errors: string[];
}

/** 扫描进度事件负载。 */
export interface ScanProgress {
  /** 对应的扫描 id。 */
  scanId: string;
  /** 已扫描到的文件数。 */
  scanned: number;
  /** 当前正在读取的目录。 */
  currentDir: string;
}

/** 保存文本文件的选项。 */
export interface SaveTextOptions {
  /** 保存对话框中的默认文件名（含扩展名）。 */
  defaultName: string;
  /** 文件内容。 */
  content: string;
  /** 文件类型过滤。 */
  filters?: Array<{ name: string; extensions: string[] }>;
  /** 是否写入 UTF-8 BOM（CSV 给 Excel 用时需要）。 */
  bom?: boolean;
}

/** 一次重命名请求项。 */
export interface RenamePair {
  /** 源文件绝对路径。 */
  path: string;
  /** 新文件名（含扩展名，不含目录）。重命名不跨目录。 */
  newName: string;
}

/**
 * 被拦下或执行失败的一项。
 * reason 已是可直接展示给用户的中文，渲染进程不必再翻译错误码。
 */
export interface RenameConflict {
  /** 源文件绝对路径。 */
  path: string;
  /** 期望的新文件名。 */
  newName: string;
  /** 原因。 */
  reason: string;
}

/** 成功改名的一项，反向即为撤销。 */
export interface RenameDone {
  /** 原绝对路径。 */
  from: string;
  /** 新绝对路径。 */
  to: string;
}

/** 批量重命名结果。 */
export interface RenameBatchResult {
  /** 已成功改名的项；撤销时把 from/to 对调再调一次即可。 */
  done: RenameDone[];
  /**
   * pre-flight 拦下的项。
   * 非空时 done 必为空——校验不过就一个文件都不碰，不做「改一半再报错」。
   */
  conflicts: RenameConflict[];
  /** 执行阶段逐项失败（权限、文件已被别的程序移走等），此时 done 为部分成功。 */
  failures: RenameConflict[];
  /** 是否走了两趟改名（批内存在循环/交换时才会）。 */
  twoPhase: boolean;
}

/** JPEG 高级选项（对应 sharp jpeg 参数）。 */
export interface JpegAdvanced {
  /** 渐进式扫描。 */
  progressive: boolean;
  /** 使用 mozjpeg 优化（更小但更慢）。 */
  mozjpeg: boolean;
  /** 色度子采样，'4:4:4' 不子采样、'4:2:0' 更小。 */
  chromaSubsampling: '4:4:4' | '4:2:0';
}

/** PNG 高级选项（对应 sharp png 参数）。 */
export interface PngAdvanced {
  /** 压缩级别 0-9。 */
  compressionLevel: number;
  /** 隔行扫描（Adam7）。 */
  progressive: boolean;
  /** 调色板量化（有损但更小）。 */
  palette: boolean;
}

/** WebP 高级选项（对应 sharp webp 参数）。 */
export interface WebpAdvanced {
  /** 无损压缩。 */
  lossless: boolean;
  /** 编码努力程度 0-6，越大越慢越小。 */
  effort: number;
}

/** AVIF 高级选项（对应 sharp avif 参数）。 */
export interface AvifAdvanced {
  /** 无损压缩。 */
  lossless: boolean;
  /** 编码努力程度 0-9，越大越慢越小。 */
  effort: number;
}

/** GIF 高级选项（对应 sharp gif 参数）。 */
export interface GifAdvanced {
  /** 调色板颜色数 2-256，越少体积越小。 */
  colours: number;
  /** 抖动强度 0-1，缓解色带。 */
  dither: number;
}

/** TIFF 高级选项（对应 sharp tiff 参数）。 */
export interface TiffAdvanced {
  /** 压缩算法。 */
  compression: 'lzw' | 'deflate' | 'jpeg' | 'none';
}

/** 各格式高级选项集合。 */
export interface FormatAdvanced {
  jpeg: JpegAdvanced;
  png: PngAdvanced;
  webp: WebpAdvanced;
  avif: AvifAdvanced;
  gif: GifAdvanced;
  tiff: TiffAdvanced;
}

/** 图片压缩/转换选项。 */
export interface CompressOptions {
  /** 输出格式。 */
  format: ImageOutputFormat;
  /** 质量 1-100（png 用于映射压缩级别；gif/tiff 无质量概念，忽略）。 */
  quality: number;
  /** 最大宽度（px）；不限制则为 undefined。等比缩放，不放大。 */
  maxWidth?: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 是否覆盖原文件（true 时忽略 outputDir，写回原路径）。 */
  overwrite: boolean;
  /**
   * 是否保留动图的全部帧（gif/webp 之间转换时有效）。
   * 关闭或目标格式不支持多帧时只取首帧。
   */
  keepAnimation?: boolean;
  /** 各格式高级选项；未提供时用主进程默认。 */
  advanced?: Partial<FormatAdvanced>;
}

/** 单张图片处理结果。 */
export interface CompressResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 原始大小（字节）。 */
  originalSize: number;
  /** 输出后大小（字节）。 */
  compressedSize: number;
  /** 体积变化百分比，正数为减小、负数为增大。 */
  ratio: number;
  /** 实际输出格式（original 解析后的结果，或因目标格式不支持而回退的格式）。 */
  outputFormat: Exclude<ImageOutputFormat, 'original'>;
  /** 输出是否为多帧动图。 */
  animated: boolean;
}

/** 图片基本尺寸信息。 */
export interface ImageMeta {
  /** 宽度 px。 */
  width: number;
  /** 高度 px。 */
  height: number;
  /** 格式（如 jpeg/png/webp）。 */
  format: string;
}

/** 裁剪模式。auto 自动去边，manual 按指定矩形裁。 */
export type CropMode = 'auto' | 'manual';

/** 裁剪矩形（图片原始像素坐标，与 sharp Region 同形）。 */
export interface CropRect {
  /** 距左边缘偏移。 */
  left: number;
  /** 距上边缘偏移。 */
  top: number;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
}

/** 自动裁剪（去边）选项，对应 sharp trim 参数。 */
export interface AutoCropOptions {
  /** 与背景色的允许差值，越大裁得越狠。sharp 默认 10。 */
  threshold: number;
  /** 裁剪后在内容四周保留的边距 px。 */
  margin: number;
  /** 线稿/矢量模式，对线条图判定更准。 */
  lineArt: boolean;
  /** 要去掉的背景色（如 '#ffffff'）；缺省用左上角像素色。 */
  background?: string;
}

/** 统一输出画布尺寸（裁剪结果居中放入）。 */
export interface CropCanvas {
  /** 画布宽度 px。 */
  width: number;
  /** 画布高度 px。 */
  height: number;
}

/** 图片裁剪选项。 */
export interface CropOptions {
  /** 裁剪模式。 */
  mode: CropMode;
  /** 自动模式参数。 */
  auto: AutoCropOptions;
  /** 手动模式的裁剪矩形；越界会被钳制进图片边界。 */
  rect?: CropRect;
  /** 统一输出尺寸；缺省则各图尺寸由裁剪结果决定。 */
  canvas?: CropCanvas;
  /** 输出格式。 */
  format: ImageOutputFormat;
  /** 质量 1-100（语义同压缩）。 */
  quality: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 是否覆盖原文件（true 时忽略 outputDir）。 */
  overwrite: boolean;
}

/** 自动裁剪包围盒探测结果（不写盘）。 */
export interface CropProbe {
  /** 原图宽度 px。 */
  width: number;
  /** 原图高度 px。 */
  height: number;
  /**
   * 自动裁剪后的包围盒（原图坐标系）。
   * 与原图等大表示无边可裁；探测失败为 null。
   */
  rect: CropRect | null;
}

/** 单张图片裁剪结果。 */
export interface CropResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 原始大小（字节）。 */
  originalSize: number;
  /** 输出后大小（字节）。 */
  croppedSize: number;
  /** 原图宽度 px。 */
  originalWidth: number;
  /** 原图高度 px。 */
  originalHeight: number;
  /** 输出宽度 px。 */
  width: number;
  /** 输出高度 px。 */
  height: number;
  /** 实际输出格式。 */
  outputFormat: Exclude<ImageOutputFormat, 'original'>;
  /** 无可裁边缘（输出尺寸与原图一致），仅重编码。 */
  skipped: boolean;
}

/**
 * 风格化效果种类。
 * 数组化后同时充当**固定执行顺序**（见主进程 EFFECT_ORDER）：
 * 几何/邻域类在前、调色在后、二值化最后。
 */
export type StylizeEffect =
  | 'mosaic'
  | 'blur'
  | 'median'
  | 'sharpen'
  | 'grayscale'
  | 'sepia'
  | 'tint'
  | 'modulate'
  | 'contrast'
  | 'negate'
  | 'threshold';

/** 马赛克。 */
export interface MosaicEffect {
  enabled: boolean;
  /** 块大小 px（2-64），越大越糊。 */
  block: number;
}

/** 高斯模糊。 */
export interface BlurEffect {
  enabled: boolean;
  /** 高斯 sigma（0.3-50）。 */
  sigma: number;
}

/** 中值滤波（去噪 / 油画感）。 */
export interface MedianEffect {
  enabled: boolean;
  /** 方形窗口边长，奇数 1-15。 */
  size: number;
}

/** 锐化。 */
export interface SharpenEffect {
  enabled: boolean;
  /** 锐化 sigma（0.3-10）。 */
  sigma: number;
}

/**
 * 灰度。
 * 实现走 `modulate({saturation:0})` 而非 `grayscale()`：后者输出的 raw 只有 1 通道，
 * alpha 会丢失，无法与其它效果串联（实测）。
 */
export interface GrayscaleEffect {
  enabled: boolean;
}

/** 复古（sepia 色调矩阵）。 */
export interface SepiaEffect {
  enabled: boolean;
}

/** 色调叠加。 */
export interface TintEffect {
  enabled: boolean;
  /** 叠加色（如 '#ff8800'）。 */
  color: string;
}

/** 亮度 / 饱和度 / 色相。 */
export interface ModulateEffect {
  enabled: boolean;
  /** 亮度乘数（0.5-2，1 为原样）。 */
  brightness: number;
  /** 饱和度乘数（0-3，1 为原样）。 */
  saturation: number;
  /** 色相旋转角度（-180-180）。 */
  hue: number;
}

/**
 * 对比度。
 * 走 `linear(a, b)`，其中 `b = 128 * (1 - a)`，即绕中灰旋转；
 * 只给乘数不给偏移会让「调对比度」连带整体变亮/变暗。
 */
export interface ContrastEffect {
  enabled: boolean;
  /** 对比度系数（0.2-3，1 为原样）。 */
  amount: number;
}

/**
 * 反色。
 * 实现固定 `{alpha:false}`：sharp 的 `negate()` 默认会把 alpha 通道一起反转，
 * 导致整张图透明度颠倒（实测）。
 */
export interface NegateEffect {
  enabled: boolean;
}

/** 阈值二值化。 */
export interface ThresholdEffect {
  enabled: boolean;
  /** 阈值 0-255。 */
  value: number;
  /** 先转灰度再二值化（关闭则各通道独立二值化，出彩色块）。 */
  grayscale: boolean;
}

/** 全局效果集合；缺省的 key 视为未启用。 */
export interface StylizeEffects {
  mosaic?: MosaicEffect;
  blur?: BlurEffect;
  median?: MedianEffect;
  sharpen?: SharpenEffect;
  grayscale?: GrayscaleEffect;
  sepia?: SepiaEffect;
  tint?: TintEffect;
  modulate?: ModulateEffect;
  contrast?: ContrastEffect;
  negate?: NegateEffect;
  threshold?: ThresholdEffect;
}

/** 局部区域效果（独立于全局效果的一组参数）。 */
export interface RegionEffect {
  /** 局部用哪种效果。 */
  kind: 'mosaic' | 'blur';
  /** 强度：mosaic 为块大小 px、blur 为 sigma。 */
  strength: number;
  /** true = 效果作用于区域**外**（背景虚化）。 */
  invert: boolean;
}

/** 风格化选项。 */
export interface StylizeOptions {
  /** 全局效果集合。 */
  effects: StylizeEffects;
  /** 局部区域（图片原始像素坐标，复用 CropRect）；空数组表示无局部处理。 */
  regions: CropRect[];
  /** 局部区域的效果参数。 */
  region: RegionEffect;
  /** 输出格式。 */
  format: ImageOutputFormat;
  /** 质量 1-100（语义同压缩）。 */
  quality: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 是否覆盖原文件（true 时忽略 outputDir）。 */
  overwrite: boolean;
}

/** 风格化预览选项：与 StylizeOptions 同构，但不写盘、按 maxSize 缩放。 */
export interface StylizePreviewOptions {
  /** 全局效果集合。 */
  effects: StylizeEffects;
  /** 局部区域（原图坐标系，主进程按预览缩放比换算）。 */
  regions: CropRect[];
  /** 局部区域的效果参数。 */
  region: RegionEffect;
  /** 预览长边上限 px。 */
  maxSize: number;
}

/** 单张图片风格化结果。 */
export interface StylizeResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 原始大小（字节）。 */
  originalSize: number;
  /** 输出后大小（字节）。 */
  stylizedSize: number;
  /** 输出宽度 px。 */
  width: number;
  /** 输出高度 px。 */
  height: number;
  /** 实际输出格式。 */
  outputFormat: Exclude<ImageOutputFormat, 'original'>;
  /** 实际施加的效果趟数（0 = 未启用任何效果，仅重编码）。 */
  appliedCount: number;
}

/* ── 精灵图（合并 / 切割） ─────────────────────────────────────────── */

/**
 * 精灵表排列方式。
 * grid：按行列网格排布，实现简单、坐标好算，但小图尺寸不一时浪费空间。
 * packed：紧凑装箱（MaxRects），本轮不做，枚举先留位以便后续扩展不改签名。
 */
export type SpriteLayout = 'grid';

/** 网格排列内的对齐方式（各格尺寸不一时，小图在格内如何摆放）。 */
export type SpriteAlign = 'topLeft' | 'center';

/** 精灵表坐标数据的导出格式。 */
export type SpriteDataFormat = 'json' | 'css' | 'plist' | 'none';

/** 合并：单张输入图在精灵表里的最终位置（原始像素坐标）。 */
export interface SpriteFrame {
  /** 帧名（取源文件名，用于坐标数据的 key）。 */
  name: string;
  /** 源文件路径。 */
  sourcePath: string;
  /** 距表左边缘偏移 px。 */
  left: number;
  /** 距表上边缘偏移 px。 */
  top: number;
  /** 帧宽 px。 */
  width: number;
  /** 帧高 px。 */
  height: number;
}

/** 合并精灵表选项。 */
export interface SpriteMergeOptions {
  /** 参与合并的图片路径（顺序即排布顺序）。 */
  sources: string[];
  /** 排列方式。 */
  layout: SpriteLayout;
  /** 网格列数（layout=grid）；<=0 时按图片数开方自动取近似正方形。 */
  columns: number;
  /** 相邻格之间的间距 px。 */
  spacing: number;
  /** 表四周的外边距 px。 */
  padding: number;
  /** 各格尺寸不一时小图在格内的对齐。 */
  align: SpriteAlign;
  /**
   * 单张图集的最大边长 px（1024/2048/4096 等）；<=0 表示不限制、始终单张。
   * 放不下时按最大尺寸拆成多张图集。
   */
  maxSize: number;
  /** 导出前剔除每张图四周的透明边（各帧按自身内容裁紧，坐标随之更新）。 */
  trim: boolean;
  /** 坐标数据导出格式。 */
  dataFormat: SpriteDataFormat;
  /** 输出图片格式（不含 original，精灵表一律显式格式，默认 png 保透明）。 */
  format: Exclude<ImageOutputFormat, 'original'>;
  /** 质量 1-100（语义同压缩）。 */
  quality: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 输出文件名（不含扩展名），如 'sprite'。 */
  baseName: string;
}

/** 合并结果。 */
/** 合并结果（可能产出多张图集）。 */
export interface SpriteMergeResult {
  /** 生成的图集图片路径（受 maxSize 影响可能多张）。 */
  sheetPaths: string[];
  /** 坐标数据文件路径；dataFormat=none 时为空数组，多张图集各一份。 */
  dataPaths: string[];
  /** 实际合并的帧数（跨所有图集）。 */
  frameCount: number;
  /** 生成的图集张数。 */
  sheetCount: number;
}

/** 单张图集的预览。 */
export interface SpriteSheetPreview {
  /** 预览图 data URL（webp，过大已缩到长边上限内）。 */
  dataUrl: string;
  /** 图集实际总宽 px（未缩放前）。 */
  width: number;
  /** 图集实际总高 px（未缩放前）。 */
  height: number;
  /** 本张图集含帧数。 */
  frameCount: number;
}

/** 合并预览结果（只算不写盘，可能多张图集）。 */
export interface SpriteMergePreview {
  /** 各图集的预览。 */
  sheets: SpriteSheetPreview[];
  /** 参与合并的总帧数。 */
  frameCount: number;
}

/**
 * 切割方式。
 * grid：按行列数或格尺寸等分。
 * lines：按渲染进程给的横/纵切割线位置切成不等分网格。
 * import：解析已有坐标文件（JSON/plist）反向切。
 * auto：按透明像素连通域自动圈出每个精灵的包围盒。
 */
export type SpriteSliceMethod = 'grid' | 'lines' | 'import' | 'auto';

/** 一个切割单元（原始像素矩形 + 导出用名字）。 */
export interface SpriteCell {
  /** 单元矩形（原图坐标系）。 */
  rect: CropRect;
  /** 导出文件名（不含扩展名）。 */
  name: string;
}

/** 固定网格切割参数。 */
export interface SpriteGridSpec {
  /** 按数量分：列数、行数（>0 时优先）。 */
  columns: number;
  rows: number;
  /** 按尺寸分：单元宽高 px（columns/rows<=0 时用）。 */
  cellWidth: number;
  cellHeight: number;
  /** 单元之间的间距 px（雪碧图常见）。 */
  spacing: number;
  /** 表四周外边距 px。 */
  margin: number;
}

/** 切割探测选项（只算不写，返回将要切出的单元）。 */
export interface SpriteSliceProbeOptions {
  /** 切割方式。 */
  method: SpriteSliceMethod;
  /** grid 方式的网格参数。 */
  grid?: SpriteGridSpec;
  /** lines 方式的纵向切割线 x 坐标（原始像素，已排序去重）。 */
  columnsAt?: number[];
  /** lines 方式的横向切割线 y 坐标。 */
  rowsAt?: number[];
  /** import 方式的坐标文件路径（JSON/plist）。 */
  dataPath?: string;
  /** auto 方式：alpha 大于此值视为不透明（0-255）。 */
  alphaThreshold?: number;
  /** auto 方式：小于此面积（px²）的连通块丢弃（滤噪点）。 */
  minArea?: number;
}

/** 切割探测结果。 */
export interface SpriteSliceProbe {
  /** 精灵表宽 px。 */
  width: number;
  /** 精灵表高 px。 */
  height: number;
  /** 计算出的切割单元。 */
  cells: SpriteCell[];
}

/** 执行切割选项（单元由渲染进程确定后传入）。 */
export interface SpriteSliceOptions {
  /** 要切出的单元。 */
  cells: SpriteCell[];
  /** 输出格式。 */
  format: Exclude<ImageOutputFormat, 'original'>;
  /** 质量 1-100。 */
  quality: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
}

/** 切割结果。 */
export interface SpriteSliceResult {
  /** 成功切出的文件路径。 */
  outputPaths: string[];
  /** 因矩形非法（越界/零面积）被跳过的单元数。 */
  skipped: number;
}

/* ── 二维码（生成 / 解析） ────────────────────────────────────────── */

/** 二维码容错级别：L(7%) < M(15%) < Q(25%) < H(30%)，越高越耐污损但码更密。 */
export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

/** 二维码输出格式。 */
export type QrOutputFormat = 'png' | 'jpg' | 'svg';

/** 单条待生成的二维码（内容 + 输出文件名，不含扩展名）。 */
export interface QrGenerateItem {
  /** 编码内容。 */
  text: string;
  /** 输出文件名（不含扩展名），渲染进程已按模板/序号/手改定好。 */
  name: string;
}

/** 二维码生成选项。 */
export interface QrGenerateOptions {
  /** 待生成条目。 */
  items: QrGenerateItem[];
  /** 输出边长 px（png/jpg 有效；svg 为矢量，此值作参考）。 */
  size: number;
  /** 静区边距（模块数）。 */
  margin: number;
  /** 容错级别。 */
  level: QrErrorLevel;
  /** 前景色（深色模块），如 '#000000'。 */
  dark: string;
  /** 背景色，如 '#ffffff'。 */
  light: string;
  /** 输出格式。 */
  format: QrOutputFormat;
  /** 输出目录绝对路径。 */
  outputDir: string;
}

/** 二维码生成结果。 */
export interface QrGenerateResult {
  /** 成功生成的文件路径。 */
  outputPaths: string[];
  /** 生成失败的条目数（如内容过长超出容量）。 */
  failed: number;
}

/** 二维码解析选项（预览用，不写盘）。 */
export interface QrPreviewOptions {
  /** 编码内容。 */
  text: string;
  /** 边长 px。 */
  size: number;
  /** 静区边距（模块数）。 */
  margin: number;
  /** 容错级别。 */
  level: QrErrorLevel;
  /** 前景色。 */
  dark: string;
  /** 背景色。 */
  light: string;
}

/** 单张图片的二维码解析结果。 */
export interface QrDecodeResult {
  /** 源文件路径。 */
  path: string;
  /** 文件名。 */
  name: string;
  /** 解析出的文本；未识别到为 null。 */
  text: string | null;
  /** 是否成功识别。 */
  ok: boolean;
}

/* ── 视频（ffmpeg） ───────────────────────────────────────────────── */

/** 单条媒体流的信息（ffprobe 结果的精简投影）。 */
export interface VideoStreamInfo {
  /** 编码名，如 h264 / aac。 */
  codec: string;
  /** 宽度 px（音频流为 0）。 */
  width: number;
  /** 高度 px（音频流为 0）。 */
  height: number;
  /** 帧率（音频流为 0）。 */
  fps: number;
  /** 像素格式，如 yuv420p（音频流为空串）。 */
  pixelFormat: string;
  /** 声道数（视频流为 0）。 */
  channels: number;
  /** 采样率 Hz（视频流为 0）。 */
  sampleRate: number;
  /** 该流码率 bps；ffprobe 未给出时为 0。 */
  bitrate: number;
}

/** 视频文件的元信息。 */
export interface VideoMeta {
  /** 时长秒；容器未给出时为 0（此时进度只能按已处理时间显示）。 */
  duration: number;
  /** 容器格式名，如 mov,mp4,m4a。 */
  container: string;
  /** 总码率 bps；未知为 0。 */
  bitrate: number;
  /** 文件大小字节。 */
  size: number;
  /** 首条视频流；无视频流为 null。 */
  video: VideoStreamInfo | null;
  /** 首条音频流；无音频流为 null。 */
  audio: VideoStreamInfo | null;
}

/**
 * 当前 ffmpeg 构建实际可用的编码器。
 * 打包的是 2018 年的 4.1 构建，文档列的编码器不等于这个构建有——
 * 一律探测后再决定 UI 上给哪些选项，别照文档写死。
 */
export interface VideoCapabilities {
  /** ffmpeg 版本串。 */
  version: string;
  /** 可用的视频编码器名集合。 */
  videoEncoders: string[];
  /** 可用的音频编码器名集合。 */
  audioEncoders: string[];
}

/** 输出容器格式。original = 保持源容器。 */
export type VideoOutputFormat = 'original' | 'mp4' | 'webm' | 'mkv' | 'gif';

/** 视频编码器。copy = 不重新编码，只换封装。 */
export type VideoCodec = 'libx264' | 'libx265' | 'libvpx-vp9' | 'copy';

/** 音频处理方式。 */
export type VideoAudioMode = 'encode' | 'copy' | 'remove';

/** 压缩模式。 */
export type VideoQualityMode = 'quality' | 'bitrate' | 'targetSize';

/** 转码选项。 */
export interface TranscodeOptions {
  /** 任务 id，用于关联进度推送与取消。 */
  taskId: string;
  /** 输出容器。 */
  format: VideoOutputFormat;
  /** 视频编码器。 */
  codec: VideoCodec;
  /** 压缩模式。 */
  qualityMode: VideoQualityMode;
  /** quality 模式的 CRF 值，越小越清晰。 */
  crf: number;
  /** bitrate 模式的目标视频码率 kbps。 */
  videoBitrate: number;
  /** targetSize 模式的目标文件大小 MB。 */
  targetSizeMb: number;
  /** 最大高度 px；0 = 不限制。宽度按比例并向偶数取整。 */
  maxHeight: number;
  /** 帧率上限；0 = 保持源帧率。 */
  maxFps: number;
  /** 音频处理方式。 */
  audioMode: VideoAudioMode;
  /** encode 模式的音频码率 kbps。 */
  audioBitrate: number;
  /** GIF 输出的帧率。 */
  gifFps: number;
  /** GIF 输出的宽度 px。 */
  gifWidth: number;
  /** 输出目录（overwrite 为 true 时忽略）。 */
  outputDir: string;
  /** 是否覆盖原文件。 */
  overwrite: boolean;
  /**
   * 输出文件名后缀，拼在原名之后（如 `-clip` → `a-clip.mp4`）。
   *
   * 剪切页默认给 `-clip`：剪一段还放回源目录是最自然的操作，没有后缀就会
   * 撞上源文件名。同路径守卫是兜底报错，后缀才是让这件事正常走通的路径。
   */
  nameSuffix?: string;
  /**
   * 时间剪切区间（秒）。压缩 tab 不用，剪切 tab 用，两者共用同一个 transcodeOne。
   */
  trim?: { start: number; end: number };
  /** 画面裁剪矩形（源像素坐标）；下发前会被 snapCropEven 偶数对齐。 */
  crop?: CropRect;
}

/** 转码结果。 */
export interface TranscodeResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径；被取消时为空串。 */
  outputPath: string;
  /** 原始大小字节。 */
  originalSize: number;
  /** 输出大小字节；被取消时为 0。 */
  outputSize: number;
  /** 体积变化百分比，正数为变小；可能为负（转码常常变大）。 */
  ratio: number;
  /** 是否被用户取消。取消不是错误，正常返回并置位。 */
  canceled: boolean;
  /** 是否走了 -c copy（只换封装、未重新编码）。 */
  streamCopy: boolean;
}

/** 转码进度推送。 */
export interface VideoProgress {
  /** 任务 id。 */
  taskId: string;
  /** 已处理到的时间点（秒）。 */
  outTime: number;
  /** 完成百分比 0-100；源时长未知时为 -1（页面改显示已处理时间）。 */
  percent: number;
  /** 处理速度倍率，如 2.5 表示 2.5x；未知为 0。 */
  speed: number;
}

/* ── 音频（ffmpeg） ───────────────────────────────────────────────── */

/**
 * 音频文件的元信息。
 *
 * 不复用 VideoMeta：那个结构里一半字段（分辨率、帧率、像素格式）对音频永远是 0，
 * 页面要处处判空；这里只留音频真正有的字段。
 */
export interface AudioMeta {
  /** 时长秒；容器未给出时为 0（此时进度只能按已处理时间显示）。 */
  duration: number;
  /** 容器格式名，如 mp3 / mov,mp4,m4a。 */
  container: string;
  /** 文件大小字节。 */
  size: number;
  /** 音频流编码名，如 mp3 / aac；无音频流时为空串。 */
  codec: string;
  /** 声道数；未知为 0。 */
  channels: number;
  /** 采样率 Hz；未知为 0。 */
  sampleRate: number;
  /** 码率 bps（流码率缺失时退回容器总码率）；未知为 0。 */
  bitrate: number;
  /** 是否含视频流（从视频里提取音频时用来提示用户）。 */
  hasVideo: boolean;
}

/** 输出容器。original = 保持源容器。 */
export type AudioFormat = 'original' | 'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg' | 'opus' | 'aac';

/** 音频编码器。copy = 不重新编码，只换封装。 */
export type AudioCodec =
  'libmp3lame' | 'aac' | 'libopus' | 'libvorbis' | 'flac' | 'alac' | 'pcm_s16le' | 'copy';

/** 码率模式。VBR 只有部分编码器支持（实测 mp3 / vorbis 有，opus / flac 无）。 */
export type AudioRateMode = 'cbr' | 'vbr' | 'lossless';

/** 音频转码 / 剪切选项。 */
export interface AudioConvertOptions {
  /** 任务 id，用于关联进度推送与取消。 */
  taskId: string;
  /** 输出容器。 */
  format: AudioFormat;
  /** 音频编码器。 */
  codec: AudioCodec;
  /** 码率模式。 */
  rateMode: AudioRateMode;
  /** cbr 模式的目标码率 kbps。 */
  bitrate: number;
  /** vbr 质量（mp3 为 0-9，越小越好；vorbis 为 0-10，越大越好）。 */
  quality: number;
  /** flac 压缩等级 0-12；实测 12 比 5 慢 48% 只多省 1.5%，默认 5。 */
  compressionLevel: number;
  /** 声道数；0 = 保持源。 */
  channels: number;
  /** 采样率 Hz；0 = 保持源。libopus 只接受 48000，pre-flight 会拦。 */
  sampleRate: number;
  /** 音量增益 dB；0 = 不调整。 */
  volumeDb: number;
  /** 响度归一目标 LUFS；null = 不做。实测单趟即可达标，不必两趟。 */
  loudnessTarget: number | null;
  /** 淡入秒；0 = 不做。 */
  fadeIn: number;
  /** 淡出秒；0 = 不做。 */
  fadeOut: number;
  /** 是否保留源文件的元数据标签（title/artist 等）。 */
  keepMetadata: boolean;
  /** 剪切区间（秒）；不给则处理整条。 */
  trim?: { start: number; end: number };
  /** 输出目录（overwrite 为 true 时忽略）。 */
  outputDir: string;
  /** 是否覆盖原文件。 */
  overwrite: boolean;
}

/** 音频转码结果。 */
export interface AudioConvertResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径；被取消时为空串。 */
  outputPath: string;
  /** 原始大小字节。 */
  originalSize: number;
  /** 输出大小字节；被取消时为 0。 */
  outputSize: number;
  /** 体积变化百分比，正数为变小；可能为负（如 wav 转无损 flac 之外的升码率场景）。 */
  ratio: number;
  /** 输出时长秒（剪切后的实际时长，用于如实展示帧对齐误差）。 */
  duration: number;
  /** 是否被用户取消。取消不是错误，正常返回并置位。 */
  canceled: boolean;
  /** 是否走了 -c:a copy（只换封装、未重新编码）。 */
  streamCopy: boolean;
}

/** 静音区间（秒）。 */
export interface SilenceRange {
  /** 起点秒。 */
  start: number;
  /** 终点秒。 */
  end: number;
}

/** 静音检测选项。 */
export interface DetectSilenceOptions {
  /** 判定为静音的电平阈值 dB（如 -50 表示低于 -50dB 算静音）。 */
  noiseDb: number;
  /** 最短静音时长秒，短于此的不算。 */
  minDuration: number;
}

/** 静音检测结果。 */
export interface DetectSilenceResult {
  /** 文件总时长秒。 */
  duration: number;
  /** 检出的静音区间。 */
  silences: SilenceRange[];
}

/** 波形图选项。 */
export interface WaveformOptions {
  /** 输出宽度 px。 */
  width: number;
  /** 输出高度 px。 */
  height: number;
  /** 波形颜色（CSS 颜色串）。 */
  color: string;
}

/** 按区间列表分割的选项。 */
export interface AudioSplitOptions extends AudioConvertOptions {
  /**
   * 要输出的区间列表（秒）。渲染进程算好后传下来，主进程只切不重算——
   * 静音检测与「平均分段」两种来源在页面上就已经归一成同一个区间列表。
   */
  segments: SilenceRange[];
  /** 输出名模板，`{n}` 替换为从 1 起的段序号。 */
  nameTemplate: string;
}

/** 分割结果。 */
export interface AudioSplitResult {
  /** 各段输出路径（按顺序）；被取消时为空数组。 */
  outputPaths: string[];
  /** 输出总大小字节。 */
  outputSize: number;
  /** 是否被用户取消。 */
  canceled: boolean;
}

/**
 * 音频处理进度推送。
 *
 * 字段与 VideoProgress 相同但**不复用**：两者会各自演进（音频往后可能要加分段
 * 序号），共用会在改一处时误伤另一处。
 */
export interface AudioProgress {
  /** 任务 id。 */
  taskId: string;
  /** 已处理到的时间点（秒）。 */
  outTime: number;
  /** 完成百分比 0-100；源时长未知时为 -1（页面改显示已处理时间）。 */
  percent: number;
  /** 处理速度倍率；未知为 0。 */
  speed: number;
}

/* ── 字体（裁剪 / 转换） ──────────────────────────────────────────── */

/** 字体输出格式。original = 保持源格式。 */
export type FontOutputFormat = 'original' | 'ttf' | 'otf' | 'woff' | 'woff2';

/** 字体元信息（fontkit 读取的精简投影）。 */
export interface FontMeta {
  /** 字体族名（familyName）。 */
  familyName: string;
  /** 字形数。 */
  glyphCount: number;
  /** 文件大小字节。 */
  size: number;
}

/** 字体裁剪选项。 */
export interface FontSubsetOptions {
  /** 要保留的字符集（已去重的字符串）。 */
  chars: string;
  /** 输出格式。 */
  format: FontOutputFormat;
  /** 输出目录绝对路径（overwrite 为 true 时忽略）。 */
  outputDir: string;
  /** 是否覆盖原文件。 */
  overwrite: boolean;
}

/** 字体裁剪结果。 */
export interface FontSubsetResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 原始大小字节。 */
  originalSize: number;
  /** 裁剪后大小字节。 */
  subsetSize: number;
  /** 体积变化百分比（正=减小）。 */
  ratio: number;
  /** 实际输出格式（original 解析后的结果）。 */
  outputFormat: Exclude<FontOutputFormat, 'original'>;
}

/* ── 字体网页分包（cn-font-split） ────────────────────────────────── */

/** 附加生成的样式表格式（在 CSS 之外，复制同内容为 less/scss）。 */
export type FontSplitStyleFormat = 'less' | 'scss';

/** 分包字体输出格式（subset-font 可产出的）。woff2 由 cn-font-split 直接出，其余由 woff2 转。 */
export type FontSplitFormat = 'woff2' | 'woff' | 'ttf';

/** 字体网页分包选项。 */
export interface FontSplitOptions {
  /** 单个分包的目标大小（字节），默认 70KB。 */
  chunkSize: number;
  /** 输出的字体格式（woff2/woff/ttf 均可选；非 woff2 的由 woff2 逐 chunk 转）。 */
  formats: FontSplitFormat[];
  /** 保留原格式：额外输出与源字体同格式的分包（源为 ttf/woff 时）。 */
  keepOriginal: boolean;
  /** 生成测试 HTML 预览页。 */
  testHtml: boolean;
  /** 保留 OpenType 特性（连字、字距等）。 */
  fontFeature: boolean;
  /** 按语言分区（CJK/拉丁等各自成组）。 */
  languageArea: boolean;
  /** CSS 里保留 unicode 注释；关闭则生成无注释、更紧凑的样式。 */
  cssComment: boolean;
  /** 额外生成的样式表格式（less/scss，内容同 CSS）。 */
  extraStyles: FontSplitStyleFormat[];
  /** 分包字体文件名模板；支持 [index]、[hash] 等占位，空则用默认。 */
  chunkName: string;
  /** 生成的 CSS 里的 font-family 名；空则用字体自身名。 */
  cssFontFamily: string;
  /** 输出根目录；实际会在其下建以字体名命名的子目录。 */
  outputDir: string;
}

/** 字体分包结果。 */
export interface FontSplitResult {
  /** 实际输出目录（输出根目录下的字体名子目录）。 */
  outDir: string;
  /** 产出文件总数。 */
  fileCount: number;
  /** 分包字体文件数。 */
  chunkCount: number;
  /** CSS 文件路径；无则空串。 */
  cssPath: string;
  /** 产出总大小（字节）。 */
  totalSize: number;
}

/* ── 字体格式转换（fontverter 纯容器转换） ────────────────────────── */

/**
 * 格式转换的目标格式。
 *
 * 不含 otf：ttf(glyf) 与 otf(CFF) 的差别是字形轮廓的存储方式，互转需要重建全部
 * 字形轮廓，现有依赖（fontverter / subset-font / harfbuzz）都做不到——subset-font
 * 传 targetFormat:'sfnt' 给 ttf 源返回的字节与 'truetype' 完全相同。故不提供该选项。
 */
export type FontConvertFormat = 'ttf' | 'woff' | 'woff2';

/** 字体格式转换选项。 */
export interface FontConvertOptions {
  /** 任务 id，用于进度推送与取消匹配（放选项内，同 TranscodeOptions）。 */
  taskId: string;
  /** 目标格式，可多选，一次调用产出多个文件。 */
  formats: FontConvertFormat[];
  /** 输出目录绝对路径；空串表示输出到源文件同目录。 */
  outputDir: string;
  /** 目标文件已存在时是否覆盖。 */
  overwrite: boolean;
}

/** 转换产出的单个文件。 */
export interface FontConvertFile {
  /** 该文件的格式。 */
  format: FontConvertFormat;
  /** 输出文件绝对路径。 */
  path: string;
  /** 文件大小字节。 */
  size: number;
}

/** 字体格式转换结果。 */
export interface FontConvertResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 源容器格式（fontverter 探测值：sfnt/woff/woff2，其中 sfnt 含 ttf 与 otf）。 */
  sourceFormat: string;
  /** 源文件大小字节。 */
  sourceSize: number;
  /** 字形数；转换是无损的，产物字形数应与此一致。 */
  glyphCount: number;
  /** 成功产出的文件。 */
  files: FontConvertFile[];
  /** 被跳过的格式（目标已存在且未开覆盖，或目标路径就是源文件本身）。 */
  skipped: FontConvertFormat[];
  /** 被用户取消：不是错误，页面把该行退回 pending。 */
  canceled?: boolean;
}

/**
 * 格式转换进度。
 *
 * fontverter 的 convert 是一次不可分割的 async 调用、没有进度回调，所以进度只能
 * 到「多个目标格式里正在转第几个」这一粒度，不编造格式内部的假百分比。
 */
export interface FontConvertProgress {
  /** 任务 id，页面据此过滤掉过期任务的推送。 */
  taskId: string;
  /** 当前正在转换的目标格式。 */
  format: FontConvertFormat;
  /** 已完成的格式数。 */
  done: number;
  /** 目标格式总数。 */
  total: number;
}

/* ── 位图字体（fontkit 取字形路径 + sharp 栅格化） ──────────────────── */

/**
 * 描述文件格式。
 *
 * 三者是 AngelCode BMFont 的等价编码，承载的数据完全相同，只是语法不同：
 * fnt（文本，Cocos/Unity/LibGDX）、xml（Pixi 默认）、json（Phaser/自研引擎直接 import）。
 */
export type BitmapFontDataFormat = 'fnt' | 'xml' | 'json';

/** 单个字符在图集里的位置与度量，即 .fnt 的一条 char 行。 */
export interface BitmapFontChar {
  /** unicode 码点（.fnt 里的 id）。 */
  id: number;
  /** 所在页索引（0-based）。 */
  page: number;
  /** 在图集中的左上角 x。 */
  x: number;
  /** 在图集中的左上角 y。 */
  y: number;
  /** 位图宽；空格这类零面积字形为 0。 */
  width: number;
  /** 位图高；空格这类零面积字形为 0。 */
  height: number;
  /** 绘制时从光标位置到位图左上角的水平偏移。 */
  xoffset: number;
  /** 绘制时从行顶到位图上边的垂直偏移。 */
  yoffset: number;
  /** 绘制完光标前进量。 */
  xadvance: number;
}

/** 字距对，即 .fnt 的一条 kerning 行。 */
export interface BitmapFontKerning {
  /** 前一个字符的码点。 */
  first: number;
  /** 后一个字符的码点。 */
  second: number;
  /** 附加的水平位移（通常为负，表示收紧）。 */
  amount: number;
}

/** 字体 → 位图字体的生成选项。 */
export interface BitmapFontOptions {
  /** 任务 id，用于进度推送与取消匹配。 */
  taskId: string;
  /** 源字体路径。 */
  sourcePath: string;
  /** 要生成的字符（渲染进程已去重去换行）。 */
  chars: string;
  /** 字号 px。 */
  fontSize: number;
  /** 字形之间的间距 px（防线性采样时相邻字形渗色）。 */
  spacing: number;
  /** 图集四周的外边距 px。 */
  padding: number;
  /** 单页最大边长 px；装不下自动开新页。 */
  pageSize: number;
  /** 字形填充色（CSS 颜色串）。 */
  fill: string;
  /** 描边宽度 px；0 表示不描边。 */
  outlineWidth: number;
  /** 描边颜色（CSS 颜色串）。 */
  outlineColor: string;
  /** 是否提取字距对。 */
  kerning: boolean;
  /** 要输出的描述文件格式，可多选。 */
  dataFormats: BitmapFontDataFormat[];
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 产物基名，如 myfont → myfont_0.png + myfont.fnt。 */
  baseName: string;
}

/** 单页图集的尺寸。 */
export interface BitmapFontPageSize {
  width: number;
  height: number;
}

/** 位图字体生成结果（字体来源与图片来源共用）。 */
export interface BitmapFontResult {
  /** 图集 PNG 路径（多页则多个）。 */
  pagePaths: string[];
  /** 描述文件路径（每种格式一个）。 */
  dataPaths: string[];
  /** 实际写入描述文件的字符数。 */
  charCount: number;
  /** 源字体里没有的字符，原样拼成一串返回，让用户知道哪些字没生成。 */
  missingChars: string;
  /** 提取到的字距对数量。 */
  kerningCount: number;
  /** 各页实际尺寸。 */
  pageSizes: BitmapFontPageSize[];
  /** 被跳过的条目数（图片来源：未填字符 / 字符重复 / 图片解码失败）。 */
  skippedCount: number;
  /** 被用户取消：不是错误，页面把行退回 pending。 */
  canceled?: boolean;
}

/** 单页预览。 */
export interface BitmapFontPagePreview {
  /** 预览图 data URL（webp，长边已缩到上限内）。 */
  dataUrl: string;
  /** 该页实际宽 px（未缩放前）。 */
  width: number;
  /** 该页实际高 px（未缩放前）。 */
  height: number;
  /** 该页含字符数。 */
  charCount: number;
}

/** 生成预览结果（只算不写盘）。 */
export interface BitmapFontPreview {
  /** 各页预览。 */
  pages: BitmapFontPagePreview[];
  /** 总字符数。 */
  charCount: number;
  /** 源字体里没有的字符。 */
  missingChars: string;
  /** 装箱占用率百分比（字形面积 / 图集面积），让用户判断参数是否浪费空间。 */
  occupancy: number;
}

/** 图片 → 位图字体：一张字符图与它对应的字符。 */
export interface BitmapGlyphSource {
  /** 图片路径。 */
  path: string;
  /** 该图对应的字符；空串表示用户没指定，主进程跳过并计数。 */
  char: string;
}

/** 图片 → 位图字体的打包选项。 */
export interface BitmapFontPackOptions {
  /** 任务 id。 */
  taskId: string;
  /** 字形图片与字符的对应关系。 */
  glyphs: BitmapGlyphSource[];
  /** 行高 px。图片来源没有字体度量，只能由用户给。 */
  lineHeight: number;
  /** 基线到行顶的距离 px。同上，由用户给。 */
  base: number;
  /** 前进量补偿 px：xadvance = 图片宽 + 该值。 */
  advanceAdjust: number;
  /** 字形之间的间距 px。 */
  spacing: number;
  /** 图集四周的外边距 px。 */
  padding: number;
  /** 单页最大边长 px。 */
  pageSize: number;
  /** 打包前剔除每张图四周的透明边（同精灵图的 trim 语义）。 */
  trim: boolean;
  /** 要输出的描述文件格式。 */
  dataFormats: BitmapFontDataFormat[];
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 产物基名。 */
  baseName: string;
}

/**
 * 生成进度。
 *
 * 分阶段而非百分比：出图是「整页一个 SVG 交给 sharp」的一次不可分割调用，
 * 内部无进度可读（同 FontConvertProgress 的态度，不编造匀速假进度条）。
 */
export interface BitmapFontProgress {
  /** 任务 id，页面据此过滤过期推送。 */
  taskId: string;
  /** 当前阶段：render 取字形路径 / pack 装箱 / write 出图落盘。 */
  stage: 'render' | 'pack' | 'write';
  /** 该阶段已完成数。 */
  done: number;
  /** 该阶段总数。 */
  total: number;
}

/* ── Excel 多语言表转 i18n JSON（exceljs） ────────────────────────── */

/** 工作簿里单个工作表的结构信息。 */
export interface ExcelSheetInfo {
  /** 工作表名（作为选择与合并的标识）。 */
  name: string;
  /** 行数（含表头）。 */
  rowCount: number;
  /** 列数。 */
  columnCount: number;
  /**
   * 表头行各列的文字，按 1-based 列序排列（headers[0] 即 A 列）。
   * 空单元格为空串，保证下标与列号一一对应，便于渲染进程按列号取表头。
   */
  headers: string[];
}

/** 工作簿探测结果。 */
export interface ExcelProbeResult {
  /** 各工作表结构。 */
  sheets: ExcelSheetInfo[];
}

/**
 * 一个待导出的语言列。
 * 文件名由渲染进程从表头解析并允许用户手改，主进程只按值落盘、不再猜。
 */
export interface ExcelI18nColumn {
  /** 列号（1-based）。 */
  column: number;
  /** 表头原文（仅用于结果展示与告警定位）。 */
  header: string;
  /** 输出文件名（可含或不含 .json，主进程兜底补）。 */
  fileName: string;
}

/** Excel 转多语言 JSON 的选项。 */
export interface ExcelI18nOptions {
  /** 参与解析的工作表名；多选时按此顺序合并进同一套 JSON。 */
  sheets: string[];
  /** 表头行行号（1-based）。 */
  headerRow: number;
  /** 数据起始行行号（1-based）。 */
  startRow: number;
  /** key 所在列号（1-based）。 */
  keyColumn: number;
  /** 要导出的语言列。 */
  columns: ExcelI18nColumn[];
  /** key 含点号时转成嵌套对象；关闭则整串作为平铺 key。 */
  nested: boolean;
  /** JSON 缩进空格数；0 表示压缩成单行。 */
  indent: number;
  /** 输出目录绝对路径；JSON 直接写在该目录下，不建子目录。 */
  outputDir: string;
}

/** 单个语言列的解析统计。 */
export interface ExcelI18nColumnStat {
  /** 列号（1-based）。 */
  column: number;
  /** 输出文件名。 */
  fileName: string;
  /** 实际写入的 key 数（已跳过空译文）。 */
  keyCount: number;
  /** 译文为空被跳过的行数。 */
  emptyCount: number;
}

/** 转换预览结果（只算不写盘）。 */
export interface ExcelI18nPreviewResult {
  /** 各语言列统计。 */
  columns: ExcelI18nColumnStat[];
  /** 被请求预览的那一列的 JSON 文本；请求列不存在时为空串。 */
  previewJson: string;
  /** key 为空被整行跳过的行数。 */
  skippedRows: number;
  /** 告警（key 冲突、嵌套结构冲突等），已聚合不逐条刷屏。 */
  warnings: string[];
}

/** 落盘后的单个 JSON 文件信息。 */
export interface ExcelI18nFile {
  /** 文件名。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  /** 写入的 key 数。 */
  keyCount: number;
  /** 文件大小（字节）。 */
  size: number;
}

/** 转换落盘结果。 */
export interface ExcelI18nWriteResult {
  /** 实际输出目录。 */
  outDir: string;
  /** 产出的 JSON 文件。 */
  files: ExcelI18nFile[];
  /** key 为空被整行跳过的行数。 */
  skippedRows: number;
  /** 告警。 */
  warnings: string[];
}

/** 可切换的存储目录种类。 */
export type StorageDirKind = 'cache' | 'data';

/** 数据目录不可写时的自动回退说明。 */
export interface StorageFallback {
  /** 本该使用的目录（默认值或用户设置值）。 */
  requested: string;
  /** 回退原因（错误码或说明），直接展示给用户。 */
  reason: string;
}

/** 应用存储路径信息，设置页展示与判断都用这一份。 */
export interface AppPathsInfo {
  /** 当前生效的缓存目录。 */
  cacheDir: string;
  /** 当前生效的数据保存目录。 */
  dataDir: string;
  /** 缓存目录默认值（系统临时目录下）。 */
  defaultCacheDir: string;
  /** 数据目录默认值（安装目录下的 data）。 */
  defaultDataDir: string;
  /** 缓存目录是否为用户显式设置（非默认）。 */
  cacheDirCustom: boolean;
  /** 数据目录是否为用户显式设置（非默认）。 */
  dataDirCustom: boolean;
  /** 缓存目录不可写而自动回退时的说明；null 表示用的就是期望路径。 */
  cacheDirFallback: StorageFallback | null;
  /** 数据目录不可写而自动回退时的说明；null 表示用的就是期望路径。 */
  dataDirFallback: StorageFallback | null;
  /** 是否 portable（免安装）运行——数据目录取自 PORTABLE_EXECUTABLE_DIR。 */
  portable: boolean;
}

/** 目录占用统计。 */
export interface DirUsage {
  /** 总字节数。 */
  bytes: number;
  /** 文件数（不含目录）。 */
  files: number;
}

/** 数据保存目录迁移结果。 */
export interface MigrateResult {
  /** 迁移后的数据目录。 */
  dataDir: string;
  /** 搬动的顶层条目数。 */
  movedEntries: number;
  /** 搬动的总字节数。 */
  movedBytes: number;
  /** 实际搬法：同盘 rename / 跨盘复制后删除 / 两者都有。 */
  mode: 'rename' | 'copy' | 'mixed' | 'none';
}

/** 清空缓存结果。被占用而删不掉的条目只计入 failed，不让整个操作失败。 */
export interface ClearCacheResult {
  /** 释放的字节数。 */
  freedBytes: number;
  /** 删掉的顶层条目数。 */
  deleted: number;
  /** 删除失败的条目名（含失败原因）。 */
  failed: string[];
}

/**
 * 应用状态整体 blob，存于数据保存目录下的 app-state.json。
 * 按命名空间平铺（`theme` / `usage` / `tools.image-compress`），一个文件存全部，
 * 迁移时只需搬这一个文件，也不会出现多文件半新半旧。
 */
export interface AppStateBlob {
  /** 结构版本，便于以后升级迁移。 */
  version: number;
  /** 命名空间 → 任意 JSON 值。 */
  entries: Record<string, unknown>;
}

/* ------------------------------- AI 对话 ------------------------------- */

/**
 * 一份 AI 配置：厂商 + 模型 + 自定义名称 + 可改的地址与参数。
 * 存在 `app-state.json` 的 `ai.configs` 命名空间里（跟着数据目录迁移）；
 * **API Key 不在这里**，见 {@link AiKeyStatus}。
 */
export interface AiConfig {
  /** 配置 id（创建时生成，key 与会话都按它关联）。 */
  id: string;
  /** 用户自定义名称，如「日常问答」。 */
  name: string;
  /** 厂商 id，对应 shared/ai.ts 的 AI_PROVIDERS。 */
  provider: string;
  /** 模型 id，直接下发给接口。 */
  model: string;
  /** 接口地址（含版本段）。留空时用厂商默认值。 */
  baseUrl: string;
  /** 系统提示词，留空则不下发 system。 */
  systemPrompt: string;
  /**
   * 采样温度。**实测**：openai 协议对推理模型会把它整条丢掉并打一条 warning，
   * 所以这个值「设了不一定生效」，UI 要说明。
   */
  temperature: number;
  /**
   * 单次回复的最大 token 数。
   *
   * **必须显式下发**：实测不传时 anthropic 协议会由 SDK 按 model id 猜一个
   * `max_tokens`（`claude-3-5-haiku-20241022` → 4096，而 `claude-opus-5` /
   * `claude-opus-4-8` / `claude-sonnet-4-6` → 128000，认不出的 id → 4096）。
   * 猜高了真实接口直接 400，且四种协议行为还不一致，因此这里自己定。
   */
  maxOutputTokens: number;
  /** 创建时间戳（毫秒）。 */
  createdAt: number;
}

/**
 * 工具审批策略，**全局一份而不是每配置一份**（用户想的是「我这台机器上要不要拦一下」，
 * 不是「这个模型要不要拦」）。
 *
 * - `off`：**压根不下发 `tools`**。省掉每次请求十几个工具声明的 token，也绕开部分兼容
 *   端点对 `tools` 直接 400 的问题。
 * - `ask`（默认）：只读工具直接跑，写盘工具逐次确认。
 * - `auto`：写盘工具也直接跑，**但覆盖原文件仍然要确认**（见 {@link AiToolCall}）。
 */
export type AiToolMode = 'off' | 'ask' | 'auto';

/** 配置集合 + 当前选中项，整体存一个命名空间（`ai`，渲染进程整块覆盖写）。 */
export interface AiConfigState {
  /** 全部配置。 */
  configs: AiConfig[];
  /** 当前选中的配置 id；为空或失效时由渲染进程回落到第一条。 */
  activeId: string;
  /**
   * 工具调用的审批策略，**全局一份而不是每配置一份**（用户想的是「我这台机器上要不要
   * 拦一下」，不是「这个模型要不要拦」）。默认 `'ask'`。
   */
  toolApproval?: AiToolMode;
}

/**
 * AI 对话窗口自己的状态，存在**独立的 `aiWindow` 命名空间**里。
 *
 * **不能塞进 `ai`**：那个命名空间是 `aiConfig` store 整块覆盖写的，而这里是**主进程**在
 * 窗口移动/缩放时写，两边都整块写必然互相抹掉。
 */
export interface AiWindowState {
  /**
   * 上次的窗口矩形（屏幕坐标，DIP）。**没存过时不要给默认值**——由主进程按主窗口现算，
   * 且读出来也一定要夹进当前显示器的工作区，否则拔掉外接屏后窗口就开在看不见的地方。
   */
  bounds?: { x: number; y: number; width: number; height: number };
  /** 是否置顶（盖住其他程序）。 */
  alwaysOnTop?: boolean;
}

/**
 * 某份配置的 key 状态。**明文永不回渲染进程**，只回是否存在与掩码提示。
 */
export interface AiKeyStatus {
  /** 对应的配置 id。 */
  configId: string;
  /** 是否已存 key。 */
  hasKey: boolean;
  /** 掩码提示，如 `sk-a…7890`；无 key 时为空串。 */
  hint: string;
  /**
   * 是否真的加密存储。`safeStorage.isEncryptionAvailable()` 为 false 时降级明文，
   * 此处为 false，设置页必须显著提示——**不许假装加密**。
   */
  encrypted: boolean;
}

/** 一张已暂存到数据目录的图片。 */
export interface AiImageRef {
  /** 内容哈希（同时是文件名主干）。 */
  id: string;
  /** 落盘绝对路径（在 `<dataDir>/ai/images/` 下）。 */
  path: string;
  /** MIME 类型，随请求下发给各家接口。 */
  mediaType: string;
  /** 降采样后的宽。 */
  width: number;
  /** 降采样后的高。 */
  height: number;
  /** 降采样后的字节数。 */
  bytes: number;
  /** 列表用的小缩略图 data URL。 */
  thumbnailDataUrl: string;
}

/**
 * 一次工具调用的记录（**既是界面模型也是落盘模型**，跟着 {@link AiMessage} 一起存）。
 *
 * 同一个 `callId` 会经历 `pending → running → done`，主进程每次推**完整一条**、渲染
 * 进程按 `callId` upsert——幂等，中途断一片也不会留下半张卡片。
 */
export interface AiToolCall {
  /** 这次调用的 id（主进程生成，确认往返也按它对应）。 */
  callId: string;
  /** 工具名。 */
  name: string;
  /** 只读还是会写盘。`write` 在 `ask` 模式下逐次确认。 */
  kind: 'read' | 'write';
  /** 给人看的一行参数摘要，由工具自己的 `summarize` 生成。 */
  summary: string;
  /**
   * 状态。`interrupted` 是**从磁盘读回来时补的**：上次关窗口时挂着的确认卡，重开后
   * 没有任何 promise 在等它，按钮点了也没人接。
   */
  status: 'pending' | 'running' | 'done' | 'denied' | 'error' | 'interrupted';
  /** 结果摘要（成功一行、失败是原因）。**不放全量结果**，会话文件不该被它撑大。 */
  result?: string;
  /** 开始时间戳（毫秒）。 */
  startedAt: number;
  /** 耗时毫秒（跑完才有）。 */
  elapsed?: number;
}

/** 一条对话消息（既是界面模型也是落盘模型）。 */
export interface AiMessage {
  /** 消息 id。 */
  id: string;
  /** 角色。 */
  role: 'user' | 'assistant';
  /** 正文。 */
  text: string;
  /** 推理过程（deepseek-reasoner 那类会有），与正文分开累积。 */
  reasoning?: string;
  /** 附带的图片。 */
  images?: AiImageRef[];
  /** 创建时间戳（毫秒）。 */
  createdAt: number;
  /** 失败原因（中文可读）；有值时这条消息是错误态。 */
  error?: string;
  /** 是否被用户取消。 */
  canceled?: boolean;
  /** SDK 的告警（如「该模型不支持 temperature」），如实展示而不是吞掉。 */
  warnings?: string[];
  /** 这条助手消息里发生过的工具调用，按发生顺序。 */
  toolCalls?: AiToolCall[];
}

/** 下发给主进程的单条消息（不带 id / 时间等界面字段）。 */
export interface AiSendMessage {
  /** 角色。 */
  role: 'user' | 'assistant';
  /** 正文。 */
  text: string;
  /** 图片路径与类型（主进程自己读文件，渲染进程不碰 base64）。 */
  images?: { path: string; mediaType: string }[];
}

/** 一次对话请求。 */
export interface AiChatRequest {
  /** 请求 id，取消与流式分片都按它对应。 */
  requestId: string;
  /**
   * 用哪份配置。**配置整份随请求下发**而不是只给 id：配置存在 `app-state.json` 里、
   * 由渲染进程管，主进程不读那个文件（读了就是两份状态，必然漂移）。主进程只按
   * `config.id` 去自己的密钥库取 key。
   */
  config: AiConfig;
  /** 完整上下文（含本轮用户消息）。 */
  messages: AiSendMessage[];
  /**
   * 工具审批策略。**跟着请求下发而不是主进程去读 app-state**，同 `config` 一个理由。
   * `'off'` 时主进程压根不给 `streamText` 传 `tools`。
   */
  toolMode: AiToolMode;
}

/** 流式分片：主进程 → 渲染进程。 */
export interface AiStreamEvent {
  /** 对应的请求 id。 */
  requestId: string;
  /** 分片类型。 */
  type: 'text' | 'reasoning' | 'warning' | 'error' | 'abort' | 'tool';
  /** text / reasoning 的增量文本。 */
  delta?: string;
  /** warning / error 的说明文本。 */
  message?: string;
  /** `tool` 分片的完整记录（**不是增量**，按 `callId` upsert）。 */
  toolCall?: AiToolCall;
}

/** token 用量。各家字段名不同，由 SDK 归一后取这三项。 */
export interface AiUsage {
  /** 输入 token。 */
  inputTokens?: number;
  /** 输出 token。 */
  outputTokens?: number;
  /** 合计。 */
  totalTokens?: number;
}

/** 一次对话的最终结果（`ai:chat` 在流结束时才 resolve）。 */
export interface AiChatResult {
  /** 完整正文。 */
  text: string;
  /** 完整推理过程。 */
  reasoning: string;
  /** 用量；取不到时为 undefined（取消时一定取不到）。 */
  usage?: AiUsage;
  /** 结束原因（stop / length / error / …）。 */
  finishReason: string;
  /** 是否因取消而结束。 */
  canceled: boolean;
  /** SDK 告警。 */
  warnings: string[];
}

/** 「测试连接」结果。 */
export interface AiTestResult {
  /** 是否连通。 */
  ok: boolean;
  /** 成功时是模型回的一小段文本，失败时是中文可读原因（含状态码）。 */
  message: string;
  /** 耗时毫秒。 */
  latencyMs: number;
}

/** 一个会话。存 `<dataDir>/ai/conversations.json`，不进 app-state.json。 */
export interface AiConversation {
  /** 会话 id。 */
  id: string;
  /** 标题（默认取首条用户消息前若干字）。 */
  title: string;
  /**
   * 标题是否由用户手动改过。为 true 时**自动标题不许再覆盖**——否则用户刚重命名，
   * 下一条消息就把它改回去。
   */
  titleCustom?: boolean;
  /** 消息列表。 */
  messages: AiMessage[];
  /** 最后一次使用的配置 id。 */
  configId: string;
  /** 创建时间戳（毫秒）。 */
  createdAt: number;
  /** 更新时间戳（毫秒）。 */
  updatedAt: number;
}
