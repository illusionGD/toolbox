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
   * 时间剪切区间（秒）。本轮不接入 UI，为下一轮的裁剪页预留，
   * 使两页共用同一个 transcodeOne，不必改签名。
   */
  trim?: { start: number; end: number };
  /** 画面裁剪矩形（源像素坐标）。同 trim，为下一轮预留。 */
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
