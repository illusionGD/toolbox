import { type BrowserWindow } from 'electron';
import { basename, dirname, extname, join } from 'path';
import { mkdir, rename, stat, unlink } from 'fs/promises';
import { AUDIO_CHANNELS } from '../../shared/channels';
import {
  ENCODER_CODEC,
  OPUS_SAMPLE_RATE,
  VBR_ENCODERS,
  codecFitsContainer,
  streamFitsContainer,
} from '../../shared/audio';
import type {
  AudioConvertOptions,
  AudioConvertResult,
  AudioFormat,
  AudioMeta,
  AudioSplitOptions,
  AudioSplitResult,
  DetectSilenceOptions,
  DetectSilenceResult,
  SilenceRange,
  VideoCapabilities,
  WaveformOptions,
} from '../../shared/types';
import { probeCapabilities } from '../ffmpeg/binary';
import { probeAudio } from '../ffmpeg/probe';
import {
  cancelFfmpeg,
  clearCanceled,
  runFfmpeg,
  runFfmpegCollectStderr,
  runFfmpegToBuffer,
} from '../ffmpeg/run';
import { allowMediaPath } from '../protocol/media';
import { handle } from './helper';

/**
 * 音频转码 / 剪切 / 分割（ffmpeg）。
 *
 * 与 video.ts 分开：那边整个文件都是视频语义（分辨率、帧率、GIF 两趟调色板），
 * 混进来只会让两组的容器/编码器表都变成「一半字段用不上」。
 *
 * **本页并发处理，与视频页的严格串行相反**，这是实测结论而非偏好：音频编码是
 * 单进程单线程（同一个十分钟文件 `-threads 1` 用 10718ms、`-threads 8` 用
 * 10693ms，完全相同），所以四个进程并行在 16 核机器上实测拿到 **3.74×**
 * 加速（mp3 320k：串行 44733ms → 并行 11975ms；flac lvl12：22708ms → 6038ms）。
 * 视频页注释里写的「单个 ffmpeg 就会吃满所有核心，并发只是互相抢 CPU」对视频
 * 成立、对音频**不成立**，别照那句话把这里改回串行。
 */

/** 输出容器 → 文件扩展名。 */
const FORMAT_EXT: Record<Exclude<AudioFormat, 'original'>, string> = {
  mp3: 'mp3',
  m4a: 'm4a',
  wav: 'wav',
  flac: 'flac',
  ogg: 'ogg',
  opus: 'opus',
  aac: 'aac',
};

/**
 * 各容器能装的音频流编码见 `shared/audio.ts` 的 CONTAINER_CODECS——放在 shared 是
 * 因为渲染进程要用同一份过滤下拉项，两端各存一份必然漂移。
 *
 * 不查表的代价是用户等 ffmpeg 跑完只收到一句 "Error initializing output stream"，
 * 完全看不出是容器装不了这个编码。
 */

/** 响度归一的固定真峰值与动态范围上限（只把目标 LUFS 开放给用户调）。 */
const LOUDNORM_TP = -1.5;
const LOUDNORM_LRA = 11;

/**
 * 解析实际输出容器（把 original 换成源扩展名）。
 * @param format 用户选择的格式。
 * @param sourcePath 源文件路径。
 * @returns 实际容器名。
 */
function resolveFormat(format: AudioFormat, sourcePath: string): Exclude<AudioFormat, 'original'> {
  if (format !== 'original') return format;
  const ext = extname(sourcePath).replace(/^\./, '').toLowerCase();
  if (ext in FORMAT_EXT) return ext as Exclude<AudioFormat, 'original'>;
  // 源是我们不产出的容器（wma / aiff / 视频容器…）时按 mp3 处理，同视频页把
  // mov/avi 一律归到 mp4 的取法：mp3 是唯一到处都能播的选择
  return 'mp3';
}

