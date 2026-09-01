import { spawn } from 'child_process';
import { stat } from 'fs/promises';
import { FFPROBE_PATH } from './binary';
import { runFfmpegToBuffer } from './run';
import type { AudioMeta, VideoMeta, VideoStreamInfo } from '../../shared/types';

/**
 * ffprobe 元信息读取与抽帧。
 */

/** ffprobe -show_streams 的单条流（只声明用到的字段）。 */
interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  pix_fmt?: string;
  channels?: number;
  sample_rate?: string;
  bit_rate?: string;
}

/** ffprobe 的完整输出（只声明用到的字段）。 */
interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; format_name?: string; bit_rate?: string };
}

/**
 * 解析 `30000/1001` 形式的帧率。
 * @param value r_frame_rate 字段。
 * @returns 帧率，保留两位小数；无法解析为 0。
 */
function parseFps(value: string | undefined): number {
  if (!value) return 0;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return 0;
  return Math.round((num / den) * 100) / 100;
}

/**
 * 把 ffprobe 的流对象投影成我们自己的结构。
 * @param stream ffprobe 流对象。
 * @returns 精简后的流信息。
 */
function toStreamInfo(stream: ProbeStream): VideoStreamInfo {
  return {
    codec: stream.codec_name ?? '',
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    fps: parseFps(stream.r_frame_rate),
    pixelFormat: stream.pix_fmt ?? '',
    channels: stream.channels ?? 0,
    sampleRate: Number(stream.sample_rate) || 0,
    bitrate: Number(stream.bit_rate) || 0,
  };
}

/**
 * 读取视频元信息。
 * @param filePath 视频文件绝对路径。
 * @returns 时长、容器、视频流与音频流信息。
 * @throws ffprobe 失败或文件无任何媒体流时抛出。
 */
export async function probeVideo(filePath: string): Promise<VideoMeta> {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath];

  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn(FFPROBE_PATH, args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.trim() || `ffprobe 退出码 ${code}`));
    });
  });

  const parsed = JSON.parse(text) as ProbeOutput;
  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  if (!video && !audio) throw new Error('文件里没有可识别的音视频流');

  const fileStat = await stat(filePath);

  return {
    // 部分容器（裸流、录制中的 mkv）不带时长。此时返回 0，进度只能按已处理时间显示，
    // 不能硬算一个假百分比
    duration: Number(parsed.format?.duration) || 0,
    container: parsed.format?.format_name ?? '',
    bitrate: Number(parsed.format?.bit_rate) || 0,
    size: fileStat.size,
    video: video ? toStreamInfo(video) : null,
    audio: audio ? toStreamInfo(audio) : null,
  };
}

/**
 * 读取音频元信息。
 *
 * 复用 probeVideo 的那一次 ffprobe 调用后投影，而不是另写一份解析：ffprobe
 * `-show_streams` 一次就把音视频流全带回来了，分两套解析只会让两边漂移。
 * 码率取流码率，缺失时退回容器总码率——wav 这类容器不给流码率，但页面要显示。
 * @param filePath 音频（或含音轨的视频）文件绝对路径。
 * @returns 音频元信息。
 * @throws ffprobe 失败或文件无任何媒体流时抛出。
 */
export async function probeAudio(filePath: string): Promise<AudioMeta> {
  const meta = await probeVideo(filePath);
  return {
    duration: meta.duration,
    container: meta.container,
    size: meta.size,
    codec: meta.audio?.codec ?? '',
    channels: meta.audio?.channels ?? 0,
    sampleRate: meta.audio?.sampleRate ?? 0,
    bitrate: meta.audio?.bitrate || meta.bitrate,
    hasVideo: meta.video !== null,
  };
}

/**
 * 抽一帧作缩略图。
 *
 * `-ss` 必须放在 `-i` **之前**：那是按关键帧快速定位，几乎瞬时；
 * 放在 `-i` 之后则是逐帧精确解码到该时间点，长视频要等好几秒。
 * @param filePath 视频路径。
 * @param atSeconds 取帧时间点（秒）。
 * @param width 输出宽度 px，高度按比例。
 * @returns jpeg data URL。
 */
export async function grabFrame(
  filePath: string,
  atSeconds: number,
  width: number,
): Promise<string> {
  const buffer = await runFfmpegToBuffer([
    '-ss',
    String(Math.max(0, atSeconds)),
    '-i',
    filePath,
    '-frames:v',
    '1',
    // -2 而非 -1：保比例并向偶数取整，见 video.ts 里 buildScaleFilter 的说明
    '-vf',
    `scale=${width}:-2:force_original_aspect_ratio=decrease`,
    '-f',
    'image2',
    '-c:v',
    'mjpeg',
    'pipe:1',
  ]);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}
