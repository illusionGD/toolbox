import http from 'node:http';
import https from 'node:https';
import { z } from 'zod';

const requestSchema = z.strictObject({
  url: z.string().max(4000),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string().max(100), z.string().max(4000)).default({}),
  body: z
    .string()
    .max(64 * 1024)
    .optional(),
});
const MAX_RESPONSE = 128 * 1024;

/**
 * 宿主代理网络请求。每次重定向重新授权；不使用宿主 cookie、凭据或代理。
 * @param input SDK 参数。
 * @param authorize 核验当前运行仍有目标来源权限。
 * @param signal 运行结束时中断。
 * @returns 有界文本响应。
 */
export async function pluginFetch(
  input: unknown,
  authorize: (origin: string) => void,
  signal: AbortSignal,
) {
  const options = requestSchema.parse(input);
  if (options.body && Buffer.byteLength(options.body) > 64 * 1024)
    throw new Error('请求体超过 64 KB');
  if (Object.keys(options.headers).length > 20) throw new Error('请求头最多 20 项');
  let headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers)) {
    const lower = key.toLowerCase();
    if (!/^(accept|content-type|authorization|x-[a-z0-9-]+)$/.test(lower) || /[\r\n]/.test(value))
      throw new Error(`不允许的请求头：${key}`);
    headers[lower] = value;
  }
  let target = new URL(options.url);
  let method = options.method;
  let body = options.body;
  const deadline = AbortSignal.timeout(20000);
  const abort = AbortSignal.any([signal, deadline]);
  for (let hop = 0; hop <= 3; hop++) {
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new Error('只支持无内嵌凭据的 HTTP(S) 地址');
    authorize(target.origin);
    if (abort.aborted) throw new Error('网络请求已取消或超时');
    const response = await new Promise<{
      status: number;
      location?: string;
      headers: Record<string, string>;
      body: string;
    }>((resolve, reject) => {
      const request = (target.protocol === 'https:' ? https : http).request(
        target,
        { method, headers, signal: abort, maxHeaderSize: 16 * 1024 },
        (incoming) => {
          const status = incoming.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status) && incoming.headers.location) {
            resolve({ status, location: incoming.headers.location, headers: {}, body: '' });
            incoming.destroy();
            return;
          }
          let bytes = 0;
          const chunks: Buffer[] = [];
          incoming.on('error', reject);
          incoming.on('aborted', () => reject(new Error('响应被中断')));
          incoming.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_RESPONSE) {
              request.destroy(new Error('响应超过 128 KB'));
              return;
            }
            chunks.push(chunk);
          });
          incoming.on('end', () => {
            resolve({
              status,
              body: Buffer.concat(chunks).toString('utf8'),
              headers: { 'content-type': String(incoming.headers['content-type'] ?? '') },
            });
          });
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    authorize(target.origin);
    if (abort.aborted) throw new Error('网络请求已取消或超时');
    if (!response.location)
      return {
        status: response.status,
        url: target.href,
        headers: response.headers,
        body: response.body,
      };
    const next = new URL(response.location, target);
    if (next.origin !== target.origin)
      headers = Object.fromEntries(
        Object.entries(headers).filter(([key]) => key === 'accept' || key === 'content-type'),
      );
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
    }
    target = next;
  }
  throw new Error('重定向超过 3 次');
}
