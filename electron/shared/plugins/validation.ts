import { z } from 'zod';
import type { JsonValue, PluginManifest, PluginSchema } from './types';
import { isPluginOrigin, PLUGIN_PERMISSIONS } from './constants';
import type { PluginPermission } from './types';

/** 单消息限制，同时约束 Schema、命令参数和输出。 */
export const PLUGIN_JSON_LIMIT = 256 * 1024;
export { PLUGIN_PERMISSIONS } from './constants';

/** 固定能力加精确网络 origin，未知能力拒绝。 */
export const pluginPermissionSchema = z
  .string()
  .refine(
    (value) =>
      Object.hasOwn(PLUGIN_PERMISSIONS, value) ||
      (value.startsWith('network:') && isPluginOrigin(value.slice(8))),
    '未知能力或非法网络来源',
  )
  .transform((value) => value as PluginPermission);

/**
 * 验证跨进程 JSON，并限制深度、节点数量和总量。
 * @param value 不可信输入。
 * @returns 可序列化的 JSON。
 */
export function assertJson(value: unknown): JsonValue {
  let nodes = 0;
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 20000 || depth > 20) throw new Error('JSON 结构过大或过深');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || !item) throw new Error('只接受 JSON 数据');
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      throw new Error('只接受普通对象');
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('不允许的对象属性');
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > PLUGIN_JSON_LIMIT)
    throw new Error('JSON 超过 256 KB');
  return value as JsonValue;
}

/**
 * 包内路径使用跨平台可移植子集，拒绝穿越、设备名、ADS、隐藏路径。
 * @param value 相对 POSIX 路径。
 * @returns 是否有效。
 */
export function isPluginPath(value: string): boolean {
  return (
    value.length <= 180 &&
    value
      .split('/')
      .every(
        (part) =>
          /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) &&
          !part.endsWith('.') &&
          !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  );
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const packageId = z.string().regex(/^[a-z][a-z0-9-]{0,29}\.[a-z][a-z0-9-]{0,39}$/);
const entry = z.string().refine(isPluginPath, '非法包内路径');
const schema: z.ZodType<PluginSchema> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']),
    title: z.string().max(100).optional(),
    description: z.string().max(1000).optional(),
    properties: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/), schema).optional(),
    required: z.array(z.string()).max(100).optional(),
    additionalProperties: z.literal(false).optional(),
    items: schema.optional(),
    enum: z.array(z.json()).min(1).max(100).optional(),
    default: z.json().optional(),
  }),
);
const manifestSchema = z.strictObject({
  id: packageId,
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/),
  apiVersion: z.literal(1),
  description: z.string().max(1000).default(''),
  entry: entry.refine((v) => v.endsWith('.js'), '入口必须是预构建 .js'),
  permissions: z.array(pluginPermissionSchema).max(30),
  contributes: z.strictObject({
    commands: z
      .array(
        z.strictObject({
          id,
          title: z.string().min(1).max(80),
          description: z.string().max(1000),
          ai: z.boolean().optional(),
          inputSchema: schema,
          outputSchema: schema,
        }),
      )
      .min(1)
      .max(20),
    pages: z
      .array(
        z.strictObject({
          id,
          title: z.string().min(1).max(80),
          category: z.enum(['file', 'dev', 'image', 'font', 'media', 'network', 'more']),
          command: id.optional(),
          entry: entry.refine((v) => v.endsWith('.html')).optional(),
        }),
      )
      .max(10),
  }),
});

/**
 * 将支持的 JSON Schema 转成 Zod；UI、执行与 AI 使用相同验证。
 * @param spec 已验证的 Schema。
 * @returns Zod 校验器。
 */
export function pluginZod(spec: PluginSchema): z.ZodType {
  let result: z.ZodType;
  switch (spec.type) {
    case 'object':
      result = z.strictObject(
        Object.fromEntries(
          Object.entries(spec.properties ?? {}).map(([key, child]) => [
            key,
            spec.required?.includes(key) ? pluginZod(child) : pluginZod(child).optional(),
          ]),
        ),
      );
      break;
    case 'array':
      result = z.array(pluginZod(spec.items!)).max(10000);
      break;
    case 'string':
      result = z.string().max(PLUGIN_JSON_LIMIT);
      break;
    case 'number':
      result = z.number();
      break;
    case 'integer':
      result = z.number().int();
      break;
    case 'boolean':
      result = z.boolean();
      break;
    case 'null':
      result = z.null();
      break;
  }
  if (spec.enum)
    result = result.refine(
      (value) => spec.enum!.some((item) => JSON.stringify(item) === JSON.stringify(value)),
      '值不在 enum 中',
    );
  if (spec.description) result = result.describe(spec.description);
  return result;
}

/**
 * 验证 Manifest 与引用关系，错误中保留字段位置。
 * @param input 不可信 manifest.json。
 * @returns 验证后的 v1 声明。
 */
export function parseManifest(input: unknown): PluginManifest {
  assertJson(input);
  const manifest = manifestSchema.parse(input);
  const checkSchema = (spec: PluginSchema, depth = 0): void => {
    if (depth > 8) throw new Error('Schema 最多嵌套 8 层');
    if (
      spec.type !== 'object' &&
      (spec.properties || spec.required || spec.additionalProperties !== undefined)
    )
      throw new Error('对象关键词只能用于 object');
    if (spec.type === 'array' ? !spec.items : Boolean(spec.items))
      throw new Error('array 必须声明 items，其他类型不可声明');
    if (spec.type === 'object' && (!spec.properties || spec.additionalProperties !== false))
      throw new Error('object 必须声明 properties 和 additionalProperties:false');
    if (spec.required?.some((key) => !Object.hasOwn(spec.properties ?? {}, key)))
      throw new Error('required 引用了不存在的字段');
    Object.values(spec.properties ?? {}).forEach((child) => checkSchema(child, depth + 1));
    if (spec.items) checkSchema(spec.items, depth + 1);
    if (spec.default !== undefined) pluginZod(spec).parse(spec.default);
  };
  for (const command of manifest.contributes.commands) {
    if (command.inputSchema.type !== 'object') throw new Error('命令输入必须是 object');
    checkSchema(command.inputSchema);
    checkSchema(command.outputSchema);
  }
  for (const list of [manifest.contributes.commands, manifest.contributes.pages]) {
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new Error('重复的贡献 ID');
  }
  if (new Set(manifest.permissions).size !== manifest.permissions.length)
    throw new Error('重复的权限');
  for (const page of manifest.contributes.pages) {
    if (Boolean(page.entry) === Boolean(page.command))
      throw new Error('页面必须选择 command 或 entry 之一');
    if (page.command && !manifest.contributes.commands.some((c) => c.id === page.command))
      throw new Error('页面引用了不存在的命令');
  }
  return manifest;
}
