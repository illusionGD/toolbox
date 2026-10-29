import path from 'node:path';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { z } from 'zod';

const common = {
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  aiEnabled: z.boolean(),
  trusted: z.boolean(),
  revision: z.string().uuid(),
};
const stdio = z.strictObject({
  ...common,
  transport: z.literal('stdio'),
  executable: z.string().min(1).max(1000).refine(path.isAbsolute, '请选择可执行程序的绝对路径'),
  args: z.array(z.string().max(4000)).max(40),
  cwd: z
    .string()
    .max(1000)
    .refine((value) => !value || path.isAbsolute(value), '工作目录必须是绝对路径'),
});
const http = z.strictObject({
  ...common,
  transport: z.literal('http'),
  url: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
        );
      } catch {
        return false;
      }
    }, '请输入 HTTP(S) 服务地址，鉴权请使用请求头，地址不能包含用户名、密码或片段'),
  headers: z
    .record(z.string(), z.string())
    .default({})
    .refine((headers) => {
      const names = new Set<string>();
      if (
        Object.keys(headers).length > 40 ||
        Buffer.byteLength(JSON.stringify(headers)) > 16 * 1024
      )
        return false;
      try {
        for (const [name, value] of Object.entries(headers)) {
          const key = name.toLowerCase();
          if (
            names.has(key) ||
            [
              'host',
              'connection',
              'content-length',
              'transfer-encoding',
              'upgrade',
              'trailer',
              'te',
              'expect',
              'accept',
              'content-type',
              'cookie',
              'origin',
            ].includes(key) ||
            key.startsWith('mcp-') ||
            key.startsWith('proxy-') ||
            key.startsWith('sec-')
          )
            return false;
          names.add(key);
          validateHeaderName(name);
          validateHeaderValue(name, value);
        }
        return true;
      } catch {
        return false;
      }
    }, '请求头无效：最多 40 项 / 16 KB，名称不能重复或覆盖 HTTP/MCP 协议头'),
});

/** 兼容没有 transport 字段的旧 stdio 配置，校验时归一化。 */
export const mcpConfigSchema = z.preprocess(
  (input) => {
    if (input && typeof input === 'object' && !Array.isArray(input) && !('transport' in input))
      return { ...input, transport: 'stdio' };
    return input;
  },
  z.discriminatedUnion('transport', [stdio, http]),
);