/**
 * pre-flight 校验：把注定失败的组合在开跑前拦下。
 *
 * 目的与 video.ts / file:renameBatch 的 pre-flight 一致——**别让用户等一轮
 * 才收到一句英文报错**。三条音频特有的规则，全部来自实测：
 * 1. libopus 只接受 48kHz：显式给 `-ar 44100` 会直接报错退出（不给 `-ar` 时它
 *    自己静默重采样到 48k，那是允许的，所以只拦显式指定的非 48k）。
 * 2. 编码器 / 源编码与容器不匹配 → 查 CONTAINER_CODECS。
 * 3. `-c:a copy` 与任何滤镜、声道数、采样率改动互斥（ffmpeg 原话 "Filtering
 *    and streamcopy cannot be used together."）。不能悄悄忽略——用户开了响度
 *    归一却拿到原样文件比报错更糟。
 * @param options 转码选项。
 * @param meta 源元信息。
 * @param container 实际输出容器。
 * @param capabilities 当前构建的编码器能力。
 * @throws 组合非法时抛出中文原因。
 */
function preflight(
  options: AudioConvertOptions,
  meta: AudioMeta,
  container: Exclude<AudioFormat, 'original'>,
  capabilities: VideoCapabilities,
): void {
  if (!meta.codec) throw new Error('该文件没有音频流');

  const upper = container.toUpperCase();

  if (options.codec === 'copy') {
    const filters: string[] = [];
    if (options.volumeDb !== 0) filters.push('音量增益');
    if (options.loudnessTarget !== null) filters.push('响度归一');
    if (options.fadeIn > 0 || options.fadeOut > 0) filters.push('淡入淡出');
    if (options.channels > 0 && options.channels !== meta.channels) filters.push('声道数转换');
    if (options.sampleRate > 0 && options.sampleRate !== meta.sampleRate) {
      filters.push('采样率转换');
    }
    if (filters.length) {
      throw new Error(
        `「不重新编码」无法同时做${filters.join('、')}，请改选一种编码器，或关掉这些处理`,
      );
    }
    if (!streamFitsContainer(meta.codec, container)) {
      throw new Error(`${upper} 容器装不了 ${meta.codec} 音频流，请改选一种编码器重新编码`);
    }
    return;
  }

  if (!capabilities.audioEncoders.includes(options.codec)) {
    throw new Error(`当前 ffmpeg 构建没有编码器 ${options.codec}`);
  }

  if (!codecFitsContainer(options.codec, container)) {
    throw new Error(
      `${upper} 容器装不了 ${ENCODER_CODEC[options.codec]}，请换一种编码器或改输出格式`,
    );
  }

  if (
    options.codec === 'libopus' &&
    options.sampleRate > 0 &&
    options.sampleRate !== OPUS_SAMPLE_RATE
  ) {
    throw new Error('Opus 只支持 48000 Hz，请把采样率设为 48000 或「保持源」（会自动重采样）');
  }
}

/**
 * 组时间剪切参数（放在 `-i` **之前**，由调用方保证顺序）。
 *
 * 实测放 `-i` 前后精度**完全相同**（都是 3.030s），音频没有视频那样的关键帧问题；
 * 但放前面不必解码整条，长文件快得多。
 * 已知误差：wav 这类未压缩格式精确到 0（要 3s 得 3.000），mp3 重编码约 +0.03s、
 * `-c:a copy` 约 +0.056s，这是压缩格式帧对齐的硬限制，不假装能做到精确。
 * @param trim 剪切区间。
 * @returns 参数数组。
 */
function buildTrimArgs(trim: { start: number; end: number } | undefined): string[] {
  if (!trim || trim.end <= trim.start) return [];
  return ['-ss', String(trim.start), '-t', String(trim.end - trim.start)];
}

