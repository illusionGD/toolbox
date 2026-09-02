import type {
  TranscodeOptions,
  TranscodeResult,
  VideoCapabilities,
  VideoMeta,
  VideoProgress,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 视频处理服务：封装 window.api.video，供渲染进程业务调用。
 */

/**
 * 探测当前 ffmpeg 构建可用的编码器。
 *
 * 页面用它过滤编码器下拉——打包的是 4.1 构建，能力与文档、与开发机的系统
 * ffmpeg 都不一样，不探测就会给用户一个点下去必然报错的选项。
 * @returns 版本与编码器集合。
 */
export function getVideoCapabilitiesApi(): Promise<VideoCapabilities> {
  return unwrap(window.api.video.capabilities(), { errorPrefix: '读取 ffmpeg 能力失败' });
}

/**
 * 读取视频元信息（同时授权该路径可被 tb-media 播放）。
 * @param filePath 视频路径。
 * @returns 元信息。
 */
export function probeVideoApi(filePath: string): Promise<VideoMeta> {
  // 批量导入时逐条探测，失败的行自己标状态，不弹窗刷屏
  return unwrap(window.api.video.probe(filePath), { silent: true });
}

/**
 * 抽一帧作缩略图。
 * @param filePath 视频路径。
 * @returns jpeg data URL。
 */
export function getVideoThumbnailApi(filePath: string): Promise<string> {
  // 同图片缩略图：列表里静默失败，由调用方兜底占位
  return unwrap(window.api.video.thumbnail(filePath), { silent: true });
}

/**
 * 抽任意时间点的一帧（胶片条时间轴用）。
 *
 * 一次一帧、由调用方并发多次（实测 120s 720p 取 12 帧：串行 1523ms、并发 4
 * 只要 550ms，且成本与视频时长无关；一趟出整条的两种写法要么覆盖不到全片、
 * 要么得解完整条视频，见主进程注释）。
 * @param filePath 视频路径。
 * @param atSeconds 时间点秒。
 * @param width 输出宽度 px。
 * @returns jpeg data URL。
 */
export function getVideoFrameApi(
  filePath: string,
  atSeconds: number,
  width: number,
): Promise<string> {
  // 同缩略图：单帧失败由调用方占位兜底，十几个格子逐个弹窗是灾难
  return unwrap(window.api.video.frame(filePath, atSeconds, width), { silent: true });
}

/**
 * 转码单个视频。
 * @param sourcePath 源文件路径。
 * @param options 转码选项。
 * @returns 转码结果（含 canceled 标记）。
 */
export function transcodeVideoApi(
  sourcePath: string,
  options: TranscodeOptions,
): Promise<TranscodeResult> {
  // 串行批量时由调用方逐条捕获并标记行状态，这里静默、只抛错
  return unwrap(window.api.video.transcode(sourcePath, options), { silent: true });
}

/**
 * 取消进行中的转码。
 * @param taskId 任务 id。
 * @returns 是否杀掉了对应进程。
 */
export function cancelTranscodeApi(taskId: string): Promise<boolean> {
  // 同 cancelScanApi：取消本身失败没什么可让用户做的，静默
  return unwrap(window.api.video.cancel(taskId), { silent: true });
}

/**
 * 订阅转码进度。
 * @param callback 进度回调。
 * @returns 取消订阅的函数。
 */
export function onTranscodeProgress(callback: (progress: VideoProgress) => void): () => void {
  return window.api.video.onProgress(callback);
}

/**
 * 生成 tb-media 播放 URL。
 *
 * `file://` 在开发环境（renderer 是 http://localhost）会被 Chromium 拦掉，
 * 所以播放一律走自定义协议；路径必须先经 probe 登记进白名单。
 * @param filePath 绝对路径。
 * @returns 可直接放进 `<video src>` 的 URL。
 */
export function toMediaUrl(filePath: string): string {
  return `tb-media://local/?path=${encodeURIComponent(filePath)}`;
}
