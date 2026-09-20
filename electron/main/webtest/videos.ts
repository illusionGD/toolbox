import { readdir, lstat, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { WebTestVideo, WebTestVideoFormat } from '../../shared/webtest';
import { probeCapabilities } from '../ffmpeg/binary';
import { runFfmpeg } from '../ffmpeg/run';

/** @param format 目标格式；录制开始前检查随应用分发的编码器。 */
export async function prepareVideoFormat(format: WebTestVideoFormat): Promise<void> {
  if (format === 'mp4' && !(await probeCapabilities()).videoEncoders.includes('libx264'))
    throw new Error('当前视频编码器不支持 MP4，请选择 WebM');
}

/**
 * 完成格式转换后再发布文件；失败保留 Playwright 的原始 WebM。
 * @param source 已结束录制的 WebM 文件。
 * @param format 用户选择的输出格式。
 * @returns 可播放和另存的最终视频路径。
 */
export async function finalizeRecordedVideo(
  source: string,
  format: WebTestVideoFormat,
): Promise<string> {
  if (format === 'webm') return source;
  if (!source.toLowerCase().endsWith('.webm')) throw new Error('录制原视频必须为 WebM');
  const target = source.slice(0, -5) + '.mp4';
  const temporary = `${target}.tmp`;
  try {
    const result = await runFfmpeg([
      '-i',
      source,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      // yuv420p 要求偶数尺寸；只补齐边缘，不裁切页面内容。
      '-vf',
      'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      temporary,
    ]);
    if (result.canceled) throw new Error('视频转换已取消');
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await unlink(source);
  return target;
}

/**
 * 从会话目录恢复视频列表，兼容未保存索引的旧录制；不遍历符号链接。
 * @param directory 当前视频缓存目录或旧版视频产物目录。
 * @param excludedDirectory 尚未结束、视频还未封装的会话目录。
 * @returns 按保存时间倒序排列的视频文件信息，播放权限由 IPC 层登记。
 */
export async function listRecordedVideos(
  directory: string,
  excludedDirectory: string | null,
): Promise<Omit<WebTestVideo, 'url'>[]> {
  const videos: Omit<WebTestVideo, 'url'>[] = [];
  let sessions;
  try {
    sessions = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  for (const session of sessions) {
    if (!session.isDirectory()) continue;
    const folder = join(directory, session.name);
    if (folder === excludedDirectory) continue;
    try {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(webm|mp4)$/i.test(entry.name)) continue;
        const path = join(folder, entry.name);
        const info = await lstat(path);
        if (!info.isFile() || info.size === 0) continue;
        videos.push({ path, name: entry.name, size: info.size, modifiedAt: info.mtimeMs });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return videos.sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
}
