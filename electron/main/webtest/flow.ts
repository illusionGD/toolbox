import { z } from 'zod';
import { viewportSchema } from './options';
import type { WebTestFlow, WebTestStep } from '../../shared/webtest';

const cssSelector = z
  .string()
  .min(1)
  .max(4000)
  .refine(
    (value) =>
      !/>>|^(?:(?:text|xpath|css)=|internal:)|:has-text\(|:text(?:-is|-matches)?\(/i.test(value),
    '只接受 CSS 定位，不支持文案、XPath 或其他定位引擎',
  );
const stepSchema = z
  .object({
    id: z.string().min(1).max(100),
    action: z.enum([
      'navigate',
      'click',
      'dblclick',
      'fill',
      'check',
      'select',
      'press',
      'scroll',
      'assertVisible',
      'assertHidden',
      'assertValue',
      'assertChecked',
      'assertUrl',
      'openPage',
      'closePage',
      'unsupported',
    ]),
    pageId: z.string().regex(/^page-\d+$/),
    delayBeforeMs: z.number().int().min(0).max(86400000).optional(),
    label: z.string().max(200).optional(),
    selector: cssSelector.optional(),
    frames: z.array(cssSelector).max(10).optional(),
    path: z.string().max(8000).optional(),
    value: z.string().max(100000).optional(),
    values: z.array(z.string().max(10000)).max(1000).optional(),
    checked: z.boolean().optional(),
    x: z.number().finite().min(0).max(1e8).optional(),
    y: z.number().finite().min(0).max(1e8).optional(),
    button: z.enum(['left', 'middle', 'right']).optional(),
    modifiers: z
      .array(z.enum(['Alt', 'Control', 'Meta', 'Shift']))
      .max(4)
      .optional(),
    openerId: z
      .string()
      .regex(/^page-\d+$/)
      .optional(),
    fragile: z.boolean().optional(),
    locatorIssue: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((step, context) => {
    const fail = (message: string): void => context.addIssue({ code: 'custom', message });
    if (['navigate', 'assertUrl'].includes(step.action)) {
      if (!step.path) fail('导航和地址检查必须填写相对路径');
      else {
        try {
          resolveTargetUrl('https://toolbox.invalid/root/', step.path);
        } catch {
          fail('路径必须以 ./ 开头且不能跳出环境根目录');
        }
      }
    }
    if (
      !['navigate', 'assertUrl', 'openPage', 'closePage', 'unsupported', 'scroll'].includes(
        step.action,
      ) &&
      !step.selector
    )
      fail('此动作必须填写 CSS 定位');
    if (
      ['fill', 'press', 'assertValue', 'unsupported'].includes(step.action) &&
      step.value === undefined
    )
      fail('此动作必须填写值');
    if (['check', 'assertChecked'].includes(step.action) && step.checked === undefined)
      fail('此动作必须填写勾选状态');
    if (step.action === 'select' && !step.values) fail('选择动作必须填写选项 value');
    if (step.action === 'scroll' && (step.x === undefined || step.y === undefined))
      fail('滚动动作必须填写坐标');
    if (step.action === 'openPage' && !step.openerId) fail('新页签必须指定来源页签');
  });

/**
 * 规范化环境根地址，路径按目录处理，拒绝凭据与非 HTTP 协议。
 * @param input 用户输入。
 * @returns 规范化的根地址。
 */
export function normalizeBaseUrl(input: string): string {
  const url = new URL(input.trim());
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('环境根地址必须是 HTTP(S) 地址，不能包含账号、查询参数或 hash');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

/**
 * 将相对路径映射到新的环境；此函数也原样嵌入导出脚本，必须自包含。
 * @param baseUrl HTTP(S) 环境根目录。
 * @param path 用例内的相对路径。
 * @returns 目标绝对 URL。
 */
export function resolveTargetUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('环境根地址无效');
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  if (!path.startsWith('./') || path.includes('\\')) throw new Error('用例路径必须以 ./ 开头');
  const url = new URL(path, base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
    throw new Error('用例路径不能跳出环境根目录');
  return url.href;
}

/**
 * 去掉录制环境的 origin 和部署目录，保留查询参数与 hash 路由。
 * @param currentUrl 浏览器当前地址。
 * @param baseUrl 录制时的环境根目录。
 * @returns 环境无关路径。
 */
export function toRelativePath(currentUrl: string, baseUrl: string): string {
  const url = new URL(currentUrl);
  const base = new URL(normalizeBaseUrl(baseUrl));
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new Error('页面跳出了环境根目录；请将根地址设为共同上级目录。此版本暂不支持跨域页面映射');
  }
  return `./${url.pathname.slice(base.pathname.length)}${url.search}${url.hash}`;
}

/**
 * 校验外部传入步骤，拒绝未知动作和缺失参数。
 * @param input IPC 或录制脚本发来的数据。
 * @returns 校验后的纯数据。
 */
export function parseStep(input: unknown): WebTestStep {
  const result = stepSchema.safeParse(input);
  if (!result.success)
    throw new Error(result.error.issues.map((issue) => issue.message).join('；'));
  return result.data;
}

/**
 * 校验用例的版本、步骤、页签顺序和唯一 ID，错误携带实际步骤编号。
 * @param input 来自文件或 IPC 的未知数据。
 * @returns 可回放的用例。
 */
export function parseFlow(input: unknown): WebTestFlow {
  const envelope = z
    .object({
      schema: z.literal('toolbox.webtest'),
      version: z.literal(1),
      name: z.string().trim().min(1).max(120),
      createdAt: z.iso.datetime(),
      viewport: viewportSchema,
      steps: z.array(z.unknown()).max(5000),
    })
    .strict()
    .safeParse(input);
  if (!envelope.success)
    throw new Error('用例格式无效：需要 toolbox.webtest v1 数据，最多 5000 步');
  const ids = new Set<string>();
  const pages = new Set(['page-1']);
  const steps = envelope.data.steps.map((inputStep, index) => {
    try {
      const step = parseStep(inputStep);
      if (ids.has(step.id)) throw new Error('步骤 ID 重复');
      ids.add(step.id);
      if (step.action === 'openPage') {
        if (pages.has(step.pageId) || !pages.has(step.openerId!))
          throw new Error('新页签编号或来源无效');
        pages.add(step.pageId);
      } else if (!pages.has(step.pageId)) throw new Error('页签尚未打开或已关闭');
      if (step.action === 'closePage') pages.delete(step.pageId);
      return step;
    } catch (error) {
      throw new Error(
        `第 ${index + 1} 步：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
  return { ...envelope.data, steps };
}

/**
 * 只解析 JSON 数据区，不执行导入的 JavaScript / TypeScript。
 * @param content 文件内容。
 * @param extension 文件扩展名。
 * @returns 校验后的用例。
 */
export function importFlow(content: string, extension: string): WebTestFlow {
  if (Buffer.byteLength(content, 'utf8') > 5 * 1024 * 1024)
    throw new Error('用例文件不能超过 5 MB');
  let json = content.replace(/^\uFEFF/, '');
  if (extension !== '.json') {
    if (!['.ts', '.js'].includes(extension)) throw new Error('只支持 JSON、TS、JS 文件');
    const start = '/* TOOLBOX_WEBTEST_DATA_BEGIN */';
    const end = '/* TOOLBOX_WEBTEST_DATA_END */';
    const startIndex = json.indexOf(start);
    const endIndex = json.indexOf(end, startIndex + start.length);
    if (startIndex < 0 || endIndex < 0)
      throw new Error('请导入本工具导出的 TS / JS 脚本（缺少用例数据区）');
    json = json.slice(startIndex + start.length, endIndex).trim();
  }
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('用例数据不是有效的 JSON');
  }
  return parseFlow(data);
}
