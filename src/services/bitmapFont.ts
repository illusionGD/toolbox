import type {
  BitmapFontOptions,
  BitmapFontPackOptions,
  BitmapFontPreview,
  BitmapFontProgress,
  BitmapFontResult,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 位图字体服务：封装 window.api.bitmapFont，供渲染进程业务调用。
 */

/**
 * 从字体生成图集 + 描述文件并落盘。
 * @param options 生成选项。
 * @returns 产物摘要。
 */
export function generateBitmapFontApi(options: BitmapFontOptions): Promise<BitmapFontResult> {
  // 单字体流程页，失败直接弹提示
  return unwrap(window.api.bitmapFont.generate(options), { errorPrefix: '生成失败' });
}

/**
 * 生成预览（只算不写盘）。
 * @param options 生成选项。
 * @returns 各页预览。
 */
export function previewBitmapFontApi(options: BitmapFontOptions): Promise<BitmapFontPreview> {
  // 预览失败在预览区就地提示，不弹窗
  return unwrap(window.api.bitmapFont.preview(options), { silent: true });
}

/**
 * 把一组字符图片打包成位图字体。
 * @param options 打包选项。
 * @returns 产物摘要。
 */
export function packBitmapFontApi(options: BitmapFontPackOptions): Promise<BitmapFontResult> {
  return unwrap(window.api.bitmapFont.packImages(options), { errorPrefix: '打包失败' });
}

/**
 * 取消进行中的生成。
 * @param taskId 任务 id。
 * @returns 是否已置取消标记。
 */
export function cancelBitmapFontApi(taskId: string): Promise<boolean> {
  // 取消是用户主动动作，失败没什么可做的，静默
  return unwrap(window.api.bitmapFont.cancel(taskId), { silent: true });
}

/**
 * 订阅生成进度。
 * @param callback 进度回调。
 * @returns 取消订阅的函数。
 */
export function onBitmapFontProgress(callback: (progress: BitmapFontProgress) => void): () => void {
  // 事件推送不是 invoke，没有 {code,data,message} 可解，直接透传
  return window.api.bitmapFont.onProgress(callback);
}
