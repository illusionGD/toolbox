import type { AppStateBlob } from '@shared/types';
import { unwrap } from './ipc';

/**
 * 应用状态（主题 / 各工具上次配置 / 使用统计）的渲染进程侧入口。
 *
 * **为什么是「启动时 await 读一次 + 内存快照」**：主题 store、useToolConfig、usage
 * store 的读都是同步的（store 创建即读）。若改成每处 await IPC，三处都要变异步、
 * 17 个 useToolConfig 调用点全要跟着改，主题色还会先闪一帧默认紫再跳到用户色。
 * 这里在 `app.mount()` 之前把整个 blob 读进内存，`readState` 保持同步，写入则防抖
 * 后经 IPC 落盘。
 */

/** 命名空间前缀：工具配置。 */
const TOOL_NS_PREFIX = 'tools.';
/** 旧版工具配置在 localStorage 里的键前缀。 */
const LEGACY_CONFIG_PREFIX = 'toolbox.config.';
/** 写盘防抖间隔（毫秒）。连续拖滑块不必每帧写一次盘。 */
const DEBOUNCE_MS = 300;

/** 内存快照：命名空间 → 值。 */
let entries: Record<string, unknown> = {};
/** 落盘不可用时降级到 localStorage。 */
let degraded = false;
/** 降级原因，设置页要显示出来。 */
let degradedReason = '';
/** 待写入的命名空间。 */
let pending: Record<string, unknown> = {};
/** 防抖定时器。 */
let timer: ReturnType<typeof setTimeout> | null = null;
/** 正在进行的写入，flush 时要等它。 */
let inflight: Promise<unknown> = Promise.resolve();

/**
 * 命名空间 ↔ 旧 localStorage 键的映射。
 * 一次性迁移与降级模式都用它，两条路径共用一套键名，互相之间数据可读。
 * @param ns 命名空间。
 * @returns localStorage 键。
 */
function legacyKeyFor(ns: string): string {
  if (ns.startsWith(TOOL_NS_PREFIX)) {
    return `${LEGACY_CONFIG_PREFIX}${ns.slice(TOOL_NS_PREFIX.length)}`;
  }
  return `toolbox.${ns}`;
}

/**
 * 反向映射：localStorage 键 → 命名空间；不是我们的键返回 null。
 * @param key localStorage 键。
 * @returns 命名空间或 null。
 */
function nsForLegacyKey(key: string): string | null {
  if (key.startsWith(LEGACY_CONFIG_PREFIX)) {
    return `${TOOL_NS_PREFIX}${key.slice(LEGACY_CONFIG_PREFIX.length)}`;
  }
  // 白名单而不是 `toolbox.` 前缀通吃：以后别处再往 localStorage 塞键不会被误搬
  if (key === 'toolbox.theme') return 'theme';
  if (key === 'toolbox.usage') return 'usage';
  return null;
}

/**
 * 扫描 localStorage 里所有旧键，组装成 entries 形状。
 * @returns 命名空间 → 值。
 */
function collectLegacy(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    const ns = nsForLegacyKey(key);
    if (!ns) continue;
    try {
      result[ns] = JSON.parse(localStorage.getItem(key) ?? 'null');
    } catch {
      // 坏值直接丢，不值得为一条历史配置卡住启动
    }
  }
  return result;
}

/**
 * 把 localStorage 里的历史数据搬到数据保存目录，成功后删掉旧键。
 *
 * **顺序不能反**：先确认写盘成功再删旧键。`appState.write` 返回 true 表示主进程已
 * 完成「临时文件 + rename」，那就是落盘的证据；再 read 一次读到的是主进程内存副本，
 * 验证不了磁盘，所以不做那种假验证。
 */
