import {
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { randomUUID } from 'node:crypto';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PLUGIN_CHANNELS } from '../../shared/channels';
import { assertJson, pluginZod } from '../../shared/plugins/validation';
import type {
  JsonValue,
  PluginPermission,
  PluginRecord,
  PluginTheme,
} from '../../shared/plugins/types';
import { handle } from '../ipc/helper';
import { dataPath } from '../storage/paths';
import {
  candidateBundle,
  enabledPlugin,
  installedBundle,
  logPlugin,
  onPluginsStop,
  pluginTransaction,
} from './registry';
import type { PluginBundle } from './package';
import { pluginFetch } from './network';
import { runHostTool, saveProcessedFile } from './host-tools';

interface Runtime {
  id: number;
  win: BrowserWindow;
  bundle: PluginBundle;
  record?: PluginRecord;
  owner: string;
  preview: boolean;
  ai?: boolean;
  grants: PluginPermission[];
  files: Map<string, FileHandle>;
  fileNames: Map<string, string>;
  active: boolean;
  requests: number;
  pending: number;
  dialogOpen: boolean;
  finish?: (error?: Error, value?: JsonValue) => void;
  command?: string;
  input?: JsonValue;
  themeCss?: string;
  abort: AbortController;
}
const runtimes = new Map<number, Runtime>();
const starting = new Map<string, AbortController>();
const startingPlugins = new Map<string, string | undefined>();
const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};
const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const DEFAULT_THEME: PluginTheme = { primaryColor: '#7c3aed', mode: 'dark' };

/** 特权 scheme 只声明标准来源，不绕过 CSP 或启用文件访问。必须在 ready 前调用。 */
export function registerPluginScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'tb-plugin',
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
    },
  ]);
}

function assertActive(runtime: Runtime, permission?: PluginPermission): void {
  if (!runtime.active || runtime.win.isDestroyed()) throw new Error('插件运行已结束');
  if (runtime.record) {
    const current = enabledPlugin(runtime.record.manifest.id);
    if (current.revision !== runtime.record.revision) throw new Error('插件版本已变化');
    if (runtime.ai && !current.aiEnabled) throw new Error('插件 AI 授权已撤销');
    if (permission && !current.grants.includes(permission))
      throw new Error(`未授权能力：${permission}`);
  }
  if (permission && !runtime.grants.includes(permission))
    throw new Error(`未授权能力：${permission}`);
}

function senderRuntime(event: IpcMainEvent | IpcMainInvokeEvent): Runtime {
  const runtime = runtimes.get(event.sender.id);
  if (!runtime || event.senderFrame !== event.sender.mainFrame) throw new Error('无效插件调用来源');
  assertActive(runtime);
  return runtime;
}

function destroy(runtime: Runtime): void {
  if (!runtime.active) return;
  runtime.active = false;
  runtime.abort.abort();
  runtimes.delete(runtime.id);
  for (const file of runtime.files.values()) void file.close().catch(() => {});
  runtime.files.clear();
  starting.get(`page:${runtime.id}`)?.abort();
  for (const child of [...runtimes.values()])
    if (child.owner === `page:${runtime.id}`) child.finish?.(new Error('插件页面已关闭'));
  if (!runtime.win.isDestroyed()) runtime.win.destroy();
}

/**
 * 取消一个所有者的全部运行（UI 与 AI 使用不同所有者）。
 * @param owner 调用所有者。
 */
export function cancelPluginRuns(owner: string): void {
  starting.get(owner)?.abort();
  for (const runtime of [...runtimes.values()]) {
    if (runtime.owner !== owner) continue;
    if (runtime.finish) runtime.finish(new Error('插件运行已取消'));
    else destroy(runtime);
  }
}

