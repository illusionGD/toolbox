import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataPath, setWriteSuspender } from '../storage/paths';
import { parseManifest } from '../../shared/plugins/validation';
import type {
  PluginCandidate,
  PluginLog,
  PluginPermission,
  PluginRecord,
} from '../../shared/plugins/types';
import { fileHash, readBundle, writeBundle, type PluginBundle } from './package';

let records: PluginRecord[] = [];
let queue = Promise.resolve();
let draftQueue = Promise.resolve();
let suspended = false;
let ready = false;
const candidates = new Map<
  string,
  { bundle: PluginBundle; baseRevision?: string; info: PluginCandidate }
>();
const logs = new Map<string, PluginLog[]>();
const listeners = new Set<() => void>();
const stoppers = new Set<(pluginId?: string) => void>();

/** 通知宿主刷新插件及开发会话列表。 */
export function notifyPluginsChanged(): void {
  for (const notify of listeners) notify();
}

/** 运行入口统一检查数据迁移与初始化状态。 */
export function assertPluginStorageReady(): void {
  if (!ready || suspended) throw new Error('插件存储尚未就绪或正在迁移');
}

/** @param fn 变更监听。 */
export function onPluginsChanged(fn: () => void): void {
  listeners.add(fn);
}
/** @param fn 禁用、更新、迁移时终止任务。 */
export function onPluginsStop(fn: (pluginId?: string) => void): void {
  stoppers.add(fn);
}
/** @param pluginId 指定插件；省略为全部。 */
export function stopPlugins(pluginId?: string): void {
  for (const stop of stoppers) stop(pluginId);
}
/** @param id 插件 ID。 @param message 日志文本。 @param level 级别。 */
export function logPlugin(id: string, message: string, level: 'info' | 'error' = 'info'): void {
  if (!logs.has(id) && logs.size >= 110) logs.delete(logs.keys().next().value!);
  const items = logs.get(id) ?? [];
  items.push({ time: new Date().toISOString(), message: message.slice(0, 2000), level });
  logs.set(id, items.slice(-100));
}
/** @param id 插件 ID。 @returns 最多 100 条最近诊断。 */
export function pluginLogs(id: string): PluginLog[] {
  return structuredClone(logs.get(id) ?? []);
}

/**
 * 所有插件落盘走同一队列，迁移期间拒绝新任务并等待已有写入。
 * @param action 持久化操作。
 * @returns 操作结果。
 */
export function pluginTransaction<T>(action: () => Promise<T>): Promise<T> {
  if (suspended || !ready) return Promise.reject(new Error('插件存储尚未就绪或正在迁移'));
  const result = queue.then(action);
  queue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function persist(next: PluginRecord[]): Promise<void> {
  const file = dataPath('plugins', 'registry.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify({ version: 1, plugins: next }));
  await fs.rename(temp, file);
  records = next;
  for (const notify of listeners) notify();
}

/** @param id 已验证的插件 ID。仅清理不再被注册表引用的包版本。 */
async function collectPackages(id: string): Promise<void> {
  const root = dataPath('plugins', 'packages', id);
  const record = records.find((r) => r.manifest.id === id);
  const keep = new Set([record?.revision, record?.previous?.revision]);
  try {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!/^[0-9a-f-]{36}$/.test(entry.name) || keep.has(entry.name)) continue;
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true });
    }
  } catch (error) {
    logPlugin(id, `旧包清理失败：${error}`, 'error');
  }
}

/**
 * 启动时恢复注册表；损坏时保留原文件并拒绝写入，不静默覆盖。
 */
export async function initPlugins(): Promise<void> {
  setWriteSuspender({
    suspend: async () => {
      suspended = true;
      stopPlugins();
      await queue;
    },
    resume: () => {
      suspended = false;
    },
  });
  try {
    const text = await fs.readFile(dataPath('plugins', 'registry.json'), 'utf8');
    if (text.length > 2 * 1024 * 1024) throw new Error('插件注册表超过限制');
    const blob = JSON.parse(text);
    if (blob.version !== 1 || !Array.isArray(blob.plugins) || blob.plugins.length > 100)
      throw new Error('不支持的插件注册表');
    records = blob.plugins.map((item: PluginRecord) => {
      const manifest = parseManifest(item.manifest);
      const revision = (value: string): string => {
        if (!/^[0-9a-f-]{36}$/.test(value)) throw new Error('版本目录损坏');
        return value;
      };
      return {
        manifest,
        revision: revision(item.revision),
        previous: item.previous
          ? {
              manifest: parseManifest(item.previous.manifest),
              revision: revision(item.previous.revision),
            }
          : undefined,
        enabled: item.enabled === true,
        aiEnabled: item.aiEnabled === true,
        grants: manifest.permissions.filter((p) => item.grants?.includes(p)),
        installedAt: String(item.installedAt),
      };
    });
    if (
      new Set(records.map((r) => r.manifest.id)).size !== records.length ||
      records.some((r) => r.previous && r.previous.manifest.id !== r.manifest.id)
    )
      throw new Error('注册表 ID 冲突');
    ready = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') ready = true;
    else {
      records = [];
      logPlugin('system', String(error), 'error');
    }
  }
}

