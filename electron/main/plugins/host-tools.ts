import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dialog } from 'electron';
import { z } from 'zod';
import { cachePath } from '../storage/paths';
import { TOOLS } from '../ai/tools/registry';
import { cancelFfmpeg, clearCanceled } from '../ffmpeg/run';
import { withPluginMedia } from '../ffmpeg/context';
import { diffText } from '../fileDiff/text';
import { getWebTestAccess } from '../webtest/access';
import { assertJson } from '../../shared/plugins/validation';
import type { PluginPermission } from '../../shared/plugins/types';

/** 宿主工具只使用当前实例的授权句柄。 */
export interface HostToolAccess {
  signal: AbortSignal;
  assert(permission: PluginPermission): void;
  file(handle: string): { opened: FileHandle; name: string };
  save(source: string, name: string): Promise<boolean>;
}
const METHODS = {
  'image.probe': ['tools.image', 'probe_image'],
  'image.compress': ['tools.image', 'compress_images'],
  'media.probeVideo': ['tools.media', 'probe_video'],
  'media.probeAudio': ['tools.media', 'probe_audio'],
  'media.convertVideo': ['tools.media', 'convert_video'],
  'media.convertAudio': ['tools.media', 'convert_audio'],
} as const;
const WEBTEST = new Set([
  'status',
  'read_steps',
  'inspect',
  'patch_steps',
  'replay',
  'wait',
  'stop',
]);
const imageOptions = z.strictObject({
  format: z.enum(['original', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']).optional(),
  quality: z.number().int().min(1).max(100).optional(),
  maxWidth: z.number().int().min(0).max(16384).optional(),
});
const videoOptions = z.strictObject({
  format: z.enum(['mp4', 'webm', 'mkv', 'gif']).optional(),
  maxHeight: z.number().int().min(0).max(8192).optional(),
  crf: z.number().int().min(0).max(51).optional(),
});
const audioOptions = z.strictObject({
  format: z.enum(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus']).optional(),
  bitrate: z.number().int().min(16).max(512).optional(),
});

/** 只允许自包含媒体容器，不让播放列表通过解码器访问其他文件或 URL。 */
function mediaExtension(header: Buffer): string {
  if (header.toString('ascii', 4, 8) === 'ftyp') return '.mp4';
  if (header.readUInt32BE(0) === 0x1a45dfa3) return '.mkv';
  if (
    header.toString('ascii', 0, 4) === 'RIFF' &&
    ['WAVE', 'AVI '].includes(header.toString('ascii', 8, 12))
  )
    return header.toString('ascii', 8, 12) === 'WAVE' ? '.wav' : '.avi';
  if (header.toString('ascii', 0, 4) === 'fLaC') return '.flac';
  if (header.toString('ascii', 0, 4) === 'OggS') return '.ogg';
  if (
    header.toString('ascii', 0, 3) === 'ID3' ||
    (header[0] === 255 && (header[1] & 0xe0) === 0xe0)
  )
    return '.mp3';
  throw new Error('仅支持自包含的 MP4/MKV/WebM/WAV/AVI/FLAC/OGG/MP3/AAC 媒体文件');
}

/** @param method SDK 的固定方法名。 @param args 参数。 @param access 授权上下文。 @returns 有界工具结果。 */
export async function runHostTool(
  method: string,
  args: unknown[],
  access: HostToolAccess,
): Promise<unknown> {
  if (method === 'diff.compare') {
    access.assert('tools.diff');
    const left = z.string().max(64000).parse(args[0]);
    const right = z.string().max(64000).parse(args[1]);
    const result = await diffText(
      { text: left, encoding: 'UTF-8' },
      { text: right, encoding: 'UTF-8' },
    );
    access.assert('tools.diff');
    while (Buffer.byteLength(JSON.stringify(result)) > 200000 && result.lines.length) {
      result.lines.pop();
      result.truncated = true;
    }
    return result;
  }
  if (method.startsWith('webtest.')) {
    access.assert('tools.webtest');
    if (!WEBTEST.has(method.slice(8))) throw new Error('未开放的网页测试方法');
    const def = TOOLS.find((item) => item.name === method.replace('.', '_'))!;
    const input = def.inputSchema.parse(args[0] ?? {});
    let result = await def.run(input, {
      requestId: `plugin-${randomUUID()}`,
      mode: 'auto',
      signal: access.signal,
      emit: () => {},
      trackTask: () => {},
    });
    if (method === 'webtest.replay') {
      await (await getWebTestAccess()).session.waitForReplay();
      const status = TOOLS.find((item) => item.name === 'webtest_status')!;
      result = await status.run(
        {},
        {
          requestId: `plugin-${randomUUID()}`,
          mode: 'auto',
          signal: access.signal,
          emit: () => {},
          trackTask: () => {},
        },
      );
    }
    access.assert('tools.webtest');
    return assertJson(JSON.parse(JSON.stringify(result.data)));
  }
  if (!Object.hasOwn(METHODS, method)) throw new Error('未开放的宿主工具');
  const [permission, tool] = METHODS[method as keyof typeof METHODS];
  access.assert(permission);
  access.assert('files.readSelected');
  const source = access.file(z.string().uuid().parse(args[0]));
  const options =
    method === 'image.compress'
      ? imageOptions.parse(args[1] ?? {})
      : method === 'media.convertVideo'
        ? videoOptions.parse(args[1] ?? {})
        : method === 'media.convertAudio'
          ? audioOptions.parse(args[1] ?? {})
          : {};
  const writes = method.includes('compress') || method.includes('convert');
  if (writes) access.assert('files.save');
  const base = cachePath('plugins', 'processing');
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'run-'));
  const taskIds = new Set<string>();
  const cancel = (): void => {
    for (const id of taskIds) cancelFfmpeg(id);
  };
  access.signal.addEventListener('abort', cancel, { once: true });
  try {
    if (access.signal.aborted) throw new Error('插件已取消');
    const stat = await source.opened.stat();
    const max = permission === 'tools.image' ? 32 * 1024 * 1024 : 128 * 1024 * 1024;
    if (stat.size > max) throw new Error(`输入文件超过 ${max / 1024 / 1024} MB`);
    const header = Buffer.alloc(16);
    await source.opened.read(header, 0, header.length, 0);
    const ext =
      permission === 'tools.media'
        ? mediaExtension(header)
        : path.extname(source.name).toLowerCase();
    if (
      permission === 'tools.image' &&
      !['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.tiff', '.tif'].includes(ext)
    )
      throw new Error('不支持的图片格式');
    const inputPath = path.join(dir, 'input' + ext);
    const output = await fs.open(inputPath, 'wx');
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      let position = 0;
      for (;;) {
        access.assert('files.readSelected');
        const { bytesRead } = await source.opened.read(chunk, 0, chunk.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        if (position > max) throw new Error('输入文件读取期间超过限制');
        await output.writeFile(chunk.subarray(0, bytesRead));
      }
    } finally {
      await output.close();
    }
    access.assert(permission);
    if (writes) await fs.mkdir(path.join(dir, 'output'), { recursive: true });
    const def = TOOLS.find((item) => item.name === tool)!;
    const input = def.inputSchema.parse({
      ...options,
      path: inputPath,
      paths: [inputPath],
      outputDir: path.join(dir, 'output'),
      overwrite: false,
    });
    const result = await withPluginMedia(access.signal, () =>
      def.run(input, {
        requestId: `plugin-${randomUUID()}`,
        mode: 'auto',
        signal: access.signal,
        emit: () => {},
        trackTask: (id) => {
          taskIds.add(id);
          if (access.signal.aborted) cancelFfmpeg(id);
        },
      }),
    );
    access.assert(permission);
    if (access.signal.aborted) throw new Error('插件已取消');
    if (!writes) {
      const data = { ...(result.data as Record<string, unknown>) };
      delete data.path;
      return assertJson(JSON.parse(JSON.stringify(data)));
    }
    const data = result.data as { path?: string; canceled?: boolean; files?: { path: string }[] };
    if (data.canceled) throw new Error('处理已取消');
    const file = data.path ?? data.files?.[0]?.path;
    if (
      !file ||
      path.relative(dir, file).startsWith('..') ||
      path.isAbsolute(path.relative(dir, file))
    )
      throw new Error('工具未返回有效结果');
    const bytes = (await fs.stat(file)).size;
    const name = path.parse(source.name).name + path.extname(file);
    return { saved: await access.save(file, name), name, bytes };
  } finally {
    access.signal.removeEventListener('abort', cancel);
    cancel();
    for (const id of taskIds) clearCanceled(id);
    // dir 由宿主在固定缓存根下 mkdtemp 创建，插件无法指定或改写。
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** @param source 缓存中的处理结果。 @param name 输出文件名。 @param assertSave 保存前再次授权。 @returns 用户是否保存。 */
export async function saveProcessedFile(
  source: string,
  name: string,
  assertSave: () => void,
): Promise<boolean> {
  assertSave();
  const selected = await dialog.showSaveDialog({
    title: '保存插件处理结果',
    defaultPath: path.basename(name),
  });
  assertSave();
  if (selected.canceled || !selected.filePath) return false;
  const temporary = selected.filePath + '.' + randomUUID() + '.tmp';
  try {
    await fs.copyFile(source, temporary, fs.constants.COPYFILE_EXCL);
    assertSave();
    await fs.rename(temporary, selected.filePath);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return true;
}
