import type {
  AutoCropOptions,
  CompressOptions,
  CompressResult,
  CropOptions,
  CropProbe,
  CropResult,
  StylizeOptions,
  StylizePreviewOptions,
  StylizeResult,
} from '@shared/types';
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

/**
 * 探测自动裁剪的包围盒（不写盘），用于处理前预览裁剪范围。
 * @param filePath 图片路径。
 * @param auto 自动裁剪参数。
 * @returns 原图尺寸与包围盒。
 */
export function probeCropApi(filePath: string, auto: AutoCropOptions): Promise<CropProbe> {
  // 探测只影响列表里的预览列，失败不该打扰用户
  return unwrap(window.api.image.probeCrop(filePath, auto), { silent: true });
}

/**
 * 裁剪单张图片。
 * @param sourcePath 源文件路径。
 * @param options 裁剪选项。
 * @returns 裁剪结果。
 */
export function cropImageApi(sourcePath: string, options: CropOptions): Promise<CropResult> {
  // 同压缩：批量时由调用方逐条标记行状态
  return unwrap(window.api.image.crop(sourcePath, options), { silent: true });
}

/**
 * 生成风格化预览（缩放后处理，不写盘）。
 * @param filePath 图片路径。
 * @param options 预览选项。
 * @returns 预览 data URL。
 */
export function stylizePreviewApi(
  filePath: string,
  options: StylizePreviewOptions,
): Promise<string> {
  // 预览随参数变化频繁触发，失败弹窗会刷屏；由调用方在预览区就地提示
  return unwrap(window.api.image.stylizePreview(filePath, options), { silent: true });
}

/**
 * 风格化单张图片。
 * @param sourcePath 源文件路径。
 * @param options 风格化选项。
 * @returns 处理结果。
 */
export function stylizeImageApi(
  sourcePath: string,
  options: StylizeOptions,
): Promise<StylizeResult> {
  // 同压缩：批量时由调用方逐条标记行状态
  return unwrap(window.api.image.stylize(sourcePath, options), { silent: true });
}
