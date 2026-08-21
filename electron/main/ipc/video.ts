import { type BrowserWindow } from 'electron';
import { basename, dirname, extname, join } from 'path';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { VIDEO_CHANNELS } from '../../shared/channels';
import type {
  TranscodeOptions,
  TranscodeResult,
  VideoCapabilities,
  VideoMeta,
  VideoOutputFormat,
} from '../../shared/types';
import { probeCapabilities } from '../ffmpeg/binary';
import { grabFrame, probeVideo } from '../ffmpeg/probe';
import { cancelFfmpeg, clearCanceled, runFfmpeg } from '../ffmpeg/run';
import { allowMediaPath } from '../protocol/media';
import { handle } from './helper';

/** 缩略图取帧的时间点（秒）。 */
const THUMB_AT_SECONDS = 1;

/** 缩略图宽度 px。 */
const THUMB_WIDTH = 160;

/** 输出容器 → 文件扩展名。 */
const FORMAT_EXT: Record<Exclude<VideoOutputFormat, 'original'>, string> = {
  mp4: 'mp4',
  webm: 'webm',
  mkv: 'mkv',
  gif: 'gif',
};

/**
 * 各容器能装的视频编码。
 * `-c copy`（只换封装）前必须查这张表——不查就等于让用户等 ffmpeg 跑十几秒
 * 再收到一句英文报错。mkv 几乎什么都能装，故不设限。
 */
const CONTAINER_VIDEO_CODECS: Record<string, Set<string> | null> = {
  mp4: new Set(['h264', 'hevc', 'mpeg4', 'av1', 'vp9']),
  webm: new Set(['vp8', 'vp9', 'av1']),
  mkv: null,
};

/** 各容器能装的音频编码。 */
const CONTAINER_AUDIO_CODECS: Record<string, Set<string> | null> = {
  mp4: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus']),
  webm: new Set(['opus', 'vorbis']),
  mkv: null,
};

/** 各容器默认的音频编码器。 */
const CONTAINER_AUDIO_ENCODER: Record<string, string> = {
  mp4: 'aac',
  webm: 'libopus',
  mkv: 'aac',
};

/**
 * 解析实际输出容器（把 original 换成源扩展名）。
 * @param format 用户选择的格式。
 * @param sourcePath 源文件路径。
 * @returns 实际容器名。
 */
function resolveFormat(
  format: VideoOutputFormat,
  sourcePath: string,
): Exclude<VideoOutputFormat, 'original'> {
  if (format !== 'original') return format;
  const ext = extname(sourcePath).replace(/^\./, '').toLowerCase();
  if (ext === 'webm') return 'webm';
  if (ext === 'mkv') return 'mkv';
  // 其余一律按 mp4 处理：mov/avi/flv 等换成 mp4 是最通用的选择
  return 'mp4';
}

/**
 * 组 scale 滤镜。
 *
 * **必须用 `-2` 而不是 `-1`**：两者都保持比例，但 `-1` 会算出奇数宽度，
 * 而 H.264 的 yuv420p 要求宽高都是偶数，直接报 "width not divisible by 2"。
 * `-2` 是「保比例并向偶数取整」。
 * `force_original_aspect_ratio=decrease` + min() 保证源比目标小时不放大。
 * @param maxHeight 高度上限；0 表示不缩放。
 * @param sourceHeight 源高度，用于「不放大」判断。
 * @returns 滤镜串；无需缩放时为空串。
 */
function buildScaleFilter(maxHeight: number, sourceHeight: number): string {
  if (maxHeight <= 0) return '';
  if (sourceHeight > 0 && sourceHeight <= maxHeight) return '';
  return `scale=-2:${maxHeight}:force_original_aspect_ratio=decrease`;
}

/**
 * 组视频编码参数。
 * @param options 转码选项。
 * @param meta 源元信息（targetSize 模式要按时长反算码率）。
 * @returns 参数数组。
 */
