import { spawn } from 'child_process';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import type { VideoCapabilities } from '../../shared/types';

/**
 * ffmpeg / ffprobe 二进制的定位与能力探测。
 *
 * 二进制随 @ffmpeg-installer / @ffprobe-installer 打进依赖（平台专属
 * optionalDependency，无安装脚本、不联网下载），运行时只需拿到路径。
 */

/**
 * 把 asar 内的路径改写到 asar.unpacked。
 *
 * 打包后 node_modules 进了 app.asar，而 **asar 内的可执行文件无法被 spawn**
 * （它不是真实文件）。electron-builder 需把这两个包配进 asarUnpack，
 * 届时二进制会落在 app.asar.unpacked 下，路径要跟着换。
 * 开发环境路径里没有 app.asar，此函数是恒等变换。
 * @param path 安装包给出的二进制路径。
 * @returns 实际可执行的路径。
 */
function unpacked(path: string): string {
  return path.replace('app.asar', 'app.asar.unpacked');
}

/** ffmpeg 可执行文件路径。 */
export const FFMPEG_PATH = unpacked(ffmpegInstaller.path);

/** ffprobe 可执行文件路径。 */
export const FFPROBE_PATH = unpacked(ffprobeInstaller.path);

/** 能力探测结果缓存：一次进程生命周期内不会变。 */
let cachedCapabilities: VideoCapabilities | null = null;

/**
 * 跑一次子进程并收集 stdout。
 * @param file 可执行文件路径。
 * @param args 参数数组。
 * @returns stdout 文本。
 */
function readStdout(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true });
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
      else reject(new Error(err.trim() || `进程退出码 ${code}`));
    });
  });
}

/**
 * 从 `ffmpeg -encoders` 输出里解析编码器名。
 *
 * 每行形如 ` V..... libx264   libx264 H.264 ...`，第一列六个标志位的
 * 首字符是流类型（V 视频 / A 音频），第二列是编码器名。
 *
 * 名字必须限定为标识符字符：输出开头的图例行（` V..... = Video`）与真正的
 * 编码器行**标志位形状完全相同**，只能靠「名字不可能是 `=`」把它筛掉。
 * @param text -encoders 的输出。
 * @returns 视频与音频编码器名。
 */
function parseEncoders(text: string): { video: string[]; audio: string[] } {
  const video: string[] = [];
  const audio: string[] = [];
  for (const line of text.split('\n')) {
    const matched = /^\s([VAS])[.A-Z]{5}\s+([A-Za-z0-9][A-Za-z0-9_.-]*)\s/.exec(line);
    if (!matched) continue;
    if (matched[1] === 'V') video.push(matched[2]);
    else if (matched[1] === 'A') audio.push(matched[2]);
  }
  return { video, audio };
}

/**
 * 探测当前 ffmpeg 构建实际可用的编码器（结果缓存）。
 *
 * **这不是多余的一步**：打包的是 2018 年的构建，ffmpeg 文档列的编码器
 * 不等于它有；开发机上装的系统 ffmpeg 又比它新得多（有 nvenc/av1）。
 * 照文档或照开发机写死 UI，就会给用户一个点下去必然报错的选项。
 * @returns 版本串与可用编码器集合。
 */
export async function probeCapabilities(): Promise<VideoCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  const [versionText, encodersText] = await Promise.all([
    readStdout(FFMPEG_PATH, ['-hide_banner', '-version']),
    readStdout(FFMPEG_PATH, ['-hide_banner', '-encoders']),
  ]);

  const { video, audio } = parseEncoders(encodersText);
  cachedCapabilities = {
    version: /ffmpeg version (\S+)/.exec(versionText)?.[1] ?? 'unknown',
    videoEncoders: video,
    audioEncoders: audio,
  };
  return cachedCapabilities;
}
