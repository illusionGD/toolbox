import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { PluginCandidate, PluginRecord } from '@shared/plugins/types';
import { listPluginsApi, pluginCandidatesApi, onPluginsChangedApi } from '@/services/plugins';
import { updatePluginNavigation } from '@/utils/navigation';

/** 插件列表跨页面共享，主进程变更事件刷新导航与候选。 */
export const usePluginsStore = defineStore('plugins', () => {
  const records = shallowRef<PluginRecord[]>([]);
  const candidates = shallowRef<PluginCandidate[]>([]);
  const error = ref('');
  let subscribed = false;
  /** @returns 刷新结果，失败保留明确错误。 */
  async function refresh(): Promise<void> {
    try {
      const [installed, pending] = await Promise.all([listPluginsApi(), pluginCandidatesApi()]);
      records.value = installed;
      candidates.value = pending;
      error.value = '';
      updatePluginNavigation(installed);
    } catch (cause) {
      error.value = String(cause);
    }
  }
  /** 首次挂载侧栏时订阅一次，生命周期与主窗口相同。 */
  function init(): void {
    if (subscribed) return;
    subscribed = true;
    onPluginsChangedApi(() => {
      void refresh();
    });
    void refresh();
  }
  return { records, candidates, error, refresh, init };
});