async function createRuntime(
  bundle: PluginBundle,
  owner: string,
  record?: PluginRecord,
  pageEntry?: string,
  theme = DEFAULT_THEME,
): Promise<Runtime> {
  if (runtimes.size >= 8) throw new Error('最多同时运行 8 个插件实例');
  const partition = `plugin-${randomUUID()}`;
  const isolated = session.fromPartition(partition, { cache: false });
  // 独立会话不建立外部网络连接；包括绕过 webRequest 的 WebRTC。
  await isolated.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9;socks=127.0.0.1:9',
    proxyBypassRules: '<-loopback>',
  });
  const origin = 'tb-plugin://bundle';
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', (event) => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(origin + '/') });
  });
  const files = new Map(bundle.files);
  const escaped = bundle.manifest.entry.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  files.set(
    '__host.html',
    Buffer.from(
      `<!doctype html><meta charset="utf-8"><script type="module" src="/${escaped}"></script>`,
    ),
  );
  await isolated.protocol.handle('tb-plugin', (request) => {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname).slice(1);
    const body =
      url.protocol === 'tb-plugin:' && url.hostname === 'bundle' && !url.port
        ? files.get(name)
        : undefined;
    if (!body) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': MIME[path.extname(name)] ?? 'text/plain',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
  if (runtimes.size >= 8 || starting.get(owner)?.signal.aborted) {
    isolated.protocol.unhandle('tb-plugin');
    throw new Error('任务已取消或运行实例超过限制');
  }
  const win = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    title: bundle.manifest.name,
    autoHideMenuBar: true,
    webPreferences: {
      session: isolated,
      preload: path.join(__dirname, '../preload/plugin.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      webviewTag: false,
      devTools: false,
      backgroundThrottling: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });
  const runtime: Runtime = {
    id: win.webContents.id,
    win,
    bundle,
    owner,
    record,
    preview: !record,
    grants: record?.grants ?? [],
    files: new Map(),
    fileNames: new Map(),
    active: true,
    requests: 0,
    pending: 0,
    dialogOpen: false,
    abort: new AbortController(),
  };
  runtimes.set(win.webContents.id, runtime);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-frame-navigate', (event) => event.preventDefault());
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', () =>
    runtime.finish ? runtime.finish(new Error('插件进程已退出')) : destroy(runtime),
  );
  win.webContents.on('console-message', (_event, level, message, line, source) =>
    logPlugin(bundle.manifest.id, `${source}:${line} ${message}`, level >= 3 ? 'error' : 'info'),
  );
  win.on('closed', () => {
    runtime.finish?.(new Error('插件窗口已关闭'));
    destroy(runtime);
    isolated.protocol.unhandle('tb-plugin');
    void isolated.clearStorageData().catch(() => {});
  });
  if (pageEntry) {
    try {
      await win.loadURL(`${origin}/${pageEntry}`);
      await applyTheme(runtime, theme);
      win.show();
    } catch (error) {
      destroy(runtime);
      throw error;
    }
  }
  return runtime;
}

async function applyTheme(runtime: Runtime, theme: PluginTheme): Promise<void> {
  const dark = theme.mode === 'dark';
  const previous = runtime.themeCss;
  runtime.themeCss = await runtime.win.webContents.insertCSS(
    `:root { color-scheme: ${theme.mode}; --tb-color-primary: ${theme.primaryColor}; --tb-bg-base: ${dark ? '#111' : '#fff'}; --tb-text-primary: ${dark ? '#eee' : '#222'}; } body { background: var(--tb-bg-base); color: var(--tb-text-primary); }`,
  );
  if (previous && !runtime.win.isDestroyed())
    await runtime.win.webContents.removeInsertedCSS(previous);
}

/** @param owner 宿主页面所有者。 @param theme 当前主题。 */
export async function updatePluginTheme(owner: string, theme: PluginTheme): Promise<void> {
  for (const runtime of runtimes.values()) {
    if (runtime.owner === owner && !runtime.command && runtime.active)
      await applyTheme(runtime, theme);
  }
}

/**
 * 在独立沙箱中执行命令；新实例隔离每次执行的文件授权与全局状态。
 * @param options 插件/候选、命令、输入和取消上下文。
 * @returns Schema 校验后的 JSON 输出。
 */
