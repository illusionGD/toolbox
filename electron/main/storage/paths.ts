/**
 * 应用存储路径的唯一来源。
 *
 * **后续任何需要落盘的功能都只经这里取路径**（`cachePath()` / `dataPath()`），
 * 不要再自己拼 `app.getPath(...)`：路径可被用户更改并迁移，绕过这里的代码在用户
 * 改完路径后会继续写老地方。
 *
 * 两个目录的定位：
 * - **缓存目录**（可丢弃）：默认 `%TEMP%\Toolbox`。实测 `app.getPath('temp')` 就是
 *   `%LOCALAPPDATA%\Temp`，正是 Windows 磁盘清理 / 存储感知会清的地方，符合「方便
 *   系统一起清理」。**不用 `app.getPath('cache')`**——实测它在 Windows 上等于
 *   `%APPDATA%`（Roaming），系统根本不清。
 * - **数据目录**（要保住）：默认安装目录下的 `data`，可改、改后迁移。
 */
import { app } from 'electron';
import path from 'node:path';
import type {
  AppPathsInfo,
  MigrateResult,
  StorageDirKind,
  StorageFallback,
} from '../../shared/types';
import { readStorageSettings, writeStorageSettings } from './settings';
import {
  assertUsableTarget,
  clearDirContents,
  moveDirContents,
  probeWritable,
  writeMarker,
} from './dirs';

/** 缓存与数据目录共用的子目录名（挂在安装目录/临时目录下）。 */
const DIR_NAME = 'Toolbox';

/** 当前生效的缓存目录。initStoragePaths 之前不可用。 */
let cacheDir = '';
/** 当前生效的数据目录。initStoragePaths 之前不可用。 */
let dataDir = '';
/** 缓存目录回退说明。 */
let cacheFallback: StorageFallback | null = null;
/** 数据目录回退说明。 */
let dataFallback: StorageFallback | null = null;

/**
 * 是否 portable（免安装）运行。
 * portable 版的 exe 每次都自解压到临时目录再启动，`app.getPath('exe')` 指向的是那个
 * 临时副本，数据写进去下次运行就没了，必须改用 electron-builder 注入的
 * `PORTABLE_EXECUTABLE_DIR`（真正双击的那个 exe 所在目录）。
 * @returns portable 运行时为 true。
 */
function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

/**
 * 缓存目录默认值。
 * @returns 系统临时目录下的 Toolbox。
 */
function defaultCacheDir(): string {
  return path.join(app.getPath('temp'), DIR_NAME);
}

/**
 * 数据目录默认值：打包后为安装目录下的 data，开发时为仓库根目录下的 data。
 * @returns 默认数据目录。
 */
function defaultDataDir(): string {
  const base = app.isPackaged
    ? (process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(app.getPath('exe')))
    : app.getAppPath();
  return path.join(base, 'data');
}

/**
 * 数据目录不可写时的兜底位置：`%APPDATA%\Toolbox\data`，用户目录一定可写。
 * @returns 兜底数据目录。
 */
function fallbackDataDir(): string {
  return path.join(app.getPath('userData'), 'data');
}

/**
 * 解析一个目录：可写就用它，不可写则回退并记录原因。
 * @param wanted 期望目录。
 * @param fallback 兜底目录。
 * @returns 实际目录与回退说明。
 */
async function resolveWritable(
  wanted: string,
  fallback: string,
): Promise<{ dir: string; fallback: StorageFallback | null }> {
  const reason = await probeWritable(wanted);
  if (!reason) return { dir: wanted, fallback: null };
  if (path.resolve(wanted) === path.resolve(fallback)) {
    // 连兜底都写不进去也不拦启动：渲染进程会降级到 localStorage 并在设置页提示
    return { dir: fallback, fallback: { requested: wanted, reason } };
  }
  await probeWritable(fallback);
  return { dir: fallback, fallback: { requested: wanted, reason } };
}

/**
 * 启动时解析两个目录并建好目录与归属标记。**必须在建窗口之前 await**，
 * 否则渲染进程第一次读状态时路径还没定下来。
 *
 * **本函数不抛错**：它 await 在 `createWindow()` 之前，一抛错就没有任何窗口被创建，
 * 进程静默退出，用户看到的是双击图标毫无反应。任何意外都退到 userData 下的固定位置，
 * 渲染进程那边会降级并在设置页提示。
 */
