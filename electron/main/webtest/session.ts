import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser, BrowserContext, Frame, FrameLocator, Page } from 'playwright-core';
import type {
  WebTestBrowser,
  WebTestFlow,
  WebTestRecordOptions,
  WebTestReplayOptions,
  WebTestSnapshot,
  WebTestStep,
  WebTestVideoFormat,
  WebTestViewport,
} from '../../shared/webtest';
import { WEBTEST_DEFAULT_VIEWPORT } from '../../shared/webtest';
import { videoFormatSchema, viewportSchema } from './options';
import { finalizeRecordedVideo, prepareVideoFormat } from './videos';
import { normalizeBaseUrl, parseFlow, parseStep, toRelativePath, resolveTargetUrl } from './flow';
import { recorderSource, selectorForElement } from './recorder';
import { executeStep, waitBeforeStep } from './replay';

interface SessionDependencies {
  /** 生产用可见浏览器，验证脚本可注入无头浏览器。 */
  launch: (browser: WebTestBrowser) => Promise<Browser>;
  artifactDir: () => string;
  /** 录制视频使用可清理的缓存目录，报告和截图仍保存为数据。 */
  videoDir: () => string;
  changed: (snapshot: WebTestSnapshot) => void;
}

/** 单实例的录制 / 回放控制器；状态与网页生命周期都由主进程持有。 */
export class WebTestSession {
  private state: WebTestSnapshot = {
    revision: 0,
    mode: 'idle',
    outcome: 'none',
    flow: null,
    results: [],
    activeStepId: null,
    error: '',
    artifacts: [],
  };
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages = new Map<string, Page>();
  private pageIds = new Map<Page, string>();
  private lastUrls = new Map<string, string>();
  private pausedPages = new Set<string>();
  private declaredPages = new Set<string>();
  private openerIds = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();
  private accepting = false;
  private canceled = false;
  private baseUrl = '';
  private directory = '';
  private operation: Promise<void> | null = null;
  private startup: Promise<void> | null = null;
  private lastRecordedAt = 0;
  private replayAbort: AbortController | null = null;
  private generation = 0;
  private videoFormat: WebTestVideoFormat = 'webm';

  constructor(private readonly dependencies: SessionDependencies) {}

  /** @returns 不暴露内部可变引用的完整会话快照。 */
  snapshot(): WebTestSnapshot {
    return structuredClone({ ...this.state, pausedPageIds: [...this.pausedPages] });
  }

  /** @returns 正在写入的产物目录；视频列表需等会话结束后再展示其中的文件。 */
  activeArtifactDirectory(): string | null {
    return this.state.mode === 'idle' ? null : this.directory;
  }

  /** @returns 当前浏览器页签的精简信息，失败回放保留的页面也可以检查。 */
  diagnosticPages(): { pageId: string; url: string; closed: boolean; frameUrls: string[] }[] {
    return [...this.pages].slice(0, 20).map(([pageId, page]) => ({
      pageId,
      url: page.url().slice(0, 2000),
      closed: page.isClosed(),
      frameUrls: page
        .frames()
        .slice(0, 10)
        .map((frame) => frame.url().slice(0, 1000)),
    }));
  }