export async function runPlugin(options: {
  pluginId?: string;
  candidate?: string;
  command: string;
  input: unknown;
  owner: string;
  signal?: AbortSignal;
  ai?: boolean;
  expectedRevision?: string;
}): Promise<JsonValue> {
  if (starting.has(options.owner)) throw new Error('该任务已在运行');
  if (starting.size >= 8) throw new Error('等待启动的任务过多');
  const abort = new AbortController();
  const cancel = (): void => {
    abort.abort();
    cancelPluginRuns(options.owner);
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  starting.set(options.owner, abort);
  startingPlugins.set(options.owner, options.pluginId);
  let runtime: Runtime | undefined;
  try {
    const record = options.candidate ? undefined : enabledPlugin(options.pluginId!);
    if (options.expectedRevision && record?.revision !== options.expectedRevision)
      throw new Error('插件版本已更新，请在新一轮对话中重新调用');
    if (options.ai && !record?.aiEnabled) throw new Error('未允许 AI 使用此插件');
    const bundle = record ? await installedBundle(record) : candidateBundle(options.candidate!);
    if (record && JSON.stringify(bundle.manifest) !== JSON.stringify(record.manifest))
      throw new Error('安装目录中的 Manifest 已变化，请重新导入');
    const command = bundle.manifest.contributes.commands.find((c) => c.id === options.command);
    if (!command || (options.ai && !command.ai)) throw new Error('命令不存在或未向 AI 开放');
    const input = assertJson(pluginZod(command.inputSchema).parse(assertJson(options.input)));
    if (abort.signal.aborted || options.signal?.aborted) throw new Error('任务已取消');
    runtime = await createRuntime(bundle, options.owner, record);
    runtime.ai = options.ai;
    if (abort.signal.aborted || options.signal?.aborted) throw new Error('任务已取消');
    assertActive(runtime);
    runtime.command = command.id;
    runtime.input = input;
    const active = runtime;
    const value = await new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(
        () => active.finish?.(new Error('插件执行超过 60 秒，已终止')),
        60000,
      );
      active.finish = (error, value): void => {
        active.finish = undefined;
        clearTimeout(timer);
        destroy(active);
        if (error) reject(error);
        else resolve(value!);
      };
      void active.win
        .loadURL('tb-plugin://bundle/__host.html')
        .catch((error) => active.finish?.(error));
    });
    const output = assertJson(pluginZod(command.outputSchema).parse(value));
    logPlugin(bundle.manifest.id, `${command.id} 执行完成`);
    return output;
  } catch (error) {
    if (runtime) destroy(runtime);
    logPlugin(options.pluginId ?? 'preview', String(error), 'error');
    throw error;
  } finally {
    starting.delete(options.owner);
    startingPlugins.delete(options.owner);
    options.signal?.removeEventListener('abort', cancel);
  }
}

/** @param id 插件 ID。 @param pageId 页面 ID。 @param owner 页面所有者。 @param theme 主题快照。 */
export async function openPluginPage(
  id: string,
  pageId: string,
  owner: string,
  theme: PluginTheme,
): Promise<void> {
  cancelPluginRuns(owner);
  if (starting.has(owner)) throw new Error('页面正在关闭，请稍后重试');
  const abort = new AbortController();
  starting.set(owner, abort);
  startingPlugins.set(owner, id);
  let runtime: Runtime | undefined;
  try {
    const record = enabledPlugin(id);
    const page = record.manifest.contributes.pages.find((p) => p.id === pageId && p.entry);
    if (!page?.entry) throw new Error('自定义页面不存在');
    const bundle = await installedBundle(record);
    if (JSON.stringify(bundle.manifest) !== JSON.stringify(record.manifest))
      throw new Error('安装 Manifest 已变化，请重新导入');
    if (abort.signal.aborted) throw new Error('页面已关闭');
    runtime = await createRuntime(bundle, owner, record, page.entry, theme);
    assertActive(runtime);
  } catch (error) {
    if (runtime) destroy(runtime);
    throw error;
  } finally {
    starting.delete(owner);
    startingPlugins.delete(owner);
  }
}

