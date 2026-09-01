import type { AudioCodec, AudioFormat } from './types';

/**
 * 音频容器与编码器的兼容矩阵（**实测得出，不是照文档抄的**）。
 *
 * 放在 shared 而不是主进程里，是因为**两端都要用同一份**：主进程 pre-flight 拿它
 * 拦非法组合，渲染进程拿它过滤下拉项（让用户根本选不到会失败的组合）。各存一份
 * 必然漂移——改了一处忘了另一处，表现是「下拉里能选，点下去报错」。
 */

/**
 * 各容器能装的音频**流编码**（ffprobe 报的 codec_name，如 mp3 / vorbis）。
 *
 * 用流编码名而非编码器名（libmp3lame / libvorbis），因为「重新编码」与
 * 「只换封装（-c:a copy）」两条路都要查这张表：实测跑出来的两张矩阵
 * （编码器×容器、源编码×容器）**结构完全一致**，所以合成一张，配
 * {@link ENCODER_CODEC} 做名字换算即可。
 *
 * 两个反直觉之处都是实测的：wav 能装 mp3/aac/vorbis/flac 这些压缩流；
 * ogg 与 opus 两个容器可互装 opus/vorbis/flac。
 */
export const CONTAINER_CODECS: Record<Exclude<AudioFormat, 'original'>, readonly string[]> = {
  mp3: ['mp3'],
  m4a: ['aac', 'alac'],
  wav: ['pcm_s16le', 'mp3', 'aac', 'vorbis', 'flac'],
  flac: ['flac'],
  ogg: ['vorbis', 'opus', 'flac'],
  opus: ['opus', 'vorbis', 'flac'],
  aac: ['aac'],
};

/** 编码器名 → 它产出的流编码名，用于查 {@link CONTAINER_CODECS}。 */
export const ENCODER_CODEC: Record<Exclude<AudioCodec, 'copy'>, string> = {
  libmp3lame: 'mp3',
  aac: 'aac',
  libopus: 'opus',
  libvorbis: 'vorbis',
  flac: 'flac',
  alac: 'alac',
  pcm_s16le: 'pcm_s16le',
};

/** 无损编码器：这些只有「无损」一种码率模式，给码率/质量参数没有意义。 */
export const LOSSLESS_ENCODERS: readonly AudioCodec[] = ['flac', 'alac', 'pcm_s16le'];

/** 支持 VBR（`-q:a`）的编码器。其余给 `-q:a` 会被忽略甚至报错，一律退回 CBR。 */
export const VBR_ENCODERS: readonly AudioCodec[] = ['libmp3lame', 'libvorbis'];

/** libopus 唯一接受的采样率（显式给别的值会直接报错退出，实测）。 */
export const OPUS_SAMPLE_RATE = 48_000;

/**
 * 判断某编码器的产物能否装进某容器。
 * @param codec 编码器（`copy` 请改用 {@link streamFitsContainer}）。
 * @param container 输出容器。
 * @returns 能装则为 true。
 */
export function codecFitsContainer(
  codec: Exclude<AudioCodec, 'copy'>,
  container: Exclude<AudioFormat, 'original'>,
): boolean {
  return CONTAINER_CODECS[container].includes(ENCODER_CODEC[codec]);
}

/**
 * 判断某个已有的音频流能否**原样**装进某容器（`-c:a copy` 用）。
 * @param streamCodec ffprobe 报的流编码名。
 * @param container 输出容器。
 * @returns 能装则为 true。
 */
export function streamFitsContainer(
  streamCodec: string,
  container: Exclude<AudioFormat, 'original'>,
): boolean {
  return CONTAINER_CODECS[container].includes(streamCodec);
}
