import type {
  AutoCropOptions,
  CompressOptions,
  CompressResult,
  CropOptions,
  CropProbe,
  CropResult,
  QrDecodeResult,
  QrGenerateOptions,
  QrGenerateResult,
  QrPreviewOptions,
  SpriteMergeOptions,
  SpriteMergePreview,
  SpriteMergeResult,
  SpriteSliceOptions,
  SpriteSliceProbe,
  SpriteSliceProbeOptions,
  SpriteSliceResult,
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

/**
 * 合并多图为精灵表 + 坐标数据。
 * @param options 合并选项。
 * @returns 合并结果（表路径/坐标文件/尺寸）。
 */
export function spriteMergeApi(options: SpriteMergeOptions): Promise<SpriteMergeResult> {
  return unwrap(window.api.image.spriteMerge(options), { errorPrefix: '合并失败' });
}

/**
 * 合并预览（不写盘），用于处理前查看图集排布。
 * @param options 合并选项。
 * @returns 预览 data URL 与图集尺寸。
 */
export function spriteMergePreviewApi(options: SpriteMergeOptions): Promise<SpriteMergePreview> {
  // 预览随参数变化触发，失败在预览区就地提示，不弹窗
  return unwrap(window.api.image.spriteMergePreview(options), { silent: true });
}

/**
 * 探测精灵表将切出的单元（不写盘），供画布预览框选。
 * @param filePath 精灵表路径。
 * @param options 探测选项。
 * @returns 表尺寸与切割单元。
 */
export function spriteSliceProbeApi(
  filePath: string,
  options: SpriteSliceProbeOptions,
): Promise<SpriteSliceProbe> {
  // 探测随参数变化频繁触发，失败在画布区就地提示，不弹窗刷屏
  return unwrap(window.api.image.spriteSliceProbe(filePath, options), { silent: true });
}

/**
 * 切割精灵表为多张小图。
 * @param filePath 精灵表路径。
 * @param options 切割选项。
 * @returns 切割结果（输出路径与跳过数）。
 */
export function spriteSliceApi(
  filePath: string,
  options: SpriteSliceOptions,
): Promise<SpriteSliceResult> {
  return unwrap(window.api.image.spriteSlice(filePath, options), { errorPrefix: '切割失败' });
}

/**
 * 批量生成二维码。
 * @param options 生成选项。
 * @returns 成功路径与失败数。
 */
export function generateQrApi(options: QrGenerateOptions): Promise<QrGenerateResult> {
  return unwrap(window.api.image.qrGenerate(options), { errorPrefix: '生成失败' });
}

/**
 * 生成二维码预览（不写盘）。
 * @param options 预览选项。
 * @returns png data URL。
 */
export function qrPreviewApi(options: QrPreviewOptions): Promise<string> {
  // 预览随输入/参数频繁触发，失败就地提示不弹窗
  return unwrap(window.api.image.qrPreview(options), { silent: true });
}

/**
 * 解析单张图片的二维码。
 * @param filePath 图片路径。
 * @returns 解析结果。
 */
export function decodeQrApi(filePath: string): Promise<QrDecodeResult> {
  // 批量解析由调用方逐条标记行状态，这里静默
  return unwrap(window.api.image.qrDecode(filePath), { silent: true });
}