async function sdk(runtime: Runtime, method: string, args: unknown[]): Promise<unknown> {
  if (++runtime.requests > 1000) throw new Error('该实例 SDK 调用次数超过限制');
  assertActive(runtime);
  if (method === 'network.fetch') {
    return pluginFetch(
      args[0],
      (origin) => assertActive(runtime, `network:${origin}`),
      runtime.abort.signal,
    );
  }
  if (/^(image|media|diff|webtest)\./.test(method)) {
    return runHostTool(method, args, {
      signal: runtime.abort.signal,
      assert: (permission) => assertActive(runtime, permission),
      file: (token) => {
        const opened = runtime.files.get(token);
        if (!opened) throw new Error('文件句柄未授权或已失效');
        return { opened, name: runtime.fileNames.get(token)! };
      },
      save: async (source, name) => {
        if (runtime.dialogOpen) throw new Error('已有文件对话框打开');
        runtime.dialogOpen = true;
        try {
          return await saveProcessedFile(source, name, () => assertActive(runtime, 'files.save'));
        } finally {
          runtime.dialogOpen = false;
        }
      },
    });
  }
  if (method === 'log') {
    logPlugin(runtime.bundle.manifest.id, z.string().max(2000).parse(args[0]));
    return null;
  }
  if (method === 'commands.run') {
    if (runtime.command) throw new Error('命令中不能递归启动命令');
    return runPlugin({
      pluginId: runtime.record?.manifest.id,
      command: z.string().parse(args[0]),
      input: args[1],
      owner: `page:${runtime.win.webContents.id}`,
    });
  }
  if (method === 'files.select') {
    assertActive(runtime, 'files.readSelected');
    if (runtime.dialogOpen) throw new Error('已有文件对话框打开');
    if (runtime.files.size >= 20) throw new Error('一次运行最多授权 20 个文件');
    runtime.dialogOpen = true;
    try {
      const selected = await dialog.showOpenDialog({
        title: `${runtime.bundle.manifest.name}：选择允许读取的文件`,
        properties: ['openFile', 'multiSelections'],
      });
      assertActive(runtime, 'files.readSelected');
      if (selected.canceled) return [];
      if (selected.filePaths.length + runtime.files.size > 20)
        throw new Error('一次最多 20 个文件');
      const result: { handle: string; name: string; size: number }[] = [];
      for (const file of selected.filePaths) {
        const opened = await fs.open(file, 'r');
        const stat = await opened.stat();
        if (!stat.isFile() || stat.size > 128 * 1024 * 1024) {
          await opened.close();
          throw new Error('所选文件大小上限为 128 MB，文本读取上限仍为 256 KB');
        }
        try {
          assertActive(runtime);
        } catch (error) {
          await opened.close();
          throw error;
        }
        const token = randomUUID();
        runtime.files.set(token, opened);
        runtime.fileNames.set(token, path.basename(file));
        result.push({ handle: token, name: path.basename(file), size: stat.size });
      }
      return result;
    } finally {
      runtime.dialogOpen = false;
    }
  }
  if (method === 'files.readText') {
    assertActive(runtime, 'files.readSelected');
    const opened = runtime.files.get(z.string().parse(args[0]));
    if (!opened) throw new Error('文件句柄未授权或已失效');
    const buffer = Buffer.alloc(256 * 1024 + 1);
    const { bytesRead } = await opened.read(buffer, 0, buffer.length, 0);
    assertActive(runtime, 'files.readSelected');
    if (bytesRead > 256 * 1024) throw new Error('文件内容超过 256 KB');
    return buffer.subarray(0, bytesRead).toString('utf8');
  }
  if (method === 'files.saveText') {
    assertActive(runtime, 'files.save');
    const name = z
      .string()
      .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fff][a-zA-Z0-9_.\-\u4e00-\u9fff]{0,100}$/)
      .parse(args[0]);
    const content = z
      .string()
      .max(256 * 1024)
      .parse(args[1]);
    if (runtime.dialogOpen) throw new Error('已有文件对话框打开');
    runtime.dialogOpen = true;
    try {
      const chosen = await dialog.showSaveDialog({
        title: `${runtime.bundle.manifest.name}：保存文件`,
        defaultPath: name,
      });
      assertActive(runtime, 'files.save');
      if (chosen.canceled || !chosen.filePath) return false;
      const temporary = chosen.filePath + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, content, { flag: 'wx' });
        assertActive(runtime, 'files.save');
        await fs.rename(temporary, chosen.filePath);
      } finally {
        await fs.unlink(temporary).catch(() => {});
      }
      return true;
    } finally {
      runtime.dialogOpen = false;
    }
  }
  if (method === 'storage.get' || method === 'storage.set') {
    assertActive(runtime, 'storage');
    const key = z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
      .parse(args[0]);
    return pluginTransaction(async () => {
      assertActive(runtime, 'storage');
      const file = dataPath('plugins', 'storage', runtime.bundle.manifest.id + '.json');
      let data: Record<string, JsonValue> = {};
      try {
        data = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (method === 'storage.get') return Object.hasOwn(data, key) ? data[key] : null;
      data[key] = assertJson(args[1]);
      const content = JSON.stringify(data);
      if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('插件存储超过 1 MB');
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temp = file + '.tmp';
      await fs.writeFile(temp, content);
      assertActive(runtime, 'storage');
      await fs.rename(temp, file);
      return null;
    });
  }
  throw new Error('未知 SDK 方法');
}