export async function initStoragePaths(): Promise<void> {
  try {
    const settings = readStorageSettings();

    const cache = await resolveWritable(settings.cacheDir ?? defaultCacheDir(), defaultCacheDir());
    cacheDir = cache.dir;
    cacheFallback = cache.fallback;

    const data = await resolveWritable(settings.dataDir ?? defaultDataDir(), fallbackDataDir());
    dataDir = data.dir;
    dataFallback = data.fallback;

    // 归属标记是「清空缓存」等递归删除的前提，越早写上越好；写不进去就算了
    await writeMarker(cacheDir, 'cache').catch(() => {});
    await writeMarker(dataDir, 'data').catch(() => {});

    console.log(`[storage] cache=${cacheDir}`);
    console.log(
      `[storage] data=${dataDir}${dataFallback ? ` (回退，原因 ${dataFallback.reason})` : ''}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const userData = app.getPath('userData');
    cacheDir = cacheDir || path.join(userData, 'cache');
    dataDir = dataDir || path.join(userData, 'data');
    dataFallback = dataFallback ?? { requested: '', reason };
    console.error('[storage] 路径初始化失败，已退到 userData 下：', error);
  }
}

/**
 * 当前缓存目录。
 * @returns 绝对路径。
 */
export function getCacheDir(): string {
  return cacheDir;
}

/**
 * 当前数据目录。
 * @returns 绝对路径。
 */
export function getDataDir(): string {
  return dataDir;
}

/**
 * 拼一个缓存目录下的路径（可丢弃数据用这个）。
 * @param segments 相对片段。
 * @returns 绝对路径。
 */
export function cachePath(...segments: string[]): string {
  return path.join(cacheDir, ...segments);
}

/**
 * 拼一个数据目录下的路径（要保住的数据用这个）。
 * @param segments 相对片段。
 * @returns 绝对路径。
 */
export function dataPath(...segments: string[]): string {
  return path.join(dataDir, ...segments);
}

/**
 * 确保缓存目录存在（用户可能在运行期间把它删了，比如跑了磁盘清理）。
 * @returns 缓存目录路径。
 */
export async function ensureCacheDir(): Promise<string> {
  await writeMarker(cacheDir, 'cache').catch(() => {});
  return cacheDir;
}

/**
 * 确保数据目录存在。
 * @returns 数据目录路径。
 */
export async function ensureDataDir(): Promise<string> {
  await writeMarker(dataDir, 'data').catch(() => {});
  return dataDir;
}

/**
 * 供设置页展示的完整路径信息。
 * @returns 路径信息。
 */
export function getPathsInfo(): AppPathsInfo {
  const settings = readStorageSettings();
  return {
    cacheDir,
    dataDir,
    defaultCacheDir: defaultCacheDir(),
    defaultDataDir: defaultDataDir(),
    cacheDirCustom: Boolean(settings.cacheDir),
    dataDirCustom: Boolean(settings.dataDir),
    cacheDirFallback: cacheFallback,
    dataDirFallback: dataFallback,
    portable: isPortable(),
  };
}

/** 迁移进行中时挂起状态写入的回调，由 appState 注册，避免两个模块循环引用。 */
let writeSuspender: { suspend: () => void | Promise<void>; resume: () => void } | null = null;

/**
 * 注册「迁移期间挂起状态写入」的钩子。
 * @param hooks 挂起与恢复回调。`suspend` 可以返回 Promise，用来等在途的写盘落完。
 */
export function setWriteSuspender(hooks: {
  suspend: () => void | Promise<void>;
  resume: () => void;
}): void {
  writeSuspender = hooks;
}

/**
 * 更改数据保存目录并把现有数据迁移过去。
 *
 * 顺序很讲究：**先挂起写入、再校验、搬完成功了才改指针**。
 * - 挂起要在校验**之前**：校验本身要做磁盘 I/O（探测可写、列目录），这段时间里任何
 *   一次状态写盘都会落进即将被搬走的旧目录，甚至让搬迁撞上一个正在被 rename 的
 *   临时文件（实测报 ENOENT 并触发整批回滚）。
 * - 指针要在**搬完之后**才写：反过来一旦搬到一半失败，指针已指向新目录而数据还在
 *   旧目录，下次启动就是一个空应用。
 * @param target 目标目录（绝对路径）。
 * @param explicit 是否记为用户显式设置（恢复默认时传 false）。
 * @returns 迁移结果。
 */
export async function changeDataDir(target: string, explicit = true): Promise<MigrateResult> {
  const resolved = path.resolve(target);

  await writeSuspender?.suspend();
  try {
    await assertUsableTarget(resolved, dataDir, 'data');
    await writeMarker(resolved, 'data');
    const moved = await moveDirContents(dataDir, resolved);
    dataDir = resolved;
    // 之前的回退是针对旧路径的判断，换了目录就不再适用
    dataFallback = null;
    writeStorageSettings({ dataDir: explicit ? resolved : undefined });
    return { dataDir: resolved, ...moved };
  } finally {
    writeSuspender?.resume();
  }
}

/**
 * 更改缓存目录。缓存是可丢弃数据，**不迁移**：切到新目录后把旧目录清空。
 * @param target 目标目录（绝对路径）。
 * @param explicit 是否记为用户显式设置。
 * @returns 旧目录释放的字节数。
 */
export async function changeCacheDir(target: string, explicit = true): Promise<number> {
  const resolved = path.resolve(target);
  await assertUsableTarget(resolved, cacheDir, 'cache');

  await writeMarker(resolved, 'cache');
  const previous = cacheDir;
  cacheDir = resolved;
  cacheFallback = null;
  writeStorageSettings({ cacheDir: explicit ? resolved : undefined });

  // 旧缓存清掉，避免白占空间；不是我们的目录或删不掉都无所谓
  const freed = await clearDirContents(previous, 'cache').catch(() => ({ freedBytes: 0 }));
  return freed.freedBytes;
}

/**
 * 恢复某个目录为默认值。除了切回默认路径，还会清掉 settings.json 里的显式设置，
 * 这样以后默认值变了（比如换了安装位置）也能跟着走。
 * @param kind 目录种类。
 * @returns 数据目录返回迁移结果，缓存目录返回释放字节数。
 */
export async function resetStorageDir(kind: StorageDirKind): Promise<MigrateResult | number> {
  if (kind === 'cache') {
    const target = defaultCacheDir();
    if (path.resolve(target) === path.resolve(cacheDir)) {
      writeStorageSettings({ cacheDir: undefined });
      return 0;
    }
    return changeCacheDir(target, false);
  }

  const target = defaultDataDir();
  if (path.resolve(target) === path.resolve(dataDir)) {
    writeStorageSettings({ dataDir: undefined });
    return { dataDir, movedEntries: 0, movedBytes: 0, mode: 'none' };
  }
  return changeDataDir(target, false);
}
