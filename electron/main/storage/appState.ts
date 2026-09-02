/**
 * 应用状态（主题 / 各工具上次配置 / 使用统计）的落盘：数据保存目录下的
 * `app-state.json`。
 *
 * 只用**一个文件**存全部命名空间：迁移时只需搬这一个文件，也不会出现多文件半新
 * 半旧的状态。渲染进程启动时整体读一次，之后按命名空间防抖合并写回。
 */
import fs from 'node:fs/promises';
import type { AppStateBlob } from '../../shared/types';
import { dataPath, ensureDataDir, setWriteSuspender } from './paths';

/** 状态文件名。 */
const FILE_NAME = 'app-state.json';
/** 当前结构版本。 */
const VERSION = 1;

/** 内存中的状态副本，读过一次之后以它为准。 */
let cache: AppStateBlob | null = null;
/** 迁移期间挂起写盘。 */
let suspended = false;
/** 挂起期间是否累积了未写盘的改动。 */
let dirty = false;
/** 写盘串行化，避免两次写互相盖成半个文件。 */
let chain: Promise<unknown> = Promise.resolve();

/**
 * 状态文件的绝对路径。**每次都重新取**——数据目录可能刚被用户改过。
 * @returns 文件路径。
 */
function stateFile(): string {
  return dataPath(FILE_NAME);
}

/**
 * 读取状态。文件缺失或损坏都返回空 blob，不抛错（不该因为一份配置读不出就打不开应用）。
 * @returns 状态 blob。
 */
export async function readAppState(): Promise<AppStateBlob> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile(), 'utf-8')) as AppStateBlob;
    const entries =
      typeof parsed.entries === 'object' && parsed.entries !== null ? parsed.entries : {};
    cache = { version: typeof parsed.version === 'number' ? parsed.version : VERSION, entries };
  } catch {
    cache = { version: VERSION, entries: {} };
  }
  return cache;
}

/**
 * 把内存副本原子写盘（临时文件 + rename）。
 */
async function flushToDisk(): Promise<void> {
  const blob = cache ?? { version: VERSION, entries: {} };
  await ensureDataDir();
  const file = stateFile();
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(blob, null, 2), 'utf-8');
  // 实测 Windows 下 rename 覆盖已存在的文件是允许的，所以这一步是原子替换
  await fs.rename(tmp, file);
  dirty = false;
}

/**
 * 按命名空间合并写入。
 * @param patch 命名空间 → 值；只覆盖传入的键，其余保持不变。
 * @returns 是否已落盘（迁移期间为 false，改动留在内存待迁移结束后写出）。
 */
export async function writeAppState(patch: Record<string, unknown>): Promise<boolean> {
  const blob = await readAppState();
  Object.assign(blob.entries, patch);
  blob.version = VERSION;
  dirty = true;

  if (suspended) return false;
  chain = chain.then(flushToDisk, flushToDisk);
  await chain;
  return true;
}

/**
 * 注册迁移期间的挂起钩子。
 *
 * 迁移正在逐个搬条目时若有防抖写落下来，要么写进正在消失的旧目录，要么撞上搬迁
 * 中的文件。这里的做法是**改动照样合并进内存，只是不写盘**，迁移结束后统一写到
 * 新目录——一条都不丢。
 *
 * `suspend` 会 await 当前写盘队列：光把开关拨过去还不够，此刻可能正有一次写盘停在
 * 「临时文件已写好、还没 rename」的中间态，搬迁一列目录就会看到那个临时文件。
 */
export function registerAppStateSuspender(): void {
  setWriteSuspender({
    suspend: async () => {
      suspended = true;
      await chain.catch(() => {});
    },
    resume: () => {
      suspended = false;
      if (dirty) {
        chain = chain.then(flushToDisk, flushToDisk);
      }
    },
  });
}
