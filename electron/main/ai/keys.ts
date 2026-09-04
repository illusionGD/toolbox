/**
 * API Key 存储：`<userData>/ai-keys.json`，逐条用 Electron `safeStorage` 加密。
 *
 * **故意不放数据保存目录**：数据目录被设计成可搬走、可指到网盘/U 盘，把凭据一起搬
 * 出去是坑；而 Windows 上 `safeStorage` 是 DPAPI、密钥绑当前系统账户，搬到别的机器
 * 上本来也解不开。与「指针 settings.json 放 userData」同一条理由（见 [[app-storage]]）。
 *
 * `safeStorage.isEncryptionAvailable()` 为 false 时**降级明文并如实标记**
 * （`encrypted: false`），设置页必须显著提示——不许假装加密。
 *
 * 明文 key **永不出主进程**：对渲染进程只暴露 {@link AiKeyStatus}（是否存在 + 掩码）。
 */
import { app, safeStorage } from 'electron';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import type { AiKeyStatus } from '../../shared/types';

/** 单条记录的落盘形状。 */
interface KeyEntry {
  /** 加密时是 base64 的密文，降级时是明文原文。 */
  value: string;
  /** 该条是否真的加密过（同一个文件里可能两种并存：加密能力可能中途变化）。 */
  encrypted: boolean;
  /** 掩码提示，写入时算好，读的时候不必解密。 */
  hint: string;
}

/** 文件整体形状。 */
interface KeyFile {
  /** 按配置 id 索引。 */
  keys: Record<string, KeyEntry>;
}

/** 内存副本，避免每次调用都读盘。 */
let cache: KeyFile | null = null;

/**
 * 密钥文件路径。
 * @returns 绝对路径。
 */
function keyFile(): string {
  return path.join(app.getPath('userData'), 'ai-keys.json');
}

/**
 * 当前是否具备真加密能力。
 *
 * 每次都问 `safeStorage`，不缓存：Linux 上它依赖会话里的 keyring，运行期间是可能
 * 从不可用变可用的。
 * @returns 可加密时为 true。
 */
export function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * 读整个密钥文件。缺失或损坏都当作「一条都没有」，不抛错——
 * 这个文件坏了不该拦住应用启动，用户重填一次 key 即可。
 * @returns 密钥表。
 */
function readAll(): KeyFile {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(readFileSync(keyFile(), 'utf-8')) as Partial<KeyFile>;
    const keys: Record<string, KeyEntry> = {};
    for (const [id, entry] of Object.entries(parsed.keys ?? {})) {
      if (entry && typeof entry.value === 'string') {
        keys[id] = {
          value: entry.value,
          encrypted: Boolean(entry.encrypted),
          hint: typeof entry.hint === 'string' ? entry.hint : '',
        };
      }
    }
    cache = { keys };
  } catch {
    cache = { keys: {} };
  }
  return cache;
}

/**
 * 落盘（临时文件 + rename，避免半个文件）。
 * @param next 要写入的完整内容。
 */
function writeAll(next: KeyFile): void {
  const file = keyFile();
  const tmp = `${file}.tmp-${process.pid}`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, file);
  cache = next;
}

/**
 * 算掩码：头 4 尾 4，中间省略。
 *
 * 太短的 key 直接全遮——`sk-1` 这种再露头尾就等于明文了。
 * @param key 明文 key。
 * @returns 形如 `sk-a…7890` 的提示串。
 */
function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '*'.repeat(Math.min(trimmed.length, 8));
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}

/**
 * 写入某份配置的 key。
 * @param configId 配置 id。
 * @param key 明文 key；传空串等同于删除。
 * @returns 写入后的状态（不含明文）。
 */
export function setKey(configId: string, key: string): AiKeyStatus {
  const plain = key.trim();
  if (!plain) return deleteKey(configId);

  const canEncrypt = encryptionAvailable();
  const entry: KeyEntry = {
    value: canEncrypt ? safeStorage.encryptString(plain).toString('base64') : plain,
    encrypted: canEncrypt,
    hint: maskKey(plain),
  };
  const current = readAll();
  writeAll({ keys: { ...current.keys, [configId]: entry } });
  return { configId, hasKey: true, hint: entry.hint, encrypted: entry.encrypted };
}

/**
 * 删除某份配置的 key（删配置时一并调用，避免留下孤儿凭据）。
 * @param configId 配置 id。
 * @returns 删除后的空状态。
 */
export function deleteKey(configId: string): AiKeyStatus {
  const current = readAll();
  if (current.keys[configId]) {
    const keys = { ...current.keys };
    delete keys[configId];
    writeAll({ keys });
  }
  return { configId, hasKey: false, hint: '', encrypted: encryptionAvailable() };
}

/**
 * 取明文 key。**只允许主进程内部调用**，不要接到任何 IPC 上。
 * @param configId 配置 id。
 * @returns 明文 key；没存过返回空串。
 */
export function getKey(configId: string): string {
  const entry = readAll().keys[configId];
  if (!entry) return '';
  if (!entry.encrypted) return entry.value;
  try {
    return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
  } catch (error) {
    // 换了系统账户 / 拷了别人的文件 都会解不开。这里返回空串让上层报「未配置 key」，
    // 比抛一句 DPAPI 的英文错误可读
    console.error('[ai] 解密 API Key 失败，请重新填写：', error);
    return '';
  }
}

/**
 * 把一份配置的 key 复制给另一份（「复制配置」用）。
 *
 * **明文只在主进程内流转**：走 `getKey` → `setKey`，渲染进程只拿到目标的
 * {@link AiKeyStatus}。源没有 key 时什么都不做（不要把目标已有的 key 抹掉——复制一份没
 * key 的配置不该顺手毁掉目标的凭据）；重新加密一次也顺带把加密态跟到**目标写入时**的
 * `safeStorage` 可用性。
 * @param fromId 源配置 id。
 * @param toId 目标配置 id。
 * @returns 目标配置的 key 状态。
 */
export function copyKey(fromId: string, toId: string): AiKeyStatus {
  const plain = getKey(fromId);
  if (!plain) {
    const entry = readAll().keys[toId];
    return {
      configId: toId,
      hasKey: Boolean(entry),
      hint: entry?.hint ?? '',
      encrypted: entry ? entry.encrypted : encryptionAvailable(),
    };
  }
  return setKey(toId, plain);
}

/**
 * 列出若干配置的 key 状态。
 * @param configIds 要查的配置 id 列表。
 * @returns 与入参同序的状态数组。
 */
export function listKeyStatus(configIds: string[]): AiKeyStatus[] {
  const all = readAll().keys;
  const canEncrypt = encryptionAvailable();
  return configIds.map((configId) => {
    const entry = all[configId];
    return {
      configId,
      hasKey: Boolean(entry),
      hint: entry?.hint ?? '',
      // 有记录时报这条记录的真实状态，没记录时报「以后写进去会不会加密」
      encrypted: entry ? entry.encrypted : canEncrypt,
    };
  });
}

/**
 * 清掉所有 key（仅供手工排障 / 测试用，界面上没有入口）。
 */
export function clearAllKeys(): void {
  const file = keyFile();
  if (existsSync(file)) unlinkSync(file);
  cache = { keys: {} };
}
