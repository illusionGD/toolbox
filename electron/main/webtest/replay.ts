import type { FrameLocator, Locator, Page } from 'playwright-core';
import type { WebTestStep } from '../../shared/webtest';

/**
 * 还原步骤间隔；输入一次填充，等待不占用动作超时，取消时立即清除定时器。
 * 此函数也嵌入独立脚本，必须保持自包含。
 * @param step 当前步骤，缺少间隔的旧数据按 0 处理。
 * @param signal 应用内的取消信号，独立脚本可省略。
 */
export async function waitBeforeStep(step: WebTestStep, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('回放已取消');
  const delay = step.action === 'fill' ? 0 : (step.delayBeforeMs ?? 0);
  if (!Number.isInteger(delay) || delay < 0 || delay > 86400000)
    throw new Error('步骤间隔必须为 0–86400000 毫秒');
  if (delay === 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('回放已取消'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * 执行一个步骤；失败直接抛出，让上层在该步停止。导出脚本复用同一实现。
 * @param page 当前页签。
 * @param step 已校验的步骤。
 * @param baseUrl 当前回放环境根地址。
 * @param timeout 单步骤超时。
 * @param resolveUrl URL 映射函数，显式传入保证导出脚本没有打包器内部引用。
 */
export async function executeStep(
  page: Page,
  step: WebTestStep,
  baseUrl: string,
  timeout: number,
  resolveUrl: (base: string, path: string) => string,
): Promise<void> {
  if (step.locatorIssue) throw new Error(step.locatorIssue);
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(timeout);
  const deadline = Date.now() + timeout;
  const poll = async (check: () => Promise<boolean>, message: string): Promise<void> => {
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error('页签已关闭');
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  };
  if (step.action === 'unsupported') throw new Error(step.value);
  if (step.action === 'navigate') {
    const response = await page.goto(resolveUrl(baseUrl, step.path!), {
      timeout,
      waitUntil: 'domcontentloaded',
    });
    if (response && response.status() >= 400) throw new Error(`页面返回 HTTP ${response.status()}`);
    return;
  }
  if (step.action === 'assertUrl') {
    const expected = resolveUrl(baseUrl, step.path!);
    await page.waitForURL((url) => url.href === expected, {
      timeout,
      waitUntil: 'domcontentloaded',
    });
    return;
  }
  if (step.action === 'closePage') {
    await page.close();
    return;
  }
  if (step.action === 'openPage') return;
  let scope: Page | FrameLocator = page;
  for (const frame of step.frames ?? []) scope = scope.frameLocator(`css=${frame}`);
  const locator: Locator | null = step.selector ? scope.locator(`css=${step.selector}`) : null;
  if (step.action === 'scroll' && !locator) {
    // frameLocator 没有 evaluate，通过其根元素在正确的 window 中滚动。
    const root = scope.locator('html');
    await root.evaluate(
      (_element, position) => window.scrollTo(position.x, position.y),
      { x: step.x!, y: step.y! },
      { timeout },
    );
    return;
  }
  if (!locator) throw new Error('此步骤缺少 CSS 定位');
  if (step.action === 'assertHidden') {
    await poll(async () => {
      const count = await locator.count();
      if (count > 1) throw new Error('定位不唯一，无法判断检查目标');
      return count === 0 || !(await locator.isVisible());
    }, '检查失败：元素仍然可见');
    return;
  }
  // Playwright 严格模式会拒绝多匹配，绝不使用 first() 掩盖错误。
  await locator.waitFor({ state: 'visible', timeout });
  const remaining = (): number => Math.max(1, deadline - Date.now());
  switch (step.action) {
    case 'click':
      await locator.click({ timeout: remaining(), button: step.button, modifiers: step.modifiers });
      break;
    case 'dblclick':
      await locator.dblclick({
        timeout: remaining(),
        button: step.button,
        modifiers: step.modifiers,
      });
      break;
    case 'fill':
      await locator.fill(step.value!, { timeout: remaining() });
      await poll(
        async () =>
          (await locator.evaluate((element) =>
            'value' in element ? String(element.value) : (element.textContent ?? ''),
          )) === step.value,
        '输入值未保持为预期值',
      );
      break;
    case 'check':
      await locator.setChecked(step.checked!, { timeout: remaining() });
      break;
    case 'select':
      await locator.selectOption(step.values!, { timeout: remaining() });
      break;
    case 'press':
      await locator.press(step.value!, { timeout: remaining() });
      break;
    case 'scroll':
      await locator.evaluate(
        (element, position) => element.scrollTo(position.x, position.y),
        { x: step.x!, y: step.y! },
        { timeout: remaining() },
      );
      break;
    case 'assertVisible':
      break;
    case 'assertValue':
      await poll(
        async () => (await locator.inputValue({ timeout: remaining() })) === step.value,
        '检查失败：输入值与预期不一致',
      );
      break;
    case 'assertChecked':
      await poll(
        async () => (await locator.isChecked({ timeout: remaining() })) === step.checked,
        '检查失败：勾选状态与预期不一致',
      );
      break;
    default:
      throw new Error(`不支持的动作：${step.action}`);
  }
}
