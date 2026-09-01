import type {
  AudioConvertOptions,
  AudioConvertResult,
  AudioMeta,
  AudioProgress,
  AudioSplitOptions,
  AudioSplitResult,
  DetectSilenceOptions,
  DetectSilenceResult,
  WaveformOptions,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 音频处理服务：封装 window.api.audio，供渲染进程业务调用。
 *
 * 能力探测（可用编码器）走 services/video 的 getVideoCapabilitiesApi——
 * 主进程 probeCapabilities() 一次就把音视频编码器都探回来了，这里不再开一条。
 */

/**
 * 读取音频元信息（同时授权该路径可被 tb-media 播放）。
 * @param filePath 音频路径。
 * @returns 元信息。
 */
export function probeAudioApi(filePath: string): Promise<AudioMeta> {
  // 批量导入时逐条探测，失败的行自己标状态，不弹窗刷屏
  return unwrap(window.api.audio.probe(filePath), { silent: true });
}

/**
 * 生成波形图。
 * @param filePath 音频路径。
 * @param options 尺寸与颜色。
 * @returns PNG data URL。
 */
export function getWaveformApi(filePath: string, options: WaveformOptions): Promise<string> {
  // 同缩略图：画不出来就显示占位，不值得为此弹窗
  return unwrap(window.api.audio.waveform(filePath, options), { silent: true });
}

/**
 * 转码单个音频。
 * @param sourcePath 源文件路径。
 * @param options 转码选项。
 * @returns 转码结果（含 canceled 标记）。
 */
export function convertAudioApi(
  sourcePath: string,
  options: AudioConvertOptions,
): Promise<AudioConvertResult> {
  // 批量并发时由调用方逐条捕获并标记行状态，这里静默、只抛错
  return unwrap(window.api.audio.convert(sourcePath, options), { silent: true });
}

/**
 * 检测静音区间。
 * @param filePath 音频路径。
 * @param options 阈值与最短时长。
 * @returns 总时长与静音区间。
 */
export function detectSilenceApi(
  filePath: string,
  options: DetectSilenceOptions,
): Promise<DetectSilenceResult> {
  return unwrap(window.api.audio.detectSilence(filePath, options), {
    errorPrefix: '检测静音失败',
  });
}

/**
 * 按区间列表把音频切成多段。
 * @param sourcePath 源文件路径。
 * @param options 分割选项。
 * @returns 各段输出路径。
 */
export function splitAudioApi(
  sourcePath: string,
  options: AudioSplitOptions,
): Promise<AudioSplitResult> {
  // 单文件单次操作，失败原因（多半是 pre-flight 的中文提示）要让用户看见
  return unwrap(window.api.audio.split(sourcePath, options), { errorPrefix: '导出失败' });
}

/**
 * 取消进行中的音频处理。
 * @param taskId 任务 id。
 * @returns 是否杀掉了对应进程。
 */
export function cancelAudioApi(taskId: string): Promise<boolean> {
  // 同 cancelTranscodeApi：取消本身失败没什么可让用户做的，静默
  return unwrap(window.api.audio.cancel(taskId), { silent: true });
}

/**
 * 订阅音频处理进度。
 *
 * 事件推送是**不经 unwrap 的透传**：主进程 send 的是裸的进度对象，
 * 没有 {code,data,message} 可解。
 * @param callback 进度回调。
 * @returns 取消订阅的函数。
 */
export function onAudioProgress(callback: (progress: AudioProgress) => void): () => void {
  return window.api.audio.onProgress(callback);
}
