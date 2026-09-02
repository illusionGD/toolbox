import { reactive, watch } from 'vue';
import { readState, writeState } from '@/services/appState';

/** 各工具配置在应用状态里的命名空间前缀。 */
const CONFIG_NS_PREFIX = 'tools.';

/**
 * 读取已存配置并与默认值合并。
 * 以默认值为基准做浅合并，保证后续新增字段也能拿到默认，且忽略已废弃字段。
 * @param ns 命名空间。
 * @param defaults 默认配置。
 * @returns 合并后的配置。
 */
function loadConfig<T extends object>(ns: string, defaults: T): T {
  const stored = readState<Partial<T>>(ns);
  if (typeof stored !== 'object' || stored === null) return { ...defaults };
  return { ...defaults, ...stored };
}

/**
 * 工具配置持久化 hook：记住某工具页上次使用的配置。
 * 各工具页只需传入唯一 key 与默认配置，返回的响应式对象改动即自动写入数据保存目录
 * 下的 app-state.json（经 [appState]{@link ../services/appState} 防抖）。
 * @param toolKey 工具唯一标识（如 image-compress），作为存储命名空间。
 * @param defaults 默认配置对象。
 * @returns 响应式配置对象与 reset 方法。
 */
export function useToolConfig<T extends object>(
  toolKey: string,
  defaults: T,
): { config: T; reset: () => void } {
  const ns = `${CONFIG_NS_PREFIX}${toolKey}`;
  const config = reactive(loadConfig(ns, defaults)) as T;

  watch(
    () => config,
    (value) => {
      writeState(ns, value);
    },
    { deep: true, flush: 'post' },
  );

  /** 恢复默认配置（同时写回存储）。 */
  function reset(): void {
    Object.assign(config, defaults);
  }

  return { config, reset };
}