  /**
   * 只读检查真实 DOM，返回严格匹配数和候选 CSS；不执行模型提供的代码或页面动作。
   * @param pageId 检查的页签。
   * @param selector 仅允许 CSS，可用失败步骤的旧定位查找全部候选。
   * @param frames 从外到内的 iframe CSS。
   * @param limit 返回元素上限。
   * @returns 元素属性、可见性和候选定位；不返回输入值和页面文案。
   */
  async inspectElements(pageId: string, selector: string, frames: string[], limit: number) {
    if (['starting', 'stopping'].includes(this.state.mode))
      throw new Error('会话正在切换，请稍后检查');
    parseStep({ id: 'inspect', pageId, action: 'assertVisible', selector, frames });
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('检查元素上限为 1–20');
    const page = this.pages.get(pageId);
    if (!page || page.isClosed()) throw new Error('页签不存在或已关闭，请先录制或回放到待检查页面');
    let scope: Page | FrameLocator = page;
    for (const frame of frames) scope = scope.frameLocator(`css=${frame}`);
    const matches = scope.locator(`css=${selector}`);
    const count = await matches.count();
    const elements: {
      index: number;
      tag: string;
      attributes: Record<string, string>;
      visible: boolean;
      candidate: ReturnType<typeof selectorForElement>;
      candidateMatches: number | null;
    }[] = [];
    for (let index = 0; index < Math.min(count, limit); index++) {
      const element = matches.nth(index);
      const attributes = await element.evaluate(
        (target) => ({
          tag: target.localName,
          attributes: Object.fromEntries(
            [
              'id',
              'class',
              'name',
              'type',
              'role',
              'data-testid',
              'data-test',
              'data-qa',
              'data-cy',
              'data-action',
              'data-field',
            ]
              .filter((name) => target.hasAttribute(name))
              .map((name) => [name, target.getAttribute(name)!.slice(0, 200)]),
          ),
        }),
        undefined,
        { timeout: 2000 },
      );
      const candidate = await element.evaluate(selectorForElement, undefined, { timeout: 2000 });
      elements.push({
        index,
        ...attributes,
        visible: await element.isVisible(),
        candidate,
        candidateMatches: candidate.locatorIssue
          ? null
          : await scope.locator(`css=${candidate.selector}`).count(),
      });
    }
    return {
      pageId,
      url: page.url().slice(0, 2000),
      selector,
      frames,
      count,
      elements,
      truncated: count > limit,
    };
  }

  /** @returns 当前回放收尾后的快照；长等待由调用方的取消信号中断。 */
  async waitForReplay(): Promise<WebTestSnapshot> {
    await this.operation;
    return this.snapshot();
  }

  /** @returns 当前任务标识，避免迟到的取消关闭后续任务。 */
  operationToken(): number {
    return this.generation;
  }

  /** @param token 调用方启动时捕获的任务标识，省略则停止当前任务。 */
  async cancelOwnedOperation(token = this.generation): Promise<void> {
    await this.startup;
    if (token !== this.generation) return;
    await this.stop();
  }

  private emit(): void {
    this.state.revision += 1;
    this.dependencies.changed(this.snapshot());
  }

  private assertIdle(): void {
    if (this.state.mode !== 'idle') throw new Error('当前录制或回放尚未结束');
  }

  /** @param input 用例数据。 @returns 更新后的会话。 */
  setFlow(input: unknown): WebTestSnapshot {
    this.assertIdle();
    const flow = parseFlow(input);
    this.state = {
      ...this.state,
      flow,
      viewport: flow.viewport,
      results: [],
      activeStepId: null,
      outcome: 'none',
      error: '',
      artifacts: [],
    };
    this.emit();
    return this.snapshot();
  }

