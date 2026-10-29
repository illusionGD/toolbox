import { contextBridge, ipcRenderer } from 'electron';
import type { PLUGIN_CHANNELS as PluginChannels } from '../shared/channels';
// 由构建配置内联，避免 sandbox preload require 共享 chunk（Electron 不允许）。
declare const __PLUGIN_CHANNELS__: typeof PluginChannels;
const PLUGIN_CHANNELS = __PLUGIN_CHANNELS__;
import type { JsonValue } from '../shared/plugins/types';

type Handler = (input: Record<string, JsonValue>) => JsonValue | Promise<JsonValue>;
let handlers: Record<string, Handler> | undefined;

const invoke = async (method: string, args: unknown[]): Promise<unknown> => {
  const response = await ipcRenderer.invoke(PLUGIN_CHANNELS.sdk, { method, args });
  if (response.code !== 0) throw new Error(response.message);
  return response.data;
};

ipcRenderer.on(
  PLUGIN_CHANNELS.execute,
  async (_event, request: { command: string; input: Record<string, JsonValue> }) => {
    try {
      if (!handlers || !Object.hasOwn(handlers, request.command)) throw new Error('插件未注册命令');
      const data = await handlers[request.command](request.input);
      const serialized = JSON.stringify(data);
      if (
        typeof serialized !== 'string' ||
        new TextEncoder().encode(serialized).length > 256 * 1024
      )
        throw new Error('命令输出超过 256 KB 或不是 JSON');
      ipcRenderer.send(PLUGIN_CHANNELS.result, { ok: true, data: JSON.parse(serialized) });
    } catch (error) {
      ipcRenderer.send(PLUGIN_CHANNELS.result, { ok: false, error: String(error).slice(0, 2000) });
    }
  },
);

// 不暴露 ipcRenderer、event、electronAPI 或通用 channel 参数。
contextBridge.exposeInMainWorld('toolbox', {
  definePlugin(commands: Record<string, Handler>): void {
    if (handlers) throw new Error('definePlugin 只能调用一次');
    handlers = commands;
    ipcRenderer.send(PLUGIN_CHANNELS.ready, Object.keys(commands));
  },
  files: {
    select: () => invoke('files.select', []),
    readText: (handle: string) => invoke('files.readText', [handle]),
    saveText: (name: string, content: string) => invoke('files.saveText', [name, content]),
  },
  storage: {
    get: (key: string) => invoke('storage.get', [key]),
    set: (key: string, value: JsonValue) => invoke('storage.set', [key, value]),
  },
  network: { fetch: (options: unknown) => invoke('network.fetch', [options]) },
  image: {
    probe: (handle: string) => invoke('image.probe', [handle]),
    compress: (handle: string, options: unknown = {}) =>
      invoke('image.compress', [handle, options]),
  },
  media: {
    probeVideo: (handle: string) => invoke('media.probeVideo', [handle]),
    probeAudio: (handle: string) => invoke('media.probeAudio', [handle]),
    convertVideo: (handle: string, options: unknown = {}) =>
      invoke('media.convertVideo', [handle, options]),
    convertAudio: (handle: string, options: unknown = {}) =>
      invoke('media.convertAudio', [handle, options]),
  },
  diff: { compare: (left: string, right: string) => invoke('diff.compare', [left, right]) },
  webtest: {
    status: () => invoke('webtest.status', [{}]),
    readSteps: (options: unknown = {}) => invoke('webtest.read_steps', [options]),
    inspect: (options: unknown) => invoke('webtest.inspect', [options]),
    patchSteps: (options: unknown) => invoke('webtest.patch_steps', [options]),
    replay: (options: unknown) => invoke('webtest.replay', [options]),
    wait: (options: unknown = {}) => invoke('webtest.wait', [options]),
    stop: () => invoke('webtest.stop', [{}]),
  },
  commands: {
    run: (command: string, input: JsonValue) => invoke('commands.run', [command, input]),
  },
  log: (message: string) => invoke('log', [message]),
});
