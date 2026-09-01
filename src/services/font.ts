import type {
  FontConvertOptions,
  FontConvertProgress,
  FontConvertResult,
  FontMeta,
  FontSplitOptions,
  FontSplitResult,
  FontSubsetOptions,
  FontSubsetResult,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 字体处理服务：封装 window.api.font，供渲染进程业务调用。
 */

/**
 * 读字体元信息（字体名/字形数/大小）。
 * @param filePath 字体路径。
 * @returns 元信息。
 */
export function probeFontApi(filePath: string): Promise<FontMeta> {
  // 列表里逐个探测，失败静默、由调用方兜底占位
  return unwrap(window.api.font.probe(filePath), { silent: true });
}

/**
 * 裁剪预览（不写盘），返回 woff2 的 data URL。
 * @param filePath 字体路径。
 * @param chars 要保留的字符集。
 * @returns woff2 data URL。
 */
export function subsetPreviewApi(filePath: string, chars: string): Promise<string> {
  // 预览随参数变化触发，失败在预览区就地提示，不弹窗
  return unwrap(window.api.font.subsetPreview(filePath, chars), { silent: true });
}

/**
 * 按字符集裁剪字体并落盘。
 * @param sourcePath 源字体路径。
 * @param options 裁剪选项。
 * @returns 裁剪结果。
 */
export function subsetFontApi(
  sourcePath: string,
  options: FontSubsetOptions,
): Promise<FontSubsetResult> {
  // 批量时由调用方逐条捕获并标记行状态，这里静默、只抛错
  return unwrap(window.api.font.subset(sourcePath, options), { silent: true });
}

/**
 * 网页分包：一个字体切成多个 unicode-range 分包 + CSS。
 * @param sourcePath 源字体路径。
 * @param options 分包选项。
 * @returns 产物摘要。
 */
export function splitFontApi(
  sourcePath: string,
  options: FontSplitOptions,
): Promise<FontSplitResult> {
  // 单字体处理、非批量，失败直接弹提示
  return unwrap(window.api.font.split(sourcePath, options), { errorPrefix: '分包失败' });
}

/**
 * 纯容器格式转换（无损，不裁剪），一次可产出多个格式。
 * @param sourcePath 源字体路径。
 * @param options 转换选项。
 * @returns 转换结果。
 */
export function convertFontApi(
  sourcePath: string,
  options: FontConvertOptions,
): Promise<FontConvertResult> {
  // 批量时由调用方逐条捕获并标记行状态，这里静默、只抛错
  return unwrap(window.api.font.convert(sourcePath, options), { silent: true });
}

/**
 * 取消进行中的格式转换。
 * @param taskId 任务 id。
 * @returns 是否已置取消标记。
 */
export function cancelFontConvertApi(taskId: string): Promise<boolean> {
  // 取消是用户主动动作，失败没什么可做的，静默
  return unwrap(window.api.font.cancelConvert(taskId), { silent: true });
}

/**
 * 订阅格式转换进度。
 * @param callback 进度回调。
 * @returns 取消订阅的函数。
 */
export function onFontConvertProgress(
  callback: (progress: FontConvertProgress) => void,
): () => void {
  // 事件推送不是 invoke，没有 {code,data,message} 可解，直接透传
  return window.api.font.onConvertProgress(callback);
}