function buildVideoArgs(options: TranscodeOptions, meta: VideoMeta): string[] {
  const args = ['-c:v', options.codec];

  if (options.codec === 'libvpx-vp9') {
    // VP9 的默认 deadline 慢到不可用；row-mt 开多线程
    args.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
  }

  switch (options.qualityMode) {
    case 'quality': {
      args.push('-crf', String(options.crf));
      // VP9 必须显式 -b:v 0 才是恒定质量；只给 -crf 会被当成「码率上限」模式，
      // 结果又大又慢。x264/x265 不需要这一条
      if (options.codec === 'libvpx-vp9') args.push('-b:v', '0');
      break;
    }
    case 'bitrate': {
      const kbps = Math.max(1, Math.round(options.videoBitrate));
      args.push('-b:v', `${kbps}k`, '-maxrate', `${kbps * 2}k`, '-bufsize', `${kbps * 4}k`);
      break;
    }
    case 'targetSize': {
      // 单趟按目标体积反算码率，误差约 ±10%（UI 上已如实写明）。
      // 时长未知时退回 CRF——没有时长就无法反算，硬算会得到 Infinity
      if (meta.duration > 0) {
        const audioKbps = options.audioMode === 'remove' ? 0 : options.audioBitrate;
        const totalKbps = (options.targetSizeMb * 8 * 1024) / meta.duration;
        const videoKbps = Math.max(64, Math.round(totalKbps - audioKbps));
        args.push('-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps * 2}k`);
      } else {
        args.push('-crf', String(options.crf));
      }
      break;
    }
  }

  return args;
}

/**
 * 组音频编码参数。
 * @param options 转码选项。
 * @param container 实际输出容器。
 * @returns 参数数组。
 */
function buildAudioArgs(options: TranscodeOptions, container: string): string[] {
  if (options.audioMode === 'remove') return ['-an'];
  if (options.audioMode === 'copy') return ['-c:a', 'copy'];
  const encoder = CONTAINER_AUDIO_ENCODER[container] ?? 'aac';
  return ['-c:a', encoder, '-b:a', `${Math.max(8, Math.round(options.audioBitrate))}k`];
}

/**
 * pre-flight 校验：把注定失败的组合在开跑前拦下。
 *
 * 目的与 file:renameBatch 的 pre-flight 一致——**别让用户等一轮才收到
 * 一句英文报错**。这里检查的都是 ffmpeg 一定会拒绝、我们能提前判断的组合。
 * @param options 转码选项。
 * @param meta 源元信息。
 * @param container 实际输出容器。
 * @param capabilities 当前构建的编码器能力。
 * @throws 组合非法时抛出中文原因。
 */
function preflight(
  options: TranscodeOptions,
  meta: VideoMeta,
  container: Exclude<VideoOutputFormat, 'original'>,
  capabilities: VideoCapabilities,
): void {
  if (!meta.video) throw new Error('该文件没有视频流，请用音频工具处理');

  if (container === 'gif') {
    if (options.codec === 'copy') throw new Error('GIF 输出无法「不重新编码」');
    return;
  }

  if (options.codec === 'copy') {
    // 滤镜与 streamcopy 互斥（ffmpeg 原话 "Filtering and streamcopy cannot be
    // used together."）。这里不能悄悄忽略缩放/降帧——用户选了 240p 却拿到原分辨率
    // 更糟糕，说清原因让他自己选
    if (options.maxHeight > 0 && (meta.video.height || 0) > options.maxHeight) {
      throw new Error('「不重新编码」无法同时缩放分辨率，请改选一种编码器，或把最大高度设为不限');
    }
    if (options.maxFps > 0 && (meta.video.fps || 0) > options.maxFps) {
      throw new Error('「不重新编码」无法同时降帧率，请改选一种编码器，或把帧率上限设为不限');
    }
    if (options.crop && options.crop.width > 0 && options.crop.height > 0) {
      throw new Error('「不重新编码」无法裁剪画面，请改选一种编码器');
    }

    const allowedVideo = CONTAINER_VIDEO_CODECS[container];
    if (allowedVideo && !allowedVideo.has(meta.video.codec)) {
      throw new Error(
        `${container.toUpperCase()} 容器装不了 ${meta.video.codec} 视频流，请改选一种编码器重新编码`,
      );
    }
    if (options.audioMode === 'copy' && meta.audio) {
      const allowedAudio = CONTAINER_AUDIO_CODECS[container];
      if (allowedAudio && !allowedAudio.has(meta.audio.codec)) {
        throw new Error(
          `${container.toUpperCase()} 容器装不了 ${meta.audio.codec} 音频流，请把音频改为重新编码或移除`,
        );
      }
    }
    return;
  }

  if (!capabilities.videoEncoders.includes(options.codec)) {
    throw new Error(`当前 ffmpeg 构建没有编码器 ${options.codec}`);
  }
  // copy 音频时同样要查容器兼容性——视频重编码不代表音频也重编码
  if (options.audioMode === 'copy' && meta.audio) {
    const allowedAudio = CONTAINER_AUDIO_CODECS[container];
    if (allowedAudio && !allowedAudio.has(meta.audio.codec)) {
      throw new Error(
        `${container.toUpperCase()} 容器装不了 ${meta.audio.codec} 音频流，请把音频改为重新编码或移除`,
      );
    }
  }
}

/**
 * 组时间剪切参数（放在 `-i` **之前**，由调用方保证顺序）。
 *
 * 输入侧的 `-ss` 自 ffmpeg 2.1 起默认开 `-accurate_seek`：先按关键帧快速跳，
 * 再解码丢弃到精确起点——**既快又准**，比放在 `-i` 之后逐帧解码好得多。
 * 唯一的例外是 `-c copy`，那时只能落在关键帧上，这是封装格式的硬限制。
 * 同放在 `-i` 前的 `-t` 限制的是从该输入读取的时长，语义正是我们要的。
 * @param trim 剪切区间。
 * @returns 参数数组。
 */
function buildTrimArgs(trim: { start: number; end: number } | undefined): string[] {
  if (!trim || trim.end <= trim.start) return [];
  return ['-ss', String(trim.start), '-t', String(trim.end - trim.start)];
}

/**
 * 组滤镜链（裁剪 → 缩放 → 帧率）。
 *
 * crop 必须在 scale 之前：坐标是源像素坐标，先缩放就全错位了。
 * @param options 转码选项。
 * @param meta 源元信息。
 * @returns 滤镜串；无滤镜时为空串。
 */
function buildFilters(options: TranscodeOptions, meta: VideoMeta): string {
  const parts: string[] = [];
  const crop = options.crop;
  if (crop && crop.width > 0 && crop.height > 0) {
    parts.push(`crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}`);
  }
  const scale = buildScaleFilter(options.maxHeight, crop?.height ?? meta.video?.height ?? 0);
  if (scale) parts.push(scale);
  if (options.maxFps > 0 && (meta.video?.fps ?? 0) > options.maxFps) {
    parts.push(`fps=${options.maxFps}`);
  }
  return parts.join(',');
}

/**
 * 转 GIF：两趟 palettegen + paletteuse。
 *
 * 单趟（直接 `-c:v gif`）用的是固定 216 色调色板，色带断层非常明显。
 * 两趟先按实际画面统计出 256 色最优调色板，质量差距很大。
 * @param sourcePath 源路径。
 * @param tempPath 临时输出路径。
 * @param options 转码选项。
 * @param meta 源元信息。
 * @param onProgress 进度回调。
 * @returns 是否被取消。
 */
async function transcodeToGif(
  sourcePath: string,
  tempPath: string,
  options: TranscodeOptions,
  meta: VideoMeta,
  onProgress: (percent: number, outTime: number, speed: number) => void,
): Promise<boolean> {
  const palettePath = `${tempPath}.palette.png`;
  const trim = buildTrimArgs(options.trim);
  const crop = options.crop;
  const cropPart =
    crop && crop.width > 0 && crop.height > 0
      ? `crop=${crop.width}:${crop.height}:${crop.left}:${crop.top},`
      : '';
  // GIF 必须限 fps 与宽度：1080p30 的十秒视频不限的话能出几百 MB
  const base = `${cropPart}fps=${options.gifFps},scale=${options.gifWidth}:-2:flags=lanczos`;

  try {
    const first = await runFfmpeg(
      [...trim, '-i', sourcePath, '-vf', `${base},palettegen=stats_mode=diff`, palettePath],
      { taskId: options.taskId, duration: meta.duration },
    );
    if (first.canceled) return true;

    const second = await runFfmpeg(
      [
        ...trim,
        '-i',
        sourcePath,
        '-i',
        palettePath,
        '-lavfi',
        `${base}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
        '-loop',
        '0',
        tempPath,
      ],
      {
        taskId: options.taskId,
        duration: meta.duration,
        onProgress: (p) => onProgress(p.percent, p.outTime, p.speed),
      },
    );
    return second.canceled;
  } finally {
    await unlink(palettePath).catch(() => {});
  }
}

/**
 * 转码单个视频。
 *
 * **一律先写临时文件再 rename**，两个原因：
 * 1. ffmpeg 不能读写同一个文件——输出一开就把还在读的输入截断了，覆盖模式必坏。
 * 2. 取消/失败时输出必定是坏文件（来不及写容器索引），删掉临时文件用户就看不到残骸。
 * 这与图片工具不同：sharp 是在内存里出完整 Buffer 才落盘，天然没有半成品。
 * @param win 用于推送进度的窗口。
 * @param sourcePath 源文件路径。
 * @param options 转码选项。
 * @returns 转码结果（含取消标记）。
 */
async function transcodeOne(
  win: BrowserWindow,
  sourcePath: string,
  options: TranscodeOptions,
): Promise<TranscodeResult> {
  const [meta, capabilities] = await Promise.all([probeVideo(sourcePath), probeCapabilities()]);
  const container = resolveFormat(options.format, sourcePath);
  preflight(options, meta, container, capabilities);

  const originalSize = meta.size;
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const dir = options.overwrite ? dirname(sourcePath) : options.outputDir;
  const outputPath = join(dir, `${nameNoExt}.${FORMAT_EXT[container]}`);
  const tempPath = join(dir, `${nameNoExt}.tbtmp.${FORMAT_EXT[container]}`);

  // ffmpeg 不会自建输出目录，缺目录时它报的是一句夹在几十行编码信息里的
  // "No such file or directory"，用户根本看不出是目录没建
  await mkdir(dir, { recursive: true });

  /** 推进度到渲染进程（窗口已销毁时静默跳过）。 */
  const pushProgress = (percent: number, outTime: number, speed: number): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(VIDEO_CHANNELS.transcodeProgress, {
      taskId: options.taskId,
      outTime,
      percent,
      speed,
    });
  };

  let canceled = false;
  try {
    if (container === 'gif') {
      canceled = await transcodeToGif(sourcePath, tempPath, options, meta, pushProgress);
    } else {
      const filters = buildFilters(options, meta);
      const args = [
        ...buildTrimArgs(options.trim),
        '-i',
        sourcePath,
        ...(filters ? ['-vf', filters] : []),
        ...(options.codec === 'copy' ? ['-c:v', 'copy'] : buildVideoArgs(options, meta)),
        ...buildAudioArgs(options, container),
      ];
      // faststart 把 moov 索引移到文件头，不加则播放器要下完整个文件才能开始播，
      // 我们自己的 tb-media 预览也无法立即 seek。代价是收尾多一趟顺序读写
      if (container === 'mp4') args.push('-movflags', '+faststart');
      args.push(tempPath);

      const result = await runFfmpeg(args, {
        taskId: options.taskId,
        duration: options.trim ? options.trim.end - options.trim.start : meta.duration,
        onProgress: (p) => pushProgress(p.percent, p.outTime, p.speed),
      });
      canceled = result.canceled;
    }

    if (canceled) {
      return {
        sourcePath,
        outputPath: '',
        originalSize,
        outputSize: 0,
        ratio: 0,
        canceled: true,
        streamCopy: false,
      };
    }

    // 先 rename 再删源：反过来的话 rename 若失败，源已经没了而临时文件又会被
    // finally 清掉，用户两头空。换扩展名时源文件已无用，删掉免得留一份旧格式副本
    await rename(tempPath, outputPath);
    if (options.overwrite && outputPath !== sourcePath) await unlink(sourcePath).catch(() => {});

    const outputStat = await stat(outputPath);
    return {
      sourcePath,
      outputPath,
      originalSize,
      outputSize: outputStat.size,
      // 转码常常变大（尤其是提高码率或转 gif），如实保留负数
      ratio: originalSize > 0 ? Math.round((1 - outputStat.size / originalSize) * 100) : 0,
      canceled: false,
      streamCopy: options.codec === 'copy',
    };
  } finally {
    clearCanceled(options.taskId);
    // 成功时 rename 已经把它移走，unlink 失败无所谓；失败/取消时这一步才是关键
    await unlink(tempPath).catch(() => {});
  }
}

/**
 * 注册视频处理相关 IPC。
 * @param win 主窗口，用于推送进度。
 */
export function registerVideoIpc(win: BrowserWindow): void {
  handle(VIDEO_CHANNELS.capabilities, () => probeCapabilities());

  handle(VIDEO_CHANNELS.probe, async (_event, filePath: string) => {
    const meta = await probeVideo(filePath);
    // probe 成功即登记进播放白名单：页面每加一个文件都会 probe，不必另开一个 IPC
    allowMediaPath(filePath);
    return meta;
  });

  handle(VIDEO_CHANNELS.thumbnail, (_event, filePath: string) =>
    grabFrame(filePath, THUMB_AT_SECONDS, THUMB_WIDTH),
  );

  handle(
    VIDEO_CHANNELS.transcode,
    async (_event, sourcePath: string, options: TranscodeOptions) => {
      const result = await transcodeOne(win, sourcePath, options);
      if (result.outputPath) allowMediaPath(result.outputPath);
      return result;
    },
  );

  handle(VIDEO_CHANNELS.cancelTranscode, (_event, taskId: string) => cancelFfmpeg(taskId));
}