/**
 * 组滤镜链：音量 → 响度归一 → 淡入淡出。
 *
 * **顺序有讲究，两条都不能调**：
 * - 响度归一必须在音量增益**之后**，否则手调的增益会被归一整个抵消掉。
 * - afade 必须**最后**，且淡出起点要按**剪切后的时长**算。实测确认 `-ss` 放
 *   `-i` 前时滤镜看到的时间轴从 0 重新开始（剪 2–5s 的 3 秒产物里 `st=2` 的
 *   淡出落在末段：末段 RMS -31.3dB vs 中段 -24.1dB），所以这里传的必须是
 *   effectiveDuration 而不是源时长。
 *
 * 响度归一只走**单趟**：实测源 -21.87 LUFS 单趟后得 -16.02（目标 -16），双趟
 * 得 -16.07 —— 双趟结果反而略差还要多跑一遍，不做。
 * @param options 转码选项。
 * @param effectiveDuration 输出的实际时长秒（剪切后），用于算淡出起点。
 * @returns 滤镜串；无滤镜时为空串。
 */
function buildFilters(options: AudioConvertOptions, effectiveDuration: number): string {
  const parts: string[] = [];
  if (options.volumeDb !== 0) parts.push(`volume=${options.volumeDb}dB`);
  if (options.loudnessTarget !== null) {
    parts.push(`loudnorm=I=${options.loudnessTarget}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`);
  }
  if (options.fadeIn > 0) parts.push(`afade=t=in:st=0:d=${options.fadeIn}`);
  if (options.fadeOut > 0 && effectiveDuration > 0) {
    // 淡出比总时长还长时从 0 开始淡，而不是算出负数起点让 ffmpeg 报错
    const start = Math.max(0, effectiveDuration - options.fadeOut);
    parts.push(`afade=t=out:st=${start}:d=${options.fadeOut}`);
  }
  return parts.join(',');
}

/**
 * 组编码器与码率参数。
 * @param options 转码选项。
 * @returns 参数数组。
 */
function buildCodecArgs(options: AudioConvertOptions): string[] {
  if (options.codec === 'copy') return ['-c:a', 'copy'];
  const args = ['-c:a', options.codec];

  switch (options.rateMode) {
    case 'lossless': {
      // flac 才有压缩等级；alac / pcm 无参可调。实测 level 12 比 5 慢 48%
      // 却只多省 1.5% 体积，所以 UI 默认给 5
      if (options.codec === 'flac') {
        args.push('-compression_level', String(options.compressionLevel));
      }
      break;
    }
    case 'vbr': {
      // 只有 mp3 / vorbis 支持 -q:a，其余编码器给了会被忽略甚至报错，退回 CBR
      if (VBR_ENCODERS.includes(options.codec)) args.push('-q:a', String(options.quality));
      else args.push('-b:a', `${Math.max(8, Math.round(options.bitrate))}k`);
      break;
    }
    case 'cbr': {
      args.push('-b:a', `${Math.max(8, Math.round(options.bitrate))}k`);
      break;
    }
  }

  if (options.channels > 0) args.push('-ac', String(options.channels));
  if (options.sampleRate > 0) args.push('-ar', String(options.sampleRate));
  return args;
}

/**
 * 组一次完整的 ffmpeg 参数。
 * @param sourcePath 源路径。
 * @param tempPath 临时输出路径。
 * @param options 转码选项。
 * @param effectiveDuration 输出实际时长秒（算淡出起点用）。
 * @returns 参数数组。
 */
function buildArgs(
  sourcePath: string,
  tempPath: string,
  options: AudioConvertOptions,
  effectiveDuration: number,
): string[] {
  const filters = buildFilters(options, effectiveDuration);
  return [
    ...buildTrimArgs(options.trim),
    '-i',
    sourcePath,
    // **必加 `-vn`**：源是视频时，能装视频的容器会把视频流一起**重新编码**进产物
    // （实测 m4a → libx264、flac → png 附图、ogg → theora），拿到的「音频文件」里
    // 其实还躺着一路视频：30s 720p 转 m4a 实测 683KB / 1434ms，加 -vn 才是
    // 220KB / 660ms。mp3 与 wav 容器装不了视频会自动丢掉，看不出问题，所以这个坑
    // 只在换到 m4a/flac/ogg 时才炸——别因为「mp3 试过没事」就把这行删了
    '-vn',
    ...(filters ? ['-af', filters] : []),
    ...buildCodecArgs(options),
    // 元数据默认就会带过去（实测 title/artist 转码后自动保留），要清除得显式说
    ...(options.keepMetadata ? [] : ['-map_metadata', '-1']),
    tempPath,
  ];
}

