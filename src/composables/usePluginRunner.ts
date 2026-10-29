import { onBeforeUnmount, ref } from 'vue';
import type { JsonValue } from '@shared/plugins/types';
import { cancelPluginApi, previewPluginApi, runPluginApi } from '@/services/plugins';

/** 命令执行状态独立于表单，离开页面取消本页面任务。 */
export function usePluginRunner() {
  const running = ref(false);
  const result = ref('');
  const error = ref('');
  const elapsed = ref(0);
  let requestId = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  /** @param pluginId 插件。 @param command 命令。 @param input 参数。 @param candidate 可选预览候选。 */
  async function run(
    pluginId: string,
    command: string,
    input: JsonValue,
    candidate?: string,
  ): Promise<void> {
    if (running.value) return;
    running.value = true;
    result.value = '';
    error.value = '';
    elapsed.value = 0;
    requestId = crypto.randomUUID();
    const started = Date.now();
    timer = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - started) / 1000);
    }, 250);
    try {
      const plain = JSON.parse(JSON.stringify(input)) as JsonValue;
      const value = candidate
        ? await previewPluginApi(candidate, command, plain, requestId)
        : await runPluginApi({ pluginId, command, input: plain, requestId });
      result.value = JSON.stringify(value, null, 2);
    } catch (cause) {
      error.value = String(cause);
    } finally {
      running.value = false;
      clearInterval(timer);
      requestId = '';
    }
  }
  /** 只取消本组件拥有的任务。 */
  async function cancel(): Promise<void> {
    if (requestId)
      await cancelPluginApi(requestId).catch((cause) => {
        error.value = String(cause);
      });
  }
  onBeforeUnmount(() => {
    clearInterval(timer);
    void cancel();
  });
  return { running, result, error, elapsed, run, cancel };
}
