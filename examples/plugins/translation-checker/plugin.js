/// <reference path="../../../packages/plugin-sdk/index.d.ts" />

/** 返回叶子键；路径段保留为数组，避免带点号的键混淆。 */
function keys(value, prefix = [], depth = 0) {
  if (depth > 20) throw new Error('语言 JSON 嵌套超过 20 层');
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, [...prefix, key], depth + 1));
}

window.toolbox.definePlugin({
  check({ source, target }) {
    const base = JSON.parse(source);
    const translated = JSON.parse(target);
    if (
      !base ||
      typeof base !== 'object' ||
      Array.isArray(base) ||
      !translated ||
      typeof translated !== 'object' ||
      Array.isArray(translated)
    )
      throw new Error('两份语言内容都必须是 JSON 对象');
    const available = new Set(keys(translated).map((path) => JSON.stringify(path)));
    const missing = keys(base)
      .filter((path) => !available.has(JSON.stringify(path)))
      .map((path) => path.join('.'));
    return { missing, count: missing.length };
  },
});
