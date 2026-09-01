import { type BrowserWindow, dialog, shell } from 'electron';
import { basename, dirname, extname, join } from 'path';
import { readdir, readFile, rename, stat, writeFile } from 'fs/promises';
import { FILE_CHANNELS } from '../../shared/channels';
import type {
  RenameBatchResult,
  RenameConflict,
  RenameDone,
  RenamePair,
  SaveTextOptions,
  ScanFileEntry,
  ScanOptions,
  ScanResult,
} from '../../shared/types';
import { handle } from './helper';

/** 单次扫描的文件数上限，防止误选巨型目录把内存打爆。 */
const DEFAULT_MAX_FILES = 200_000;

/** 进度推送的最小间隔（毫秒）。 */
const PROGRESS_INTERVAL = 300;

/** 进行中的扫描：scanId → 取消标记。 */
const runningScans = new Map<string, { canceled: boolean }>();

/** 遍历过程中累积的状态。 */
interface WalkContext {
  /** 目录路径 → 在 dirs 中的下标。 */
  dirIndexMap: Map<string, number>;
  dirs: string[];
  files: ScanFileEntry[];
  errors: string[];
  dirCount: number;
  truncated: boolean;
  maxFiles: number;
  /** 只收这些扩展名（小写不含点）；null 表示不过滤。 */
  extensions: Set<string> | null;
  /** 上次推送进度的时间戳。 */
  lastNotify: number;
  /** 上次推送进度时的文件数。 */
  lastNotifyCount: number;
}

/**
 * 取文件名的扩展名，小写且不含点。
 * @param name 文件名。
 * @returns 扩展名，无扩展名时为空串。
 */
function extOf(name: string): string {
  return extname(name).replace(/^\./, '').toLowerCase();
}

/**
 * 取得目录在 dirs 表中的下标，不存在则登记。
 * @param context 遍历上下文。
 * @param dir 目录绝对路径。
 * @returns 下标。
 */
function indexOfDir(context: WalkContext, dir: string): number {
  const existing = context.dirIndexMap.get(dir);
  if (existing !== undefined) return existing;
  const index = context.dirs.length;
  context.dirs.push(dir);
  context.dirIndexMap.set(dir, index);
  return index;
}

/**
 * 递归遍历目录，收集文件信息。
 * 单个目录读取失败（权限不足等）只记入 errors 并继续，不中断整体扫描。
 * @param dir 当前目录绝对路径。
 * @param options 扫描选项。
 * @param context 遍历上下文（原地累积）。
 * @param token 取消标记。
 * @param notify 进度推送函数。
 * @param depth 当前深度，根目录为 1。
 */
async function walk(
  dir: string,
  options: ScanOptions,
  context: WalkContext,
  token: { canceled: boolean },
  notify: (scanned: number, currentDir: string) => void,
  depth = 1,
): Promise<void> {
  if (token.canceled || context.truncated) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.errors.push(`${dir}: ${message}`);
    return;
  }

  const ignored = new Set(options.skipIgnoredDirs ? options.ignoreDirs : []);
  const subDirs: string[] = [];
  const fileNames: string[] = [];

  for (const entry of entries) {
    if (!options.includeHidden && entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      if (ignored.has(entry.name)) continue;
      subDirs.push(join(dir, entry.name));
      continue;
    }
    // 符号链接不下探（可能指向目录并形成环），也不计入文件统计
    if (!entry.isFile()) continue;

    // 扩展名过滤放在计数之前：maxFiles 应当是「要的文件」的上限，而不是「路过的文件」
    if (context.extensions && !context.extensions.has(extOf(entry.name))) continue;

    if (context.files.length + fileNames.length >= context.maxFiles) {
      context.truncated = true;
      break;
    }
    fileNames.push(entry.name);
  }

  if (token.canceled) return;

  // 同目录内并行 stat：大目录下比逐个 await 快得多
  const dirIndex = fileNames.length ? indexOfDir(context, dir) : -1;
  const stated = await Promise.all(
    fileNames.map(async (name): Promise<ScanFileEntry | string> => {
      const fullPath = join(dir, name);
      try {
        const info = await stat(fullPath);
        return {
          name,
          dirIndex,
          size: info.size,
          mtime: info.mtimeMs,
          ext: extOf(name),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `${fullPath}: ${message}`;
      }
    }),
  );
  for (const item of stated) {
    if (typeof item === 'string') {
      context.errors.push(item);
    } else {
      context.files.push(item);
    }
  }

  const now = Date.now();
  if (
    now - context.lastNotify >= PROGRESS_INTERVAL ||
    context.files.length - context.lastNotifyCount >= 2000
  ) {
    context.lastNotify = now;
    context.lastNotifyCount = context.files.length;
    notify(context.files.length, dir);
  }

  // maxDepth 到顶就不再下探；子目录已收集但不遍历，dirCount 也不该把它们算进去
  if (options.maxDepth !== undefined && depth >= options.maxDepth) return;

  for (const sub of subDirs) {
    if (token.canceled || context.truncated) return;
    context.dirCount += 1;
    await walk(sub, options, context, token, notify, depth + 1);
  }
}