/**
 * 读输出文件的时长（如实回报剪切的帧对齐误差，不假装精确）。
 * @param filePath 输出路径。
 * @returns 时长秒；读不到为 0。
 */
async function outputDuration(filePath: string): Promise<number> {
  const meta = await probeAudio(filePath).catch(() => null);
  return meta?.duration ?? 0;
}

/**
 * 推进度到渲染进程（没给窗口或窗口已销毁时静默跳过）。
 * @param win 目标窗口；**AI 工具调用传 null**。
 * @param taskId 任务 id。
 * @param percent 百分比。
 * @param outTime 已处理到的时间点秒。
 * @param speed 速度倍率。
 */
function pushProgress(
  win: BrowserWindow | null,
  taskId: string,
  percent: number,
  outTime: number,
  speed: number,
): void {
  if (!win || win.isDestroyed()) return;
  win.webContents.send(AUDIO_CHANNELS.progress, { taskId, outTime, percent, speed });
}

/**
 * 转码单个音频。
 *
 * **一律先写临时文件再 rename**，同 video.ts 的两个理由：ffmpeg 不能读写同一个
 * 文件（覆盖模式必坏），且取消/失败时输出必定是坏文件（来不及写容器索引）。
 * @param win 用于推送进度的窗口；**AI 工具调用传 null**（那边没有监听进度通道）。
 * @param sourcePath 源文件路径。
 * @param options 转码选项。
 * @returns 转码结果（含取消标记）。
 */
