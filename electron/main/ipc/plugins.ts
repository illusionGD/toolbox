import { type BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { PLUGIN_CHANNELS } from '../../shared/channels';
import { assertJson, pluginPermissionSchema } from '../../shared/plugins/validation';
import { handle } from './helper';
import {
  changePlugin,
  configurePlugin,
  installCandidate,
  listPlugins,
  listCandidates,
  candidateFile,
  discardCandidate,
  onPluginsChanged,
  pluginLogs,
  stageBundle,
} from '../plugins/registry';
import { readBundle } from '../plugins/package';
import { registerPluginManagement } from '../plugins/management';
import {
  cancelPluginRuns,
  openPluginPage,
  registerPluginRuntime,
  runPlugin,
  updatePluginTheme,
} from '../plugins/runtime';

/**
 * 插件管理只接受主窗口主 frame；专用 sandbox 通道在 runtime 单独鉴权。
 * @param win 主窗口。
 */
export function registerPluginsIpc(win: BrowserWindow): void {
  const guard = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      throw new Error('插件管理只允许主窗口访问');
  };
  const owner = (event: IpcMainInvokeEvent, requestId: unknown): string =>
    `ui:${event.sender.id}:${z.string().uuid().parse(requestId)}`;
  registerPluginRuntime();
  registerPluginManagement(win, guard);
  handle(PLUGIN_CHANNELS.discard, (event, token: unknown) => {
    guard(event);
    return discardCandidate(z.string().uuid().parse(token));
  });
  handle(PLUGIN_CHANNELS.candidateFile, (event, input: unknown) => {
    guard(event);
    const value = z.object({ token: z.string().uuid(), name: z.string().max(180) }).parse(input);
    return candidateFile(value.token, value.name);
  });
  onPluginsChanged(() => {
    if (!win.isDestroyed()) win.webContents.send(PLUGIN_CHANNELS.changed);
  });
  const activeOwners = new Set<string>();
  win.on('closed', () => {
    for (const id of activeOwners) cancelPluginRuns(id);
  });
  handle(PLUGIN_CHANNELS.list, (event) => {
    guard(event);
    return listPlugins();
  });
  handle(PLUGIN_CHANNELS.candidates, (event) => {
    guard(event);
    return listCandidates();
  });
  handle(PLUGIN_CHANNELS.stage, async (event, directory: unknown) => {
    guard(event);
    const isDirectory = z.boolean().parse(directory);
    const result = await dialog.showOpenDialog(win, {
      title: isDirectory ? '选择包含 manifest.json 的插件目录' : '导入插件包',
      properties: [isDirectory ? 'openDirectory' : 'openFile'],
      filters: isDirectory ? [] : [{ name: 'Toolbox 插件', extensions: ['tbplugin'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return stageBundle(await readBundle(result.filePaths[0]));
  });
  handle(PLUGIN_CHANNELS.install, (event, token: unknown) => {
    guard(event);
    return installCandidate(z.string().uuid().parse(token));
  });
  handle(PLUGIN_CHANNELS.configure, (event, input: unknown) => {
    guard(event);
    const options = z
      .strictObject({
        id: z.string(),
        enabled: z.boolean(),
        aiEnabled: z.boolean(),
        grants: z.array(pluginPermissionSchema).max(30),
      })
      .parse(input);
    return configurePlugin(options.id, options.enabled, options.aiEnabled, options.grants);
  });
  handle(PLUGIN_CHANNELS.change, (event, input: unknown) => {
    guard(event);
    const options = z
      .strictObject({ id: z.string(), action: z.enum(['uninstall', 'rollback']) })
      .parse(input);
    return changePlugin(options.id, options.action);
  });
  for (const [channel, preview] of [
    [PLUGIN_CHANNELS.run, false],
    [PLUGIN_CHANNELS.preview, true],
  ] as const) {
    handle(channel, async (event, input: unknown) => {
      guard(event);
      assertJson(input);
      const options = z
        .object({
          pluginId: z.string().optional(),
          token: z.string().uuid().optional(),
          command: z.string(),
          input: z.unknown(),
          requestId: z.string().uuid(),
        })
        .parse(input);
      if (preview ? !options.token : !options.pluginId) throw new Error('缺少插件标识');
      const id = owner(event, options.requestId);
      activeOwners.add(id);
      try {
        return await runPlugin({
          pluginId: options.pluginId,
          candidate: preview ? options.token : undefined,
          command: options.command,
          input: options.input,
          owner: id,
        });
      } finally {
        activeOwners.delete(id);
      }
    });
  }
  handle(PLUGIN_CHANNELS.cancel, (event, id: unknown) => {
    guard(event);
    cancelPluginRuns(owner(event, id));
  });
  handle(PLUGIN_CHANNELS.logs, (event, id: unknown) => {
    guard(event);
    return pluginLogs(z.string().parse(id));
  });
  handle(PLUGIN_CHANNELS.openPage, async (event, input: unknown) => {
    guard(event);
    const options = z
      .strictObject({
        id: z.string(),
        pageId: z.string(),
        theme: z.strictObject({
          mode: z.enum(['dark', 'light']),
          primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
        }),
      })
      .parse(input);
    const id = `custom:${event.sender.id}`;
    activeOwners.add(id);
    await openPluginPage(options.id, options.pageId, id, options.theme);
  });
  handle(PLUGIN_CHANNELS.closePage, (event) => {
    guard(event);
    cancelPluginRuns(`custom:${event.sender.id}`);
  });
  handle(PLUGIN_CHANNELS.theme, (event, input: unknown) => {
    guard(event);
    const theme = z
      .strictObject({
        mode: z.enum(['dark', 'light']),
        primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .parse(input);
    return updatePluginTheme(`custom:${event.sender.id}`, theme);
  });
}