/** 启动后恢复独立草稿，不自动执行或安装。 */
export async function restorePluginDrafts(): Promise<void> {
  if (!ready) return;
  try {
    const dir = dataPath('plugins', 'drafts');
    const entries = (await fs.readdir(dir, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/.test(entry.name),
    );
    for (const entry of entries.slice(-4)) {
      try {
        await stageBundle(await readBundle(path.join(dir, entry.name)), entry.name);
      } catch (error) {
        logPlugin('system', `草稿 ${entry.name} 恢复失败：${error}`, 'error');
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logPlugin('system', String(error), 'error');
  }
}

/** @returns 已安装清单快照。 */
export function listPlugins(): PluginRecord[] {
  if (!ready) throw new Error('插件注册表读取失败，请查看插件系统诊断，原文件已保留');
  return structuredClone(records);
}
/** @param id 插件 ID。 @returns 已启用的插件及已授权能力。 */
export function enabledPlugin(id: string): PluginRecord {
  if (suspended) throw new Error('数据目录正在迁移');
  const record = records.find((r) => r.manifest.id === id && r.enabled);
  if (!record) throw new Error('插件未启用或已卸载');
  return structuredClone(record);
}
/** @param record 已安装版本。 @returns 每次重新验证的包快照。 */
export function installedBundle(record: PluginRecord): Promise<PluginBundle> {
  return readBundle(dataPath('plugins', 'packages', record.manifest.id, record.revision));
}

/**
 * 创建安装候选，供审阅和隔离预览；不执行 JS。
 * @param bundle 已验证的包。
 * @returns 版本、权限和文件变化。
 */
async function stageBundleInternal(
  bundle: PluginBundle,
  restoredToken?: string,
  replaceToken?: string,
): Promise<PluginCandidate> {
  if (!ready || suspended) throw new Error('插件存储不可用');
  const replaced = replaceToken ? candidates.get(replaceToken) : undefined;
  if (!replaced && candidates.size >= 4)
    throw new Error('待审阅草稿最多 4 个，请先安装或丢弃旧草稿');
  const token = restoredToken ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error('非法草稿标识');
  const current = records.find((r) => r.manifest.id === bundle.manifest.id);
  const old = current ? await installedBundle(current) : undefined;
  const names = [...new Set([...bundle.files.keys(), ...(old?.files.keys() ?? [])])];
  const info: PluginCandidate = {
    token,
    manifest: bundle.manifest,
    currentVersion: current?.manifest.version,
    addedPermissions: bundle.manifest.permissions.filter((p) => !current?.grants.includes(p)),
    files: [...bundle.files.keys()],
    changedFiles: names.filter((name) => {
      const before = old?.files.get(name);
      const after = bundle.files.get(name);
      return !before || !after || fileHash(before) !== fileHash(after);
    }),
  };
  // 草稿保存在独立目录，重启可找回；永不写进已安装版本。
  if (!restoredToken)
    await pluginTransaction(async () => {
      const dir = dataPath('plugins', 'drafts', token);
      for (const [name, bytes] of bundle.files) {
        const target = path.join(dir, ...name.split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, bytes, { flag: 'wx' });
      }
    });
  candidates.set(token, { bundle, baseRevision: current?.revision, info });
  if (replaced && replaceToken) await discardCandidate(replaceToken);
  for (const notify of listeners) notify();
  return structuredClone(info);
}

/** @param bundle 校验后的快照。 @param restoredToken 重启恢复的草稿。 @returns 串行创建的候选，避免并发绕过数量限制。 */
export function stageBundle(
  bundle: PluginBundle,
  restoredToken?: string,
  replaceToken?: string,
): Promise<PluginCandidate> {
  const result = draftQueue.then(() => stageBundleInternal(bundle, restoredToken, replaceToken));
  draftQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}
/** @returns 本次会话中待审阅的候选（包含 AI 草稿）。 */
export function listCandidates(): PluginCandidate[] {
  return structuredClone([...candidates.values()].map((c) => c.info));
}

/** @param token 草稿标识；仅删除该草稿，已安装版本不受影响。 */
export async function discardCandidate(token: string): Promise<void> {
  if (!candidates.has(token) || !/^[0-9a-f-]{36}$/.test(token)) throw new Error('草稿不存在');
  await pluginTransaction(async () => {
    await fs.rm(dataPath('plugins', 'drafts', token), { recursive: true, force: true });
    candidates.delete(token);
    for (const notify of listeners) notify();
  });
}
/** @param token 候选标识。 @returns 候选快照。 */
export function candidateBundle(token: string): PluginBundle {
  const candidate = candidates.get(token);
  if (!candidate) throw new Error('候选已失效，请重新导入');
  return candidate.bundle;
}

/**
 * 审阅候选文件的前后内容；二进制与大文本仅展示摘要。
 * @param token 候选。
 * @param name 包内路径。
 * @returns 有界文本差异的两侧内容。
 */
export async function candidateFile(
  token: string,
  name: string,
): Promise<{ before: string; after: string; truncated: boolean }> {
  const bundle = candidateBundle(token);
  if (
    !listCandidates()
      .find((c) => c.token === token)
      ?.changedFiles.includes(name)
  )
    throw new Error('文件不在候选变更列表中');
  const current = records.find((r) => r.manifest.id === bundle.manifest.id);
  const old = current ? await installedBundle(current) : undefined;
  const before = old?.files.get(name);
  const after = bundle.files.get(name);
  const render = (buffer?: Buffer): string => {
    if (!buffer) return '（文件不存在）';
    if (!/\.(js|json|html|css|txt|md|svg|map)$/.test(name))
      return `（二进制 ${buffer.length} 字节，SHA256 ${fileHash(buffer)}）`;
    return buffer.subarray(0, 64 * 1024).toString('utf8');
  };
  return {
    before: render(before),
    after: render(after),
    truncated: (before?.length ?? 0) > 64 * 1024 || (after?.length ?? 0) > 64 * 1024,
  };
}

/**
 * 原子安装或更新；更新后停用，用户重新审阅并启用。
 * @param token 已审阅候选。
 * @returns 安装记录。
 */
export function installCandidate(token: string): Promise<PluginRecord> {
  return pluginTransaction(async () => {
    const candidate = candidates.get(token);
    if (!candidate) throw new Error('候选已失效');
    const current = records.find((r) => r.manifest.id === candidate.bundle.manifest.id);
    if (current?.revision !== candidate.baseRevision)
      throw new Error('插件已被修改，请重新导入审阅');
    if (!current && records.length >= 100) throw new Error('最多安装 100 个插件');
    stopPlugins(candidate.bundle.manifest.id);
    const revision = await writeBundle(candidate.bundle);
    const record: PluginRecord = {
      manifest: candidate.bundle.manifest,
      revision,
      previous: current ? { manifest: current.manifest, revision: current.revision } : undefined,
      enabled: false,
      aiEnabled: false,
      grants: [],
      installedAt: new Date().toISOString(),
    };
    await persist([...records.filter((r) => r.manifest.id !== record.manifest.id), record]);
    await collectPackages(record.manifest.id);
    candidates.delete(token);
    await fs
      .rm(dataPath('plugins', 'drafts', token), { recursive: true, force: true })
      .catch((error) => logPlugin(record.manifest.id, String(error), 'error'));
    for (const notify of listeners) notify();
    logPlugin(record.manifest.id, `安装 ${record.manifest.version}，等待授权启用`);
    return structuredClone(record);
  });
}

/**
 * 修改启用/AI/能力授权；任何变更终止在途运行，撤销立即生效。
 * @param id 插件 ID。
 * @param enabled 启用状态。
 * @param aiEnabled 允许 AI 使用。
 * @param grants 用户勾选的能力。
 */
export function configurePlugin(
  id: string,
  enabled: boolean,
  aiEnabled: boolean,
  grants: PluginPermission[],
): Promise<void> {
  stopPlugins(id);
  return pluginTransaction(async () => {
    const record = records.find((r) => r.manifest.id === id);
    if (!record) throw new Error('插件不存在');
    if (grants.some((p) => !record.manifest.permissions.includes(p)))
      throw new Error('未声明的权限');
    const aiCount = records
      .filter((r) => r !== record && r.enabled && r.aiEnabled)
      .reduce((sum, r) => sum + r.manifest.contributes.commands.filter((c) => c.ai).length, 0);
    if (
      enabled &&
      aiEnabled &&
      aiCount + record.manifest.contributes.commands.filter((c) => c.ai).length > 30
    )
      throw new Error('同时向 AI 开放的插件命令最多 30 个');
    await persist(
      records.map((r) =>
        r === record ? { ...r, enabled, aiEnabled, grants: [...new Set(grants)] } : r,
      ),
    );
  });
}

/** @param id 插件 ID。 @param action 卸载保留数据，回滚交换两个已安装版本并停用。 */
export function changePlugin(id: string, action: 'uninstall' | 'rollback'): Promise<void> {
  stopPlugins(id);
  return pluginTransaction(async () => {
    const record = records.find((r) => r.manifest.id === id);
    if (!record) throw new Error('插件不存在');
    if (action === 'uninstall') {
      await persist(records.filter((r) => r !== record));
      await collectPackages(id);
    } else {
      if (!record.previous) throw new Error('没有上一版本');
      await persist(
        records.map((r) =>
          r === record
            ? {
                ...r,
                ...r.previous!,
                previous: { manifest: r.manifest, revision: r.revision },
                enabled: false,
                aiEnabled: false,
                grants: [],
              }
            : r,
        ),
      );
    }
    logPlugin(id, action === 'uninstall' ? '已卸载，保留插件数据' : '已回滚，请重新授权启用');
  });
}
