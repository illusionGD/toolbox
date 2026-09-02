/**
 * 路径设置本身的持久化：`<userData>/settings.json`（Windows 下即 `%APPDATA%\Toolbox`）。
 *
 * **不能存进数据保存目录**——它就是指向数据目录的指针，放进去等于自己指自己：
 * 用户改完路径重启后，新位置里没有指针，只能回到默认值，改动直接丢失。
 * 只记录被用户显式改过的值，没记录就走默认，这样默认值将来变了也能跟着变。
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';

/** settings.json 里的可持久化字段。 */
export interface StorageSettings {
  /** 用户显式设置的缓存目录；未设置为 undefined。 */
  cacheDir?: string;
  /** 用户显式设置的数据保存目录；未设置为 undefined。 */
  dataDir?: string;
}

/** 内存中的设置副本。启动时同步读一次，之后以内存为准。 */
let cache: StorageSettings | null = null;

/**
 * settings.json 的绝对路径。
 * @returns 文件路径。
 */
function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * 读取路径设置。文件缺失或损坏都当作「没有任何显式设置」，不抛错。
 * 同步读：内容极小（两个字符串），而且必须在建窗口前拿到结果。
 * @returns 设置对象。
 */
export function readStorageSettings(): StorageSettings {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf-8')) as StorageSettings;
    cache = {
      cacheDir: typeof parsed.cacheDir === 'string' ? parsed.cacheDir : undefined,
      dataDir: typeof parsed.dataDir === 'string' ? parsed.dataDir : undefined,
    };
  } catch {
    cache = {};
  }
  return cache;
}

/**
 * 写入路径设置（临时文件 + rename，避免半个文件）。
 * @param patch 要合并的字段；显式传 undefined 表示清除该项（恢复默认）。
 */
export function writeStorageSettings(patch: StorageSettings): void {
  const next: StorageSettings = { ...readStorageSettings(), ...patch };
  if (!next.cacheDir) delete next.cacheDir;
  if (!next.dataDir) delete next.dataDir;

  const file = settingsFile();
  const tmp = `${file}.tmp-${process.pid}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  // 实测 Windows 下 rename 覆盖已存在的**文件**是允许的（覆盖目录才报 EPERM）
  renameSync(tmp, file);
  cache = next;
}
