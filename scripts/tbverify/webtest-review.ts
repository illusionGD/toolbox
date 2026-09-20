import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { transform } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright-core';
import { WebTestSession } from '../../electron/main/webtest/session';
import { selectorForElement } from '../../electron/main/webtest/recorder';
import { waitBeforeStep } from '../../electron/main/webtest/replay';
import { finalizeRecordedVideo, listRecordedVideos } from '../../electron/main/webtest/videos';
import { probeVideo } from '../../electron/main/ffmpeg/probe';
import { registerWebTestAccess } from '../../electron/main/webtest/access';
import { WEBTEST_TOOLS } from '../../electron/main/ai/tools/webtest';
import type { ToolCtx } from '../../electron/main/ai/tools/types';
import { exportFlow } from '../../electron/main/webtest/export';
import {
  importFlow,
  parseFlow,
  resolveTargetUrl,
  toRelativePath,
} from '../../electron/main/webtest/flow';
import type { WebTestFlow, WebTestSnapshot } from '../../electron/shared/webtest';

const directory = resolve('out-tbverify', `webtest-${Date.now()}`);
await mkdir(directory, { recursive: true });
let checks = 0;
const check = (condition: unknown, message: string): void => {
  assert.ok(condition, message);
  checks++;
  console.log('PASS', message);
};
const wait = async (
  condition: () => boolean | Promise<boolean>,
  message: string,
  timeout = 15000,
): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(`Timeout: ${message}`);
};
let submitted = 0;
const servers: Server[] = [];
const serve = async (prefix: string, text: string): Promise<string> => {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === `${prefix}lists`) {
      const items = (className: string, count: number, action = '') =>
        Array.from(
          { length: count },
          (_, index) =>
            `<li${className ? ` class="${className}"` : ''}${action ? ` onclick="${action.replace('INDEX', String(index))}"` : ''}>${text} ${index}</li>`,
        ).join('');
      const extra =
        prefix === '/source/'
          ? ''
          : `
        <div class="luna-dom-viewer"><ul>${items('luna-dom-viewer-tree-item', 9)}</ul><ol>${items('luna-dom-viewer-tree-item', 9)}</ol></div>
        <extra-panel></extra-panel><script>document.querySelector('extra-panel').attachShadow({mode:'open'}).innerHTML='<ul>${items('luna-dom-viewer-tree-item', 9)}</ul>';</script>`;
      response.end(`<!doctype html><html><body>
        <main><section class="language-picker"><ul>${items('lang-item', 9, "document.querySelector('[data-testid=result]').value=INDEX===6?'passed':'wrong'")}</ul></section>
        <aside><ol>${items('', 2, "document.querySelector('[data-testid=plain-result]').value=INDEX===1?'passed':'wrong'")}</ol></aside></main>
        <input data-testid="result" readonly><input data-testid="plain-result" readonly>${extra}
      </body></html>`);
      return;
    }
    if (url.pathname === `${prefix}structure`) {
      response.end(`<!doctype html><html><body>
        <section data-testid="structural-panel">
          <div><button onclick="document.querySelector('[data-testid=result]').value='wrong'">${text}</button></div>
          <div><button onclick="document.querySelector('[data-testid=result]').value='passed'">${text}</button></div>
        </section>
        <input data-testid="result" readonly><input data-testid="shadow-result" readonly>
        <qa-widget></qa-widget><qa-widget></qa-widget>
        <script>for (const host of document.querySelectorAll('qa-widget')) {
          host.attachShadow({mode:'open'}).innerHTML='<button>${text}</button><button>${text}</button>';
          for (const [index, button] of [...host.shadowRoot.querySelectorAll('button')].entries()) {
            button.onclick=()=>document.querySelector('[data-testid=shadow-result]').value=host===document.querySelectorAll('qa-widget')[1] && index===1?'passed':'wrong';
          }
        }</script>
        <iframe src="${prefix}frame"></iframe><iframe src="${prefix}frame"></iframe>
      </body></html>`);
      return;
    }
    if (url.pathname === `${prefix}timing`) {
      response.end(`<button data-testid="start" onclick="window.startAt=performance.now()">Start</button>
        <input data-testid="typing"><button data-testid="finish" onclick="document.querySelector('[data-testid=result]').value=performance.now()-window.startAt>=450?'passed':'too-fast'">Finish</button>
        <input data-testid="result" readonly>`);
      return;
    }
    if (url.pathname === `${prefix}form`) {
      response.end(
        `<form action="${prefix}done"><input data-testid="form-input" name="query"><button data-testid="form-submit" type="submit">Submit</button></form>`,
      );
      return;
    }
    if (url.pathname === `${prefix}dialog`) {
      response.end(
        '<button data-testid="dialog" onclick="confirm(\'Test confirm\')">Open confirm</button>',
      );
      return;
    }
    if (url.pathname === `${prefix}missing`) {
      response.writeHead(500);
      response.end('failure');
      return;
    }
    if (url.pathname === `${prefix}frame`) {
      response.end(
        '<input data-testid="inside" /><button data-testid="frame-button" onclick="this.dataset.clicked=1">iframe button</button>',
      );
      return;
    }
    if (url.pathname === `${prefix}done`) {
      submitted++;
      response.end('<main data-testid="done">Finished</main>');
      return;
    }
    if (url.pathname === `${prefix}popup`) {
      response.end('<input data-testid="popup-input">');
      return;
    }
    response.end(`<!doctype html><html><body>
      <h1>${text}</h1>
      <input data-testid="username" id="user"><textarea data-testid="note"></textarea>
      <input type="checkbox" data-testid="agree"><select data-testid="role"><option value="a">${text} A</option><option value="b">${text} B</option></select>
      <div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<input data-testid="shadow-input">';</script>
      <iframe data-testid="frame" src="${prefix}frame"></iframe>
      <a data-testid="popup" href="${prefix}popup" target="_blank">${text} popup</a>
      <button data-testid="route" onclick="location.hash='next'">${text} route</button>
      <a data-testid="submit" href="${prefix}done">${text} submit</a>
      <div style="height:1400px"></div>
    </body></html>`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as { port: number }).port}${prefix}`;
};

let browser: Browser | null = null;
let snapshot: WebTestSnapshot;
const session = new WebTestSession({
  launch: async () => {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    return browser;
  },
  artifactDir: () => directory,
  videoDir: () => join(directory, 'cache', 'webtest', 'videos'),
  changed: (value) => {
    snapshot = value;
  },
});
const run = async (
  flow: WebTestFlow,
  baseUrl: string,
  timeout = 1500,
): Promise<WebTestSnapshot> => {
  await session.startReplay({ flow, baseUrl, browser: 'msedge', timeout });
  await wait(() => session.snapshot().mode === 'idle', 'replay completion', 30000);
  return session.snapshot();
};
const child = (args: string[]): Promise<number | null> =>
  new Promise((done, fail) => {
    const process = spawn(globalThis.process.execPath, args, {
      cwd: directory,
      windowsHide: true,
      env: { ...globalThis.process.env, WEBTEST_HEADLESS: '1', WEBTEST_BROWSER: 'msedge' },
    });
    process.stdout.on('data', (data) => globalThis.process.stdout.write(data));
    process.stderr.on('data', (data) => globalThis.process.stderr.write(data));
    process.on('error', fail);
    process.on('exit', done);
  });

try {
  const recordBase = await serve('/source/', '原始文案');
  const replayBase = await serve('/different-root/', 'Changed copy');
  const recordingOptions = {
    name: '尺寸验证',
    startUrl: recordBase,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  } as const;
  for (const viewport of [
    { width: 319, height: 720 },
    { width: 3841, height: 720 },
    { width: 1280, height: 239 },
    { width: 1280, height: 2161 },
    { width: 1280.5, height: 720 },
    { width: NaN, height: 720 },
  ])
    await assert.rejects(session.startRecording({ ...recordingOptions, viewport }));
  await assert.rejects(
    session.startRecording({ ...recordingOptions, videoFormat: 'avi' as 'mp4' }),
  );
  check(session.snapshot().mode === 'idle' && !browser, '非法尺寸或视频格式在启动浏览器前被拒绝');
  for (const delayBeforeMs of [-1, 1.2, Infinity, 86400001]) {
    assert.throws(() =>
      parseFlow({
        schema: 'toolbox.webtest',
        version: 1,
        name: 'invalid timing',
        createdAt: new Date().toISOString(),
        viewport: { width: 1280, height: 720 },
        steps: [{ id: 'one', pageId: 'page-1', action: 'navigate', path: './', delayBeforeMs }],
      }),
    );
  }
  check(true, '拒绝非法步骤间隔');
  check(
    toRelativePath(`${recordBase}login?q=1#/list`, recordBase) === './login?q=1#/list',
    '相对路径保留查询参数和 hash',
  );
  check(
    resolveTargetUrl(replayBase, './login?q=1#/list') === `${replayBase}login?q=1#/list`,
    '同一用例映射不同 origin 和部署目录',
  );
  for (const path of [
    'https://evil.example/',
    './../escape',
    './%2e%2e/escape',
    './\\evil.example/',
  ])
    assert.throws(() => resolveTargetUrl(replayBase, path));
  checks++;
  console.log('PASS 拒绝绝对地址与路径越界');

  await session.startRecording({
    name: '跨环境回归',
    startUrl: recordBase,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: true,
    videoFormat: 'mp4',
    viewport: { width: 1023, height: 767 },
  });
  const page = browser!.contexts()[0].pages()[0];
  assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), {
    width: 1023,
    height: 767,
  });
  check(true, '录制页面使用配置的宽高');
  const fill = async (page: Page, selector: string, value: string): Promise<void> => {
    await page.locator(selector).fill(value);
    await wait(
      () =>
        session
          .snapshot()
          .flow!.steps.some((step) => step.action === 'fill' && step.value === value),
      `record fill ${value}`,
    );
  };
  await fill(page, '[data-testid="username"]', 'qa-user');
  await fill(page, '[data-testid="note"]', 'line one\nline two /* TOOLBOX_WEBTEST_DATA_END */');
  await page.locator('[data-testid="agree"]').check();
  await page.locator('[data-testid="role"]').selectOption('b');
  await fill(page, '[data-testid="shadow-input"]', 'shadow value');
  await page
    .frameLocator('[data-testid="frame"]')
    .locator('[data-testid="inside"]')
    .fill('iframe value');
  await page.frameLocator('[data-testid="frame"]').locator('[data-testid="frame-button"]').click();
  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-testid="popup"]').click();
  const popup = await popupPromise;
  await fill(popup, '[data-testid="popup-input"]', 'popup value');
  await popup.close();
  await page.locator('[data-testid="route"]').click();
  await wait(
    () =>
      session
        .snapshot()
        .flow!.steps.some((step) => step.action === 'assertUrl' && step.path?.includes('#next')),
    'hash checkpoint',
  );
  await page.locator('[data-testid="submit"]').click();
  await page.waitForURL(`${recordBase}done`);
  await wait(
    () => session.snapshot().flow!.steps.some((step) => step.path === './done'),
    'navigation checkpoint',
  );
  const recorded = await session.stop();
  const savedVideos = await listRecordedVideos(join(directory, 'cache', 'webtest', 'videos'), null);
  check(
    savedVideos.length > 0 &&
      savedVideos.every((video) => video.size > 0 && recorded.artifacts.includes(video.path)),
    '历史视频列表从缓存 webtest/videos 恢复真实录制，无需依赖当前会话',
  );
  check(
    (
      await listRecordedVideos(
        join(directory, 'cache', 'webtest', 'videos'),
        savedVideos[0].path.replace(/[\\/][^\\/]+$/, ''),
      )
    ).length === 0,
    '未结束的会话目录不出现在已保存视频列表中',
  );
  check(
    recorded.outcome === 'recorded' && !recorded.error,
    `真实浏览器录制结束：${recorded.error}`,
  );
  let flow = recorded.flow!;
  assert.deepEqual(flow.viewport, { width: 1023, height: 767 });
  for (const video of savedVideos) {
    assert.ok(video.path.endsWith('.mp4'));
    const meta = await probeVideo(video.path);
    assert.ok(meta.container.includes('mp4'));
    assert.equal(meta.video?.codec, 'h264');
    assert.equal(meta.video?.width, 1024);
    assert.equal(meta.video?.height, 768);
    assert.ok(meta.duration > 0);
    await assert.rejects(stat(video.path.slice(0, -4) + '.webm'), { code: 'ENOENT' });
  }
  check(true, '主页面和已关闭页签的视频均为真实 MP4/H.264，保持配置尺寸且无重复 WebM');
  const brokenVideo = join(directory, 'broken.webm');
  await writeFile(brokenVideo, 'invalid video');
  await assert.rejects(finalizeRecordedVideo(brokenVideo, 'mp4'));
  assert.equal(await readFile(brokenVideo, 'utf8'), 'invalid video');
  await assert.rejects(stat(join(directory, 'broken.mp4.tmp')), { code: 'ENOENT' });
  check(true, '转换失败保留原视频并清除不完整临时文件');
  await writeFile(join(directory, 'recorded.json'), JSON.stringify(flow, null, 2));
  check(
    flow.steps.some((step) => step.frames?.length),
    '记录 iframe 链',
  );
  check(
    flow.steps.some((step) => step.selector?.includes('shadow')),
    '记录开放 Shadow DOM',
  );
  check(
    flow.steps.some((step) => step.action === 'openPage'),
    '记录新页签及来源',
  );
  check(
    flow.steps.filter((step) => step.action === 'navigate').length === 1,
    '点击跳转使用检查点而不是重复导航',
  );
  check(
    !JSON.stringify(flow).includes(recordBase) && !JSON.stringify(flow).includes('原始文案'),
    '用例不包含原始环境或页面文案定位',
  );
  check(
    recorded.artifacts.length >= 2 &&
      (await Promise.all(recorded.artifacts.map((path) => stat(path)))).every(
        (info) => info.size > 0,
      ),
    '录制视频在停止后完整落盘（含新页签）',
  );
  flow = parseFlow({
    ...flow,
    steps: [
      ...flow.steps,
      {
        id: 'done-check',
        pageId: 'page-1',
        action: 'assertVisible',
        selector: '[data-testid="done"]',
      },
    ],
  });

  for (const format of ['json', 'js', 'ts'] as const) {
    const exported = exportFlow(flow, format);
    check(
      JSON.stringify(importFlow(exported, `.${format}`)) === JSON.stringify(flow),
      `${format} 导出 / 导入完整往返（含数据区标记文本）`,
    );
    await writeFile(join(directory, `test.${format}`), exported);
  }
  const passed = await run(flow, replayBase, 5000);
  check(
    passed.outcome === 'passed',
    `跨环境 + 文案变更 + iframe + 页签回放全部通过：${passed.error}`,
  );
  check(
    passed.artifacts.every((path) => !/\.(mp4|webm)$/i.test(path)),
    '回放不录视频',
  );
  check(passed.flow!.steps.length === flow.steps.length, '回放不追加录制步骤');
  const overrideFlow: WebTestFlow = {
    ...flow,
    steps: [
      flow.steps[0],
      {
        id: 'size-check',
        pageId: 'page-1',
        action: 'assertVisible',
        selector: 'body',
        delayBeforeMs: 1500,
      },
    ],
  };
  for (const viewport of [undefined, { width: 900, height: 600 }]) {
    await session.startReplay({
      flow: overrideFlow,
      baseUrl: replayBase,
      browser: 'msedge',
      timeout: 5000,
      viewport,
    });
    const replayPage = browser!.contexts()[0].pages()[0];
    await replayPage.waitForURL(replayBase);
    assert.deepEqual(
      await replayPage.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      viewport ?? flow.viewport,
    );
    await session.waitForReplay();
    assert.equal(session.snapshot().outcome, 'passed');
    assert.deepEqual(session.snapshot().flow!.viewport, flow.viewport);
    assert.deepEqual(session.snapshot().viewport, viewport ?? flow.viewport);
    const report = JSON.parse(
      await readFile(
        session.snapshot().artifacts.find((path) => path.endsWith('report.json'))!,
        'utf8',
      ),
    );
    assert.deepEqual(report.viewport, viewport ?? flow.viewport);
  }
  check(true, '回放默认沿用用例尺寸，自定义尺寸仅影响本次浏览器，不改写用例');
  check(
    (await child([join(directory, 'test.js'), replayBase])) === 0,
    '导出的 JS 可在独立 Node 进程运行',
  );
  const compiled = await transform(await readFile(join(directory, 'test.ts'), 'utf8'), {
    loader: 'ts',
    format: 'cjs',
    target: 'node20',
  });
  await writeFile(join(directory, 'test-ts.cjs'), compiled.code);
  check(
    (await child([join(directory, 'test-ts.cjs'), replayBase])) === 0,
    '导出的 TS 经标准编译后可独立执行',
  );

  const simple = {
    ...flow,
    steps: [
      flow.steps[0],
      {
        id: 'missing',
        action: 'assertVisible',
        pageId: 'page-1',
        selector: '[data-testid="missing"]',
      },
      { id: 'never', action: 'click', pageId: 'page-1', selector: '[data-testid="submit"]' },
    ],
  } as WebTestFlow;
  const before = submitted;
  const failed = await run(simple, replayBase, 500);
  check(
    failed.outcome === 'failed' &&
      failed.activeStepId === 'missing' &&
      failed.results[1].status === 'failed' &&
      failed.results[2].status === 'pending',
    '失败精确标记当前步，后续保持未执行',
  );
  check(submitted === before, '失败后确实没有提交后续页面操作');
  check(
    failed.artifacts.some((path) => path.endsWith('.png')) &&
      (await stat(failed.artifacts.find((path) => path.endsWith('.png'))!)).size > 0,
    '失败截图确实生成',
  );
  check(
    JSON.parse(
      await readFile(
        failed.artifacts.find((path) => path.endsWith('report.json'))!,
        'utf8',
      ),
    ).outcome === 'failed',
    '报告保存失败步骤和结果',
  );
  const duplicate = structuredClone(simple);
  duplicate.steps[1].selector = 'input';
  check(
    (await run(duplicate, replayBase)).outcome === 'failed',
    '定位多匹配时失败，不偷选第一个元素',
  );
  const wrongUrl = structuredClone(simple);
  wrongUrl.steps[1] = {
    id: 'missing',
    pageId: 'page-1',
    action: 'assertUrl',
    path: './unexpected',
  };
  check(
    (await run(wrongUrl, replayBase, 300)).results[1].status === 'failed',
    '错误跳转检查点会停止',
  );
  const serverError = structuredClone(simple);
  serverError.steps[0].path = './missing';
  check(
    (await run(serverError, replayBase)).results[0].status === 'failed',
    '导航 HTTP 500 会失败',
  );
  assert.throws(() => importFlow('throw new Error("must not execute")', '.js'));
  const withCode = `${exportFlow(flow, 'js')}\nthrow new Error('must not execute');`;
  check(importFlow(withCode, '.js').steps.length === flow.steps.length, '导入不执行脚本附加代码');
  assert.throws(() =>
    parseFlow({
      ...flow,
      steps: [{ id: 'x', pageId: 'page-1', action: 'eval', value: 'process.exit()' }],
    }),
  );
  assert.throws(() =>
    parseFlow({
      ...flow,
      steps: [{ id: 'x', pageId: 'page-1', action: 'click', selector: 'text=文案' }],
    }),
  );
  checks++;
  console.log('PASS 拒绝未知动作与文本定位');
  await session.startReplay({
    flow: simple,
    baseUrl: replayBase,
    browser: 'msedge',
    timeout: 10000,
  });
  await wait(() => session.snapshot().activeStepId === 'missing', 'before cancel');
  const canceled = await session.stop();
  check(
    canceled.mode === 'idle' &&
      canceled.outcome === 'canceled' &&
      canceled.results[2].status === 'pending',
    '用户取消立即中断后续步骤',
  );

  await session.startRecording({
    name: '暂停与恢复',
    startUrl: recordBase,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const resumePage = browser!.contexts()[0].pages()[0];
  await fill(resumePage, '[data-testid="username"]', 'before departure');
  await resumePage.goto(replayBase);
  await wait(
    () => session.snapshot().pausedPageIds?.includes('page-1') ?? false,
    'external navigation pauses',
  );
  const pausedCount = session.snapshot().flow!.steps.length;
  await resumePage.locator('[data-testid="username"]').fill('external input must not be recorded');
  await resumePage.locator('[data-testid="role"]').selectOption('b');
  await resumePage.evaluate(async () => {
    await (window as any).__toolboxRecorder.flush();
  });
  check(
    session.snapshot().mode === 'recording' &&
      !session.snapshot().error &&
      session.snapshot().flow!.steps.length === pausedCount,
    '跨域跳转暂停操作录制，不失败且不收集外站操作',
  );
  await resumePage.goto(recordBase);
  await wait(() => session.snapshot().pausedPageIds?.length === 0, 'recording resumes');
  await fill(resumePage, '[data-testid="username"]', 'after return');
  check(
    session
      .snapshot()
      .flow!.steps.some((step) => step.action === 'fill' && step.value === 'after return'),
    '返回原页面后继续录制输入',
  );
  await resumePage.goto(new URL('/outside-root/', recordBase).href);
  await wait(
    () => session.snapshot().pausedPageIds?.includes('page-1') ?? false,
    'same origin outside root pauses',
  );
  check(
    !session.snapshot().error && session.snapshot().mode === 'recording',
    '同域不同根目录跳转也不会终止录制',
  );
  await resumePage.goto(recordBase);
  await wait(() => session.snapshot().pausedPageIds?.length === 0, 'same origin resume');
  const popupOpened = resumePage.waitForEvent('popup');
  await resumePage.evaluate((url) => window.open(url), replayBase);
  const externalPopup = await popupOpened;
  await wait(() => (session.snapshot().pausedPageIds?.length ?? 0) > 0, 'external popup pauses');
  await fill(resumePage, '[data-testid="username"]', 'original page still recording');
  await externalPopup.close();
  await wait(() => session.snapshot().pausedPageIds?.length === 0, 'external popup closed');
  check(
    !session.snapshot().flow!.steps.some((step) => step.pageId !== 'page-1'),
    '外部页签不产生无效打开/关闭步骤，原页签可继续录制',
  );
  const resumed = await session.stop();
  check(
    resumed.outcome === 'recorded' &&
      !resumed.error &&
      !JSON.stringify(resumed.flow).includes('external input'),
    '多次离开再返回后正常保存，外站数据不会进入用例',
  );
  check(
    (await run(resumed.flow!, replayBase)).outcome === 'passed',
    '恢复后录制的用例可在另一环境回放',
  );

  await session.startRecording({
    name: '稳定 CSS',
    startUrl: recordBase,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const selectorPage = browser!.contexts()[0].pages()[0];
  await selectorPage.evaluate(() => {
    document.body.innerHTML = `
      <section data-testid="primary-form"><div><button class="save-button is-active css-a3f64c">保存</button></div></section>
      <section data-testid="secondary-form"><button class="save-button">保存</button></section>
      <input name="account" type="email"><input name="account" type="password">
      <button id="el-id-381624-7" class="confirm-order is-loading">确认</button>
      <div class="css-deadbeef"></div><div class="css-cafebabe"></div>`;
  });
  const anchored = await selectorPage
    .locator('[data-testid="primary-form"] button')
    .evaluate(selectorForElement);
  const combined = await selectorPage
    .locator('input[type="password"]')
    .evaluate(selectorForElement);
  const stableClass = await selectorPage.locator('.confirm-order').evaluate(selectorForElement);
  const ambiguous = await selectorPage.locator('div.css-deadbeef').evaluate(selectorForElement);
  check(
    anchored.selector.includes('primary-form') &&
      !anchored.selector.includes(':nth-') &&
      !anchored.fragile &&
      !anchored.locatorIssue,
    '同名元素使用稳定祖先锚点，不生成 nth-of-type',
  );
  check(
    !combined.locatorIssue && combined.selector.includes('password'),
    '通过非文案属性区分同名输入框',
  );
  check(
    stableClass.selector.includes('confirm-order') &&
      !/el-id|is-loading/.test(stableClass.selector),
    '忽略动态 ID 和状态类名',
  );
  await selectorPage.evaluate(() => {
    const target = document.querySelector('[data-testid="primary-form"]')!;
    const wrapper = document.createElement('article');
    target.parentNode!.insertBefore(wrapper, target);
    wrapper.appendChild(target);
    const extra = document.createElement('div');
    target.prepend(extra);
    document.querySelector('button.save-button')!.textContent = 'Changed label';
  });
  check(
    (await selectorPage.locator(anchored.selector).count()) === 1,
    '插入包装节点、兄弟节点和修改文案后定位仍唯一',
  );
  check(
    ambiguous.fragile &&
      !ambiguous.locatorIssue &&
      ambiguous.selector.includes(':nth-of-type(') &&
      (await selectorPage.locator(ambiguous.selector).count()) === 1 &&
      (await selectorPage.locator(ambiguous.selector).getAttribute('class')) === 'css-deadbeef',
    '无稳定特征时使用结构路径兜底，唯一匹配目标并标记',
  );
  await selectorPage.locator('div.css-deadbeef').evaluate((element) => {
    (element as HTMLElement).style.cssText = 'width:100px;height:40px';
  });
  await selectorPage.locator('div.css-deadbeef').click();
  await wait(
    () => session.snapshot().flow!.steps.some((step) => step.fragile && !step.locatorIssue),
    'structural locator recorded',
  );
  const selectorRecording = await session.stop();
  selectorRecording.flow!.steps.at(-1)!.locatorIssue = '无法生成唯一 CSS 定位';
  const unresolved = await run(selectorRecording.flow!, replayBase);
  check(
    unresolved.outcome === 'failed' && unresolved.error.includes('唯一 CSS'),
    '待补充定位的步骤在回放前明确报错，避免点错元素',
  );

  await session.startRecording({
    name: '结构定位兜底',
    startUrl: `${recordBase}structure`,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const structurePage = browser!.contexts()[0].pages()[0];
  await structurePage.locator('[data-testid="structural-panel"] button').nth(1).click();
  await structurePage.locator('qa-widget').nth(1).locator('button').nth(1).click();
  await structurePage
    .frameLocator('iframe:nth-of-type(2)')
    .locator('[data-testid="inside"]')
    .fill('frame fallback');
  const structuralFlow = (await session.stop()).flow!;
  const structuralActions = structuralFlow.steps.filter((step) =>
    ['click', 'fill'].includes(step.action),
  );
  check(
    structuralActions.length === 3 &&
      structuralActions.every((step) => step.fragile && !step.locatorIssue),
    '普通元素、Shadow DOM 和 iframe 的结构定位均可录制并保留标记',
  );
  const frameStep = structuralActions.find((step) => step.action === 'fill')!;
  structuralFlow.steps.push(
    {
      id: 'structure-result',
      pageId: 'page-1',
      action: 'assertValue',
      selector: '[data-testid="result"]',
      value: 'passed',
    },
    {
      id: 'shadow-result',
      pageId: 'page-1',
      action: 'assertValue',
      selector: '[data-testid="shadow-result"]',
      value: 'passed',
    },
    {
      id: 'frame-result',
      pageId: 'page-1',
      action: 'assertValue',
      selector: frameStep.selector,
      frames: frameStep.frames,
      value: 'frame fallback',
    },
  );
  check(
    (await run(structuralFlow, replayBase)).outcome === 'passed',
    '结构定位在不同环境和文案下准确回放普通元素、Shadow DOM 和 iframe 操作',
  );
  for (const format of ['json', 'js', 'ts'] as const) {
    const source = exportFlow(structuralFlow, format);
    assert.deepEqual(importFlow(source, `.${format}`), structuralFlow);
    if (format !== 'json') {
      const executable =
        format === 'ts'
          ? (await transform(source, { loader: 'ts', format: 'cjs', target: 'node20' })).code
          : source;
      const filename = join(directory, `structural-${format}.cjs`);
      await writeFile(filename, executable);
      assert.equal(await child([filename, replayBase]), 0);
    }
    check(true, `${format} 导入导出保留结构定位，脚本可独立回放`);
  }

  await session.startRecording({
    name: '列表范围回归',
    startUrl: `${recordBase}lists`,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const listsPage = browser!.contexts()[0].pages()[0];
  await listsPage.locator('.lang-item').nth(6).click();
  await listsPage.locator('aside li').nth(1).click();
  const listFlow = (await session.stop()).flow!;
  const listActions = listFlow.steps.filter((step) => step.action === 'click');
  check(
    listActions.length === 2 &&
      listActions[0].selector!.includes('.lang-item:nth-of-type(7)') &&
      listActions[0].selector!.includes('.language-picker') &&
      listActions[1].selector!.startsWith('html > body >'),
    '结构兜底保留语言项类名和所属容器，无稳定锚点时保留到文档根',
  );
  listFlow.steps.push(
    {
      id: 'language-result',
      pageId: 'page-1',
      action: 'assertValue',
      selector: '[data-testid="result"]',
      value: 'passed',
    },
    {
      id: 'plain-list-result',
      pageId: 'page-1',
      action: 'assertValue',
      selector: '[data-testid="plain-result"]',
      value: 'passed',
    },
  );
  check(
    (await run(listFlow, replayBase)).outcome === 'passed',
    '回放新增调试列表及 Shadow DOM 列表后仍准确点击语言项和无特征列表',
  );
  for (const format of ['js', 'ts'] as const) {
    const source = exportFlow(listFlow, format);
    const executable =
      format === 'ts'
        ? (await transform(source, { loader: 'ts', format: 'cjs', target: 'node20' })).code
        : source;
    const filename = join(directory, `scoped-lists-${format}.cjs`);
    await writeFile(filename, executable);
    check(
      (await child([filename, replayBase])) === 0,
      `${format} 导出脚本使用带范围的结构定位并准确回放`,
    );
  }

  await session.startRecording({
    name: '键盘提交',
    startUrl: `${recordBase}form`,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const formPage = browser!.contexts()[0].pages()[0];
  await formPage.locator('[data-testid="form-input"]').fill('keyboard');
  await formPage.locator('[data-testid="form-input"]').press('Enter');
  await formPage.waitForURL((url) => url.pathname.endsWith('/done'));
  await wait(
    () => session.snapshot().flow!.steps.some((step) => step.action === 'assertUrl'),
    'form submit checkpoint',
  );
  const formRecording = await session.stop();
  check(
    formRecording.flow!.steps.filter((step) => step.action === 'click').length === 0 &&
      formRecording.flow!.steps.some((step) => step.action === 'press'),
    'Enter 产生的合成 click 不会重复录制',
  );
  check(
    (await run(formRecording.flow!, replayBase)).outcome === 'passed',
    '键盘提交的真实录制能够跨环境回放',
  );
  await session.startRecording({
    name: '原生弹窗',
    startUrl: `${recordBase}dialog`,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const dialogPage = browser!.contexts()[0].pages()[0];
  await dialogPage
    .locator('[data-testid="dialog"]')
    .click()
    .catch(() => undefined);
  await wait(() => session.snapshot().mode === 'idle', 'dialog stops recording');
  check(
    session.snapshot().outcome === 'failed' &&
      session.snapshot().flow!.steps.some((step) => step.action === 'unsupported'),
    '不支持的原生弹窗有明确记录且不会卡死会话',
  );

  await session.startRecording({
    name: '操作间隔',
    startUrl: `${recordBase}timing`,
    baseUrl: recordBase,
    browser: 'msedge',
    recordVideo: false,
  });
  const timingPage = browser!.contexts()[0].pages()[0];
  await timingPage.locator('[data-testid="start"]').click();
  await new Promise((done) => setTimeout(done, 200));
  await fill(timingPage, '[data-testid="typing"]', 'first fragment');
  await new Promise((done) => setTimeout(done, 300));
  await fill(timingPage, '[data-testid="typing"]', 'final fragment');
  const latestFillTime = Date.now();
  await new Promise((done) => setTimeout(done, 600));
  await timingPage.locator('[data-testid="finish"]').click();
  const recordedTiming = await session.stop();
  const fills = recordedTiming.flow!.steps.filter((step) => step.action === 'fill');
  const finish = recordedTiming.flow!.steps.find(
    (step) => step.action === 'click' && step.selector?.includes('finish'),
  )!;
  check(
    recordedTiming.flow!.steps.every(
      (step) => Number.isInteger(step.delayBeforeMs) && step.delayBeforeMs! >= 0,
    ),
    '所有新录制步骤包含毫秒间隔',
  );
  check(fills.length === 1 && fills[0].value === 'final fragment', '连续输入仍合并为一次填充');
  check(
    finish.delayBeforeMs! >= 550 && finish.delayBeforeMs! < Date.now() - latestFillTime + 500,
    '输入到点击的间隔从最后输入事件计时，不累加打字耗时',
  );
  for (const format of ['json', 'ts', 'js'] as const) {
    check(
      importFlow(exportFlow(recordedTiming.flow!, format), `.${format}`).steps.find(
        (step) => step.id === finish.id,
      )?.delayBeforeMs === finish.delayBeforeMs,
      `${format} 往返保留步骤间隔`,
    );
  }
  const timingFlow: WebTestFlow = {
    ...recordedTiming.flow!,
    steps: [
      { id: 'navigate', pageId: 'page-1', action: 'navigate', path: './timing' },
      {
        id: 'start',
        pageId: 'page-1',
        action: 'click',
        selector: '[data-testid="start"]',
        delayBeforeMs: 0,
      },
      {
        id: 'input',
        pageId: 'page-1',
        action: 'fill',
        selector: '[data-testid="typing"]',
        value: 'fast typing',
        delayBeforeMs: 10000,
      },
      {
        id: 'finish',
        pageId: 'page-1',
        action: 'click',
        selector: '[data-testid="finish"]',
        delayBeforeMs: 600,
      },
      {
        id: 'check',
        pageId: 'page-1',
        action: 'assertValue',
        selector: '[data-testid="result"]',
        value: 'passed',
        delayBeforeMs: 0,
      },
    ],
  };
  const timingStart = Date.now();
  const timingResult = await run(timingFlow, replayBase, 500);
  check(
    timingResult.outcome === 'passed' && Date.now() - timingStart < 8000,
    '真实回放等待点击间隔、跳过输入间隔，等待不占用动作超时',
  );
  for (const format of ['js', 'ts'] as const) {
    let content = exportFlow(timingFlow, format);
    if (format === 'ts')
      content = (await transform(content, { loader: 'ts', format: 'cjs', target: 'node20' })).code;
    const filename = join(directory, `timing-${format}.cjs`);
    await writeFile(filename, content);
    check((await child([filename, replayBase])) === 0, `独立 ${format} 脚本实际遵守操作间隔`);
  }
  const longWaitFlow = structuredClone(timingFlow);
  longWaitFlow.steps[1].delayBeforeMs = 60000;
  await session.startReplay({
    flow: longWaitFlow,
    baseUrl: replayBase,
    browser: 'msedge',
    timeout: 500,
  });
  await wait(() => session.snapshot().activeStepId === 'start', 'long wait starts');
  const cancelStarted = Date.now();
  const canceledWait = await session.stop();
  check(
    canceledWait.outcome === 'canceled' &&
      Date.now() - cancelStarted < 2000 &&
      canceledWait.results[1].status === 'pending' &&
      canceledWait.results[2].status === 'pending',
    '长间隔等待可立即取消，不执行后续步骤',
  );
  const oldStep = { id: 'old', pageId: 'page-1', action: 'click', selector: 'button' } as const;
  await waitBeforeStep(oldStep);
  check(
    parseFlow({ ...timingFlow, steps: [timingFlow.steps[0], oldStep] }).steps[1].delayBeforeMs ===
      undefined,
    '旧用例无间隔字段仍可导入，默认为不等待',
  );
  let aiFlushes = 0;
  registerWebTestAccess({
    session,
    ready: Promise.resolve(),
    flush: async () => {
      aiFlushes++;
    },
    videos: async () => [],
  });
  const aiCall = async (name: string, input: unknown, signal?: AbortSignal) => {
    const tool = WEBTEST_TOOLS.find((item) => item.name === name)!;
    const ctx: ToolCtx = {
      requestId: 'browser-review',
      mode: 'auto',
      emit: () => {},
      trackTask: () => {},
      signal,
    };
    return (await tool.run(tool.inputSchema.parse(input), ctx)).data as Record<string, unknown>;
  };
  const brokenList = structuredClone(listFlow);
  await aiCall('webtest_record', {
    ...recordingOptions,
    expectedRevision: session.snapshot().revision,
    recordVideo: true,
    videoFormat: 'webm',
    viewport: { width: 800, height: 600 },
  });
  await browser!.contexts()[0].pages()[0].screenshot();
  await aiCall('webtest_stop', {});
  assert.deepEqual(session.snapshot().flow!.viewport, { width: 800, height: 600 });
  for (const path of session.snapshot().artifacts) {
    assert.ok(path.endsWith('.webm'));
    assert.ok((await probeVideo(path)).container.includes('webm'));
  }
  check(
    session.snapshot().outcome === 'recorded' && session.snapshot().artifacts.length > 0,
    'AI 录制传递尺寸和 WebM 格式，未转换为 MP4',
  );
  brokenList.steps.find((step) => step.action === 'click')!.selector = 'li:nth-of-type(7)';
  session.setFlow(brokenList);
  const failedAi = await aiCall('webtest_replay', {
    expectedRevision: session.snapshot().revision,
    baseUrl: replayBase,
    timeout: 500,
    viewport: { width: 880, height: 660 },
  });
  assert.deepEqual(
    await browser!
      .contexts()[0]
      .pages()[0]
      .evaluate(() => ({ width: innerWidth, height: innerHeight })),
    { width: 880, height: 660 },
  );
  check(failedAi.outcome === 'failed', 'AI 回放报告真实失败并保留浏览器现场');
  const aiStatus = await aiCall('webtest_status', {});
  check(
    (aiStatus.activeStep as { number: number }).number === 2 &&
      (aiStatus.pages as unknown[]).length > 0,
    'AI 状态提供失败步骤号和真实页签',
  );
  const inspection = await aiCall('webtest_inspect', { selector: 'li:nth-of-type(7)' });
  const candidates = inspection.elements as {
    attributes: Record<string, string>;
    candidate: { selector: string };
    candidateMatches: number;
  }[];
  const language = candidates.find((item) => item.attributes.class === 'lang-item')!;
  check(
    Number(inspection.count) >= 3 &&
      language.candidateMatches === 1 &&
      language.candidate.selector.includes('language-picker'),
    'AI 只读检查区分业务语言项和调试面板，候选定位经真实 Playwright 唯一验证',
  );
  await assert.rejects(aiCall('webtest_inspect', { selector: 'text=Changed' }), /CSS/);
  const patchInput = {
    expectedRevision: session.snapshot().revision,
    patches: [{ id: brokenList.steps[1].id, selector: language.candidate.selector }],
  };
  const preview = await aiCall('webtest_patch_steps', patchInput);
  check(
    preview.saved === false && session.snapshot().flow!.steps[1].selector === 'li:nth-of-type(7)',
    'AI 修复预览不改变用例',
  );
  const fixed = await aiCall('webtest_patch_steps', { ...patchInput, dryRun: false });
  check(
    fixed.saved === true &&
      aiFlushes > 0 &&
      session.snapshot().flow!.steps[1].id === brokenList.steps[1].id,
    'AI 按步骤 ID 保存修复并调用共享持久化队列',
  );
  await assert.rejects(aiCall('webtest_patch_steps', { ...patchInput, dryRun: false }), /已变化/);
  check(
    (
      await aiCall('webtest_replay', {
        expectedRevision: session.snapshot().revision,
        baseUrl: replayBase,
        timeout: 500,
      })
    ).outcome === 'passed',
    'AI 诊断→预览→修复→回放闭环实际通过',
  );
  const saved = join(directory, 'ai-export.json');
  await aiCall('webtest_export', { path: saved, format: 'json' });
  const oldRevision = session.snapshot().revision;
  await aiCall('webtest_import', { path: saved, expectedRevision: oldRevision });
  check(
    session.snapshot().revision > oldRevision &&
      session.snapshot().flow!.steps[1].selector === language.candidate.selector,
    'AI 导出再导入沿用生产用例格式',
  );
  const secretFlow = structuredClone(timingFlow);
  secretFlow.steps.find((step) => step.action === 'fill')!.value = 'private-input';
  session.setFlow(secretFlow);
  const hidden = await aiCall('webtest_read_steps', { limit: 3 });
  check(
    !JSON.stringify(hidden).includes('private-input') && hidden.nextFrom === 4,
    'AI 分页读取默认隐藏输入值并返回续读位置',
  );
  const oversized = structuredClone(secretFlow);
  oversized.steps[1] = {
    id: 'large-step',
    pageId: 'page-1',
    action: 'select',
    selector: '字'.repeat(4000),
    frames: Array.from({ length: 10 }, () => '字'.repeat(4000)),
    values: Array.from({ length: 100 }, () => '字'.repeat(1000)),
  };
  session.setFlow(oversized);
  const bounded = await aiCall('webtest_read_steps', { from: 2, limit: 1, includeValues: true });
  check(
    bounded.nextFrom === 3 &&
      Buffer.byteLength(JSON.stringify(bounded)) < 60000 &&
      (bounded.rows as { truncatedFields: string[] }[])[0].truncatedFields.length > 0,
    '超大步骤返回显式截断标记且分页继续推进，避免卡在同一步',
  );
  const controller = new AbortController();
  session.setFlow(longWaitFlow);
  const pendingAi = aiCall(
    'webtest_replay',
    { expectedRevision: session.snapshot().revision, baseUrl: replayBase },
    controller.signal,
  );
  await wait(() => session.snapshot().mode === 'replaying', 'AI replay starts');
  controller.abort();
  await pendingAi;
  await wait(() => session.snapshot().mode === 'idle', 'AI cancel completes');
  check(session.snapshot().outcome === 'canceled', '取消 AI 对话中断本轮启动的回放与长间隔等待');
  const recordedAi = await aiCall('webtest_record', {
    expectedRevision: session.snapshot().revision,
    name: 'AI recording',
    startUrl: recordBase,
    baseUrl: recordBase,
  });
  check(recordedAi.mode === 'recording', 'AI 可启动用户操作录制');
  assert.deepEqual(session.snapshot().flow!.viewport, { width: 1280, height: 720 });
  await aiCall('webtest_stop', {});
  check(session.snapshot().outcome === 'recorded', 'AI 停止录制使用同一会话收尾流程');
  console.log(`\n${checks} checks passed. Artifacts: ${directory}`);
} catch (error) {
  console.error('SESSION', JSON.stringify(session.snapshot(), null, 2));
  throw error;
} finally {
  await session.dispose();
  for (const server of servers) server.close();
}
