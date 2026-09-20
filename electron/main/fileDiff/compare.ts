import { createHash } from 'node:crypto';
import { lstat, open, opendir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type {
  FileDiffDetail,
  FileDiffEntry,
  FileDiffFile,
  FileDiffOptions,
  FileDiffProgress,
  FileDiffResult,
} from '../../shared/fileDiff';
import { decodeText, diffText } from './text';

const MAX_ENTRIES = 50000;
const PREVIEW_BYTES = 1024 * 1024;

/** 在任何 I/O 前验证 IPC 入参。 */
export const fileDiffOptionsSchema = z
  .object({
    jobId: z.string().min(1).max(100),
    leftPath: z.string().trim().min(1).max(32768),
    rightPath: z.string().trim().min(1).max(32768),
    include: z.string().max(4000),
    exclude: z.string().max(4000),
  })
  .strict();

interface Inventory {
  files: Map<string, FileDiffFile>;
  directories: Map<string, FileDiffFile>;
  failed: string[];
  truncated: boolean;
}

/** @param input 后缀列表。 @returns 统一为小写的后缀规则。 */
export function parseExtensions(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,;，；]+/)
        .filter(Boolean)
        .map((raw) => {
          const value = raw.toLowerCase();
          if (value === '*' || value === '(无扩展名)') return value;
          const ext = value.replace(/^\*?\./, '');
          if (!/^[\p{L}\p{N}_+-]+(?:\.[\p{L}\p{N}_+-]+)*$/u.test(ext))
            throw new Error(`无效后缀「${raw}」，请使用 ts、.ts 或 *.ts`);
          return ext;
        }),
    ),
  ];
}

/** @param name 文件名。 @param rules 标准后缀。 @returns 是否匹配至少一条规则。 */
function matches(name: string, rules: string[]): boolean {
  return rules.some(
    (rule) =>
      rule === '*' ||
      (rule === '(无扩展名)' ? !extname(name) : name.toLowerCase().endsWith(`.${rule}`)),
  );
}

/** @param path 绝对路径。 @returns 不跟随符号链接的文件身份。 */
async function inspect(path: string): Promise<FileDiffFile> {
  const info = await lstat(path);
  if (!info.isFile() && !info.isDirectory()) throw new Error(`不支持符号链接或特殊文件：${path}`);
  return {
    path,
    kind: info.isFile() ? 'file' : 'directory',
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    dev: info.dev,
    ino: info.ino,
  };
}

function unchanged(a: FileDiffFile, b: FileDiffFile): boolean {
  return (
    a.kind === b.kind &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.dev === b.dev &&
    a.ino === b.ino
  );
}

/** 小块读取并校验文件身份，确保读到的内容对应扫描结果。 */
async function readStable(
  file: FileDiffFile,
  signal: AbortSignal,
  consume: (chunk: Buffer) => void,
): Promise<void> {
  signal.throwIfAborted();
  if (!unchanged(file, await inspect(file.path))) throw new Error('文件已变化，请重新对比');
  const handle = await open(file.path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== file.size || info.ino !== file.ino || info.dev !== file.dev)
      throw new Error('文件已被替换，请重新对比');
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    while (position < file.size) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, file.size - position),
        position,
      );
      if (!bytesRead) throw new Error('文件在读取过程中被截断，请重新对比');
      consume(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat();
    if (
      after.size !== file.size ||
      after.mtimeMs !== file.mtimeMs ||
      after.ctimeMs !== file.ctimeMs ||
      !unchanged(file, await inspect(file.path))
    )
      throw new Error('文件在读取过程中发生变化，请重新对比');
  } finally {
    await handle.close();
  }
}

/**
 * 比较文件或目录；仅检查文件内容，不写入源路径。
 * @param input 根路径和后缀规则。
 * @param signal 取消信号。
 * @param notify 节流后的进度。
 * @returns 文件对比结果；读取失败、取消、截断均显式报告。
 */
