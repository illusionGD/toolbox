import type { FileItem } from '@/types/file';

/** 图片压缩列表项：在通用文件项上附加缩略图与压缩结果。 */
export interface CompressItem extends FileItem {
  /** 缩略图 data URL（异步加载）。 */
  thumbnail?: string;
  /** 压缩后大小（字节）。 */
  compressedSize?: number;
  /** 压缩率百分比 0-100。 */
  ratio?: number;
  /** 输出文件路径。 */
  outputPath?: string;
}
