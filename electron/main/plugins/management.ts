import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PLUGIN_CHANNELS } from '../../shared/channels';
import { handle } from '../ipc/helper';
import { cancelMcp, initMcp, listMcpServers, removeMcpServer, runMcp, saveMcpServer } from './mcp';
import {
  clearPluginStorage,
  developmentSessions,
  exportPluginBundle,
  packPlugin,
  pluginStorageInfo,
  startDevelopment,
  stopDevelopment,
} from './development';

/** @param win 主窗口。 @param guard 主窗口来源检查。 */
export function registerPluginManagement(
  win: BrowserWindow,
  guard: (event: IpcMainInvokeEvent) => void,
): void {
  const owners = new Set<string>();
  handle(PLUGIN_CHANNELS.mcpList, async (event) => {
    guard(event);
    await initMcp();
    return listMcpServers();
  });
  handle(PLUGIN_CHANNELS.mcpSave, (event, input: unknown) => {
    guard(event);
    return saveMcpServer(input);
  });
  handle(PLUGIN_CHANNELS.mcpRemove, (event, id: unknown) => {
    guard(event);
    return removeMcpServer(z.string().uuid().parse(id));
  });
  handle(PLUGIN_CHANNELS.mcpPick, async (event) => {
    guard(event);
    const selected = await dialog.showOpenDialog(win, {
      title: '选择受信任的 MCP 可执行程序',
      properties: ['openFile'],
    });
    return selected.canceled ? null : (selected.filePaths[0] ?? null);
  });
  handle(PLUGIN_CHANNELS.mcpRun, async (event, input: unknown) => {
    guard(event);
    const request = z
      .strictObject({
        id: z.string().uuid(),
        requestId: z.string().uuid(),
        tool: z.string().max(200).optional(),
        input: z.unknown().optional(),
      })
      .parse(input);
    const owner = `ui:${event.sender.id}:mcp:${request.requestId}`;
    owners.add(owner);
    try {
      return await runMcp({ ...request, owner });
    } finally {
      owners.delete(owner);
    }
  });
  handle(PLUGIN_CHANNELS.mcpCancel, (event, id: unknown) => {
    guard(event);
    cancelMcp(`ui:${event.sender.id}:mcp:${z.string().uuid().parse(id)}`);
  });
  win.on('closed', () => {
    for (const owner of owners) cancelMcp(owner);
  });
  handle(PLUGIN_CHANNELS.export, async (event, input: unknown) => {
    guard(event);
    const source = z
      .strictObject({ id: z.string().optional(), token: z.string().uuid().optional() })
      .parse(input);
    if (Boolean(source.id) === Boolean(source.token)) throw new Error('请选择一个插件或草稿');
    const bundle = await exportPluginBundle(source);
    const selected = await dialog.showSaveDialog(win, {
      title: '导出插件包',
      defaultPath: `${bundle.manifest.id}-${bundle.manifest.version}.tbplugin`,
      filters: [{ name: 'Toolbox 插件', extensions: ['tbplugin'] }],
    });
    if (selected.canceled || !selected.filePath) return null;
    const bytes = await packPlugin(bundle);
    const temp = selected.filePath + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx' });
      await fs.rename(temp, selected.filePath);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return selected.filePath;
  });
  handle(PLUGIN_CHANNELS.development, (event) => {
    guard(event);
    return developmentSessions();
  });
  handle(PLUGIN_CHANNELS.startDevelopment, async (event) => {
    guard(event);
    const selected = await dialog.showOpenDialog(win, {
      title: '选择要监听的插件开发目录',
      properties: ['openDirectory'],
    });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return startDevelopment(selected.filePaths[0]);
  });
  handle(PLUGIN_CHANNELS.stopDevelopment, (event, id: unknown) => {
    guard(event);
    stopDevelopment(z.string().uuid().parse(id));
  });
  handle(PLUGIN_CHANNELS.storageInfo, (event) => {
    guard(event);
    return pluginStorageInfo();
  });
  handle(PLUGIN_CHANNELS.clearStorage, (event, id: unknown) => {
    guard(event);
    return clearPluginStorage(z.string().parse(id));
  });
  win.on('closed', () => {
    for (const session of developmentSessions()) stopDevelopment(session.id);
  });
}