  private enqueue(task: () => Promise<void> | void): Promise<void> {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.state.error = error instanceof Error ? error.message : String(error);
      this.accepting = false;
      this.emit();
      // 不在队列自身等待 stop，否则 stop 的排空会发生死锁。
      if (this.state.mode === 'recording') void this.stop();
    });
    return this.queue;
  }

  private append(step: WebTestStep, recordedAt = Date.now()): void {
    if (!this.state.flow) return;
    if (this.state.flow.steps.length >= 5000) throw new Error('录制达到 5000 步上限，请拆分用例');
    const timestamp = Math.max(this.lastRecordedAt, recordedAt);
    const delayBeforeMs = Math.min(86400000, Math.round(timestamp - this.lastRecordedAt));
    const parsed = parseStep({ ...step, delayBeforeMs });
    this.lastRecordedAt = timestamp;
    const previous = this.state.flow.steps.at(-1);
    // 输入的防抖分片和双击的首击应合并，避免重复触发业务事件。
    if (
      previous?.pageId === parsed.pageId &&
      previous.selector === parsed.selector &&
      JSON.stringify(previous.frames) === JSON.stringify(parsed.frames) &&
      ((previous.action === 'fill' && parsed.action === 'fill') ||
        (previous.action === 'assertUrl' && parsed.action === 'assertUrl') ||
        (previous.action === 'click' && parsed.action === 'dblclick'))
    ) {
      this.state.flow.steps[this.state.flow.steps.length - 1] = {
        ...parsed,
        id: previous.id,
        // 连续输入合成一次 fill，不把打字耗时叠加到下一次点击前。
        delayBeforeMs:
          previous.action === 'assertUrl'
            ? Math.min(86400000, (previous.delayBeforeMs ?? 0) + delayBeforeMs)
            : (previous.delayBeforeMs ?? 0),
      };
    } else this.state.flow.steps.push(parsed);
    this.emit();
  }

  private async frameSelectors(
    frame: Frame,
  ): Promise<Pick<WebTestStep, 'frames' | 'fragile' | 'locatorIssue'>> {
    const frames: string[] = [];
    let fragile = false;
    let locatorIssue: string | undefined;
    let cursor: Frame | null = frame;
    while (cursor?.parentFrame()) {
      const element = await cursor.frameElement();
      try {
        const located = await element.evaluate(selectorForElement);
        frames.unshift(located.selector);
        fragile ||= located.fragile;
        locatorIssue ??= located.locatorIssue ? `iframe ${located.locatorIssue}` : undefined;
      } finally {
        await element.dispose();
      }
      cursor = cursor.parentFrame();
    }
    return { frames, ...(fragile ? { fragile } : {}), ...(locatorIssue ? { locatorIssue } : {}) };
  }

  /** @param url 当前主页面地址。 @returns 是否处于本次录制范围内。 */
  private inRecordingScope(url: string): boolean {
    try {
      toRelativePath(url, this.baseUrl);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 外部页签不写进用例；首次回到录制范围后才声明其来源。
   * @param id 当前页签编号。
   */
  private declareRecordingPage(id: string, recordedAt = Date.now()): void {
    if (this.declaredPages.has(id)) return;
    const openerId = this.openerIds.get(id);
    if (!openerId) throw new Error('新页签尚未关联到录制页面');
    this.declareRecordingPage(openerId, recordedAt);
    this.append({ id: randomUUID(), action: 'openPage', pageId: id, openerId }, recordedAt);
    this.declaredPages.add(id);
  }

  private attachRecordingPage(page: Page, id: string, initial = false): void {
    this.pages.set(id, page);
    this.pageIds.set(page, id);
    if (initial) this.declaredPages.add(id);
    if (!initial) {
      void this.enqueue(async () => {
        const opener = await page.opener();
        const openerId = opener && this.pageIds.get(opener);
        if (!openerId) throw new Error('检测到无来源的新页签，请通过录制页面中的链接打开页签');
        this.openerIds.set(id, openerId);
      });
    }
    const navigation = (frame: Frame): void => {
      if (!this.accepting || frame !== page.mainFrame()) return;
      const url = frame.url();
      const recordedAt = Date.now();
      void this.enqueue(() => {
        if (!this.inRecordingScope(url)) {
          this.pausedPages.add(id);
          this.emit();
          return;
        }
        const resumed = this.pausedPages.delete(id);
        this.declareRecordingPage(id, recordedAt);
        if (resumed) this.emit();
        if (!resumed && this.lastUrls.get(id) === url) return;
        this.lastUrls.set(id, url);
        const path = toRelativePath(url, this.baseUrl);
        // 页面自身的跳转只能成为检查点；强制 goto 会掩盖回放时没有正确跳转的缺陷。
        this.append({ id: randomUUID(), action: 'assertUrl', pageId: id, path }, recordedAt);
      });
    };
    page.on('framenavigated', navigation);
    if (!initial && page.url() !== 'about:blank') navigation(page.mainFrame());
    page.on('dialog', (dialog) => {
      if (!this.accepting) return;
      if (!this.inRecordingScope(page.url())) {
        void dialog.dismiss().catch(() => undefined);
        return;
      }
      const recordedAt = Date.now();
      void this.enqueue(() => {
        this.append(
          {
            id: randomUUID(),
            action: 'unsupported',
            pageId: id,
            value: `检测到 ${dialog.type()} 原生对话框，请调整用例；不会静默跳过`,
          },
          recordedAt,
        );
      });
      // Playwright 监听后必须处理弹窗，否则页面与停止录制都会阻塞。
      void dialog
        .dismiss()
        .catch(() => undefined)
        .finally(() => {
          this.state.error =
            '检测到暂不支持的原生对话框，已取消弹窗并停止录制；用例中保留了对应步骤';
          if (this.state.mode === 'recording') void this.stop();
        });
    });
    page.on('close', () => {
      if (!this.accepting) return;
      const recordedAt = Date.now();
      void this.enqueue(() => {
        this.pausedPages.delete(id);
        if (this.declaredPages.has(id))
          this.append({ id: randomUUID(), action: 'closePage', pageId: id }, recordedAt);
        else this.emit();
      });
      if (this.context?.pages().length === 0 && this.state.mode === 'recording') void this.stop();
    });
  }

  private async cleanup(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.context = null;
    this.browser = null;
    try {
      await context?.close();
    } finally {
      await browser?.close();
    }
  }

  /** @param options 已校验的录制参数。 @returns 录制启动后的快照。 */
  async startRecording(options: WebTestRecordOptions): Promise<WebTestSnapshot> {
    this.assertIdle();
    this.generation++;
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const path = toRelativePath(options.startUrl, baseUrl);
    const viewport = viewportSchema.parse(options.viewport ?? WEBTEST_DEFAULT_VIEWPORT);
    const videoFormat = videoFormatSchema.parse(options.videoFormat);
    let finishStartup!: () => void;
    this.startup = new Promise((resolve) => {
      finishStartup = resolve;
    });
    this.state.mode = 'starting';
    this.emit();
    try {
      if (options.recordVideo) await prepareVideoFormat(videoFormat);
      await this.cleanup();
      this.pages.clear();
      this.pageIds.clear();
      this.lastUrls.clear();
      this.pausedPages.clear();
      this.declaredPages.clear();
      this.openerIds.clear();
      this.baseUrl = baseUrl;
      this.videoFormat = videoFormat;
      this.directory = join(this.dependencies.videoDir(), randomUUID());
      if (options.recordVideo) await mkdir(this.directory, { recursive: true });
      this.browser = await this.dependencies.launch(options.browser);
      this.context = await this.browser.newContext({
        viewport,
        ...(options.recordVideo
          ? {
              recordVideo: {
                dir: this.directory,
                // Playwright 会向下取偶数；预先向上补齐，避免丢失奇数尺寸的最后一行/列。
                size: {
                  width: Math.ceil(viewport.width / 2) * 2,
                  height: Math.ceil(viewport.height / 2) * 2,
                },
              },
            }
          : {}),
      });
      this.state = {
        ...this.state,
        outcome: 'none',
        error: '',
        results: [],
        activeStepId: null,
        artifacts: [],
        viewport,
        flow: {
          schema: 'toolbox.webtest',
          version: 1,
          name: options.name,
          createdAt: new Date().toISOString(),
          viewport,
          steps: [
            { id: randomUUID(), action: 'navigate', pageId: 'page-1', path, delayBeforeMs: 0 },
          ],
        },
      };
      await this.context.exposeBinding('__toolboxRecord', ({ page, frame }, input: unknown) => {
        if (!this.accepting || !this.inRecordingScope(page.url())) return;
        const pageId = this.pageIds.get(page);
        if (!pageId || !input || typeof input !== 'object') return;
        // 使用事件发生时间，避免防抖及 iframe 定位耗时被算作用户等待时间。
        const { recordedAt: rawRecordedAt, ...payload } = input as Record<string, unknown>;
        const receivedAt = Date.now();
        const recordedAt =
          typeof rawRecordedAt === 'number' && Number.isFinite(rawRecordedAt) && rawRecordedAt > 0
            ? Math.min(receivedAt, rawRecordedAt)
            : receivedAt;
        return this.enqueue(async () => {
          let frameLocation: Pick<WebTestStep, 'frames' | 'fragile' | 'locatorIssue'>;
          try {
            frameLocation = await this.frameSelectors(frame);
          } catch (error) {
            // 跳转可销毁上一个 document 中的 iframe；不让已失效的事件终止整段录制。
            if (frame.isDetached() || page.isClosed() || !this.inRecordingScope(page.url())) return;
            throw error;
          }
          this.declareRecordingPage(pageId, recordedAt);
          const step = parseStep({
            ...payload,
            id: randomUUID(),
            pageId,
            ...frameLocation,
          });
          this.append(step, recordedAt);
        });
      });
      await this.context.addInitScript({ content: recorderSource() });
      const page = await this.context.newPage();
      this.attachRecordingPage(page, 'page-1', true);
      let pageIndex = 1;
      this.context.on('page', (popup) => {
        if (this.accepting) this.attachRecordingPage(popup, `page-${++pageIndex}`);
      });
      this.lastUrls.set('page-1', new URL(options.startUrl).href);
      this.lastRecordedAt = Date.now();
      this.accepting = true;
      const response = await page.goto(options.startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      if (response && response.status() >= 400 && this.inRecordingScope(page.url()))
        throw new Error(`录制入口返回 HTTP ${response.status()}`);
      if (this.state.error) throw new Error(this.state.error);
      this.state.mode = 'recording';
      this.emit();
      this.browser.on('disconnected', () => {
        if (this.state.mode === 'recording') void this.stop();
      });
      return this.snapshot();
    } catch (error) {
      this.accepting = false;
      this.pausedPages.clear();
      await this.cleanup().catch(() => undefined);
      this.state.mode = 'idle';
      this.state.outcome = 'failed';
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    } finally {
      finishStartup();
      this.startup = null;
    }
  }

  /** @param options 回放参数。 @returns 启动后的快照，执行进度由 changed 推送。 */
  async startReplay(options: WebTestReplayOptions): Promise<WebTestSnapshot> {
    this.assertIdle();
    this.generation++;
    const flow = parseFlow(options.flow);
    const viewport = viewportSchema.parse(options.viewport ?? flow.viewport);
    if (!flow.steps.length || flow.steps[0].action !== 'navigate')
      throw new Error('用例必须以导航步骤开始');
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    let finishStartup!: () => void;
    this.startup = new Promise((resolve) => {
      finishStartup = resolve;
    });
    this.state = {
      ...this.state,
      mode: 'starting',
      outcome: 'none',
      flow,
      viewport,
      results: flow.steps.map((step) => ({ stepId: step.id, status: 'pending' })),
      activeStepId: null,
      error: '',
      artifacts: [],
    };
    this.canceled = false;
    this.replayAbort = new AbortController();
    this.emit();
    try {
      await this.cleanup();
      this.pages.clear();
      this.pageIds.clear();
      this.pausedPages.clear();
      this.directory = join(this.dependencies.artifactDir(), randomUUID());
      this.browser = await this.dependencies.launch(options.browser);
      this.context = await this.browser.newContext({ viewport });
      this.pages.set('page-1', await this.context.newPage());
      this.state.mode = 'replaying';
      this.emit();
      this.operation = this.run(flow, baseUrl, options.timeout, viewport);
      void this.operation.finally(() => {
        this.operation = null;
      });
      return this.snapshot();
    } catch (error) {
      await this.cleanup().catch(() => undefined);
      this.state.mode = 'idle';
      this.state.outcome = 'failed';
      this.state.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    } finally {
      finishStartup();
      this.startup = null;
    }
  }

  private async run(
    flow: WebTestFlow,
    baseUrl: string,
    timeout: number,
    viewport: WebTestViewport,
  ): Promise<void> {
    const popups = new Map<string, Page[]>();
    const attach = (page: Page, id: string): void => {
      page.on('popup', (popup) => {
        const list = popups.get(id) ?? [];
        list.push(popup);
        popups.set(id, list);
      });
    };
    attach(this.pages.get('page-1')!, 'page-1');
    for (const [index, step] of flow.steps.entries()) {
      if (this.canceled) break;
      this.state.activeStepId = step.id;
      const result = this.state.results[index];
      result.status = 'running';
      this.emit();
      const started = Date.now();
      try {
        await waitBeforeStep(step, this.replayAbort?.signal);
        if (this.canceled) {
          result.status = 'pending';
          break;
        }
        if (step.action === 'openPage') {
          const opener = this.pages.get(step.openerId!);
          if (!opener) throw new Error('来源页签不存在');
          const popup =
            popups.get(step.openerId!)?.shift() ??
            (await opener.waitForEvent('popup', { timeout }));
          // waitForEvent 与 on('popup') 会同时收到，把已消费项从队列移除。
          popups.set(
            step.openerId!,
            (popups.get(step.openerId!) ?? []).filter((page) => page !== popup),
          );
          this.pages.set(step.pageId, popup);
          attach(popup, step.pageId);
        } else {
          const page = this.pages.get(step.pageId);
          if (!page || (page.isClosed() && step.action !== 'closePage'))
            throw new Error(`页签 ${step.pageId} 已关闭或不存在`);
          await executeStep(page, step, baseUrl, timeout, resolveTargetUrl);
        }
        if (this.canceled) {
          result.status = 'pending';
          break;
        }
        result.status = 'passed';
      } catch (error) {
        if (this.canceled) {
          result.status = 'pending';
          break;
        }
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
        this.state.outcome = 'failed';
        this.state.error = `第 ${index + 1} 步失败：${result.error}`;
        try {
          const page = this.pages.get(step.pageId);
          if (page && !page.isClosed()) {
            await mkdir(this.directory, { recursive: true });
            const screenshot = join(this.directory, `step-${index + 1}-failed.png`);
            await page.screenshot({ path: screenshot, timeout: 3000 });
            this.state.artifacts.push(screenshot);
          }
        } catch (captureError) {
          this.state.error += `；截图失败：${String(captureError)}`;
        }
        break;
      } finally {
        result.duration = Date.now() - started;
        this.emit();
      }
    }
    if (this.canceled) this.state.outcome = 'canceled';
    else if (this.state.outcome !== 'failed') this.state.outcome = 'passed';
    // 失败时保留浏览器现场；下一次开始时统一关闭旧上下文。
    if (this.state.outcome !== 'failed')
      await this.cleanup().catch((error: unknown) => {
        this.state.error = String(error);
      });
    try {
      await mkdir(this.directory, { recursive: true });
      const report = join(this.directory, 'report.json');
      await writeFile(
        report,
        JSON.stringify(
          {
            name: flow.name,
            baseUrl,
            viewport,
            outcome: this.state.outcome,
            results: this.state.results,
          },
          null,
          2,
        ),
        'utf8',
      );
      this.state.artifacts.push(report);
    } catch (error) {
      this.state.error += `；报告保存失败：${String(error)}`;
    }
    this.state.mode = 'idle';
    this.emit();
  }

  /** @returns 停止后的完整快照，包含落盘完毕的视频路径。 */
  async stop(): Promise<WebTestSnapshot> {
    if (this.state.mode === 'starting') throw new Error('浏览器正在启动，请稍候');
    if (this.state.mode === 'stopping') {
      await this.operation;
      return this.snapshot();
    }
    if (this.state.mode === 'replaying') {
      this.canceled = true;
      this.replayAbort?.abort();
      this.state.mode = 'stopping';
      this.emit();
      await this.cleanup().catch(() => undefined);
      await this.operation;
    } else if (this.state.mode === 'recording') {
      this.state.mode = 'stopping';
      this.emit();
      this.operation = this.finishRecording();
      await this.operation;
      this.operation = null;
    }
    return this.snapshot();
  }

  private async finishRecording(): Promise<void> {
    try {
      const frames = [...this.pages.values()]
        .filter((page) => !page.isClosed())
        .flatMap((page) => page.frames());
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const flushed = Promise.all(
        frames.map((frame) =>
          frame
            .evaluate(async () => {
              const recorder = (
                window as Window & { __toolboxRecorder?: { stop: () => Promise<void> } }
              ).__toolboxRecorder;
              await recorder?.stop();
            })
            .catch(() => undefined),
        ),
      );
      try {
        await Promise.race([
          flushed,
          new Promise<never>((_resolve, reject) => {
            flushTimer = setTimeout(
              () => reject(new Error('页面响应超时，最后一次输入可能未记录')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(flushTimer);
      }
      await this.queue;
      this.accepting = false;
      const videos = [...this.pages.values()]
        .map((page) => page.video())
        .filter((video) => video !== null);
      await this.cleanup();
      for (const video of videos) {
        const source = await video.path();
        try {
          this.state.artifacts.push(await finalizeRecordedVideo(source, this.videoFormat));
        } catch (error) {
          this.state.artifacts.push(source);
          this.state.error = [
            this.state.error,
            `视频转换失败，原始 WebM 已保留，操作步骤仍可复用：${String(error)}`,
          ]
            .filter(Boolean)
            .join('\n');
        }
      }
      this.state.outcome = this.state.error ? 'failed' : 'recorded';
    } catch (error) {
      this.state.error = String(error);
      this.state.outcome = 'failed';
    } finally {
      this.accepting = false;
      this.pausedPages.clear();
      await this.cleanup().catch(() => undefined);
      this.state.mode = 'idle';
      this.emit();
    }
  }

  /** 退出应用时排空录制与关闭浏览器，确保视频完成封装。 */
  async dispose(): Promise<void> {
    await this.startup;
    await this.stop();
    await this.cleanup();
  }
}
