import type {
  AppPathsInfo,
  ClearCacheResult,
  DirUsage,
  MigrateResult,
  StorageDirKind,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * 存储路径服务：封装 window.api.storage，供设置页调用。
 * 目录选择沿用 [pickDirectoryApi]{@link ../services/fs} ，这里只管路径本身的读写。
 */

/**
 * 读当前生效路径、默认路径与回退情况。
 * @returns 路径信息。
 */
export function getStoragePathsApi(): Promise<AppPathsInfo> {
  return unwrap(window.api.storage.getPaths(), { errorPrefix: '读取存储路径失败' });
}

/**
 * 统计某个目录的占用。失败静默：只影响页面上一行读数，不该弹错。
 * @param kind 目录种类。
 * @returns 字节数与文件数。
 */
export function dirUsageApi(kind: StorageDirKind): Promise<DirUsage> {
  return unwrap(window.api.storage.dirUsage(kind), { silent: true });
}

/**
 * 更改数据保存目录并迁移现有数据。
 * @param target 目标目录绝对路径。
 * @returns 迁移结果。
 */
export function setDataDirApi(target: string): Promise<MigrateResult> {
  return unwrap(window.api.storage.setDataDir(target), { errorPrefix: '迁移数据失败' });
}

/**
 * 更改数据缓存目录（不迁移，清空旧目录）。
 * @param target 目标目录绝对路径。
 * @returns 旧目录释放的字节数。
 */
export function setCacheDirApi(target: string): Promise<number> {
  return unwrap(window.api.storage.setCacheDir(target), { errorPrefix: '更改缓存目录失败' });
}

/**
 * 恢复某个目录为默认值。
 * @param kind 目录种类。
 * @returns 迁移结果（数据目录）或释放字节数（缓存目录）。
 */
export function resetStorageDirApi(kind: StorageDirKind): Promise<MigrateResult | number> {
  return unwrap(window.api.storage.resetDir(kind), { errorPrefix: '恢复默认路径失败' });
}

/**
 * 清空缓存目录内容。
 * @returns 释放字节数、删除条目数与失败清单。
 */
export function clearCacheApi(): Promise<ClearCacheResult> {
  return unwrap(window.api.storage.clearCache(), { errorPrefix: '清空缓存失败' });
}

/**
 * 在系统文件管理器中打开某个目录。
 * @param kind 目录种类。
 * @returns 是否成功。
 */
export function openStorageDirApi(kind: StorageDirKind): Promise<boolean> {
  return unwrap(window.api.storage.openDir(kind), { errorPrefix: '打开文件夹失败' });
}
