import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { open as openZip, type Entry, type ZipFile } from 'yauzl';
import { dataPath } from '../storage/paths';
import { isPluginPath, parseManifest } from '../../shared/plugins/validation';
import type { PluginManifest } from '../../shared/plugins/types';

const MAX_FILES = 500;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const EXTENSIONS = new Set([
  '.js',
  '.json',
  '.html',
  '.css',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.woff2',
  '.txt',
  '.md',
  '.map',
]);

/** 验证后的包快照，不执行源码；最多 20 MB。 */
export interface PluginBundle {
  manifest: PluginManifest;
  files: Map<string, Buffer>;
}

/**
 * 验证路径与静态资源类型；运行时不提供 native 模块或安装脚本。
 * @param name 包内文件名。
 */
export function assertPackageFile(name: string): void {
  if (!isPluginPath(name) || !EXTENSIONS.has(path.extname(name).toLowerCase()))
    throw new Error(`不支持的包内文件：${name}`);
}

/**
 * 从文件内容建立可复用的校验快照。
 * @param files 文件映射。
 * @returns 已验证的包。
 */
export function validateBundle(files: Map<string, Buffer>): PluginBundle {
  let total = 0;
  const folded = new Set<string>();
  if (files.size > MAX_FILES) throw new Error('插件文件数超过 500');
  for (const [name, content] of files) {
    assertPackageFile(name);
    if (folded.has(name.toLowerCase())) throw new Error(`重复文件（不区分大小写）：${name}`);
    folded.add(name.toLowerCase());
    total += content.length;
    if (content.length > MAX_FILE || total > MAX_TOTAL)
      throw new Error('插件超过单文件 4 MB / 总计 20 MB 限制');
  }
  const manifest = parseManifest(
    JSON.parse(files.get('manifest.json')?.toString('utf8') ?? 'null'),
  );
  for (const entry of [
    manifest.entry,
    ...manifest.contributes.pages.map((p) => p.entry).filter(Boolean),
  ]) {
    if (!files.has(entry!)) throw new Error(`入口不存在：${entry}`);
  }
  return { manifest, files };
}

/**
 * 有界读取开发目录或 ZIP；拒绝链接、大小写冲突及路径穿越。
 * @param source 用户选择的包或目录。
 * @returns 内存中的不可执行包快照。
 */
export async function readBundle(source: string): Promise<PluginBundle> {
  const files = new Map<string, Buffer>();
  let total = 0;
  let visited = 0;
  const add = (name: string, buffer: Buffer): void => {
    if (files.has(name)) throw new Error(`重复文件：${name}`);
    total += buffer.length;
    if (files.size >= MAX_FILES || buffer.length > MAX_FILE || total > MAX_TOTAL)
      throw new Error('插件包超过容量限制');
    files.set(name, buffer);
  };
  const info = await fs.lstat(source);
  if (info.isSymbolicLink()) throw new Error('插件源不能是链接');
  if (info.isDirectory()) {
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      if (entries.length > MAX_FILES) throw new Error('目录条目过多');
      for (const entry of entries) {
        if (++visited > MAX_FILES) throw new Error('目录总条目超过 500');
        const name = prefix + entry.name;
        if (!isPluginPath(name)) throw new Error(`非法路径：${name}`);
        const file = path.join(dir, entry.name);
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) throw new Error(`不接受链接：${name}`);
        if (stat.isDirectory()) await walk(file, name + '/');
        else if (stat.isFile()) {
          assertPackageFile(name);
          if (stat.size > MAX_FILE) throw new Error(`文件过大：${name}`);
          add(name, await fs.readFile(file));
        } else throw new Error(`不支持的文件：${name}`);
      }
    };
    await walk(source);
  } else {
    if (!info.isFile() || !source.endsWith('.tbplugin') || info.size > MAX_TOTAL)
      throw new Error('请选择小于 20 MB 的 .tbplugin 文件');
    const zip = await new Promise<ZipFile>((resolve, reject) =>
      openZip(
        source,
        { lazyEntries: true, autoClose: true, strictFileNames: true },
        (error, value) =>
          error || !value ? reject(error ?? new Error('ZIP 打开失败')) : resolve(value),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      let count = 0;
      const fail = (error: unknown): void => {
        zip.close();
        reject(error);
      };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          if (++count > MAX_FILES) throw new Error('ZIP 条目超过 500');
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== 0x8000 && mode !== 0x4000)
            throw new Error('ZIP 不允许链接或特殊文件');
          if (entry.fileName.endsWith('/')) {
            if (!isPluginPath(entry.fileName.slice(0, -1))) throw new Error('非法 ZIP 目录');
          } else {
            assertPackageFile(entry.fileName);
            if (
              entry.uncompressedSize > MAX_FILE ||
              total + entry.uncompressedSize > MAX_TOTAL ||
              entry.generalPurposeBitFlag & 1
            )
              throw new Error('ZIP 超过限制或被加密');
            const stream = await new Promise<NodeJS.ReadableStream>((yes, no) =>
              zip.openReadStream(entry, (error, value) =>
                error || !value ? no(error) : yes(value),
              ),
            );
            const chunks: Buffer[] = [];
            let size = 0;
            // yauzl 2 的旧式读取流在 Electron 的 async iterator 下不推进，使用事件消费。
            await new Promise<void>((yes, no) => {
              stream.on('error', no);
              stream.on('end', yes);
              stream.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_FILE) {
                  no(new Error('解压文件超过限制'));
                  zip.close();
                  return;
                }
                chunks.push(Buffer.from(chunk));
              });
            });
            add(entry.fileName, Buffer.concat(chunks));
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
  }
  return validateBundle(files);
}

/**
 * 存储一个新版本；UUID 路径永不覆盖旧版本，注册表提交后才生效。
 * @param bundle 已验证的静态快照。
 * @returns 新版本的相对目录标识。
 */
export async function writeBundle(bundle: PluginBundle): Promise<string> {
  const revision = randomUUID();
  for (const [name, content] of bundle.files) {
    const target = dataPath(
      'plugins',
      'packages',
      bundle.manifest.id,
      revision,
      ...name.split('/'),
    );
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { flag: 'wx' });
  }
  return revision;
}

/** @param content 文件内容。 @returns 用于更新审阅的摘要。 */
export function fileHash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}
