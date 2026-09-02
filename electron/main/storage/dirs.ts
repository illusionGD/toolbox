/**
 * 存储目录的底层原语：归属标记、可写探测、占用统计、目录搬迁与清空。
 *
 * **本文件刻意不 import electron**——所有函数只吃路径字符串，因此能脱离 Electron
 * 直接由 node 跑断言（见 skill app-storage 的验证一节）。electron 相关的默认值解析
 * 与状态保持放在 paths.ts。
 */
import { constants, type Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClearCacheResult, DirUsage, StorageDirKind } from '../../shared/types';

/** 目录归属标记文件名。递归删除前必须先确认目录是我们自己的。 */
const MARKER_NAME: Record<StorageDirKind, string> = {
  cache: '.toolbox-cache',
  data: '.toolbox-data',
};

/** 各目录种类的中文名，用于拼错误提示。 */
const KIND_LABEL: Record<StorageDirKind, string> = { cache: '缓存目录', data: '数据目录' };

/**
 * 判断 child 是否等于 parent 或在 parent 之下。
 *
 * 用 `path.relative` 而不是字符串前缀比较：实测 `relative('D:\\ab','D:\\a')` 得 `'..\\a'`、
 * 跨盘时得绝对路径，两种情况都能被下面的判断正确排除，而 `startsWith` 会把
 * `D:\dataX` 误判成在 `D:\data` 之下。
 * @param parent 上层目录。
 * @param child 待判断目录。
 * @returns child 在 parent 之内（含相等）时为 true。
 */
