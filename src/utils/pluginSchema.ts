import type { JsonValue, PluginSchema } from '@shared/plugins/types';

/** @param schema 字段结构。 @returns 新字段的独立默认值。 */
export function pluginFieldDefault(schema: PluginSchema): JsonValue {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum) return structuredClone(schema.enum[0]);
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .filter(([key, child]) => schema.required?.includes(key) || child.default !== undefined)
          .map(([key, child]) => [key, pluginFieldDefault(child)]),
      );
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return 0;
    case 'null':
      return null;
    default:
      return '';
  }
}
