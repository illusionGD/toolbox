import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initStoragePaths, changeDataDir, dataPath } from '../../electron/main/storage/paths';
import {
  initPlugins,
  restorePluginDrafts,
  stageBundle,
  installCandidate,
  configurePlugin,
  changePlugin,
  listPlugins,
  listCandidates,
  discardCandidate,
  pluginLogs,
} from '../../electron/main/plugins/registry';
import { readBundle, validateBundle } from '../../electron/main/plugins/package';
import {
  registerPluginScheme,
  runPlugin,
  cancelPluginRuns,
} from '../../electron/main/plugins/runtime';
import { registerPluginsIpc } from '../../electron/main/ipc/plugins';
import { parseManifest } from '../../electron/shared/plugins/validation';
import { pluginTools } from '../../electron/main/ai/tools/plugins';
import { verifyPluginExtensions } from './plugins-extensions';
import { initMcp, listMcpServers } from '../../electron/main/plugins/mcp';

const root = process.env.TB_PLUGIN_TEST_ROOT!;
app.setPath('userData', root);
app.setPath('temp', root);
app.disableHardwareAcceleration();
registerPluginScheme();
let pick = path.resolve('examples/plugins/translation-checker');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pick] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(root, 'saved.txt') });
const results: string[] = [];
const check = async (name: string, fn: () => Promise<void> | void): Promise<void> => {
  await fn();
  results.push(name);
  console.log('PASS ' + name);
};

