import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { dataPath } from '../storage/paths';
import { assertJson } from '../../shared/plugins/validation';
import type { McpServerConfig, McpStdioConfig, McpToolInfo } from '../../shared/plugins/mcp';
import { mcpConfigSchema } from './mcp-config';
import { withHttpMcpClient } from './mcp-http';
import {
  assertPluginStorageReady,
  logPlugin,
  notifyPluginsChanged,
  onPluginsStop,
  pluginTransaction,
} from './registry';

let records: McpServerConfig[] = [];
let loaded = false;
let loading: Promise<void> | undefined;
const active = new Map<string, { serverId: string; abort: AbortController }>();

/** 启动恢复显式配置；损坏文件保留，不静默覆盖。 */
export async function initMcp(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const file = await fs.readFile(dataPath('plugins', 'mcp.json'), 'utf8');
      if (Buffer.byteLength(file) > 256 * 1024) throw new Error('MCP 配置过大');
      const parsed = z.array(mcpConfigSchema).max(20).parse(JSON.parse(file));
      if (new Set(parsed.map((item) => item.id)).size !== parsed.length)
        throw new Error('MCP 配置 ID 重复');
      records = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    loaded = true;
  })();
  try {
    await loading;
  } finally {
    loading = undefined;
  }
}

/** @returns 不含运行进程的配置快照。 */
export function listMcpServers(): McpServerConfig[] {
  return structuredClone(records);
}

function stopServer(id?: string): void {
  for (const run of active.values()) if (!id || run.serverId === id) run.abort.abort();
}
onPluginsStop((id) => {
  if (!id) stopServer();
});

/** @param owner 只取消指定 UI 或 AI 所有者的调用。 */
export function cancelMcp(owner: string): void {
  active.get(owner)?.abort.abort();
}

async function persist(next: McpServerConfig[]): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(next)) > 256 * 1024)
    throw new Error('MCP 配置总计不能超过 256 KB');
  const file = dataPath('plugins', 'mcp.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temp, JSON.stringify(next));
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
  records = next;
  notifyPluginsChanged();
}

/** @param input 用户保存并确认信任的本地程序或 HTTP 服务配置。 */
export async function saveMcpServer(input: unknown): Promise<void> {
  await initMcp();
  const config = mcpConfigSchema.parse(input);
  if (config.enabled && !config.trusted) throw new Error('启用前需确认信任此 MCP 连接');
  if (config.transport === 'stdio') {
    if (/\.(cmd|bat|ps1)$/i.test(config.executable))
      throw new Error('请选择 exe 或可执行文件，脚本请使用解释器路径和参数');
    if (!(await fs.stat(config.executable)).isFile()) throw new Error('可执行程序不存在');
    if (config.cwd && !(await fs.stat(config.cwd)).isDirectory()) throw new Error('工作目录不存在');
  }
  await pluginTransaction(async () => {
    const current = records.find((item) => item.id === config.id);
    if (current && current.revision !== config.revision)
      throw new Error('MCP 配置已变化，请重新打开配置');
    if (!records.some((item) => item.id === config.id) && records.length >= 20)
      throw new Error('最多配置 20 个 MCP 服务');
    stopServer(config.id);
    await persist([
      ...records.filter((item) => item.id !== config.id),
      { ...config, revision: randomUUID() },
    ]);
  });
}

/** @param id 用户确认移除的连接；不会删除可执行程序。 */
export async function removeMcpServer(id: string): Promise<void> {
  await initMcp();
  await pluginTransaction(async () => {
    stopServer(id);
    await persist(records.filter((item) => item.id !== id));
  });
}

