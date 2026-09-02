import { shell } from 'electron';
import { APP_STATE_CHANNELS, STORAGE_CHANNELS } from '../../shared/channels';
import type { StorageDirKind } from '../../shared/types';
import { handle } from './helper';
import { clearDirContents, dirUsage } from '../storage/dirs';
import {
  changeCacheDir,
  changeDataDir,
  ensureCacheDir,
  getCacheDir,
  getDataDir,
  getPathsInfo,
  resetStorageDir,
} from '../storage/paths';
import { readAppState, writeAppState } from '../storage/appState';

/**
 * 按种类取当前目录。
 * @param kind 目录种类。
 * @returns 绝对路径。
 */
function dirOf(kind: StorageDirKind): string {
  return kind === 'cache' ? getCacheDir() : getDataDir();
}

/**
 * 注册存储路径与应用状态 IPC。
 * 路径必须先经 initStoragePaths 解析，注册时机在其之后。
 */
export function registerStorageIpc(): void {
  handle(STORAGE_CHANNELS.getPaths, () => getPathsInfo());

  handle(STORAGE_CHANNELS.dirUsage, (_event, kind: StorageDirKind) => dirUsage(dirOf(kind)));

  handle(STORAGE_CHANNELS.setDataDir, (_event, target: string) => changeDataDir(target));

  handle(STORAGE_CHANNELS.setCacheDir, (_event, target: string) => changeCacheDir(target));

  handle(STORAGE_CHANNELS.resetDir, (_event, kind: StorageDirKind) => resetStorageDir(kind));

  handle(STORAGE_CHANNELS.clearCache, async () => {
    // 用户可能刚跑过磁盘清理，目录连标记一起没了，先补回来再清
    await ensureCacheDir();
    return clearDirContents(getCacheDir(), 'cache');
  });

  handle(STORAGE_CHANNELS.openDir, async (_event, kind: StorageDirKind) => {
    const dir = dirOf(kind);
    // openPath 打开目录本身；file:showInFolder 是「选中某一项」，用途不同
    const error = await shell.openPath(dir);
    if (error) throw new Error(`打开文件夹失败：${error}`);
    return true;
  });

  handle(APP_STATE_CHANNELS.read, () => readAppState());

  handle(APP_STATE_CHANNELS.write, (_event, patch: Record<string, unknown>) =>
    writeAppState(patch),
  );
}
