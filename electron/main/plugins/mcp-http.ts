import { z } from 'zod';
import type { McpHttpConfig } from '../../shared/plugins/mcp';
import { assertJson, PLUGIN_JSON_LIMIT } from '../../shared/plugins/validation';

const MAX_SESSION_BYTES = 2 * 1024 * 1024;
const messageSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});
const initializeSchema = z.object({
  protocolVersion: z.enum(['2025-03-26', '2025-06-18', '2025-11-25']),
  capabilities: z.object({ tools: z.object({}).optional() }),
});

/**
 * 每次操作建立独立 Streamable HTTP 会话，不重试可能产生写入的工具调用。
 * @param server 已授权的 HTTP 连接。
 * @param signal UI/AI 取消、撤销授权或应用退出信号。
 * @param action 初始化完成后的工具发现或调用。
 * @returns 有界 JSON-RPC 结果；结束后释放响应流并尝试删除会话。
 */
export async function withHttpMcpClient<T>(
  server: McpHttpConfig,
  signal: AbortSignal,
  action: (rpc: (method: string, params: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(() => controller.abort(), 60000);
  let sessionId = '';
  let protocolVersion = '';
  let sequence = 0;
  let total = 0;
  let serverRequests = 0;

  const headers = (): Headers => {
    const result = new Headers(server.headers);
    result.set('accept', 'application/json, text/event-stream');
    result.set('content-type', 'application/json');
    if (sessionId) result.set('mcp-session-id', sessionId);
    if (protocolVersion) result.set('mcp-protocol-version', protocolVersion);
    return result;
  };
  const count = (bytes: number): void => {
    total += bytes;
    if (total > MAX_SESSION_BYTES) throw new Error('MCP HTTP 会话响应超过 2 MB');
  };
  const post = async (packet: unknown): Promise<Response> => {
    assertJson(packet);
    combined.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(server.url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(packet),
        signal: combined,
        redirect: 'manual',
        credentials: 'omit',
      });
    } catch {
      if (combined.aborted) throw new Error('MCP 已取消或超过 60 秒');
      throw new Error('MCP HTTP 连接失败，请检查服务地址、网络和证书');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 300 && response.status < 400)
        throw new Error('MCP HTTP 不跟随重定向，请填写最终服务地址');
      if (response.status === 401 || response.status === 403)
        throw new Error(`MCP HTTP 鉴权失败（${response.status}），请检查请求头和服务权限`);
      if (response.status === 404 && sessionId)
        throw new Error('MCP HTTP 会话已失效，请重新发起操作；本次调用不会自动重试');
      throw new Error(`MCP HTTP 请求失败（${response.status}）`);
    }
    return response;
  };
  const send = async (packet: unknown): Promise<void> => {
    const response = await post(packet);
    await response.body?.cancel();
    if (response.status !== 202 && response.status !== 204)
      throw new Error('MCP HTTP 通知或客户端响应应返回 202');
  };
  const parse = async (text: string, id: number): Promise<{ value: unknown } | undefined> => {
    if (Buffer.byteLength(text) > PLUGIN_JSON_LIMIT) throw new Error('MCP HTTP 消息超过 256 KB');
    const message = messageSchema.parse(assertJson(JSON.parse(text)));
    if (message.method !== undefined) {
      if (message.id !== undefined) {
        if (++serverRequests > 32) throw new Error('MCP 服务请求过多');
        await send(
          message.method === 'ping'
            ? { jsonrpc: '2.0', id: message.id, result: {} }
            : {
                jsonrpc: '2.0',
                id: message.id,
                error: { code: -32601, message: 'Client capability not supported' },
              },
        );
      }
      return;
    }
    if (message.id !== id) throw new Error('MCP HTTP 响应 ID 不匹配');
    if (message.error) throw new Error(message.error.message.slice(0, 2000));
    if (!Object.hasOwn(message, 'result')) throw new Error('MCP HTTP 响应缺少 result');
    return { value: message.result };
  };
  const read = async (response: Response, id: number): Promise<unknown> => {
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json' && contentType !== 'text/event-stream') {
      await response.body?.cancel();
      throw new Error('MCP HTTP 需要 JSON 或 SSE 响应，请填写 Streamable HTTP 的 MCP 端点');
    }
    if (!response.body) throw new Error('MCP HTTP 响应为空');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let data: string[] = [];
    let eventBytes = 0;
    let jsonBytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (value) count(value.byteLength);
        buffer += decoder.decode(value, { stream: !done });
        if (contentType === 'application/json') {
          jsonBytes += value?.byteLength ?? 0;
          if (jsonBytes > PLUGIN_JSON_LIMIT) throw new Error('MCP HTTP 消息超过 256 KB');
          if (!done) continue;
          const result = await parse(buffer, id);
          if (result) return result.value;
          throw new Error('MCP HTTP 未返回请求结果');
        }
        // CR/LF 可能跨网络分片，保留末尾 CR，避免把同一换行误判为事件结束。
        while (true) {
          const match = /\r\n|\r|\n/.exec(buffer);
          if (!match || (!done && match[0] === '\r' && match.index === buffer.length - 1)) break;
          const line = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          eventBytes += Buffer.byteLength(line) + 1;
          if (eventBytes > PLUGIN_JSON_LIMIT) throw new Error('MCP HTTP SSE 消息超过 256 KB');
          if (!line) {
            const payload = data.join('\n');
            if (payload) {
              const result = await parse(payload, id);
              if (result) return result.value;
            }
            data = [];
            eventBytes = 0;
          } else if (line === 'data' || line.startsWith('data:')) {
            data.push(line.slice(5).replace(/^ /, ''));
          }
        }
        if (Buffer.byteLength(buffer) + eventBytes > PLUGIN_JSON_LIMIT)
          throw new Error('MCP HTTP SSE 消息超过 256 KB');
        if (done) throw new Error('MCP HTTP 响应流提前结束，未返回请求结果');
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  };
  const rpc = async (method: string, params: unknown): Promise<unknown> => {
    const id = ++sequence;
    const response = await post({ jsonrpc: '2.0', id, method, params });
    if (method === 'initialize') {
      const assigned = response.headers.get('mcp-session-id');
      if (assigned !== null) {
        if (!/^[\x21-\x7e]{1,1024}$/.test(assigned)) {
          await response.body?.cancel();
          throw new Error('MCP HTTP 会话 ID 无效');
        }
        sessionId = assigned;
      }
    }
    return read(response, id);
  };
  try {
    const accepted = initializeSchema.parse(
      await rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Toolbox', version: '1.0.0' },
      }),
    );
    protocolVersion = accepted.protocolVersion;
    if (!accepted.capabilities.tools) throw new Error('MCP 服务未提供 tools 能力');
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await action(rpc);
  } catch (error) {
    if (combined.aborted) throw new Error('MCP 已取消或超过 60 秒');
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (sessionId) {
      // DELETE 失败不覆盖调用结果；服务可不支持会话删除（405）。
      await fetch(server.url, {
        method: 'DELETE',
        headers: headers(),
        redirect: 'manual',
        credentials: 'omit',
        signal: AbortSignal.timeout(1000),
      })
        .then((response) => response.body?.cancel())
        .catch(() => {});
    }
  }
}