function terminate(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    killer.on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * 一次调用一个本地 MCP 进程，使用标准 JSON-RPC stdio，无 shell 字符串拼接。
 * @param server 已授权配置。
 * @param signal 请求取消或撤销授权。
 * @param action 初始化完成后的操作。
 * @returns MCP 结果。
 */
async function withStdioClient<T>(
  server: McpStdioConfig,
  signal: AbortSignal,
  action: (rpc: (method: string, params: unknown) => Promise<unknown>) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new Error('MCP 已取消');
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'SystemDrive',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const child = spawn(server.executable, server.args, {
    cwd: server.cwd || path.dirname(server.executable),
    env,
    windowsHide: true,
    shell: false,
    stdio: 'pipe',
  });
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let sequence = 0;
  let buffer = '';
  let total = 0;
  let failure: Error | undefined;
  const fail = (error: Error): void => {
    failure = error;
    for (const item of waiting.values()) item.reject(error);
    waiting.clear();
    terminate(child);
  };
  const abort = (): void => fail(new Error('MCP 已取消或超过 60 秒'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 60000);
  const send = (value: unknown): void => {
    child.stdin.write(JSON.stringify(value) + '\n');
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.on('close', () => fail(new Error('MCP 进程已退出')));
  child.stderr.on('data', (chunk: Buffer) =>
    logPlugin(`mcp:${server.id}`, chunk.toString('utf8').slice(0, 2000), 'error'),
  );
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    try {
      total += Buffer.byteLength(chunk);
      buffer += chunk;
      if (total > 2 * 1024 * 1024 || Buffer.byteLength(buffer) > 300 * 1024)
        throw new Error('MCP 输出超过限制');
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        assertJson(message);
        if (message.jsonrpc !== '2.0') throw new Error('MCP JSON-RPC 格式错误');
        if (typeof message.method === 'string') {
          if (message.id !== undefined)
            send(
              message.method === 'ping'
                ? { jsonrpc: '2.0', id: message.id, result: {} }
                : {
                    jsonrpc: '2.0',
                    id: message.id,
                    error: { code: -32601, message: 'Client capability not supported' },
                  },
            );
          continue;
        }
        const pending = waiting.get(message.id);
        if (!pending) continue;
        waiting.delete(message.id);
        if (message.error)
          pending.reject(new Error(String(message.error.message ?? 'MCP 执行失败').slice(0, 2000)));
        else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
        else pending.reject(new Error('MCP 响应缺少 result'));
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  const rpc = (method: string, params: unknown): Promise<unknown> => {
    if (failure || signal.aborted) return Promise.reject(failure ?? new Error('已取消'));
    assertJson(params);
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      waiting.set(id, { resolve, reject });
      send({ jsonrpc: '2.0', id, method, params });
    });
  };
  try {
    const init = await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Toolbox', version: '1.0.0' },
    });
    const accepted = z
      .object({
        protocolVersion: z.enum(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']),
        capabilities: z.object({ tools: z.object({}).optional() }),
      })
      .parse(init);
    if (!accepted.capabilities.tools) throw new Error('MCP 服务未提供 tools 能力');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return await action(rpc);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    child.stdin.end();
    terminate(child);
  }
}

/** @param request 受信任连接与明确调用。 @returns tools 列表或 tools/call 结果。 */
export async function runMcp(request: {
  id: string;
  owner: string;
  tool?: string;
  input?: unknown;
  ai?: boolean;
  revision?: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  await initMcp();
  assertPluginStorageReady();
  const server = records.find((item) => item.id === request.id && item.enabled && item.trusted);
  if (!server || (request.ai && !server.aiEnabled)) throw new Error('MCP 未启用或未授权');
  if (request.revision && request.revision !== server.revision)
    throw new Error('MCP 配置已变化，请重新发起请求');
  if (active.has(request.owner) || active.size >= 4)
    throw new Error('MCP 已运行或超过 4 个并发任务');
  const controller = new AbortController();
  const signal = request.signal
    ? AbortSignal.any([request.signal, controller.signal])
    : controller.signal;
  active.set(request.owner, { serverId: server.id, abort: controller });
  try {
    const action = async (rpc: (method: string, params: unknown) => Promise<unknown>) => {
      if (request.tool)
        return rpc('tools/call', {
          name: z.string().min(1).max(200).parse(request.tool),
          arguments: assertJson(request.input ?? {}),
        });
      const tools: McpToolInfo[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page++) {
        const response = z
          .object({
            tools: z
              .array(
                z.object({
                  name: z.string().max(200),
                  description: z.string().max(16000).default(''),
                  inputSchema: z.record(z.string(), z.unknown()),
                }),
              )
              .max(100),
            nextCursor: z.string().max(1000).optional(),
          })
          .parse(await rpc('tools/list', cursor ? { cursor } : {}));
        tools.push(...response.tools);
        if (tools.length > 100) throw new Error('MCP 工具超过 100 个');
        cursor = response.nextCursor;
        if (!cursor) return tools;
      }
      throw new Error('MCP 工具分页超过限制');
    };
    const result =
      server.transport === 'http'
        ? await withHttpMcpClient(server, signal, action)
        : await withStdioClient(server, signal, action);
    if (signal.aborted) throw new Error('MCP 已取消');
    return assertJson(result);
  } finally {
    active.delete(request.owner);
  }
}
