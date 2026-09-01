import type { FontConvertFile, FontConvertFormat, FontOutputFormat } from '@shared/types';
import type { FileItem } from '@/types/file';

/** 字体裁剪列表项：在通用文件项上附加元信息与裁剪结果。 */
export interface FontItem extends FileItem {
  /** 字体族名；加入列表后异步探测填充。 */
  fontName?: string;
  /** 字形数。 */
  glyphCount?: number;
  /** 元信息是否已探测（区分「读取失败」与「还没探测」）。 */
  probed?: boolean;
  /** 裁剪后大小（字节）。 */
  subsetSize?: number;
  /** 体积变化百分比，正数为减小。 */
  ratio?: number;
  /** 输出文件路径。 */
  outputPath?: string;
  /** 实际输出格式。 */
  outputFormat?: Exclude<FontOutputFormat, 'original'>;
}

/**
 * 字体格式转换列表项。
 *
 * 不复用 FontItem：那边的 subsetSize / ratio 是裁剪语义，格式转换是无损的、
 * 且一行可能对应多个产物文件，字段结构不同。
 */
export interface FontConvertItem extends FileItem {
  /** 字体族名；加入列表后异步探测填充。 */
  fontName?: string;
  /** 字形数（转换前后应一致，用于向用户证明无损）。 */
  glyphCount?: number;
  /** 元信息是否已探测（区分「读取失败」与「还没探测」）。 */
  probed?: boolean;
  /** 源容器格式（sfnt / woff / woff2）。 */
  sourceFormat?: string;
  /** 已产出的文件（一行可有多个格式）。 */
  outputs?: FontConvertFile[];
  /** 被跳过的格式（目标已存在未开覆盖，或目标就是源文件）。 */
  skipped?: FontConvertFormat[];
  /** 正在转换的格式（processing 时显示，让 12 秒的 woff2 编码不像卡死）。 */
  currentFormat?: FontConvertFormat;
  /** 当前是第几个格式 / 共几个（同上，进度只到格式粒度）。 */
  formatStep?: string;
}

/**
 * 位图字体「图片 → 位图」tab 的列表项。
 *
 * 与精灵图的合并项不同：这里每张图必须绑定一个字符，图集里的位置由字符（码点）
 * 决定排序，所以 char 是必填项而不是可选的装饰。
 */
export interface BitmapGlyphItem extends FileItem {
  /** 这张图对应的字符；空表示还没填，生成时会被跳过。 */
  char?: string;
  /** 缩略图 data URL；进入当前页后异步加载。 */
  thumb?: string;
  /** 图片像素尺寸；与缩略图一起探测填充。 */
  imgWidth?: number;
  imgHeight?: number;
}