/** 注册专用 SDK 通道；每条消息验证 WebContents 与主 frame。 */
export function registerPluginRuntime(): void {
  onPluginsStop((id) => {
    for (const [owner, pluginId] of startingPlugins)
      if (!id || id === pluginId) starting.get(owner)?.abort();
    for (const runtime of [...runtimes.values()]) {
      if (id && runtime.bundle.manifest.id !== id) continue;
      if (runtime.finish) runtime.finish(new Error('插件已停用或正在更新'));
      else destroy(runtime);
    }
  });
  ipcMain.on(PLUGIN_CHANNELS.ready, (event, commands: unknown) => {
    try {
      const runtime = senderRuntime(event);
      if (!runtime.command) return;
      if (!Array.isArray(commands) || !commands.includes(runtime.command))
        throw new Error('入口未注册所需命令');
      event.sender.send(PLUGIN_CHANNELS.execute, {
        command: runtime.command,
        input: runtime.input,
      });
    } catch (error) {
      runtimes.get(event.sender.id)?.finish?.(new Error(String(error)));
    }
  });
  ipcMain.on(PLUGIN_CHANNELS.result, (event, payload: unknown) => {
    try {
      const runtime = senderRuntime(event);
      const result = z
        .object({
          ok: z.boolean(),
          data: z.unknown().optional(),
          error: z.string().max(2000).optional(),
        })
        .parse(payload);
      if (result.ok) runtime.finish?.(undefined, assertJson(result.data));
      else runtime.finish?.(new Error(result.error ?? '插件执行失败'));
    } catch (error) {
      runtimes.get(event.sender.id)?.finish?.(new Error(String(error)));
    }
  });
  handle(PLUGIN_CHANNELS.sdk, async (event, payload: unknown) => {
    assertJson(payload);
    const request = z
      .strictObject({ method: z.string(), args: z.array(z.unknown()).max(3) })
      .parse(payload);
    const runtime = senderRuntime(event);
    if (runtime.pending >= 16) throw new Error('SDK 并发调用超过 16');
    runtime.pending++;
    try {
      const value = await sdk(runtime, request.method, request.args);
      return assertJson(JSON.parse(JSON.stringify(value ?? null)));
    } finally {
      runtime.pending--;
    }
  });
}
