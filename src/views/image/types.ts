import type { CropRect, ImageOutputFormat } from '@shared/types';
import type { FileItem } from '@/types/file';

/** 图片压缩/转换列表项：在通用文件项上附加缩略图与处理结果。 */
export interface CompressItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
  /** 处理后大小（字节）。 */
  compressedSize?: number;
  /** 体积变化百分比，正数为减小、负数为增大。 */
  ratio?: number;
  /** 输出文件路径。 */
  outputPath?: string;
  /** 实际输出格式（保持原格式时为解析后的结果）。 */
  outputFormat?: Exclude<ImageOutputFormat, 'original'>;
  /** 输出是否为多帧动图。 */
  animated?: boolean;
}

/** 图片裁剪列表项：在通用文件项上附加缩略图、裁剪框与处理结果。 */
export interface CropItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
  /** 原图宽度 px；加入列表后异步探测填充。 */
  naturalWidth?: number;
  /** 原图高度 px。 */
  naturalHeight?: number;
  /**
   * 裁剪框（原图像素坐标）。
   * 手动模式为用户拉的框；自动模式为探测出的包围盒（仅预览，实际由主进程 trim 决定）。
   */
  rect?: CropRect;
  /** 处理后大小（字节）。 */
  croppedSize?: number;
  /** 输出宽度 px。 */
  outputWidth?: number;
  /** 输出高度 px。 */
  outputHeight?: number;
  /** 输出文件路径。 */
  outputPath?: string;
  /** 无可裁边缘（输出尺寸与原图一致），仅重编码。 */
  skipped?: boolean;
}

/** 图片风格化列表项：在通用文件项上附加缩略图、局部区域与处理结果。 */
export interface StylizeItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
  /** 原图宽度 px；打开局部区域弹窗时由 <img> 的 naturalWidth 读取。 */
  naturalWidth?: number;
  /** 原图高度 px。 */
  naturalHeight?: number;
  /** 局部效果区域（原图像素坐标）；未设置时只施加全局效果。 */
  regions?: CropRect[];
  /** 处理后大小（字节）。 */
  stylizedSize?: number;
  /** 输出文件路径。 */
  outputPath?: string;
}

/** 精灵图合并列表项：在通用文件项上附加缩略图。 */
export interface SpriteMergeItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
}

/** 二维码解析列表项：在通用文件项上附加缩略图与解析结果。 */
export interface QrDecodeItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
  /** 解析出的文本；未识别为空。 */
  result?: string;
  /** 是否已解析（区分「未识别」与「还没解析」）。 */
  decoded?: boolean;
}
