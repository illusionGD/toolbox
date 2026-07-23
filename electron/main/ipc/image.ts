import { basename, extname, join } from 'path';
import { readFile, stat } from 'fs/promises';
import sharp, { type Sharp } from 'sharp';
import { IMAGE_CHANNELS } from '../../shared/channels';
import type {
  CompressOptions,
  CompressResult,
  FormatAdvanced,
  ImageOutputFormat,
} from '../../shared/types';
import { handle } from './helper';

/** 输出格式对应的文件扩展名。 */
const FORMAT_EXT: Record<Exclude<ImageOutputFormat, 'original'>, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
};

/**
 * 按输出格式对 sharp 实例应用编码参数（含高级选项）。
 * @param instance sharp 实例。
 * @param format 目标格式（已解析，非 original）。
 * @param quality 质量 1-100。
 * @param advanced 各格式高级选项（可选，缺省用 sharp 默认）。
 * @returns 配置后的 sharp 实例。
 */
function applyFormat(
  instance: Sharp,
  format: Exclude<ImageOutputFormat, 'original'>,
  quality: number,
  advanced?: Partial<FormatAdvanced>,
): Sharp {
  switch (format) {
    case 'jpeg': {
      const a = advanced?.jpeg;
      return instance.jpeg({
        quality,
        progressive: a?.progressive,
        mozjpeg: a?.mozjpeg,
        chromaSubsampling: a?.chromaSubsampling,
      });
    }
    case 'png': {
      const a = advanced?.png;
      // png 无 quality；高级里可显式给 compressionLevel，否则由 quality 近似映射
      return instance.png({
        compressionLevel: a?.compressionLevel ?? Math.round(((100 - quality) / 100) * 9),
        progressive: a?.progressive,
        palette: a?.palette,
        quality: a?.palette ? quality : undefined,
      });
    }
    case 'webp': {
      const a = advanced?.webp;
      return instance.webp({ quality, lossless: a?.lossless, effort: a?.effort });
    }
    case 'avif': {
      const a = advanced?.avif;
      return instance.avif({ quality, lossless: a?.lossless, effort: a?.effort });
    }
  }
}

/**
 * 生成缩略图 data URL（用于列表预览，避免把原图全量塞进渲染进程）。
 * @param filePath 图片路径。
 * @param size 缩略图最大边长，默认 64。
 * @returns webp 格式的 data URL。
 */
async function makeThumbnail(filePath: string, size = 64): Promise<string> {
  const buffer = await sharp(filePath)
    .resize(size, size, { fit: 'cover' })
    .webp({ quality: 60 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

/**
 * 读取原图为 data URL（用于点击对比大图预览）。
 * @param filePath 图片路径。
 * @returns 原图 data URL。
 */
async function readDataUrl(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const ext = extname(filePath).replace(/^\./, '').toLowerCase() || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${buffer.toString('base64')}`;
}

/**
 * 压缩单张图片。
 * @param sourcePath 源文件路径。
 * @param options 压缩选项。
 * @returns 压缩结果（含前后大小与压缩率）。
 */
async function compressOne(sourcePath: string, options: CompressOptions): Promise<CompressResult> {
  const { format, quality, maxWidth, outputDir, overwrite, advanced } = options;

  const originalStat = await stat(sourcePath);
  const sourceExt = extname(sourcePath).replace(/^\./, '').toLowerCase();

  // 解析实际输出格式：original 时沿用源扩展名（jpg/jpeg 归一到 jpeg）
  const resolvedFormat: Exclude<ImageOutputFormat, 'original'> =
    format === 'original'
      ? sourceExt === 'jpg' || sourceExt === 'jpeg'
        ? 'jpeg'
        : sourceExt === 'png'
          ? 'png'
          : sourceExt === 'webp'
            ? 'webp'
            : sourceExt === 'avif'
              ? 'avif'
              : 'jpeg'
      : format;

  let instance = sharp(sourcePath).rotate();
  if (maxWidth && maxWidth > 0) {
    // 仅缩小、不放大
    instance = instance.resize({ width: maxWidth, withoutEnlargement: true });
  }
  instance = applyFormat(instance, resolvedFormat, quality, advanced);

  const outExt = FORMAT_EXT[resolvedFormat];
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const outputPath = overwrite ? sourcePath : join(outputDir, `${nameNoExt}.${outExt}`);

  const buffer = await instance.toBuffer();
  // 覆盖原文件时也用 sharp 输出后写回（toFile 不能读写同一路径，故先 toBuffer 再写）
  await sharp(buffer).toFile(outputPath);

  const compressedSize = buffer.length;
  const originalSize = originalStat.size;
  const ratio =
    originalSize > 0 ? Math.max(0, Math.round((1 - compressedSize / originalSize) * 100)) : 0;

  return { sourcePath, outputPath, originalSize, compressedSize, ratio };
}

/** 注册图片处理相关 IPC。 */
export function registerImageIpc(): void {
  handle(IMAGE_CHANNELS.thumbnail, (_e, filePath: string) => makeThumbnail(filePath));
  handle(IMAGE_CHANNELS.dataUrl, (_e, filePath: string) => readDataUrl(filePath));
  handle(IMAGE_CHANNELS.compress, (_e, sourcePath: string, options: CompressOptions) =>
    compressOne(sourcePath, options),
  );
}
