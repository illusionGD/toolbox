import type { WebTestFlow, WebTestFormat } from '../../shared/webtest';
import { parseFlow, resolveTargetUrl } from './flow';
import { executeStep, waitBeforeStep } from './replay';

/**
 * 导出数据或可执行脚本；脚本从命令行接收环境地址，不包含录制环境。
 * @param input 已录制或编辑的用例。
 * @param format 目标格式。
 * @returns UTF-8 文本。
 */
export function exportFlow(input: WebTestFlow, format: WebTestFormat): string {
  const flow = parseFlow(input);
  // 标记字符在字符串内转义，避免用户输入内容意外结束数据区。
  const json = JSON.stringify(flow, null, 2).replace(/\//g, '\\u002f');
  if (format === 'json') return JSON.stringify(flow, null, 2) + '\n';
  return `${format === 'ts' ? '// @ts-nocheck\n' : ''}// Toolbox 网页测试。npm install playwright-core@1.63.0
// ${format === 'ts' ? 'npx tsx test.ts' : 'node test.js'} https://your-environment.example/app/
// 使用本机 Edge；可设置 WEBTEST_BROWSER=chrome。失败立即退出并生成截图和报告。
// 数据修改请在下面的 JSON 区完成，重新导入时仅解析此区，不执行代码。
const recording = /* TOOLBOX_WEBTEST_DATA_BEGIN */
${json}
/* TOOLBOX_WEBTEST_DATA_END */;

const resolveTargetUrl = ${resolveTargetUrl.toString()};
const executeStep = ${executeStep.toString()};
const waitBeforeStep = ${waitBeforeStep.toString()};

(async () => {
  const { chromium } = await import('playwright-core');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const baseUrl = process.argv[2];
  if (!baseUrl) throw new Error('请传入回放环境根地址');
  resolveTargetUrl(baseUrl, './');
  const timeout = Number(process.env.WEBTEST_TIMEOUT || 10000);
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 120000) throw new Error('WEBTEST_TIMEOUT 必须为 100–120000 毫秒');
  const browser = await chromium.launch({ channel: process.env.WEBTEST_BROWSER || 'msedge', headless: process.env.WEBTEST_HEADLESS === '1' });
  const context = await browser.newContext({ viewport: recording.viewport });
  const pages = new Map([['page-1', await context.newPage()]]);
  const popups = new Map();
  const attach = (page, id) => page.on('popup', (popup) => { const list = popups.get(id) || []; list.push(popup); popups.set(id, list); });
  attach(pages.get('page-1'), 'page-1');
  const results = recording.steps.map((step) => ({ stepId: step.id, status: 'pending' }));
  const directory = join(process.cwd(), 'webtest-results', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true });
  let failed = false;
  try {
    for (const [index, step] of recording.steps.entries()) {
      const result = results[index];
      const start = Date.now();
      try {
        await waitBeforeStep(step);
        if (step.action === 'openPage') {
          const opener = pages.get(step.openerId);
          if (!opener) throw new Error('来源页签不存在');
          const popup = popups.get(step.openerId)?.shift() || await opener.waitForEvent('popup', { timeout });
          popups.set(step.openerId, (popups.get(step.openerId) || []).filter((page) => page !== popup));
          pages.set(step.pageId, popup); attach(popup, step.pageId);
        } else {
          const page = pages.get(step.pageId);
          if (!page) throw new Error('页签不存在');
          await executeStep(page, step, baseUrl, timeout, resolveTargetUrl);
        }
        result.status = 'passed';
        console.log('PASS', index + 1, step.label || step.action);
      } catch (error) {
        result.status = 'failed'; result.error = String(error); failed = true;
        console.error('FAIL 第 ' + (index + 1) + ' 步', result.error);
        const page = pages.get(step.pageId);
        if (page && !page.isClosed()) await page.screenshot({ path: join(directory, 'step-' + (index + 1) + '-failed.png'), timeout: 3000 }).catch(() => {});
        break;
      } finally { result.duration = Date.now() - start; }
    }
  } finally {
    try {
      await writeFile(join(directory, 'report.json'), JSON.stringify({ name: recording.name, baseUrl, outcome: failed ? 'failed' : 'passed', results }, null, 2));
    } finally {
      try { await context.close(); } finally { await browser.close(); }
    }
  }
  if (failed) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
}