export async function convertOne(
  win: BrowserWindow | null,
  sourcePath: string,
  options: AudioConvertOptions,
): Promise<AudioConvertResult> {
  const [meta, capabilities] = await Promise.all([probeAudio(sourcePath), probeCapabilities()]);
  const container = resolveFormat(options.format, sourcePath);
  preflight(options, meta, container, capabilities);

  const ext = FORMAT_EXT[container];
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const dir = options.overwrite ? dirname(sourcePath) : options.outputDir;
  const outputPath = join(dir, `${nameNoExt}.${ext}`);
  const tempPath = join(dir, `${nameNoExt}.tbtmp.${ext}`);

  // 没开覆盖却算出了和源同名的输出路径：直接写下去会把源文件悄悄换掉（我们走的是
  // 临时文件 + rename，ffmpeg 自己那句 "cannot edit existing files in-place"
  // 拦不住我们）。这是数据丢失，必须拦
  if (!options.overwrite && outputPath === sourcePath) {
    throw new Error('输出会覆盖源文件，请换一个输出目录或改输出格式，或显式开启「覆盖原文件」');
  }

  // ffmpeg 不会自建输出目录，缺目录时它报的是一句夹在几十行编码信息里的
  // "No such file or directory"，用户根本看不出是目录没建
  await mkdir(dir, { recursive: true });

  const effectiveDuration = options.trim ? options.trim.end - options.trim.start : meta.duration;

  try {
    const result = await runFfmpeg(buildArgs(sourcePath, tempPath, options, effectiveDuration), {
      taskId: options.taskId,
      duration: effectiveDuration,
      onProgress: (p) => pushProgress(win, options.taskId, p.percent, p.outTime, p.speed),
    });

    if (result.canceled) {
      return {
        sourcePath,
        outputPath: '',
        originalSize: meta.size,
        outputSize: 0,
        ratio: 0,
        duration: 0,
        canceled: true,
        streamCopy: false,
      };
    }

    await rename(tempPath, outputPath);
    // 换扩展名时源文件已无用，删掉免得留一份旧格式副本；先 rename 再删，
    // 反过来则 rename 失败时源已经没了而临时文件又会被 finally 清掉
    if (options.overwrite && outputPath !== sourcePath) {
      await unlink(sourcePath).catch(() => {});
    }

    const outputStat = await stat(outputPath);
    return {
      sourcePath,
      outputPath,
      originalSize: meta.size,
      outputSize: outputStat.size,
      // 音频转码常常变大（wav 转 flac 只省 6%、提码率会更大），如实保留负数
      ratio: meta.size > 0 ? Math.round((1 - outputStat.size / meta.size) * 100) : 0,
      duration: await outputDuration(outputPath),
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
 * 按区间列表把一个音频切成多段。
 *
 * **全成才落盘**：所有段先写到临时文件，全部成功后才一起 rename。同位图字体
 * writeAllAtomic 的理由——半套分段（3 段成功、第 4 段挂了）比一段都没有更难
 * 排查，用户还得先分辨哪几段是完整的。
 * @param win 用于推送进度的窗口。
 * @param sourcePath 源文件路径。
 * @param options 分割选项。
 * @returns 各段输出路径。
 */
async function splitAudio(
  win: BrowserWindow,
  sourcePath: string,
  options: AudioSplitOptions,
): Promise<AudioSplitResult> {
  const segments = options.segments.filter((s) => s.end > s.start);
  if (!segments.length) throw new Error('没有可输出的片段');

  const [meta, capabilities] = await Promise.all([probeAudio(sourcePath), probeCapabilities()]);
  const container = resolveFormat(options.format, sourcePath);
  preflight(options, meta, container, capabilities);

  const ext = FORMAT_EXT[container];
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const dir = options.overwrite ? dirname(sourcePath) : options.outputDir;
  await mkdir(dir, { recursive: true });

  // 序号按总段数补零，否则 10 段以上时资源管理器里 seg-10 会排在 seg-2 前面
  const pad = String(segments.length).length;
  const planned = segments.map((segment, index) => {
    const name = options.nameTemplate
      .replace(/\{name\}/g, nameNoExt)
      .replace(/\{n\}/g, String(index + 1).padStart(pad, '0'));
    return {
      segment,
      outputPath: join(dir, `${name}.${ext}`),
      tempPath: join(dir, `${name}.tbtmp.${ext}`),
    };
  });

  const collision = planned.find((p) => p.outputPath === sourcePath);
  if (collision) {
    throw new Error('输出会覆盖源文件，请换一个输出目录，或改输出名模板');
  }

  const total = segments.length;
  let highest = 0;
  let canceled = false;

  try {
    for (const [index, plan] of planned.entries()) {
      const segmentDuration = plan.segment.end - plan.segment.start;
      const args = buildArgs(
        sourcePath,
        plan.tempPath,
        { ...options, trim: plan.segment },
        segmentDuration,
      );
      const result = await runFfmpeg(args, {
        // 各段共用一个 taskId：取消时 runFfmpeg 的 canceledTasks 标记会让后续
        // 段开跑前自我了断，不然杀掉当前段之后剩下的段还会照跑完
        taskId: options.taskId,
        duration: segmentDuration,
        onProgress: (p) => {
          // runFfmpeg 的百分比是**单段**的 0→100，这里换算成整体进度，
          // 否则进度条会每切一段就从 0 重新走一遍
          const overall = Math.round(((index + Math.max(0, p.percent) / 100) / total) * 100);
          highest = Math.max(highest, overall);
          pushProgress(win, options.taskId, highest, p.outTime, p.speed);
        },
      });
      if (result.canceled) {
        canceled = true;
        break;
      }
    }

    if (canceled) return { outputPaths: [], outputSize: 0, canceled: true };

    // 到这里所有段都成功了，才一起搬到最终位置
    let outputSize = 0;
    for (const plan of planned) {
      await rename(plan.tempPath, plan.outputPath);
      const info = await stat(plan.outputPath);
      outputSize += info.size;
    }
    return { outputPaths: planned.map((p) => p.outputPath), outputSize, canceled: false };
  } finally {
    clearCanceled(options.taskId);
    // 成功时已 rename 走，unlink 全部失败也无所谓；失败/取消时这一步才是关键
    await Promise.all(planned.map((p) => unlink(p.tempPath).catch(() => {})));
  }
}

/**
 * 画波形图，直出 stdout 不落盘。
 *
 * 不缓存、不写临时文件：实测 `showwavespic` 的成本与时长、尺寸都几乎无关
 * （十分钟文件 1200×80 用 277ms、2400×120 用 287ms），要就现画最简单。
 * @param filePath 音频路径。
 * @param options 尺寸与颜色。
 * @returns PNG data URL。
 */
async function waveform(filePath: string, options: WaveformOptions): Promise<string> {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const buffer = await runFfmpegToBuffer([
    '-i',
    filePath,
    '-filter_complex',
    `showwavespic=s=${width}x${height}:colors=${options.color}`,
    '-frames:v',
    '1',
    '-f',
    'image2',
    '-c:v',
    'png',
    'pipe:1',
  ]);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

/**
 * 检测静音区间。
 *
 * `silencedetect` 只把结果打在 stderr 上，所以走 runFfmpegCollectStderr 收全文
 * （runFfmpeg 只留尾部 40 行，长文件会把前面的检出结果丢掉）。
 * 实测精度约 15ms：30 秒文件三段静音（真值 5-7 / 14-16 / 22-25）测得
 * 5.02-7.01 / 14.00-16.02 / 22.01-25.01。
 * @param filePath 音频路径。
 * @param options 阈值与最短时长。
 * @returns 总时长与静音区间列表。
 */
async function detectSilence(
  filePath: string,
  options: DetectSilenceOptions,
): Promise<DetectSilenceResult> {
  const meta = await probeAudio(filePath);
  const stderr = await runFfmpegCollectStderr([
    '-i',
    filePath,
    '-af',
    `silencedetect=noise=${options.noiseDb}dB:d=${options.minDuration}`,
    '-f',
    'null',
    '-',
  ]);

  const silences: SilenceRange[] = [];
  let pendingStart: number | null = null;
  for (const match of stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    if (match[1] === 'start') {
      pendingStart = Math.max(0, value);
    } else if (pendingStart !== null) {
      silences.push({ start: pendingStart, end: value });
      pendingStart = null;
    }
  }
  // 文件以静音结尾时 ffmpeg **不输出收尾的 silence_end**（它在流结束时就不再报了），
  // 不补这一刀，末尾那段静音会被整个漏掉
  if (pendingStart !== null && meta.duration > pendingStart) {
    silences.push({ start: pendingStart, end: meta.duration });
  }

  return { duration: meta.duration, silences };
}

/**
 * 注册音频处理相关 IPC。
 * @param win 主窗口，用于推送进度。
 */
export function registerAudioIpc(win: BrowserWindow): void {
  handle(AUDIO_CHANNELS.probe, async (_event, filePath: string) => {
    const meta = await probeAudio(filePath);
    // probe 成功即登记进播放白名单：页面每加一个文件都会 probe，不必另开一个 IPC
    allowMediaPath(filePath);
    return meta;
  });

  handle(AUDIO_CHANNELS.waveform, (_event, filePath: string, options: WaveformOptions) =>
    waveform(filePath, options),
  );

  handle(
    AUDIO_CHANNELS.convert,
    async (_event, sourcePath: string, options: AudioConvertOptions) => {
      const result = await convertOne(win, sourcePath, options);
      if (result.outputPath) allowMediaPath(result.outputPath);
      return result;
    },
  );

  handle(AUDIO_CHANNELS.detectSilence, (_event, filePath: string, options: DetectSilenceOptions) =>
    detectSilence(filePath, options),
  );

  handle(AUDIO_CHANNELS.split, async (_event, sourcePath: string, options: AudioSplitOptions) => {
    const result = await splitAudio(win, sourcePath, options);
    for (const path of result.outputPaths) allowMediaPath(path);
    return result;
  });

  handle(AUDIO_CHANNELS.cancel, (_event, taskId: string) => cancelFfmpeg(taskId));
}
