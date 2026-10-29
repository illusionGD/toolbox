import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { dataPath } from '../storage/paths';
import type { PluginDevelopment, PluginStorageInfo } from '../../shared/plugins/types';
import { readBundle, type PluginBundle } from './package';
import {
  candidateBundle,
  discardCandidate,
  installedBundle,
  listPlugins,
  logPlugin,
  pluginTransaction,
  stageBundle,
  stopPlugins,
  onPluginsStop,
  notifyPluginsChanged,
} from './registry';

interface DevelopmentSession {
  info: PluginDevelopment;
  watcher: FSWatcher;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  dirty: boolean;
  active: boolean;
}
const sessions = new Map<string, DevelopmentSession>();

/** @param bundle 已校验快照。 @returns 可重新导入的 ZIP，不包含权限或数据。 */
export async function packPlugin(bundle: PluginBundle): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, bytes] of bundle.files) zip.file(name, bytes);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (bytes.length > 20 * 1024 * 1024) throw new Error('导出包超过 20 MB');
  return bytes;
}

/** @param source 插件 ID 或候选令牌。 @returns 不可执行的导出快照。 */
export async function exportPluginBundle(source: {
  id?: string;
  token?: string;
}): Promise<PluginBundle> {
  if (source.token) return candidateBundle(source.token);
  const record = listPlugins().find((item) => item.manifest.id === source.id);
  if (!record) throw new Error('插件不存在');
  return installedBundle(record);
}

/** @returns 已安装和已卸载插件保留的 storage 文件。 */
export async function pluginStorageInfo(): Promise<PluginStorageInfo[]> {
  const records = listPlugins();
  const dir = dataPath('plugins', 'storage');
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  const result: PluginStorageInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-z][a-z0-9-]{0,29}\.[a-z][a-z0-9-]{0,39}\.json$/.test(entry.name))
      continue;
    const id = entry.name.slice(0, -5);
    const record = records.find((item) => item.manifest.id === id);
    const stat = await fs.lstat(path.join(dir, entry.name));
    if (stat.isSymbolicLink()) continue;
    result.push({
      id,
      name: record?.manifest.name ?? id,
      installed: Boolean(record),
      bytes: stat.size,
    });
  }
  return result;
}

/** @param id 用户确认清理的插件；仅删除精确匹配的单个 storage 文件。 */
export async function clearPluginStorage(id: string): Promise<void> {
  if (!/^[a-z][a-z0-9-]{0,29}\.[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('非法插件 ID');
  stopPlugins(id);
  await pluginTransaction(async () => {
    stopPlugins(id);
    await fs
      .unlink(dataPath('plugins', 'storage', id + '.json'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
  });
  logPlugin(id, '用户已清理插件数据');
}

/** @returns 当前开发监听状态。 */
export function developmentSessions(): PluginDevelopment[] {
  return [...sessions.values()].map((session) => ({ ...session.info }));
}

/** @param id 监听 ID；停止后保留最后可审阅草稿。 */
export function stopDevelopment(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.active = false;
  clearTimeout(session.timer);
  session.watcher.close();
  sessions.delete(id);
  notifyPluginsChanged();
}

async function refreshDevelopment(session: DevelopmentSession): Promise<void> {
  if (!session.active) return;
  if (session.running) {
    session.dirty = true;
    return;
  }
  session.running = true;
  session.dirty = false;
  try {
    const bundle = await readBundle(session.info.directory);
    if (!session.active) return;
    // 先完整校验，再用新令牌替换旧草稿；旧安装版和其权限均不变化。
    const candidate = await stageBundle(bundle, undefined, session.info.token);
    if (!session.active) return;
    session.info.token = candidate.token;
    session.info.updatedAt = new Date().toISOString();
    session.info.error = '';
  } catch (error) {
    session.info.error = String(error);
  } finally {
    session.running = false;
    notifyPluginsChanged();
    if (session.dirty && session.active)
      session.timer = setTimeout(() => void refreshDevelopment(session), 350);
  }
}

/** @param directory 用户通过宿主对话框选择的开发目录。 @returns 监听状态与草稿令牌。 */
export async function startDevelopment(directory: string): Promise<PluginDevelopment> {
  const canonical = await fs.realpath(directory);
  if (sessions.size >= 4) throw new Error('最多监听 4 个开发目录');
  if ([...sessions.values()].some((item) => item.info.directory === canonical))
    throw new Error('目录已在监听');
  const candidate = await stageBundle(await readBundle(canonical));
  let session: DevelopmentSession;
  try {
    const watcher = watch(canonical, { recursive: true }, () => {
      if (!session?.active) return;
      clearTimeout(session.timer);
      session.timer = setTimeout(() => void refreshDevelopment(session), 350);
    });
    session = {
      info: {
        id: randomUUID(),
        directory: canonical,
        token: candidate.token,
        updatedAt: new Date().toISOString(),
        error: '',
      },
      watcher,
      active: true,
      running: false,
      dirty: false,
    };
    watcher.on('error', (error) => {
      session.info.error = String(error);
      watcher.close();
      notifyPluginsChanged();
    });
    sessions.set(session.info.id, session);
    notifyPluginsChanged();
    return { ...session.info };
  } catch (error) {
    await discardCandidate(candidate.token);
    throw error;
  }
}

onPluginsStop((id) => {
  if (!id) for (const key of sessions.keys()) stopDevelopment(key);
});
