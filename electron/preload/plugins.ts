import { ipcRenderer } from 'electron';
import { PLUGIN_CHANNELS } from '../shared/channels';
import type { IpcResponse } from '../shared/types';
import type { McpServerConfig } from '../shared/plugins/mcp';
import type {
  JsonValue,
  PluginCandidate,
  PluginLog,
  PluginPermission,
  PluginRecord,
  PluginRunRequest,
  PluginTheme,
  PluginDevelopment,
  PluginStorageInfo,
} from '../shared/plugins/types';

/** 主应用管理 API；不进入插件专用 preload。 */
export const pluginsApi = {
  mcpList: (): Promise<IpcResponse<McpServerConfig[]>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.mcpList),
  mcpSave: (config: McpServerConfig): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.mcpSave, config),
  mcpRemove: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.mcpRemove, id),
  mcpPick: (): Promise<IpcResponse<string | null>> => ipcRenderer.invoke(PLUGIN_CHANNELS.mcpPick),
  mcpRun: (request: {
    id: string;
    requestId: string;
    tool?: string;
    input?: unknown;
  }): Promise<IpcResponse<unknown>> => ipcRenderer.invoke(PLUGIN_CHANNELS.mcpRun, request),
  mcpCancel: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.mcpCancel, id),
  export: (source: { id?: string; token?: string }): Promise<IpcResponse<string | null>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.export, source),
  development: (): Promise<IpcResponse<PluginDevelopment[]>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.development),
  startDevelopment: (): Promise<IpcResponse<PluginDevelopment | null>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.startDevelopment),
  stopDevelopment: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.stopDevelopment, id),
  storageInfo: (): Promise<IpcResponse<PluginStorageInfo[]>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.storageInfo),
  clearStorage: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.clearStorage, id),
  theme: (theme: PluginTheme): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.theme, theme),
  discard: (token: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.discard, token),
  candidateFile: (
    token: string,
    name: string,
  ): Promise<IpcResponse<{ before: string; after: string; truncated: boolean }>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.candidateFile, { token, name }),
  list: (): Promise<IpcResponse<PluginRecord[]>> => ipcRenderer.invoke(PLUGIN_CHANNELS.list),
  candidates: (): Promise<IpcResponse<PluginCandidate[]>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.candidates),
  stage: (directory: boolean): Promise<IpcResponse<PluginCandidate | null>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.stage, directory),
  install: (token: string): Promise<IpcResponse<PluginRecord>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.install, token),
  configure: (
    id: string,
    enabled: boolean,
    aiEnabled: boolean,
    grants: PluginPermission[],
  ): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.configure, { id, enabled, aiEnabled, grants }),
  change: (id: string, action: 'uninstall' | 'rollback'): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.change, { id, action }),
  run: (request: PluginRunRequest): Promise<IpcResponse<JsonValue>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.run, request),
  cancel: (requestId: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.cancel, requestId),
  preview: (
    token: string,
    command: string,
    input: JsonValue,
    requestId: string,
  ): Promise<IpcResponse<JsonValue>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.preview, { token, command, input, requestId }),
  logs: (id: string): Promise<IpcResponse<PluginLog[]>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.logs, id),
  openPage: (id: string, pageId: string, theme: PluginTheme): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke(PLUGIN_CHANNELS.openPage, { id, pageId, theme }),
  closePage: (): Promise<IpcResponse<void>> => ipcRenderer.invoke(PLUGIN_CHANNELS.closePage),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on(PLUGIN_CHANNELS.changed, listener);
    return () => ipcRenderer.removeListener(PLUGIN_CHANNELS.changed, listener);
  },
};