app.whenReady().then(async () => {
  try {
    await initStoragePaths();
    await initPlugins();
    if (process.env.TB_PLUGIN_RESTART === '1') {
      await initMcp();
      const httpConfig = listMcpServers().find((server) => server.name === 'HTTP UI fixture');
      assert.equal(httpConfig?.transport, 'http');
      if (httpConfig?.transport === 'http')
        assert.equal(httpConfig.headers.Authorization, 'Bearer ui-fixture-token');
      await restorePluginDrafts();
      assert.equal(
        listPlugins().find((r) => r.manifest.id === 'example.translation-checker')?.enabled,
        true,
      );
      assert.ok(listCandidates().length > 0);
      Object.assign(globalThis, {
        __pluginResults: ['restart restores installation, grants and drafts'],
      });
      console.log('PASS restart restores installation, grants and drafts');
      return;
    }
    const win = new BrowserWindow({
      show: false,
      width: 1120,
      height: 720,
      webPreferences: { preload: path.resolve('out/preload/index.js'), sandbox: false },
    });
    registerPluginsIpc(win);
    ipcMain.handle('window:isMaximized', () => false);
    ipcMain.handle('pet:isOpen', () => ({ code: 0, data: false, message: '' }));
    ipcMain.handle('appState:read', () => ({ code: 0, data: {}, message: '' }));
    ipcMain.handle('appState:write', () => ({ code: 0, data: true, message: '' }));
    const bundle = await readBundle(pick);
    await check('manifest path / schema / references', () => {
      for (const change of [{ entry: '../evil.js' }, { apiVersion: 2 }, { permissions: ['shell'] }])
        assert.throws(() => parseManifest({ ...bundle.manifest, ...change }));
    });
    await check('ZIP valid / traversal / oversized', async () => {
      assert.equal(
        (await readBundle(path.join(root, 'valid.tbplugin'))).manifest.id,
        bundle.manifest.id,
      );
      await assert.rejects(readBundle(path.join(root, 'traversal.tbplugin')));
      await assert.rejects(readBundle(path.join(root, 'large.tbplugin')));
    });
    const staged = await stageBundle(bundle);
    await check('preview translation without install', async () => {
      assert.deepEqual(
        await runPlugin({
          candidate: staged.token,
          command: 'check',
          input: { source: '{"a":1,"b":2}', target: '{"a":1}' },
          owner: 'test-preview',
        }),
        { missing: ['b'], count: 1 },
      );
      assert.equal(listPlugins().length, 0);
    });
    const installed = await installCandidate(staged.token);
    await check('install disabled / enable / AI exposure', async () => {
      assert.equal(installed.enabled, false);
      await assert.rejects(
        runPlugin({
          pluginId: installed.manifest.id,
          command: 'check',
          input: {},
          owner: 'disabled',
        }),
      );
      await configurePlugin(installed.manifest.id, true, true, []);
      assert.equal(
        pluginTools().filter((tool) => /^plugin_[a-f0-9]{24}$/.test(tool.name)).length,
        1,
      );
      assert.deepEqual(
        await runPlugin({
          pluginId: installed.manifest.id,
          command: 'check',
          input: { source: '{"x":1}', target: '{}' },
          owner: 'enabled',
          ai: true,
        }),
        { missing: ['x'], count: 1 },
      );
    });
    const make = async (code: string, permissions: string[] = []) => {
      for (const pending of listCandidates()) await discardCandidate(pending.token);
      const manifest = {
        ...bundle.manifest,
        id: 'test.sandbox',
        permissions,
        contributes: {
          commands: [
            {
              id: 'probe',
              title: 'Probe',
              description: 'Sandbox probe',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              outputSchema: { type: 'string' },
            },
          ],
          pages: [],
        },
      };
      const testBundle = validateBundle(
        new Map([
          ['manifest.json', Buffer.from(JSON.stringify(manifest))],
          [
            'plugin.js',
            Buffer.from(`window.toolbox.definePlugin({ probe: async () => { ${code} } });`),
          ],
        ]),
      );
      return stageBundle(testBundle);
    };
    await check('sandbox globals and network denied', async () => {
      const probe = await make(
        `let blocked = false; try { await fetch('https://example.com'); } catch { blocked = true; } return JSON.stringify({ node: typeof require, process: typeof process, api: typeof window.api, electron: typeof window.electron, blocked });`,
      );
      const value = await runPlugin({
        candidate: probe.token,
        command: 'probe',
        input: {},
        owner: 'security',
      });
      assert.deepEqual(JSON.parse(String(value)), {
        node: 'undefined',
        process: 'undefined',
        api: 'undefined',
        electron: 'undefined',
        blocked: true,
      });
    });
    await check('preview denies declared storage', async () => {
      const probe = await make(`await window.toolbox.storage.set('x', 1); return 'bad';`, [
        'storage',
      ]);
      await assert.rejects(
        runPlugin({ candidate: probe.token, command: 'probe', input: {}, owner: 'deny' }),
        /未授权/,
      );
    });
    await check('storage permission and migration', async () => {
      const probe = await make(
        `await window.toolbox.storage.set('x', 123); return String(await window.toolbox.storage.get('x'));`,
        ['storage'],
      );
      await installCandidate(probe.token);
      await configurePlugin('test.sandbox', true, false, ['storage']);
      assert.equal(
        await runPlugin({
          pluginId: 'test.sandbox',
          command: 'probe',
          input: {},
          owner: 'storage',
        }),
        '123',
      );
      await changeDataDir(path.join(root, 'migrated'));
      assert.equal(
        await runPlugin({
          pluginId: 'test.sandbox',
          command: 'probe',
          input: {},
          owner: 'migrated',
        }),
        '123',
      );
      assert.equal(
        JSON.parse(await fs.readFile(dataPath('plugins', 'storage', 'test.sandbox.json'), 'utf8'))
          .x,
        123,
      );
    });
    await check('file handles and save broker', async () => {
      const file = path.join(root, 'selected.txt');
      await fs.writeFile(file, 'selected content');
      pick = file;
      const probe = await make(
        `let denied = false; try { await window.toolbox.files.readText('not-a-handle'); } catch { denied = true; } const files = await window.toolbox.files.select(); const content = await window.toolbox.files.readText(files[0].handle); await window.toolbox.files.saveText('copy.txt', content); return String(denied) + ':' + content;`,
        ['files.readSelected', 'files.save'],
      );
      await installCandidate(probe.token);
      await configurePlugin('test.sandbox', true, false, ['files.readSelected', 'files.save']);
      assert.equal(
        await runPlugin({ pluginId: 'test.sandbox', command: 'probe', input: {}, owner: 'files' }),
        'true:selected content',
      );
      assert.equal(await fs.readFile(path.join(root, 'saved.txt'), 'utf8'), 'selected content');
    });
    await check('cancel hung script kills sandbox', async () => {
      const probe = await make(`while (true) {} return '';`);
      const owner = randomUUID();
      const task = runPlugin({ candidate: probe.token, command: 'probe', input: {}, owner });
      setTimeout(() => cancelPluginRuns(owner), 600);
      await assert.rejects(task, /取消/);
    });
    await check('invalid output and stale AI revision rejected', async () => {
      const probe = await make('return 123;');
      await assert.rejects(
        runPlugin({ candidate: probe.token, command: 'probe', input: {}, owner: 'bad-output' }),
      );
      await assert.rejects(
        runPlugin({
          pluginId: installed.manifest.id,
          expectedRevision: randomUUID(),
          command: 'check',
          input: {},
          owner: 'stale',
        }),
        /版本/,
      );
    });
    if (process.env.TB_PLUGIN_SKIP_TIMEOUT !== '1')
      await check('60 second timeout terminates unresolved command', async () => {
        const probe = await make('return await new Promise(() => {});');
        await assert.rejects(
          runPlugin({ candidate: probe.token, command: 'probe', input: {}, owner: 'timeout' }),
          /60 秒/,
        );
      });
    await check('update rollback disables and preserves data', async () => {
      await changePlugin('test.sandbox', 'rollback');
      const record = listPlugins().find((r) => r.manifest.id === 'test.sandbox')!;
      assert.equal(record.enabled, false);
      assert.deepEqual(record.grants, []);
      assert.equal(
        JSON.parse(await fs.readFile(dataPath('plugins', 'storage', 'test.sandbox.json'), 'utf8'))
          .x,
        123,
      );
      await changePlugin('test.sandbox', 'uninstall');
    });
    pick = path.resolve('examples/plugins/translation-checker');
    await check('concurrent drafts respect quota', async () => {
      for (const candidate of listCandidates()) await discardCandidate(candidate.token);
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => stageBundle(bundle)),
      );
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 4);
      assert.equal(listCandidates().length, 4);
      for (const candidate of listCandidates()) await discardCandidate(candidate.token);
    });
    await verifyPluginExtensions({
      root,
      check,
      make,
      pick: (file) => {
        pick = file;
      },
    });
    pick = path.resolve('examples/plugins/translation-checker');
    Object.assign(globalThis, {
      __pluginTest: {
        logs: pluginLogs,
        stage: async () => stageBundle(await readBundle(pick)),
        schema: async () =>
          stageBundle(await readBundle(path.resolve('examples/plugins/host-tools'))),
      },
    });
    await win.loadFile(path.resolve('out/renderer/index.html'), { hash: '/plugins' });
    Object.assign(globalThis, { __pluginResults: results });
  } catch (error) {
    console.error(error);
    await fs.writeFile(path.join(root, 'failed.txt'), String(error));
    app.exit(1);
  }
});