/**
 * 扫描目录并汇总文件信息。
 * @param win 用于推送进度的窗口。
 * @param options 扫描选项。
 * @returns 扫描结果（含截断/取消标记与错误列表）。
 */
async function scanDirectory(win: BrowserWindow, options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const token = { canceled: false };
  runningScans.set(options.scanId, token);

  const context: WalkContext = {
    dirIndexMap: new Map(),
    dirs: [],
    files: [],
    errors: [],
    dirCount: 0,
    truncated: false,
    maxFiles: options.maxFiles && options.maxFiles > 0 ? options.maxFiles : DEFAULT_MAX_FILES,
    extensions: options.extensions?.length
      ? new Set(options.extensions.map((ext) => ext.replace(/^\./, '').toLowerCase()))
      : null,
    lastNotify: 0,
    lastNotifyCount: 0,
  };

  /** 向渲染进程推送进度（窗口已销毁时静默跳过）。 */
  const notify = (scanned: number, currentDir: string): void => {
    if (win.isDestroyed()) return;
    win.webContents.send(FILE_CHANNELS.scanProgress, {
      scanId: options.scanId,
      scanned,
      currentDir,
    });
  };

  try {
    await walk(options.root, options, context, token, notify);
  } finally {
    runningScans.delete(options.scanId);
  }

  return {
    root: options.root,
    dirs: context.dirs,
    files: context.files,
    dirCount: context.dirCount,
    elapsed: Date.now() - started,
    truncated: context.truncated,
    canceled: token.canceled,
    errors: context.errors.slice(0, 50),
  };
}

/**
 * 将文本保存到用户选择的路径。
 * @param win 父窗口。
 * @param options 保存选项。
 * @returns 写入的文件路径；用户取消返回 null。
 */
