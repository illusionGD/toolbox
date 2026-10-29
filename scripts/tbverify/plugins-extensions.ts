import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';
import { readBundle } from '../../electron/main/plugins/package';
import {
  clearPluginStorage,
  developmentSessions,
  packPlugin,
  pluginStorageInfo,
  startDevelopment,
  stopDevelopment,
} from '../../electron/main/plugins/development';
import {
  candidateBundle,
  changePlugin,
  configurePlugin,
  discardCandidate,
  installCandidate,
  listCandidates,
  listPlugins,
} from '../../electron/main/plugins/registry';
import { runPlugin } from '../../electron/main/plugins/runtime';
import { pluginFetch } from '../../electron/main/plugins/network';
import {
  listMcpServers,
  runMcp,
  saveMcpServer,
  removeMcpServer,
  cancelMcp,
} from '../../electron/main/plugins/mcp';
import { mcpTools } from '../../electron/main/ai/tools/mcp';
import { verifyMcpHttp } from './mcp-http';
import { WebTestSession } from '../../electron/main/webtest/session';
import { registerWebTestAccess } from '../../electron/main/webtest/access';
import type { PluginCandidate, PluginPermission } from '../../electron/shared/plugins/types';

export async function verifyPluginExtensions(options: {
  root: string;
  check: (name: string, fn: () => Promise<void> | void) => Promise<void>;
  make: (code: string, permissions?: string[]) => Promise<PluginCandidate>;
  pick: (file: string) => void;
}): Promise<void> {
  const { root, check, make } = options;
  const run = (candidate?: string) =>
    runPlugin({
      pluginId: candidate ? undefined : 'test.sandbox',
      candidate,
      command: 'probe',
      input: {},
      owner: randomUUID(),
    });
  const install = async (code: string, permissions: PluginPermission[]) => {
    const candidate = await make(code, permissions);
    await installCandidate(candidate.token);
    await configurePlugin('test.sandbox', true, false, permissions);
  };
  await check('export ZIP round trip preserves files and excludes grants', async () => {
    const bundle = await readBundle(path.resolve('examples/plugins/translation-checker'));
    const target = path.join(root, 'export.tbplugin');
    await fs.writeFile(target, await packPlugin(bundle));
    const restored = await readBundle(target);
    assert.deepEqual(restored.manifest, bundle.manifest);
    assert.deepEqual([...restored.files.keys()].sort(), [...bundle.files.keys()].sort());
    for (const [name, value] of bundle.files) assert.deepEqual(restored.files.get(name), value);
    assert.equal(restored.files.has('registry.json'), false);
  });
  await check(
    'development watch validates before replacing draft; stop keeps snapshot',
    async () => {
      for (const pending of listCandidates()) await discardCandidate(pending.token);
      const directory = path.join(root, 'development');
      await fs.cp(path.resolve('examples/plugins/translation-checker'), directory, {
        recursive: true,
      });
      const session = await startDevelopment(directory);
      try {
        const installedRevision = listPlugins().find(
          (record) => record.manifest.id === 'example.translation-checker',
        )!.revision;
        const script = path.join(directory, 'plugin.js');
        await fs.appendFile(script, '\n// watched update\n');
        for (let i = 0; i < 100 && developmentSessions()[0]?.token === session.token; i++)
          await delay(50);
        const updated = developmentSessions()[0];
        assert.notEqual(updated.token, session.token);
        assert.equal(listCandidates().length, 1);
        assert.match(
          candidateBundle(updated.token).files.get('plugin.js')!.toString(),
          /watched update/,
        );
        assert.equal(
          listPlugins().find((record) => record.manifest.id === 'example.translation-checker')!
            .revision,
          installedRevision,
        );
        await fs.writeFile(path.join(directory, 'manifest.json'), '{invalid');
        for (let i = 0; i < 100 && !developmentSessions()[0]?.error; i++) await delay(50);
        assert.ok(developmentSessions()[0].error);
        assert.equal(developmentSessions()[0].token, updated.token);
        stopDevelopment(session.id);
        assert.equal(developmentSessions().length, 0);
        assert.ok(candidateBundle(updated.token));
      } finally {
        stopDevelopment(session.id);
      }
    },
  );
  await check('orphan storage cleanup respects exact plugin identity', async () => {
    const before = await pluginStorageInfo();
    assert.ok(before.some((entry) => entry.id === 'test.sandbox' && !entry.installed));
    await assert.rejects(clearPluginStorage('../registry'));
    await clearPluginStorage('test.sandbox');
    assert.equal(
      (await pluginStorageInfo()).some((entry) => entry.id === 'test.sandbox'),
      false,
    );
    assert.ok(listPlugins().length);
  });
  await check('network origin grants, redirect denial, bounds and cancellation', async () => {
    let hits = 0;
    const peer = http.createServer((_request, response) => {
      hits++;
      response.end('peer');
    });
    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const peerOrigin = `http://127.0.0.1:${(peer.address() as import('node:net').AddressInfo).port}`;
    const server = http.createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: peerOrigin });
        response.end();
      } else if (request.url === '/large') response.end('x'.repeat(140000));
      else if (request.url === '/hang') {
        /* cancellation probe */
      } else response.end('hello');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
    try {
      const candidate = await make(
        `return (await window.toolbox.network.fetch({url:${JSON.stringify(origin)}})).body;`,
        [`network:${origin}`],
      );
      await assert.rejects(run(candidate.token), /未授权/);
      await installCandidate(candidate.token);
      await configurePlugin('test.sandbox', true, false, [`network:${origin}`]);
      assert.equal(await run(), 'hello');
      const authorize = (value: string) => {
        if (value !== origin) throw new Error('origin denied');
      };
      await assert.rejects(
        pluginFetch({ url: origin + '/redirect' }, authorize, new AbortController().signal),
        /origin denied/,
      );
      assert.equal(hits, 0);
      await assert.rejects(
        pluginFetch({ url: origin + '/large' }, authorize, new AbortController().signal),
        /128 KB/,
      );
      await assert.rejects(
        pluginFetch(
          { url: origin, headers: { Host: 'evil' } },
          authorize,
          new AbortController().signal,
        ),
      );
      const cancel = new AbortController();
      const pending = pluginFetch({ url: origin + '/hang' }, authorize, cancel.signal);
      setTimeout(() => cancel.abort(), 50);
      await assert.rejects(pending);
    } finally {
      server.closeAllConnections();
      peer.closeAllConnections();
      server.close();
      peer.close();
    }
  });
  await check('SDK Diff uses host comparison and preview cannot bypass permission', async () => {
    const candidate = await make(
      `return JSON.stringify(await window.toolbox.diff.compare('a\\nb\\n','a\\nc\\n'));`,
      ['tools.diff'],
    );
    await assert.rejects(run(candidate.token), /未授权/);
    await installCandidate(candidate.token);
    await configurePlugin('test.sandbox', true, false, ['tools.diff']);
    const result = JSON.parse(String(await run()));
    assert.ok(result.lines.some((line: { kind: string }) => line.kind === 'added'));
    assert.ok(result.lines.some((line: { kind: string }) => line.kind === 'removed'));
  });
  await check('SDK image processing saves actual bytes without revealing paths', async () => {
    const file = path.join(root, 'source.png');
    await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ff0000' } })
      .png()
      .toFile(file);
    options.pick(file);
    await install(
      `const [f]=await toolbox.files.select(); const meta=await toolbox.image.probe(f.handle); const out=await toolbox.image.compress(f.handle,{format:'webp'}); return JSON.stringify({meta,out});`,
      ['files.readSelected', 'files.save', 'tools.image'],
    );
    const result = JSON.parse(String(await run()));
    assert.equal(result.meta.width, 12);
    assert.equal(result.meta.path, undefined);
    assert.equal(result.out.saved, true);
    assert.equal(
      (await sharp(await fs.readFile(path.join(root, 'saved.txt'))).metadata()).format,
      'webp',
    );
    await install(
      `const [f]=await toolbox.files.select(); return JSON.stringify(await toolbox.image.compress(f.handle,{outputDir:'C:/'}));`,
      ['files.readSelected', 'files.save', 'tools.image'],
    );
    await assert.rejects(run(), /outputDir|Unrecognized/);
  });
  await check('SDK audio conversion uses existing ffmpeg implementation', async () => {
    const file = path.join(root, 'tone.wav');
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(16000, 40);
    await fs.writeFile(file, wav);
    options.pick(file);
    await install(
      `const [f]=await toolbox.files.select(); return JSON.stringify(await toolbox.media.convertAudio(f.handle,{format:'flac'}));`,
      ['files.readSelected', 'files.save', 'tools.media'],
    );
    assert.equal(JSON.parse(String(await run())).saved, true);
    assert.equal((await fs.readFile(path.join(root, 'saved.txt'))).toString('ascii', 0, 4), 'fLaC');
  });
  await check('SDK webtest reads and patches the shared session with revision checks', async () => {
    const session = new WebTestSession({
      launch: async () => {
        throw new Error('read/patch must not launch');
      },
      artifactDir: () => root,
      videoDir: () => root,
      changed: () => {},
    });
    session.setFlow({
      schema: 'toolbox.webtest',
      version: 1,
      name: 'SDK case',
      createdAt: new Date().toISOString(),
      viewport: { width: 800, height: 600 },
      steps: [{ id: 'click-step', pageId: 'page-1', action: 'click', selector: '#old' }],
    });
    let flushed = 0;
    registerWebTestAccess({
      session,
      ready: Promise.resolve(),
      flush: async () => {
        flushed++;
      },
      videos: async () => [],
    });
    await install(
      `const state=await toolbox.webtest.status(); const result=await toolbox.webtest.patchSteps({expectedRevision:state.revision,dryRun:false,patches:[{id:'click-step',selector:'#new'}]}); return String(result.saved);`,
      ['tools.webtest'],
    );
    assert.equal(await run(), 'true');
    assert.equal(session.snapshot().flow?.steps[0].selector, '#new');
    assert.equal(flushed, 1);
    await install(
      `await toolbox.webtest.patchSteps({expectedRevision:0,dryRun:false,patches:[{id:'click-step',selector:'#wrong'}]}); return 'unexpected';`,
      ['tools.webtest'],
    );
    await assert.rejects(run(), /已变化/);
    assert.equal(session.snapshot().flow?.steps[0].selector, '#new');
  });
  await check(
    'MCP stdio discovery/call, trust, AI gate, revision, error and cancellation',
    async () => {
      const file = path.join(root, 'mcp-server.cjs');
      await fs.writeFile(
        file,
        `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}}};else if(m.method==='tools/list')result={tools:[{name:'sum',description:'Sum',inputSchema:{type:'object'}}]};else if(m.params.name==='hang')return;else if(m.params.name==='failure'){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32602,message:'invalid arguments'}})+'\\n');return;}else result={content:[{type:'text',text:String(m.params.arguments.a+m.params.arguments.b)}],secret:!!process.env.TB_MCP_SECRET};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`,
      );
      const config = {
        id: randomUUID(),
        name: 'Test MCP',
        executable: process.env.TB_PLUGIN_NODE!,
        args: [file],
        cwd: root,
        enabled: true,
        trusted: false,
        aiEnabled: false,
        revision: randomUUID(),
      };
      await assert.rejects(saveMcpServer(config), /信任/);
      await saveMcpServer({ ...config, trusted: true });
      const saved = listMcpServers().find((server) => server.id === config.id)!;
      assert.equal(mcpTools().length, 0);
      const tools = (await runMcp({ id: config.id, owner: 'discover' })) as { name: string }[];
      assert.equal(tools[0].name, 'sum');
      process.env.TB_MCP_SECRET = 'must-not-inherit';
      const result = (await runMcp({
        id: config.id,
        owner: 'sum',
        tool: 'sum',
        input: { a: 2, b: 3 },
      })) as { content: { text: string }[]; secret: boolean };
      delete process.env.TB_MCP_SECRET;
      assert.equal(result.content[0].text, '5');
      assert.equal(result.secret, false);
      await assert.rejects(runMcp({ id: config.id, owner: 'ai-deny', ai: true }), /未授权/);
      await assert.rejects(
        runMcp({ id: config.id, owner: 'stale', revision: randomUUID() }),
        /配置已变化/,
      );
      await assert.rejects(
        runMcp({ id: config.id, owner: 'failure', tool: 'failure' }),
        /invalid arguments/,
      );
      const pending = runMcp({ id: config.id, owner: 'cancel', tool: 'hang' });
      setTimeout(() => cancelMcp('cancel'), 250);
      await assert.rejects(pending, /取消/);
      await saveMcpServer({ ...saved, aiEnabled: true });
      assert.equal(mcpTools().length, 2);
      await removeMcpServer(config.id);
      assert.equal(mcpTools().length, 0);
    },
  );
  await verifyMcpHttp(check);
  if (listPlugins().some((record) => record.manifest.id === 'test.sandbox'))
    await changePlugin('test.sandbox', 'uninstall');
  for (const candidate of listCandidates()) await discardCandidate(candidate.token);
}
