import type { FileItem } from '@/types/file';

/**
 * 视频压缩 / 转码列表项。
 *
 * 与图片各页的区别：视频的元信息（时长、分辨率、编码）必须经 ffprobe 一次外部
 * 进程调用才拿得到，不像图片那样能从缩略图顺带得出，所以这里的字段全是异步填充，
 * 未探测完成时一律显示「—」而不是编一个默认值。
 */
export interface VideoItem extends FileItem {
  /** 缩略图 data URL（异步抽帧）。 */
  thumbnail?: string;
  /** 时长秒；容器未给出时为 0。 */
  duration?: number;
  /** 源视频宽度 px。 */
  width?: number;
  /** 源视频高度 px。 */
  height?: number;
  /** 源视频编码名，如 h264。 */
  videoCodec?: string;
  /** 源音频编码名；无音轨时为空串。 */
  audioCodec?: string;
  /** 源帧率。 */
  fps?: number;
  /** 元信息是否已探测（区分「没有音轨」与「还没探测」）。 */
  probed?: boolean;
  /** 输出后大小字节。 */
  outputSize?: number;
  /** 体积变化百分比，正数为减小、负数为增大。 */
  ratio?: number;
  /** 输出文件路径。 */
  outputPath?: string;
  /** 是否走了 -c copy（只换封装）。 */
  streamCopy?: boolean;
  /** 本次转码的任务 id，用于把进度推送对上行、以及取消。 */
  taskId?: string;
  /** 完成百分比 0-100；源时长未知时主进程推 -1，此时改显示 outTime。 */
  percent?: number;
  /** 已处理到的时间点秒（源时长未知时用它代替百分比显示）。 */
  outTime?: number;
  /** 当前处理速度倍率。 */
  speed?: number;
}

/**
 * 音频转码列表项。
 *
 * 与 {@link VideoItem} 的区别不只是字段少：音频页**并发处理**（实测四进程 3.74×，
 * 因为音频编码是单线程），所以同一时刻会有多行处于 processing，`taskId` 不再是
 * 「当前唯一任务」而是每行各自的在跑标记。
 */
export interface AudioItem extends FileItem {
  /** 时长秒；容器未给出时为 0。 */
  duration?: number;
  /** 源音频编码名，如 mp3 / aac。 */
  codec?: string;
  /** 声道数。 */
  channels?: number;
  /** 采样率 Hz。 */
  sampleRate?: number;
  /** 码率 bps。 */
  bitrate?: number;
  /** 源是否带视频流（从视频里提音频时给个提示）。 */
  hasVideo?: boolean;
  /** 元信息是否已探测（区分「没有音频流」与「还没探测」）。 */
  probed?: boolean;
  /** 输出后大小字节。 */
  outputSize?: number;
  /** 体积变化百分比，正数为减小、负数为增大。 */
  ratio?: number;
  /** 输出文件路径。 */
  outputPath?: string;
  /** 是否走了 -c:a copy（只换封装）。 */
  streamCopy?: boolean;
  /** 本次任务 id，用于把进度推送对上行、以及取消。 */
  taskId?: string;
  /** 完成百分比 0-100。 */
  percent?: number;
  /** 当前处理速度倍率。 */
  speed?: number;
}
