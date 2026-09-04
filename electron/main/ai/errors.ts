/**
 * AI 错误归一化：把 SDK 抛出的东西变成一句中文可读的原因。
 *
 * 三条实测结论决定了这里的写法：
 * 1. **默认重试会把真实错误包起来**：`streamText` 默认 maxRetries=2 时，错误分片里是
 *    `AI_RetryError`，它自己的 `statusCode` 是 `undefined`、`responseBody` 是空串，
 *    真正带状态码的 `AI_APICallError` 藏在 `lastError` 里。所以**必须先拆链**再判断，
 *    否则永远拿不到状态码。
 * 2. **HTML 错误页与空响应体的 `message` 是空串**（实测 502 text/html、500 空体），
 *    直接把 message 显示出来就是一片空白，必须自己按状态码 + 响应体片段合成。
 * 3. 取消是**单独的 abort 分片**，不走错误路径；但若 fetch 层的 AbortError 冒到这里
 *    （比如取消发生在建连阶段），也要认出来当取消处理而不是「请求失败」。
 */
import { APICallError, RetryError } from 'ai';

/** 拆链时最多走几层，防成环。 */
const MAX_DEPTH = 6;

/**
 * 沿 `lastError` / `cause` 拆到最内层，优先返回第一个 APICallError。
 * @param error 任意错误。
 * @returns 最有信息量的那一层。
 */
function innermost(error: unknown): unknown {
  let current: unknown = error;
  let fallback: unknown = error;
  for (let i = 0; i < MAX_DEPTH && current; i += 1) {
    if (APICallError.isInstance(current)) return current;
    fallback = current;
    const next = RetryError.isInstance(current)
      ? current.lastError
      : (current as { cause?: unknown }).cause;
    if (!next || next === current) break;
    current = next;
  }
  return current ?? fallback;
}

/**
 * 是否是「用户取消」。
 * @param error 任意错误。
 * @returns 取消导致的错误为 true。
 */
export function isAbortError(error: unknown): boolean {
  for (let i = 0, cur: unknown = error; i < MAX_DEPTH && cur; i += 1) {
    const name = (cur as { name?: string }).name;
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * 状态码 → 中文说法。**这是猜测性的归类而非各家实测**：各厂商对同一状态码的含义
 * 大体一致，但个别端点会用 400 表达额度问题。因此原始响应体片段一定要附上。
 * @param status HTTP 状态码。
 * @returns 中文说明。
 */
function statusText(status: number): string {
  if (status === 400) return '请求被拒绝（参数或模型 id 不被接受）';
  if (status === 401) return 'API Key 无效或已过期';
  if (status === 403) return '无权限（key 不能用这个模型，或地区受限）';
  if (status === 404) return '接口地址或模型不存在（检查 base URL 的版本段与模型 id）';
  if (status === 413) return '请求过大（图片或上下文太长）';
  if (status === 422) return '请求参数不被接受';
  if (status === 429) return '触发频率或额度限制，稍后再试';
  if (status === 402) return '余额不足';
  if (status >= 500) return '服务端错误或网关异常';
  return `接口返回 ${status}`;
}

/**
 * 从响应体里抠一段能看的信息。
 *
 * JSON 优先取 `error.message` / `message` / `error`（各家都在这三处之一）；
 * 拿不到就退回截断的原文——HTML 错误页会被压成一行，比原样贴一坨标签强。
 * @param body 原始响应体。
 * @returns 片段；无内容时为空串。
 */
function bodySnippet(body: string | undefined): string {
  const raw = (body ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const err = parsed.error;
    const picked =
      (typeof err === 'object' && err && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : undefined) ??
      (typeof err === 'string' ? err : undefined) ??
      (typeof parsed.message === 'string' ? parsed.message : undefined);
    if (picked) return picked.slice(0, 300);
  } catch {
    // 不是 JSON（HTML 错误页 / 纯文本）就走下面的截断
  }
  return raw.replace(/\s+/g, ' ').slice(0, 200);
}

/**
 * 归一化成一句可直接显示给用户的中文原因。
 * @param error 任意错误。
 * @returns 中文说明，永不为空串。
 */
export function describeAiError(error: unknown): string {
  if (isAbortError(error)) return '已取消';

  const inner = innermost(error);

  if (APICallError.isInstance(inner)) {
    const status = inner.statusCode;
    const head = typeof status === 'number' ? statusText(status) : '请求失败';
    const detail = bodySnippet(inner.responseBody) || inner.message.trim();
    const code = typeof status === 'number' ? ` [HTTP ${status}]` : '';
    return detail ? `${head}${code}：${detail}` : `${head}${code}`;
  }

  const message = (inner as { message?: unknown } | undefined)?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();

  const name = (inner as { name?: unknown } | undefined)?.name;
  if (typeof name === 'string' && name) return `请求失败（${name}）`;

  return '请求失败（无更多信息）';
}