export function isSamePathOrInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 判断是否盘根（如 `C:\`）。盘根一律不许当存储目录：清空缓存是递归删除。
 * @param dir 目录路径。
 * @returns 是盘根时为 true。
 */
export function isDriveRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  return path.parse(resolved).root === resolved;
}

/**
 * 真写一个探测文件来判断目录可写。
 *
 * **不用 `fs.access(W_OK)`**：实测在 Windows 上它对 `C:\Program Files`、
 * `C:\Windows\System32`、`C:\` 全都返回「可写」，而真写入是 EPERM。access 在
 * Windows 上只看只读属性，不看 ACL，所以只有真写一次才算数。
 * @param dir 目标目录，不存在会尝试创建。
 * @returns 可写返回 null；否则返回错误码（如 `EPERM`）或错误描述。
 */
export async function probeWritable(dir: string): Promise<string | null> {
  const probe = path.join(dir, `.tbprobe-${process.pid}-${Date.now().toString(36)}`);
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(probe, 'toolbox');
    return null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code ?? (error instanceof Error ? error.message : String(error));
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {});
  }
}

/**
 * 写入归属标记，声明这个目录由本应用管理。
 * @param dir 目录路径。
 * @param kind 目录种类。
 */
export async function writeMarker(dir: string, kind: StorageDirKind): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const body = JSON.stringify({ app: 'toolbox', kind, createdAt: Date.now() }, null, 2);
  await fs.writeFile(path.join(dir, MARKER_NAME[kind]), body, 'utf-8');
}

/**
 * 目录是否带有本应用的归属标记。
 * @param dir 目录路径。
 * @param kind 目录种类。
 * @returns 有标记为 true。
 */
export async function hasMarker(dir: string, kind: StorageDirKind): Promise<boolean> {
  try {
    await fs.access(path.join(dir, MARKER_NAME[kind]), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 列出目录下的条目名，不存在时返回空数组。
 * @param dir 目录路径。
 * @returns 条目名数组。
 */
async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * 递归统计目录占用。
 * @param dir 目录路径，不存在时返回 0/0。
 * @returns 字节数与文件数。
 */
export async function dirUsage(dir: string): Promise<DirUsage> {
  let bytes = 0;
  let files = 0;
  /**
   * 递归一层。
   * @param current 当前目录。
   */
  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        try {
          bytes += (await fs.stat(full)).size;
          files += 1;
        } catch {
          // 统计失败的单个文件忽略，读数不准也不该让整页报错
        }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

/**
 * 校验一个目录能否作为新的存储目录。不合法直接抛中文错误（会经 IPC 原样带到界面）。
 * @param target 目标目录。
 * @param current 当前目录。
 * @param kind 目录种类。
 */
export async function assertUsableTarget(
  target: string,
  current: string,
  kind: StorageDirKind,
): Promise<void> {
  const label = KIND_LABEL[kind];
  if (!target || !path.isAbsolute(target)) throw new Error(`${label}必须是绝对路径`);
  if (isDriveRoot(target)) throw new Error(`不能把${label}设为磁盘根目录，请选择一个子文件夹`);
  if (path.resolve(target) === path.resolve(current)) throw new Error(`${label}没有变化`);
  // 互相嵌套会导致「把自己搬进自己」或递归删自己
  if (isSamePathOrInside(current, target)) throw new Error(`新${label}不能位于当前${label}之内`);
  if (isSamePathOrInside(target, current))
    throw new Error(`新${label}不能是当前${label}的上层目录`);

  const entries = await readdirSafe(target);
  const owned = await hasMarker(target, kind);
  const meaningful = entries.filter((name) => name !== MARKER_NAME[kind]);
  // 非空且没有我们的标记 → 不接管。否则「清空缓存」有可能删掉别人的东西，
  // 而且逐条 rename 撞上同名子目录在 Windows 上只会给一个莫名的 EPERM。
  if (meaningful.length > 0 && !owned) {
    throw new Error(
      `目标文件夹不是空的（${meaningful.length} 项），请选择空文件夹或本应用用过的文件夹`,
    );
  }

  const reason = await probeWritable(target);
  if (reason) throw new Error(`目标文件夹不可写（${reason}），请换一个位置`);
}

/** 单个条目的搬迁方式。 */
type MoveMode = 'rename' | 'copy';

/**
 * 搬动单个条目：先试同盘 rename，跨盘（EXDEV）退化为复制后删除。
 * @param from 源路径。
 * @param to 目标路径。
 * @returns 实际用的搬法。
 */
async function moveEntry(from: string, to: string): Promise<MoveMode> {
  try {
    await fs.rename(from, to);
    return 'rename';
  } catch (error) {
    // 实测跨盘 rename（文件与目录都）报 EXDEV，此时只能复制
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
    return 'copy';
  }
}

/** 目录搬迁结果。 */
export interface MoveDirResult {
  /** 搬动的顶层条目数。 */
  movedEntries: number;
  /** 搬动的总字节数。 */
  movedBytes: number;
  /** 实际搬法。 */
  mode: 'rename' | 'copy' | 'mixed' | 'none';
}

/**
 * 把 src 下的所有顶层条目搬到 dst，并在搬空后删掉 src 本身。
 *
 * 任一条目失败即**回滚已搬的条目**再抛错：半搬状态加上指针还指着旧目录，数据就
 * 裂成两半了，宁可整批不动。src 用**非递归 rmdir** 删除（不是 rm -rf）——只删我们
 * 确实搬空了的目录，别人往里放了东西就让它 ENOTEMPTY 失败，绝不连带清掉。
 * @param src 源目录。
 * @param dst 目标目录（须已存在且可写）。
 * @returns 搬动条目数、字节数与搬法。
 */
export async function moveDirContents(src: string, dst: string): Promise<MoveDirResult> {
  const entries = await readdirSafe(src);
  if (entries.length === 0) {
    await fs.rmdir(src).catch(() => {});
    return { movedEntries: 0, movedBytes: 0, mode: 'none' };
  }

  const { bytes } = await dirUsage(src);
  const moved: string[] = [];
  const modes = new Set<MoveMode>();

  for (const name of entries) {
    const from = path.join(src, name);
    try {
      modes.add(await moveEntry(from, path.join(dst, name)));
      moved.push(name);
    } catch (error) {
      // 条目在枚举之后自己消失了——典型是别处刚写完的 `.tmp-<pid>` 被 rename 成正式
      // 文件。源里已经没有它，也就没什么可搬、没什么会丢，跳过即可；为此回滚整批
      // 反而会把一次正常的迁移变成失败（实测踩过）
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' &&
        !(await fs.stat(from).catch(() => null))
      ) {
        continue;
      }

      const failures: string[] = [];
      // 回滚：把已经搬过去的原样搬回来
      for (const done of moved.reverse()) {
        try {
          await moveEntry(path.join(dst, done), path.join(src, done));
        } catch {
          failures.push(done);
        }
      }
      const code = (error as NodeJS.ErrnoException).code ?? '';
      const detail = failures.length
        ? `；回滚时这些条目未能复位：${failures.join('、')}，请手动检查两个文件夹`
        : '，已恢复原状';
      throw new Error(`迁移失败：无法移动「${name}」（${code || String(error)}）${detail}`);
    }
  }

  await fs.rmdir(src).catch(() => {});
  const mode = modes.size > 1 ? 'mixed' : ([...modes][0] ?? 'none');
  return { movedEntries: moved.length, movedBytes: bytes, mode };
}

/**
 * 清空目录内容但保留目录本身。
 *
 * 只对带有归属标记的目录动手。单个条目删不掉（被占用等）**只计入 failed**，
 * 不让整个操作失败——缓存清不干净是小事，报错让用户以为出了大问题才是坏体验。
 * @param dir 目录路径。
 * @param kind 目录种类。
 * @returns 释放字节数、删除条目数与失败清单。
 */
export async function clearDirContents(
  dir: string,
  kind: StorageDirKind,
): Promise<ClearCacheResult> {
  const entries = await readdirSafe(dir);
  if (entries.length === 0) return { freedBytes: 0, deleted: 0, failed: [] };
  if (!(await hasMarker(dir, kind))) {
    throw new Error('该文件夹缺少本应用的标记文件，为避免误删已拒绝清空');
  }

  const failed: string[] = [];
  let freedBytes = 0;
  let deleted = 0;
  for (const name of entries) {
    if (name === MARKER_NAME[kind]) continue;
    const full = path.join(dir, name);
    // 先量大小再删，删完就量不到了；目录递归求和，文件直接取 size
    const stat = await fs.stat(full).catch(() => null);
    const size = stat?.isDirectory() ? (await dirUsage(full)).bytes : (stat?.size ?? 0);
    try {
      await fs.rm(full, { recursive: true, force: true });
      freedBytes += size;
      deleted += 1;
    } catch (error) {
      failed.push(`${name}（${(error as NodeJS.ErrnoException).code ?? '未知错误'}）`);
    }
  }
  return { freedBytes, deleted, failed };
}
