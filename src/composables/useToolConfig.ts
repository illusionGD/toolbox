import { reactive, watch } from 'vue';

/** 配置持久化的命名空间前缀。 */
const CONFIG_PREFIX = 'toolbox.config.';

/**
 * 从 localStorage 读取并与默认值合并。
 * 以默认值为基准做浅合并，保证后续新增字段也能拿到默认，且忽略已废弃字段。
 * @param key 完整存储键。
 * @param defaults 默认配置。
 * @returns 合并后的配置。
 */
function loadConfig<T extends object>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw) as Partial<T>;
    if (typeof parsed !== 'object' || parsed === null) return { ...defaults };
    return { ...defaults, ...parsed };
  } catch {
    return { ...defaults };
  }
}

/**
 * 工具配置持久化 hook：记住某工具页上次使用的配置。
 * 各工具页只需传入唯一 key 与默认配置，返回的响应式对象改动即自动写入 localStorage。
 * @param toolKey 工具唯一标识（如 image-compress），作为存储命名空间。
 * @param defaults 默认配置对象。
 * @returns 响应式配置对象与 reset 方法。
 */
export function useToolConfig<T extends object>(
  toolKey: string,
  defaults: T,
): { config: T; reset: () => void } {
  const storageKey = `${CONFIG_PREFIX}${toolKey}`;
  const config = reactive(loadConfig(storageKey, defaults)) as T;

  watch(
    () => config,
    (value) => {
      localStorage.setItem(storageKey, JSON.stringify(value));
    },
    { deep: true, flush: 'post' },
  );

  /** 恢复默认配置（同时写回存储）。 */
  function reset(): void {
    Object.assign(config, defaults);
  }

  return { config, reset };
}