async function saveText(win: BrowserWindow, options: SaveTextOptions): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: options.defaultName,
    filters: options.filters,
  });
  if (canceled || !filePath) return null;
  // CSV 无 BOM 时 Excel 会按本地编码解析导致中文乱码
  const content = options.bom ? `﻿${options.content}` : options.content;
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Windows 文件名中的非法字符（含控制字符）。
 * `/` 与 `\` 也在内：重命名不允许跨目录，带分隔符一律拒绝。
 */

const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/** Windows 保留设备名（连同任意扩展名一起保留，`CON.txt` 同样非法）。 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** 目标全路径长度上限（超出 MAX_PATH 时报错信息很不友好，自己先拦）。 */
const MAX_PATH_LENGTH = 259;

/** 两趟改名的中间名后缀。 */
const TEMP_SUFFIX = '.tbtmp-';

/**
 * 路径的大小写无关比较键。
 * Windows 文件系统不区分大小写，`a.txt` 与 `A.TXT` 是同一个文件，
 * 判重与「目标是否就是源自己」都必须按这个键比。
 * @param path 绝对路径。
 * @returns 比较键。
 */
function pathKey(path: string): string {
  return path.toLowerCase();
}

/**
 * 校验单个新文件名本身是否合法（与磁盘状态无关的部分）。
 * @param newName 新文件名。
 * @param targetPath 目标全路径。
 * @returns 不合法时返回原因，合法返回空串。
 */
function checkName(newName: string, targetPath: string): string {
  if (!newName) return '新文件名为空';
  if (INVALID_NAME_CHARS.test(newName)) return '含非法字符 < > : " / \\ | ? *';
  // 结尾的点与空格会被 Windows 悄悄吃掉，改出来的名字与预览不符
  if (/[. ]$/.test(newName)) return '不能以点或空格结尾';
  const base = newName.replace(/\.[^.]*$/, '');
  if (RESERVED_NAMES.has(base.toLowerCase())) return `${base} 是系统保留名`;
  if (targetPath.length > MAX_PATH_LENGTH) return `目标路径过长（${targetPath.length} 字符）`;
  return '';
}

/**
 * 判断路径当前是否存在。
 * @param path 绝对路径。
 * @returns 是否存在。
 */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** pre-flight 通过后的一项。 */
interface PlannedRename {
  from: string;
  to: string;
}

/**
 * 批量重命名的落盘前校验。
 *
 * 全部通过才允许动手：只要有一项不合法就整批不执行，
 * 而不是「改到一半发现冲突」——重命名不可逆，半成品状态最难收拾。
 * @param pairs 重命名请求。
 * @returns 通过的计划与被拦下的冲突。
 */
async function preflight(
  pairs: RenamePair[],
): Promise<{ planned: PlannedRename[]; conflicts: RenameConflict[] }> {
  const conflicts: RenameConflict[] = [];
  const planned: PlannedRename[] = [];

  /** 本批全部源路径，用于判断「目标其实是本批某个源」。 */
  const sourceKeys = new Set(pairs.map((p) => pathKey(p.path)));
  /** 已占用的目标路径，查批内自相撞。 */
  const targetKeys = new Set<string>();

  for (const pair of pairs) {
    const dir = dirname(pair.path);
    const to = join(dir, pair.newName);

    const nameIssue = checkName(pair.newName, to);
    if (nameIssue) {
      conflicts.push({ path: pair.path, newName: pair.newName, reason: nameIssue });
      continue;
    }

    const key = pathKey(to);
    if (targetKeys.has(key)) {
      conflicts.push({ path: pair.path, newName: pair.newName, reason: '与批内另一项重名' });
      continue;
    }
    targetKeys.add(key);

    // 源不在了就没法改（用户添加列表后文件被别的程序移走）
    if (!(await exists(pair.path))) {
      conflicts.push({ path: pair.path, newName: pair.newName, reason: '源文件已不存在' });
      continue;
    }

    // 目标已存在时，只有两种情况不算冲突：
    //   1. 目标就是它自己 —— foo.txt → FOO.txt 的大小写修正，NTFS 下 exists 必然为 true
    //   2. 目标是本批某个源 —— 那个文件待会儿会被改走，两趟改名能处理
    if (key !== pathKey(pair.path) && !sourceKeys.has(key) && (await exists(to))) {
      conflicts.push({
        path: pair.path,
        newName: pair.newName,
        reason: '目标文件已存在（会覆盖）',
      });
      continue;
    }

    planned.push({ from: pair.path, to });
  }

  return { planned, conflicts };
}

/**
 * 批量重命名：pre-flight 全过才执行，存在循环时走两趟。
 * @param pairs 重命名请求。
 * @returns 执行结果。
 */
async function renameBatch(pairs: RenamePair[]): Promise<RenameBatchResult> {
  const { planned, conflicts } = await preflight(pairs);
  if (conflicts.length > 0) {
    // 一个文件都不碰
    return { done: [], conflicts, failures: [], twoPhase: false };
  }

  // 有目标撞在本批某个源上（a→b 且 b→a，或 a→b→c 的链），单趟必然覆盖掉一个
  const sourceKeys = new Set(planned.map((p) => pathKey(p.from)));
  const twoPhase = planned.some(
    (p) => pathKey(p.to) !== pathKey(p.from) && sourceKeys.has(pathKey(p.to)),
  );

  const done: RenameDone[] = [];
  const failures: RenameConflict[] = [];

  if (!twoPhase) {
    for (const item of planned) {
      try {
        await rename(item.from, item.to);
        done.push({ from: item.from, to: item.to });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ path: item.from, newName: basename(item.to), reason: message });
      }
    }
    return { done, conflicts: [], failures, twoPhase };
  }

  // 第一趟：全部改成临时名，把循环拆开
  const staged: Array<{ original: string; temp: string; to: string }> = [];
  for (const [index, item] of planned.entries()) {
    const temp = `${item.from}${TEMP_SUFFIX}${index}`;
    try {
      await rename(item.from, temp);
      staged.push({ original: item.from, temp, to: item.to });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: item.from, newName: basename(item.to), reason: message });
    }
  }

  // 第二趟：临时名 → 目标名。失败的尽力回滚到原名，别把文件留在 .tbtmp- 状态
  for (const item of staged) {
    try {
      await rename(item.temp, item.to);
      done.push({ from: item.original, to: item.to });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: item.original, newName: basename(item.to), reason: message });
      try {
        await rename(item.temp, item.original);
      } catch {
        // 回滚也失败只能作罢，上面的 failures 已如实记录
      }
    }
  }

  return { done, conflicts: [], failures, twoPhase };
}

/**
 * 注册文件统计相关 IPC。
 * @param win 关联的主窗口，用于进度推送与保存对话框定位。
 */
export function registerFileIpc(win: BrowserWindow): void {
  handle(FILE_CHANNELS.scan, (_e, options: ScanOptions) => scanDirectory(win, options));

  handle(FILE_CHANNELS.cancelScan, (_e, scanId: string) => {
    const token = runningScans.get(scanId);
    if (token) token.canceled = true;
    return token !== undefined;
  });

  handle(FILE_CHANNELS.showInFolder, (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  handle(FILE_CHANNELS.saveText, (_e, options: SaveTextOptions) => saveText(win, options));

  handle(FILE_CHANNELS.readText, (_e, filePath: string) => readFile(filePath, 'utf-8'));

  handle(FILE_CHANNELS.renameBatch, (_e, pairs: RenamePair[]) => renameBatch(pairs));
}
