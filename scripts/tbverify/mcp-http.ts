import assert from 'node:assert/strict';
import http, { type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mcpConfigSchema } from '../../electron/main/plugins/mcp-config';
import {
  cancelMcp,
  listMcpServers,
  removeMcpServer,
  runMcp,
  saveMcpServer,
} from '../../electron/main/plugins/mcp';
import { mcpTools } from '../../electron/main/ai/tools/mcp';
import type { McpHttpConfig } from '../../electron/shared/plugins/mcp';

/** 本地真实 HTTP 服务验证，不连接外网、不读取用户 MCP 配置。 */
export async function verifyMcpHttp(
  check: (name: string, fn: () => Promise<void> | void) => Promise<void>,
): Promise<void> {
  const sessions = new Set<string>();
  const initialized = new Set<string>();
  const pings = new Map<string, { response: ServerResponse; id: number }>();
  const seen: {
    method: string;
    session: string;
    url: string;
    headers: http.IncomingHttpHeaders;
  }[] = [];
  let leaked = 0;
  const errors: unknown[] = [];
  const fixture = http.createServer((req, res) => {
    void (async () => {
      const url = req.url!;
      if (url === '/credential-leak') leaked++;
      if (url === '/redirect') {
        res.writeHead(307, { location: '/credential-leak' });
        res.end();
        return;
      }
      if (url === '/unauthorized') {
        res.writeHead(401);
        res.end('private error body');
        return;
      }
      assert.equal(req.headers.authorization, 'Bearer fixture-secret');
      assert.equal(req.headers['x-test-key'], 'fixture-key');
      assert.equal(req.headers.cookie, undefined);
      const session = String(req.headers['mcp-session-id'] ?? '');
      if (req.method === 'DELETE') {
        seen.push({ method: 'DELETE', session, url, headers: req.headers });
        sessions.delete(session);
        res.writeHead(204);
        res.end();
        return;
      }
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.accept, 'application/json, text/event-stream');
      let body = '';
      for await (const chunk of req) body += chunk;
      const packet = JSON.parse(body);
      seen.push({ method: packet.method ?? 'response', session, url, headers: req.headers });
      const reply = (result: unknown, id = packet.id): void => {
        const text = JSON.stringify({ jsonrpc: '2.0', id, result });
        if (url === '/sse') {
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
          res.write(': keepalive\r\n\r\n');
          res.write('id: initial-event\r\nretry: 1000\r\ndata: \r\n\r\n');
          res.write(
            'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\n',
          );
          // 同时覆盖多行 data、CRLF 和 UTF-8 字符被拆成多次网络写入。
          const payload = Buffer.from(
            `event: message\r\ndata: ${text.slice(0, text.indexOf(',') + 1)}\r\ndata: ${text.slice(text.indexOf(',') + 1)}\r\n\r\n`,
          );
          void (async () => {
            for (let offset = 0; offset < payload.length; offset += 7) {
              if (res.destroyed) return;
              res.write(payload.subarray(offset, offset + 7));
              await delay(1);
            }
            // 流保持打开，客户端拿到目标响应就应返回并关闭流。
          })();
        } else {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(text);
        }
      };
      if (packet.method === 'initialize') {
        assert.equal(session, '');
        assert.equal(req.headers['mcp-protocol-version'], undefined);
        assert.equal(packet.params.protocolVersion, '2025-06-18');
        if (url !== '/stateless') {
          const id = randomUUID();
          sessions.add(id);
          res.setHeader('mcp-session-id', id);
        }
        reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
        return;
      }
      assert.equal(req.headers['mcp-protocol-version'], '2025-06-18');
      if (url !== '/stateless') assert.ok(sessions.has(session));
      if (packet.method === 'notifications/initialized') {
        initialized.add(session);
        res.writeHead(202);
        res.end();
        return;
      }
      assert.ok(initialized.has(session));
      if (packet.method === undefined) {
        const pending = pings.get(session)!;
        assert.equal(packet.id, 'server-ping');
        assert.deepEqual(packet.result, {});
        pending.response.end(
          `data: ${JSON.stringify({ jsonrpc: '2.0', id: pending.id, result: { pong: true } })}\n\n`,
        );
        pings.delete(session);
        res.writeHead(202);
        res.end();
        return;
      }
      if (packet.method === 'tools/list') {
        if (packet.params.cursor) {
          assert.equal(packet.params.cursor, 'page-2');
          reply({
            tools: [{ name: 'echo', description: '中文', inputSchema: { type: 'object' } }],
          });
        } else
          reply({
            tools: [{ name: 'sum', inputSchema: { type: 'object' } }],
            nextCursor: 'page-2',
          });
        return;
      }
      assert.equal(packet.method, 'tools/call');
      switch (packet.params.name) {
        case 'sum':
          reply({
            content: [
              { type: 'text', text: String(packet.params.arguments.a + packet.params.arguments.b) },
            ],
          });
          break;
        case 'hang':
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write(': waiting\n\n');
          break;
        case 'ping':
          pings.set(session, { response: res, id: packet.id });
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: {"jsonrpc":"2.0","id":"server-ping","method":"ping"}\n\n');
          break;
        case 'wrong-id':
          reply({}, packet.id + 1);
          break;
        case 'large':
          reply({ text: 'x'.repeat(270 * 1024) });
          break;
        case 'large-sse':
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end('data: ' + 'x'.repeat(270 * 1024));
          break;
        case 'total-limit':
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end((': ' + 'x'.repeat(1000) + '\n\n').repeat(2200));
          break;
        case 'ended':
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.end(': no result\n\n');
          break;
        case 'html':
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>not mcp</html>');
          break;
        case 'expired':
          res.writeHead(404);
          res.end();
          break;
        case 'failure':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: packet.id,
              error: { code: -32602, message: 'invalid arguments' },
            }),
          );
          break;
        default:
          throw new Error('Unexpected fixture tool');
      }
    })().catch((error) => {
      errors.push(error);
      res.destroy();
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const port = (fixture.address() as { port: number }).port;
  const ids: string[] = [];
  const make = async (endpoint: string, aiEnabled = false): Promise<McpHttpConfig> => {
    const config: McpHttpConfig = {
      id: randomUUID(),
      name: 'HTTP fixture',
      transport: 'http',
      url: `http://127.0.0.1:${port}${endpoint}`,
      headers: { Authorization: 'Bearer fixture-secret', 'X-Test-Key': 'fixture-key' },
      enabled: true,
      trusted: true,
      aiEnabled,
      revision: randomUUID(),
    };
    await saveMcpServer(config);
    ids.push(config.id);
    return listMcpServers().find((item) => item.id === config.id)! as McpHttpConfig;
  };
  const call = (server: McpHttpConfig, tool: string, extra = {}) =>
    runMcp({ id: server.id, owner: randomUUID(), tool, input: { a: 2, b: 3 }, ...extra });
  try {
    await check('MCP HTTP config validation and legacy stdio compatibility', () => {
      const base = {
        id: randomUUID(),
        name: 'test',
        enabled: false,
        trusted: false,
        aiEnabled: false,
        revision: randomUUID(),
      };
      assert.equal(
        mcpConfigSchema.parse({ ...base, executable: process.execPath, args: [], cwd: '' })
          .transport,
        'stdio',
      );
      for (const url of [
        'file:///tmp/mcp',
        'http://user:pass@localhost/mcp',
        'https://host/mcp#fragment',
      ])
        assert.throws(() => mcpConfigSchema.parse({ ...base, transport: 'http', url }));
      for (const headers of [
        { Host: 'evil' },
        { 'Mcp-Session-Id': 'spoof' },
        { authorization: 'a', Authorization: 'b' },
        { Authorization: 'a\r\nx: b' },
        { 'X-Large': 'x'.repeat(17000) },
      ])
        assert.throws(() =>
          mcpConfigSchema.parse({
            ...base,
            transport: 'http',
            url: 'http://localhost/mcp',
            headers,
          }),
        );
    });
    await check(
      'MCP HTTP JSON/SSE, pagination, UTF-8 chunks, session headers and cleanup',
      async () => {
        for (const endpoint of ['/json', '/sse', '/stateless']) {
          const config = await make(endpoint);
          const tools = await runMcp({ id: config.id, owner: randomUUID() });
          assert.deepEqual(
            (tools as { name: string }[]).map((tool) => tool.name),
            ['sum', 'echo'],
          );
          assert.equal((tools as { description: string }[])[1].description, '中文');
          assert.deepEqual(await call(config, 'sum'), { content: [{ type: 'text', text: '5' }] });
          assert.equal(sessions.size, 0);
        }
        assert.ok(seen.filter((request) => request.method === 'DELETE').length >= 4);
      },
    );
    await check(
      'MCP HTTP trust, AI authorization, revision and no secret in tool metadata',
      async () => {
        const config = await make('/json');
        await assert.rejects(saveMcpServer({ ...config, trusted: false }), /信任/);
        await assert.rejects(call(config, 'sum', { ai: true }), /未授权/);
        await saveMcpServer({ ...config, aiEnabled: true });
        const current = listMcpServers().find((item) => item.id === config.id)!;
        assert.equal(mcpTools().length, 2);
        assert.ok(mcpTools().every((tool) => !tool.description.includes('fixture-secret')));
        await assert.rejects(call(config, 'sum', { revision: config.revision }), /配置已变化/);
        assert.deepEqual(await call(config, 'sum', { revision: current.revision, ai: true }), {
          content: [{ type: 'text', text: '5' }],
        });
      },
    );
    await check(
      'MCP HTTP errors, auth, redirect isolation, message and stream limits',
      async () => {
        const config = await make('/json');
        for (const [tool, expected] of [
          ['wrong-id', /ID/],
          ['large', /256 KB/],
          ['large-sse', /256 KB/],
          ['total-limit', /2 MB/],
          ['ended', /提前结束/],
          ['html', /端点/],
          ['expired', /会话已失效/],
          ['failure', /invalid arguments/],
        ] as const)
          await assert.rejects(call(config, tool), expected);
        const auth = await make('/unauthorized');
        await assert.rejects(call(auth, 'sum'), /鉴权失败/);
        const redirect = await make('/redirect');
        await assert.rejects(call(redirect, 'sum'), /重定向/);
        assert.equal(leaked, 0);
        assert.equal(sessions.size, 0);
        assert.equal(
          seen.filter((item) => item.method === 'tools/call' && item.url === '/json').length > 0,
          true,
        );
      },
    );
    await check(
      'MCP HTTP server ping, explicit cancellation and revoke in-flight request',
      async () => {
        const config = await make('/json');
        assert.deepEqual(await call(config, 'ping'), { pong: true });
        const owner = randomUUID();
        const start = seen.length;
        const pending = call(config, 'hang', { owner });
        const rejected = assert.rejects(pending, /取消/);
        for (
          let retry = 0;
          retry < 100 && !seen.slice(start).some((item) => item.method === 'tools/call');
          retry++
        )
          await delay(10);
        cancelMcp(owner);
        await rejected;
        const secondStart = seen.length;
        const second = assert.rejects(call(config, 'hang'), /取消/);
        for (
          let retry = 0;
          retry < 100 && !seen.slice(secondStart).some((item) => item.method === 'tools/call');
          retry++
        )
          await delay(10);
        await removeMcpServer(config.id);
        await second;
        assert.equal(sessions.size, 0);
      },
    );
    assert.deepEqual(errors, []);
  } finally {
    for (const id of ids) await removeMcpServer(id);
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
}
