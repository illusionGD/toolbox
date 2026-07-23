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
}

/** 图片输出格式。'original' 表示保持原格式。 */
export type ImageOutputFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif';

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

/** 各格式高级选项集合。 */
export interface FormatAdvanced {
  jpeg: JpegAdvanced;
  png: PngAdvanced;
  webp: WebpAdvanced;
  avif: AvifAdvanced;
}

/** 图片压缩选项。 */
export interface CompressOptions {
  /** 输出格式。 */
  format: ImageOutputFormat;
  /** 质量 1-100（png 用于映射压缩级别）。 */
  quality: number;
  /** 最大宽度（px）；不限制则为 undefined。等比缩放，不放大。 */
  maxWidth?: number;
  /** 输出目录绝对路径。 */
  outputDir: string;
  /** 是否覆盖原文件（true 时忽略 outputDir，写回原路径）。 */
  overwrite: boolean;
  /** 各格式高级选项；未提供时用主进程默认。 */
  advanced?: Partial<FormatAdvanced>;
}

/** 单张图片压缩结果。 */
export interface CompressResult {
  /** 源文件路径。 */
  sourcePath: string;
  /** 输出文件路径。 */
  outputPath: string;
  /** 原始大小（字节）。 */
  originalSize: number;
  /** 压缩后大小（字节）。 */
  compressedSize: number;
  /** 压缩率百分比 0-100（节省的比例）。 */
  ratio: number;
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
