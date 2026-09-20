const { _electron: electron } = require('playwright-core');
const { build } = require('esbuild');
const { mkdir, readFile, writeFile, stat } = require('node:fs/promises');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

(async () => {
  await build({
    entryPoints: ['scripts/tbverify/webtest-electron-app.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: [
      'electron',
      'playwright-core',
      '@ffmpeg-installer/ffmpeg',
      '@ffprobe-installer/ffprobe',
    ],
    outfile: 'out-tbverify/webtest-electron-app.cjs',
  });
  const directory = resolve('out-tbverify/webtest-electron');
  await mkdir(directory, { recursive: true });
  const videoDirectory = resolve(directory, 'tool-cache/webtest/videos/video-review');
  await mkdir(videoDirectory, { recursive: true });
  await writeFile(
    resolve(directory, 'settings.json'),
    JSON.stringify({
      dataDir: resolve(directory, 'data'),
      cacheDir: resolve(directory, 'tool-cache'),
    }),
  );
  const videoPath = resolve(videoDirectory, 'cache-recording.webm');
  execFileSync(
    require('@ffmpeg-installer/ffmpeg').path,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=320x180:r=10',
      '-t',
      '1',
      '-c:v',
      'libvpx',
      videoPath,
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  const mp4Path = resolve(videoDirectory, 'cache-recording.mp4');
  execFileSync(
    require('@ffmpeg-installer/ffmpeg').path,
    [
      '-y',
      '-i',
      videoPath,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4Path,
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  const flow = {
    schema: 'toolbox.webtest',
    version: 1,
    name: '界面联调用例',
    createdAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
    steps: [
      { id: 'initial', pageId: 'page-1', action: 'navigate', path: './' },
      {
        id: 'fill',
        pageId: 'page-1',
        action: 'fill',
        selector: 'input:nth-of-type(2)',
        fragile: true,
        value: 'qa-user',
      },
    ],
  };
  await writeFile(resolve(directory, 'import.json'), JSON.stringify(flow));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await electron.launch({
    executablePath: require('electron'),
    args: [resolve('out-tbverify/webtest-electron-app.cjs')],
    env,
  });
  try {
    const page = await application.firstWindow();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('textbox', { name: '录制浏览器宽度', exact: true }).fill('1100');
    await page.getByRole('textbox', { name: '录制浏览器高度', exact: true }).fill('750');
    console.log('PASS 尺寸输入框可编辑');
    const videoSwitch = page.getByRole('switch', { name: '同时录制视频', exact: true });
    if ((await videoSwitch.getAttribute('aria-checked')) !== 'true') await videoSwitch.click();
    const formatSelect = page
      .locator('.n-form-item')
      .filter({ has: page.locator('.n-form-item-label', { hasText: '视频格式' }) })
      .locator('.n-base-selection');
    await formatSelect.click();
    await page.locator('.n-base-select-option').filter({ hasText: 'MP4（H.264）' }).click();
    await page.getByText('回放测试', { exact: true }).click();
    const sizeSwitch = page.getByRole('switch', { name: '使用用例尺寸', exact: true });
    if ((await sizeSwitch.getAttribute('aria-checked')) === 'true') await sizeSwitch.click();
    await page.getByRole('textbox', { name: '回放浏览器宽度', exact: true }).fill('900');
    await page.getByRole('textbox', { name: '回放浏览器高度', exact: true }).fill('600');
    await page.getByText('录制用例', { exact: true }).click();
    await page.waitForTimeout(500);
    await page.reload();
    assert.equal(
      await page.getByRole('textbox', { name: '录制浏览器宽度', exact: true }).inputValue(),
      '1100',
    );
    assert.equal(
      await page.getByRole('textbox', { name: '录制浏览器高度', exact: true }).inputValue(),
      '750',
    );
    assert.ok((await formatSelect.innerText()).includes('MP4'));
    await page.getByText('回放测试', { exact: true }).click();
    assert.equal(await sizeSwitch.getAttribute('aria-checked'), 'false');
    assert.equal(
      await page.getByRole('textbox', { name: '回放浏览器宽度', exact: true }).inputValue(),
      '900',
    );
    assert.equal(
      await page.getByRole('textbox', { name: '回放浏览器高度', exact: true }).inputValue(),
      '600',
    );
    await page.getByText('录制用例', { exact: true }).click();
    for (const extra of [
      { videoFormat: 'avi' },
      { viewport: { width: 0, height: 720 } },
      { viewport: { width: 1280, height: 2161 } },
    ]) {
      const invalid = await page.evaluate(
        (extra) =>
          window.api.webtest.record({
            name: 'invalid',
            startUrl: 'http://127.0.0.1/',
            baseUrl: 'http://127.0.0.1/',
            browser: 'msedge',
            recordVideo: true,
            ...extra,
          }),
        extra,
      );
      assert.notEqual(invalid.code, 0);
    }
    assert.equal((await page.evaluate(() => window.api.webtest.snapshot())).data.mode, 'idle');
    console.log('PASS 视频格式、录制和回放尺寸刷新后保留，真实 IPC 拒绝非法格式与尺寸');
    await page.getByText('cache-recording.webm', { exact: true }).waitFor();
    const videoRow = page
      .locator('.webtest-videos__item')
      .filter({ hasText: 'cache-recording.webm' });
    const recordedVideos = await page.evaluate(() => window.api.webtest.videos());
    assert.equal(recordedVideos.code, 0);
    assert.ok(recordedVideos.data.some((video) => video.path === videoPath && video.size > 0));
    await videoRow.getByRole('button', { name: '播放视频', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate(async (video) => {
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    await page.keyboard.press('Escape');
    await page.locator('video').waitFor({ state: 'detached' });
    console.log('PASS 启动恢复历史录制视频，真实媒体协议可播放且关闭后释放播放器');
    await videoRow.getByRole('button', { name: '保存视频', exact: true }).click();
    await page.getByText('视频已保存', { exact: true }).waitFor();
    const savedPath = resolve(directory, 'saved-video.webm');
    assert.deepEqual(await readFile(savedPath), await readFile(videoPath));
    await application.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    const canceledSave = await page.evaluate(
      (path) => window.api.webtest.saveVideo(path),
      videoPath,
    );
    assert.equal(canceledSave.code, 0);
    assert.equal(canceledSave.data, null);
    assert.deepEqual(await readFile(savedPath), await readFile(videoPath));
    await application.evaluate(({ dialog }, directory) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: `${directory}/export.js` });
    }, directory);
    const invalidDelete = await page.evaluate(
      (path) => window.api.webtest.deleteVideo(path),
      savedPath,
    );
    assert.notEqual(invalidDelete.code, 0);
    assert.ok((await stat(savedPath)).size > 0);
    console.log('PASS 保存视频复制完整文件，取消不改文件，拒绝删除目录外的另存副本');
    await page.getByRole('button', { name: '导入用例', exact: true }).click();
    await page.getByText('界面联调用例 · 2 步', { exact: true }).waitFor();
    console.log('PASS 真实 preload + IPC 导入 JSON 并显示步骤');
    await page.getByRole('button', { name: '编辑', exact: true }).nth(1).click();
    assert.equal(await page.getByPlaceholder('执行前等待（毫秒）').isDisabled(), true);
    await page.getByPlaceholder('输入值、快捷键或检查点的预期值').fill('new-value');
    await page.getByRole('button', { name: '保存步骤', exact: true }).click();
    await page.getByText('new-value', { exact: true }).waitFor();
    await page.getByText('cache-recording.webm', { exact: true }).waitFor();
    await page.getByText('⚠ 结构定位 · input:nth-of-type(2)', { exact: true }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.api.webtest.snapshot())).data.flow.steps[1].fragile,
      true,
    );
    console.log('PASS 编辑输入值后保留结构定位标记');
    console.log('PASS 编辑步骤通过真实 IPC 保存，Vue Proxy 可以克隆');
    await page.getByRole('button', { name: '添加检查点', exact: true }).click();
    await page
      .getByPlaceholder('[data-testid="submit"]', { exact: true })
      .fill('[data-testid="result"]');
    await page.getByPlaceholder('执行前等待（毫秒）').fill('750');
    await page.getByRole('button', { name: '保存步骤', exact: true }).click();
    await page.getByText('界面联调用例 · 3 步', { exact: true }).waitFor();
    const response = await page.evaluate(() => window.api.webtest.snapshot());
    assert.equal(response.code, 0);
    assert.equal(response.data.flow.steps[2].action, 'assertVisible');
    assert.equal(response.data.flow.steps[2].delayBeforeMs, 750);
    await page.getByText('750 ms', { exact: true }).waitFor();
    console.log('PASS 步骤间隔可编辑、显示并通过 IPC 保存，输入步骤跳过等待');
    console.log('PASS 添加检查点并持久化至主进程');
    const patched = await page.evaluate(async () => (await window.api.webtest.snapshot()).data);
    const aiPatch = {
      expectedRevision: patched.revision,
      dryRun: false,
      patches: [{ id: patched.flow.steps[2].id, delayBeforeMs: 900 }],
    };
    const aiResult = await application.evaluate(async (_electron, input) => {
      return await globalThis.__verifyWebTestTool('webtest_patch_steps', input);
    }, aiPatch);
    assert.equal(aiResult.data.saved, true);
    await page.getByText('900 ms', { exact: true }).waitFor();
    const persistedFlow = JSON.parse(
      await readFile(resolve(directory, 'data/webtest/last-flow.json'), 'utf8'),
    );
    assert.equal(persistedFlow.steps[2].delayBeforeMs, 900);
    console.log('PASS AI 步骤修复共用 UI 会话，进度推送立即更新页面且自动保存落盘');
    await page.getByRole('button', { name: '导出', exact: true }).hover();
    await page.getByText('JavaScript 脚本', { exact: true }).click();
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await stat(resolve(directory, 'export.js'))).size > 0) break;
      } catch {}
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(
      (await readFile(resolve(directory, 'export.js'), 'utf8')).includes(
        'TOOLBOX_WEBTEST_DATA_BEGIN',
      ),
    );
    console.log('PASS 界面导出 JavaScript 文件');
    await page.getByText('回放测试', { exact: true }).click();
    const screenshot = async (name) => {
      const dataUrl = await application.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()[0].capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          })
        ).toDataURL(),
      );
      await writeFile(resolve(directory, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    };
    await screenshot('desktop.png');
    await application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(900, 600);
    });
    await screenshot('compact.png');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflow, false);
    assert.deepEqual(errors, []);
    console.log('PASS 最小窗口无页面横向溢出，无 Vue 运行错误');
    await page.reload();
    await page.getByText('界面联调用例 · 3 步', { exact: true }).waitFor();
    console.log('PASS 页面刷新恢复主进程用例');
    await page.getByRole('button', { name: '清空步骤', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.api.webtest.snapshot())).data.flow.steps.length,
      3,
    );
    await page.getByRole('button', { name: '清空步骤', exact: true }).click();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.getByText('界面联调用例 · 0 步', { exact: true }).waitFor();
    const cleared = (await page.evaluate(() => window.api.webtest.snapshot())).data;
    assert.equal(cleared.flow.steps.length, 0);
    assert.equal(cleared.flow.name, '界面联调用例');
    assert.equal(cleared.results.length, 0);
    assert.equal(cleared.activeStepId, null);
    await page.reload();
    await page.getByText('界面联调用例 · 0 步', { exact: true }).waitFor();
    console.log('PASS 清空步骤支持取消，确认后保存空用例并清除回放状态');
    await page.getByText('cache-recording.webm', { exact: true }).waitFor();
    assert.ok((await stat(videoPath)).size > 0);
    console.log('PASS 编辑、清空用例和刷新后，录制视频入口与文件仍保留');
    await videoRow.getByRole('button', { name: '删除视频', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.ok((await stat(videoPath)).size > 0);
    await videoRow.getByRole('button', { name: '删除视频', exact: true }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByText('视频已删除', { exact: true }).waitFor();
    await assert.rejects(stat(videoPath), { code: 'ENOENT' });
    assert.ok((await stat(savedPath)).size > 0);
    await page.getByRole('button', { name: '刷新视频', exact: true }).click();
    await page.getByText('cache-recording.webm', { exact: true }).waitFor({ state: 'detached' });
    assert.ok(
      !(await page.evaluate(() => window.api.webtest.videos())).data.some(
        (video) => video.path === videoPath,
      ),
    );
    const denied = await application.evaluate(
      async ({ net }, url) => (await net.fetch(url)).status,
      recordedVideos.data.find((video) => video.path === videoPath).url,
    );
    assert.equal(denied, 403);
    console.log('PASS 删除支持取消，确认后移除缓存视频并撤销播放权限，另存副本保留');
    const mp4Row = page.locator('.webtest-videos__item').filter({ hasText: 'cache-recording.mp4' });
    await mp4Row.getByRole('button', { name: '播放视频', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await page.locator('video').evaluate(async (video) => {
      await video.play();
    });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
    await page.keyboard.press('Escape');
    await page.locator('video').waitFor({ state: 'detached' });
    const savedMp4 = resolve(directory, 'saved-video.mp4');
    await application.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async (_window, options) => {
        if (options.filters[0].extensions[0] !== 'mp4') throw new Error('MP4 保存扩展名错误');
        return { canceled: false, filePath: path };
      };
    }, savedMp4);
    await mp4Row.getByRole('button', { name: '保存视频', exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector('.webtest-videos__item .n-button--disabled'),
    );
    assert.deepEqual(await readFile(savedMp4), await readFile(mp4Path));
    await application.evaluate(
      ({ dialog }, path) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      },
      resolve(directory, 'mislabeled.webm'),
    );
    assert.notEqual(
      (await page.evaluate((path) => window.api.webtest.saveVideo(path), mp4Path)).code,
      0,
    );
    await assert.rejects(stat(resolve(directory, 'mislabeled.webm')), { code: 'ENOENT' });
    await mp4Row.getByRole('button', { name: '删除视频', exact: true }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByText('cache-recording.mp4', { exact: true }).waitFor({ state: 'detached' });
    await assert.rejects(stat(mp4Path), { code: 'ENOENT' });
    assert.ok((await stat(savedMp4)).size > 0);
    assert.deepEqual(errors, []);
    console.log('PASS MP4 真实媒体协议播放、按正确扩展名另存和删除，拒绝仅改名伪装格式');
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
