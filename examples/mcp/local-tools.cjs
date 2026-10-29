// 使用本机 Node 启动：node examples/mcp/local-tools.cjs。
// stdout 只输出 MCP JSON-RPC；调试日志写 stderr。
const readline = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');
const tools = [
  {
    name: 'text_statistics',
    description: '统计文本行数和字符数。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'file_metadata',
    description: '读取指定本地文件的大小和修改时间（受信任程序使用系统权限）。',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
    if (request.id === undefined) return;
    let result;
    if (request.method === 'initialize')
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'toolbox-local-example', version: '1.0.0' },
      };
    else if (request.method === 'tools/list') result = { tools };
    else if (request.method === 'ping') result = {};
    else if (request.method === 'tools/call') {
      const input = request.params.arguments;
      let value;
      if (request.params.name === 'text_statistics') {
        if (typeof input.text !== 'string') throw new Error('text 必须是字符串');
        value = {
          characters: [...input.text].length,
          lines: input.text ? input.text.split(/\r\n|\r|\n/).length : 0,
        };
      } else if (request.params.name === 'file_metadata') {
        if (typeof input.path !== 'string' || !path.isAbsolute(input.path))
          throw new Error('path 必须是绝对路径');
        const stat = await fs.stat(input.path);
        value = { bytes: stat.size, modifiedAt: stat.mtime.toISOString(), isFile: stat.isFile() };
      } else throw new Error('未知工具');
      result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
    } else throw new Error('未知方法');
    send({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: request?.id ?? null,
      error: { code: -32602, message: String(error) },
    });
  }
});