async function migrateLegacy(): Promise<void> {
  if (Object.keys(entries).length > 0) {
    cleanupMigratedKeys();
    return; // 已经在用文件了
  }
  const legacy = collectLegacy();
  if (Object.keys(legacy).length === 0) return;

  // 先进内存：写盘失败时本次会话也该照旧显示用户的设置，而不是像被重置过一样
  entries = legacy;
  // unwrap 在 IPC 返回错误码时是**抛错**而不是返回假值，这里必须接住：
  // 让它冒出 initAppState 会连 app.mount() 一起挡掉，那就是一整片白屏
  let written = false;
  try {
    written = await unwrap(window.api.appState.write(legacy), { silent: true });
  } catch (error) {
    console.warn('[appState] 历史数据写入失败，旧键保留，下次启动再试：', error);
    return;
  }
  if (!written) {
    console.warn('[appState] 历史数据尚未落盘，旧键保留，下次启动再试');
    return;
  }

  for (const ns of Object.keys(legacy)) localStorage.removeItem(legacyKeyFor(ns));
  console.log(`[appState] 已从 localStorage 迁移 ${Object.keys(legacy).length} 项到数据目录`);
}

/**
 * 清掉那些「文件里已经有了」的旧 localStorage 键。
 *
 * 上一次迁移可能写进了主进程内存但当时还没落盘（比如正好撞上目录迁移），于是旧键
 * 被保留了下来；这次启动文件里已经读到了同名命名空间，旧键就是纯粹的残留。
 */
function cleanupMigratedKeys(): void {
  for (const ns of Object.keys(entries)) {
    const key = legacyKeyFor(ns);
    if (localStorage.getItem(key) !== null) localStorage.removeItem(key);
  }
}

/**
 * 启动时读取状态。**必须在 app.mount() 之前 await**。
 * 读失败不阻塞启动：降级为 localStorage 模式，设置页会提示。
 */
export async function initAppState(): Promise<void> {
  try {
    const blob = await unwrap<AppStateBlob>(window.api.appState.read(), { silent: true });
    entries = blob?.entries ?? {};
  } catch (error) {
    degraded = true;
    degradedReason = error instanceof Error ? error.message : String(error);
    entries = collectLegacy();
    console.error('[appState] 读取失败，降级为浏览器本地存储：', degradedReason);
    return;
  }
  await migrateLegacy();
}

/**
 * 同步读取某个命名空间。
 * @param ns 命名空间（如 `theme` / `tools.image-compress`）。
 * @returns 存储的值；没有或类型不对时返回 undefined。
 */
export function readState<T>(ns: string): T | undefined {
  const value = entries[ns];
  return value === null || value === undefined ? undefined : (value as T);
}

/**
 * 立即把待写队列送出去。
 */
function flushPending(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const patch = pending;
  pending = {};
  if (Object.keys(patch).length === 0) return;

  if (degraded) {
    for (const [ns, value] of Object.entries(patch)) {
      try {
        localStorage.setItem(legacyKeyFor(ns), JSON.stringify(value));
      } catch {
        // 降级模式下再失败就真没地方写了，静默
      }
    }
    return;
  }
  inflight = unwrap(window.api.appState.write(patch), { silent: true }).catch((error: unknown) => {
    console.error('[appState] 写入失败：', error);
  });
}

/**
 * 写入某个命名空间（防抖合并）。
 *
 * 传进来的值会先 JSON 往返一遍再入队：一是**去掉 Vue 的响应式代理**（代理对象过
 * IPC 会直接抛 "An object could not be cloned"，类型检查与构建都拦不住），二是顺手
 * 把不可序列化的字段丢掉，与真正落盘的内容保持一致。
 * @param ns 命名空间。
 * @param value 任意可 JSON 序列化的值。
 */
export function writeState(ns: string, value: unknown): void {
  let plain: unknown;
  try {
    plain = JSON.parse(JSON.stringify(value));
  } catch {
    return;
  }
  entries[ns] = plain;
  pending[ns] = plain;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushPending, DEBOUNCE_MS);
}

/**
 * 等待所有待写内容真正写出去。
 * **迁移数据目录之前必须调用**，否则防抖中的写入会落进正在搬走的旧目录。
 */
export async function flushAppState(): Promise<void> {
  flushPending();
  await inflight;
}

/**
 * 状态是否处于降级（写不进数据目录，退回浏览器本地存储）。
 * @returns 降级标记与原因。
 */
export function appStateStatus(): { degraded: boolean; reason: string } {
  return { degraded, reason: degradedReason };
}
