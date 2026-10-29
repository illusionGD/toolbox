const { build } = require('esbuild');
const { _electron } = require('playwright-core');
const { mkdir, writeFile, readFile, readdir, copyFile } = require('node:fs/promises');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const JSZip = require(require.resolve('jszip', { paths: [require.resolve('exceljs')] }));

(async () => {
  const root = resolve('out-tbverify', `plugins-${Date.now()}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ dataDir: join(root, 'data'), cacheDir: join(root, 'cache') }),
  );
  await mkdir(resolve('out-tbverify/preload'), { recursive: true });
  await copyFile('out/preload/plugin.js', 'out-tbverify/preload/plugin.js');
  const zip = new JSZip();
  for (const name of await readdir('examples/plugins/translation-checker', { recursive: true })) {
    const file = join('examples/plugins/translation-checker', name);
    if ((await require('node:fs/promises').stat(file)).isFile())
      zip.file(name.replaceAll('\\', '/'), await readFile(file));
  }
  await writeFile(join(root, 'valid.tbplugin'), await zip.generateAsync({ type: 'nodebuffer' }));
  zip.file('../evil.js', 'bad');
  await writeFile(
    join(root, 'traversal.tbplugin'),
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
  const large = new JSZip();
  large.file('big.js', Buffer.alloc(5 * 1024 * 1024));
  await writeFile(
    join(root, 'large.tbplugin'),
    await large.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  await build({
    entryPoints: ['scripts/tbverify/plugins-electron.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: [
      'electron',
      'yauzl',
      'jszip',
      'sharp',
      'cn-font-split',
      'subset-font',
      'fontverter',
      '@ffmpeg-installer/ffmpeg',
      '@ffprobe-installer/ffprobe',
    ],
    outfile: 'out-tbverify/main/plugins-test.cjs',
  });
  const env = {
    ...process.env,
    TB_PLUGIN_TEST_ROOT: root,
    TB_PLUGIN_NODE: process.execPath,
    TB_PLUGIN_SKIP_TIMEOUT: process.argv.includes('--quick') ? '1' : '0',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: [resolve('out-tbverify/main/plugins-test.cjs')],
    env,
    timeout: 30000,
  });
  app.process().stdout.on('data', (chunk) => process.stdout.write(chunk));
  app.process().stderr.on('data', (chunk) => process.stderr.write(chunk));
  try {
    await app.evaluate(async () => {
      const deadline = Date.now() + 90000;
      while (!globalThis.__pluginResults && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
      if (!globalThis.__pluginResults) throw new Error('Runtime verification timed out');
    });
    const page = (await app.windows())[0];
    await page.waitForSelector('.plugin-manager');
    await page.getByRole('button', { name: '导入开发目录', exact: true }).click();
    await page.getByRole('button', { name: '导出草稿 .tbplugin', exact: true }).click();
    assert.equal((await readFile(join(root, 'saved.txt'))).readUInt32LE(0), 0x04034b50);
    await page.getByRole('button', { name: '隔离预览', exact: true }).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('textarea')).some((node) =>
        node.value.includes('"missing"'),
      ),
    );
    await page.screenshot({ path: join(root, 'manager.png') });
    await page.keyboard.press('Escape');
    await page.getByText('文件工具', { exact: true }).click();
    await page.locator('.side-nav').getByText('翻译检查', { exact: true }).click();
    await page.getByRole('button', { name: '运行', exact: true }).click();
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll('textarea')).some((node) =>
        node.value.includes('"missing"'),
      ),
    );
    await page.screenshot({ path: join(root, 'command.png') });
    await page.locator('.side-nav').getByText('翻译检查 · 自定义页', { exact: true }).click();
    const customReady = app.waitForEvent('window');
    await page.getByRole('button', { name: '打开 翻译检查 · 自定义页', exact: true }).click();
    const custom = await customReady;
    await custom.locator('#run').click();
    await custom.waitForFunction(() =>
      document.querySelector('#result').textContent.includes('"missing"'),
    );
    assert.equal(await custom.evaluate(() => typeof window.api), 'undefined');
    await page.evaluate(async () => {
      await window.api.plugins.theme({ mode: 'light', primaryColor: '#ff0000' });
    });
    await custom.waitForFunction(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--tb-bg-base').trim() ===
        '#fff',
    );
    assert.equal(
      await custom.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--tb-color-primary').trim(),
      ),
      '#ff0000',
    );
    await custom.screenshot({ path: join(root, 'custom.png') });
    const closed = custom.waitForEvent('close');
    await page.locator('.side-nav').getByText('插件管理', { exact: true }).click();
    await closed;
    await page.getByRole('button', { name: '添加 MCP 服务', exact: true }).click();
    await page.getByText('我信任此程序及启动参数', { exact: true }).waitFor();
    const mcpForm = page.locator('.n-modal').filter({ hasText: 'MCP 配置' });
    await mcpForm.locator('.n-select').click();
    await page.getByText('HTTP（Streamable HTTP）', { exact: true }).last().click();
    await mcpForm.getByPlaceholder('https://example.com/mcp').fill('http://127.0.0.1:54321/mcp');
    await mcpForm
      .locator('.n-form-item')
      .filter({ hasText: '名称' })
      .locator('input')
      .fill('HTTP UI fixture');
    await mcpForm.locator('textarea').fill('{"Authorization":"Bearer ui-fixture-token"}');
    await mcpForm.getByText('我信任此服务地址及请求头', { exact: true }).click();
    await mcpForm.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(async () =>
      (await window.api.plugins.mcpList()).data.some((s) => s.name === 'HTTP UI fixture'),
    );
    const savedMcp = await page.evaluate(async () =>
      (await window.api.plugins.mcpList()).data.find((s) => s.name === 'HTTP UI fixture'),
    );
    assert.equal(savedMcp.transport, 'http');
    assert.equal(savedMcp.headers.Authorization, 'Bearer ui-fixture-token');
    assert.equal(savedMcp.trusted, true);
    assert.equal(savedMcp.enabled, false);
    assert.equal(Object.hasOwn(savedMcp, 'executable'), false);
    await page
      .locator('.n-space')
      .filter({ has: page.getByText('HTTP UI fixture · HTTP · 已停用', { exact: true }) })
      .getByRole('button', { name: '配置', exact: true })
      .last()
      .click();
    assert.equal(
      await mcpForm.locator('textarea').inputValue(),
      '{\n  "Authorization": "Bearer ui-fixture-token"\n}',
    );
    await mcpForm.getByPlaceholder('https://example.com/mcp').fill('http://127.0.0.1:54322/mcp');
    assert.equal(
      await mcpForm.locator('.n-checkbox').first().getAttribute('aria-checked'),
      'false',
    );
    await page.screenshot({ path: join(root, 'mcp-http.png') });
    await page.keyboard.press('Escape');
    const count = await app.evaluate(() => globalThis.__pluginResults.length);
    assert.ok(count >= 10);
    console.log(
      `PASS UI import/preview/navigation/run; ${count} runtime scenarios; artifacts: ${root}`,
    );
    await page
      .getByRole('button', { name: /翻译检查 · 1\.0\.0/ })
      .first()
      .click();
    await page.getByRole('button', { name: '安装此版本（保持停用）', exact: true }).click();
    await page.getByRole('button', { name: '授权 / 启用', exact: true }).click();
    await page.getByText('启用插件', { exact: true }).click();
    await page.getByRole('button', { name: '保存授权', exact: true }).click();
    await page.waitForFunction(async () =>
      (await window.api.plugins.list()).data.some(
        (r) => r.manifest.id === 'example.translation-checker' && r.enabled,
      ),
    );
    await app.evaluate(() => globalThis.__pluginTest.stage());
    console.log('PASS UI install and explicit enable');
    await app.evaluate(() => globalThis.__pluginTest.schema());
    await page.getByRole('button', { name: /宿主工具示例 · 1\.0\.0/ }).click();
    assert.equal(await page.locator('.plugin-schema-field .n-input-number').count(), 2);
    assert.equal(await page.locator('.plugin-schema-field .n-switch').count(), 1);
    await page.locator('.plugin-manager > .n-select').click();
    await page.getByText('比较多组文本', { exact: true }).last().click();
    await page.getByRole('button', { name: '添加项', exact: true }).click();
    assert.equal(await page.locator('.plugin-schema-field__row').count(), 2);
    await page.getByRole('button', { name: '删除项', exact: true }).first().click();
    assert.equal(await page.locator('.plugin-schema-field__row').count(), 1);
    assert.deepEqual(
      await page
        .locator('.plugin-schema-field__row textarea')
        .evaluateAll((nodes) => nodes.map((node) => node.value)),
      ['', ''],
    );
    await page.screenshot({ path: join(root, 'schema.png') });
    console.log('PASS UI export, live theme, MCP entry, typed and nested schema fields');
  } finally {
    await app.close();
  }
  const restarted = await _electron.launch({
    args: [resolve('out-tbverify/main/plugins-test.cjs')],
    env: { ...env, TB_PLUGIN_RESTART: '1' },
  });
  try {
    await restarted.evaluate(async () => {
      const deadline = Date.now() + 10000;
      while (!globalThis.__pluginResults && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 100));
      if (!globalThis.__pluginResults) throw new Error('Restart failed');
    });
    console.log('PASS restart restores installation, grants and drafts');
  } finally {
    await restarted.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
