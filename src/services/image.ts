import type { CompressOptions, CompressResult } from '@shared/types';
import { unwrap } from './ipc';

/**
 * 图片处理服务：封装 window.api.image，供渲染进程业务调用。
 */

/**
 * 生成缩略图 data URL。
 * @param filePath 图片路径。
 * @returns webp 缩略图 data URL。
 */
export function getThumbnailApi(filePath: string): Promise<string> {
  // 缩略图失败不打扰用户（列表里静默），由调用方决定是否兜底
  return unwrap(window.api.image.thumbnail(filePath), { silent: true });
}

/**
 * 读取原图 data URL（对比大图用）。
 * @param filePath 图片路径。
 * @returns 原图 data URL。
 */
export function getDataUrlApi(filePath: string): Promise<string> {
  return unwrap(window.api.image.dataUrl(filePath), { errorPrefix: '预览加载失败' });
}

/**
 * 压缩单张图片。
 * @param sourcePath 源文件路径。
 * @param options 压缩选项。
 * @returns 压缩结果。
 */
export function compressImageApi(
  sourcePath: string,
  options: CompressOptions,
): Promise<CompressResult> {
  // 批量压缩由调用方逐条捕获并标记行状态，这里静默、只抛错
  return unwrap(window.api.image.compress(sourcePath, options), { silent: true });
}