export async function compareFiles(
  input: FileDiffOptions,
  signal: AbortSignal,
  notify: (progress: FileDiffProgress) => void,
): Promise<FileDiffResult> {
  const options = fileDiffOptionsSchema.parse(input);
  if (!isAbsolute(options.leftPath) || !isAbsolute(options.rightPath))
    throw new Error('请输入两个绝对文件路径或文件夹路径');
  const include = parseExtensions(options.include);
  const exclude = parseExtensions(options.exclude);
  const allowed = (name: string): boolean =>
    (!include.length || matches(name, include)) && !matches(name, exclude);
  const started = Date.now();
  const leftRoot = await inspect(resolve(options.leftPath));
  const rightRoot = await inspect(resolve(options.rightPath));
  if (leftRoot.kind !== rightRoot.kind)
    throw new Error('两侧类型不同：请选择两个文件，或两个文件夹');
  const result: FileDiffResult = {
    jobId: options.jobId,
    leftPath: leftRoot.path,
    rightPath: rightRoot.path,
    entries: [],
    canceled: false,
    truncated: false,
    errors: [],
    errorCount: 0,
    skippedLinks: 0,
    filtered: 0,
    elapsed: 0,
  };
  const progress: FileDiffProgress = {
    jobId: options.jobId,
    phase: 'scanning',
    scanned: 0,
    compared: 0,
    total: 0,
    currentPath: '',
  };
  let lastNotified = 0;
  const emit = (force = false): void => {
    if (force || Date.now() - lastNotified >= 150) {
      lastNotified = Date.now();
      notify({ ...progress });
    }
  };
  const error = (message: string): void => {
    result.errorCount++;
    if (result.errors.length < 50) result.errors.push(message);
  };
  const inventory = async (root: FileDiffFile): Promise<Inventory> => {
    const found: Inventory = {
      files: new Map(),
      directories: new Map(),
      failed: [],
      truncated: false,
    };
    const stack = [{ path: root.path, relative: '' }];
    let visited = 0;
    while (stack.length && !signal.aborted && !found.truncated) {
      const current = stack.pop()!;
      try {
        for await (const entry of await opendir(current.path)) {
          if (signal.aborted) break;
          if (++visited > MAX_ENTRIES) {
            found.truncated = true;
            break;
          }
          const path = join(current.path, entry.name);
          const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name;
          progress.scanned++;
          progress.currentPath = path;
          emit();
          if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
            result.skippedLinks++;
            found.failed.push(relativePath);
            continue;
          }
          try {
            const file = await inspect(path);
            if (file.kind === 'directory') {
              found.directories.set(relativePath, file);
              stack.push({ path, relative: relativePath });
            } else found.files.set(relativePath, file);
          } catch (cause) {
            found.failed.push(relativePath);
            error(`${path}：${String(cause)}`);
          }
        }
      } catch (cause) {
        found.failed.push(current.relative);
        error(`${current.path}：${String(cause)}`);
      }
    }
    return found;
  };
  let pairs: {
    name: string;
    left: FileDiffFile | null;
    right: FileDiffFile | null;
    uncertain: boolean;
  }[];
  if (leftRoot.kind === 'file') {
    // 单文件不同扩展名时，两侧都需满足过滤规则，排除任何一侧均跳过。
    pairs =
      allowed(basename(leftRoot.path)) && allowed(basename(rightRoot.path))
        ? [
            {
              name: `${basename(leftRoot.path)} ↔ ${basename(rightRoot.path)}`,
              left: leftRoot,
              right: rightRoot,
              uncertain: false,
            },
          ]
        : [];
    if (!pairs.length) result.filtered = 1;
  } else {
    const left = await inventory(leftRoot);
    const right = await inventory(rightRoot);
    result.truncated = left.truncated || right.truncated;
    const uncertain = (side: Inventory, name: string): boolean =>
      side.truncated ||
      side.failed.some((prefix) => !prefix || name === prefix || name.startsWith(`${prefix}/`));
    pairs = [];
    for (const name of new Set([...left.files.keys(), ...right.files.keys()])) {
      if (!allowed(basename(name))) {
        result.filtered++;
        continue;
      }
      if (pairs.length >= MAX_ENTRIES) {
        result.truncated = true;
        break;
      }
      const a = left.files.get(name) ?? left.directories.get(name) ?? null;
      const b = right.files.get(name) ?? right.directories.get(name) ?? null;
      pairs.push({
        name,
        left: a,
        right: b,
        uncertain: (!a && uncertain(left, name)) || (!b && uncertain(right, name)),
      });
    }
    pairs.sort((a, b) => a.name.localeCompare(b.name));
  }
  progress.phase = 'comparing';
  progress.total = pairs.length;
  emit(true);
  for (const pair of pairs) {
    if (signal.aborted) break;
    const row: FileDiffEntry = {
      id: String(result.entries.length),
      relativePath: pair.name,
      left: pair.left,
      right: pair.right,
      status: 'same',
    };
    progress.currentPath = pair.left?.path ?? pair.right!.path;
    try {
      if (pair.uncertain) throw new Error('另一侧扫描不完整，无法确认文件是否缺失');
      if (!pair.left) row.status = 'right-only';
      else if (!pair.right) row.status = 'left-only';
      else if (pair.left.kind !== pair.right.kind) row.status = 'type-conflict';
      else if (pair.left.size !== pair.right.size) row.status = 'modified';
      else {
        const digest = async (file: FileDiffFile): Promise<string> => {
          const hash = createHash('sha256');
          await readStable(file, signal, (chunk) => {
            hash.update(chunk);
            emit();
          });
          return hash.digest('hex');
        };
        const leftHash = await digest(pair.left);
        const rightHash = await digest(pair.right);
        row.status = leftHash === rightHash ? 'same' : 'modified';
      }
      for (const file of [pair.left, pair.right]) {
        if (file?.kind === 'file' && !unchanged(file, await inspect(file.path)))
          throw new Error('文件在比较过程中发生变化，请重新对比');
      }
    } catch (cause) {
      if (signal.aborted) break;
      row.status = 'error';
      row.error = cause instanceof Error ? cause.message : String(cause);
      error(`${pair.name}：${row.error}`);
    }
    result.entries.push(row);
    progress.compared++;
    emit();
  }
  result.canceled = signal.aborted;
  result.elapsed = Date.now() - started;
  emit(true);
  return result;
}

/**
 * 只为已缓存的对比条目读取详情；对大文件和二进制不做文本解码。
 * @param entry 主进程已登记的条目，不接收渲染进程任意文件路径。
 * @returns 有界的文本差异。
 */
export async function readDiffDetail(entry: FileDiffEntry): Promise<FileDiffDetail> {
  const empty: FileDiffDetail = {
    kind: 'unavailable',
    message: '',
    lines: [],
    leftEncoding: '',
    rightEncoding: '',
    simplified: false,
    truncated: false,
  };
  if (entry.status === 'error' || entry.status === 'type-conflict')
    return { ...empty, message: entry.error ?? '同一路径一侧为文件，另一侧为文件夹。' };
  if ([entry.left, entry.right].some((file) => file && file.size > PREVIEW_BYTES))
    return {
      ...empty,
      kind: 'large',
      message: '文件超过 1 MiB，仅显示内容比较结果，不加载文本预览。',
    };
  const read = async (file: FileDiffFile | null) => {
    if (!file) return { text: '', encoding: '不存在' };
    const chunks: Buffer[] = [];
    await readStable(file, new AbortController().signal, (chunk) =>
      chunks.push(Buffer.from(chunk)),
    );
    return decodeText(Buffer.concat(chunks));
  };
  const left = await read(entry.left);
  const right = await read(entry.right);
  if (!left || !right)
    return {
      ...empty,
      kind: 'binary',
      message:
        '二进制或不支持的文本编码，仅显示文件内容是否相同。文本预览支持 UTF-8 和带 BOM 的 UTF-16。',
    };
  const detail = await diffText(left, right);
  if (!entry.left || !entry.right)
    detail.message = `文件仅${entry.left ? '左' : '右'}侧存在${left.text === '' && right.text === '' ? '，内容为空' : ''}。`;
  return detail;
}
