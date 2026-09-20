import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  WebTestBrowser,
  WebTestFlow,
  WebTestFormat,
  WebTestSnapshot,
  WebTestStep,
  WebTestVideoFormat,
} from '@shared/webtest';
import { WEBTEST_DEFAULT_VIEWPORT, WEBTEST_VIEWPORT_LIMITS } from '@shared/webtest';
import {
  exportWebTestApi,
  getWebTestSnapshotApi,
  importWebTestApi,
  onWebTestChangedApi,
  recordWebTestApi,
  replayWebTestApi,
  stopWebTestApi,
  updateWebTestApi,
} from '@/services/webtest';
import { useToolConfig } from './useToolConfig';

/**
 * 网页测试页面状态和 IPC 编排；实际任务保留在主进程，离开页面不丢录制。
 * @returns 配置、会话及用户操作方法。
 */
export function useWebTest() {
  const { config } = useToolConfig('dev-webtest', {
    name: '网页回归测试',
    startUrl: '',
    recordBaseUrl: '',
    replayBaseUrl: '',
    browser: 'msedge' as WebTestBrowser,
    recordVideo: false,
    videoFormat: 'webm' as WebTestVideoFormat,
    viewportWidth: WEBTEST_DEFAULT_VIEWPORT.width,
    viewportHeight: WEBTEST_DEFAULT_VIEWPORT.height,
    useRecordedViewport: true,
    replayWidth: WEBTEST_DEFAULT_VIEWPORT.width,
    replayHeight: WEBTEST_DEFAULT_VIEWPORT.height,
    timeout: 10000,
  });
  const snapshot = ref<WebTestSnapshot>({
    revision: -1,
    mode: 'idle',
    outcome: 'none',
    flow: null,
    results: [],
    activeStepId: null,
    error: '',
    artifacts: [],
  });
  const loading = ref(true);
  const busy = computed(() => loading.value || snapshot.value.mode !== 'idle');
  const validSize = (width: number, height: number): boolean =>
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= WEBTEST_VIEWPORT_LIMITS.width.min &&
    width <= WEBTEST_VIEWPORT_LIMITS.width.max &&
    height >= WEBTEST_VIEWPORT_LIMITS.height.min &&
    height <= WEBTEST_VIEWPORT_LIMITS.height.max;
  const validRecordSize = computed(() => validSize(config.viewportWidth, config.viewportHeight));
  const validReplaySize = computed(
    () => config.useRecordedViewport || validSize(config.replayWidth, config.replayHeight),
  );
  const passed = computed(
    () => snapshot.value.results.filter((result) => result.status === 'passed').length,
  );
  let unsubscribe: (() => void) | null = null;

  const apply = (value: WebTestSnapshot): void => {
    if (value.revision >= snapshot.value.revision) snapshot.value = value;
  };
  const perform = async (task: () => Promise<void>): Promise<void> => {
    if (loading.value) return;
    loading.value = true;
    try {
      await task();
    } catch {
      /* 错误由 service 的 unwrap 统一提示。 */
    } finally {
      loading.value = false;
    }
  };
  const plainFlow = (): WebTestFlow =>
    JSON.parse(JSON.stringify(snapshot.value.flow)) as WebTestFlow;

  onMounted(async () => {
    unsubscribe = onWebTestChangedApi(apply);
    try {
      apply(await getWebTestSnapshotApi());
    } catch {
      /* 统一反馈已显示。 */
    } finally {
      loading.value = false;
    }
  });
  onUnmounted(() => unsubscribe?.());

  /** @param url 录制入口；根地址为空时按 origin 提供默认值。 */
  const setStartUrl = (url: string): void => {
    config.startUrl = url;
    if (!config.recordBaseUrl) {
      try {
        config.recordBaseUrl = `${new URL(url).origin}/`;
      } catch {
        /* 输入未完成。 */
      }
    }
  };
  /** 开始一次新录制，替换当前用例。 */
  const record = (): Promise<void> =>
    perform(async () => {
      apply(
        await recordWebTestApi({
          name: config.name.trim(),
          startUrl: config.startUrl.trim(),
          baseUrl: config.recordBaseUrl.trim(),
          browser: config.browser,
          recordVideo: config.recordVideo,
          videoFormat: config.videoFormat,
          viewport: { width: config.viewportWidth, height: config.viewportHeight },
        }),
      );
      if (!config.replayBaseUrl) config.replayBaseUrl = config.recordBaseUrl;
    });
  /** 回放当前用例，默认沿用录制尺寸，也可仅覆盖本次回放尺寸。 */
  const replay = (): Promise<void> =>
    perform(async () => {
      apply(
        await replayWebTestApi({
          flow: plainFlow(),
          baseUrl: config.replayBaseUrl.trim(),
          browser: config.browser,
          timeout: config.timeout,
          ...(!config.useRecordedViewport
            ? { viewport: { width: config.replayWidth, height: config.replayHeight } }
            : {}),
        }),
      );
    });
  /** 停止录制或取消回放。 */
  const stop = (): Promise<void> =>
    perform(async () => {
      apply(await stopWebTestApi());
    });
  /** 打开系统对话框并导入数据。 */
  const importFile = (): Promise<void> =>
    perform(async () => {
      const value = await importWebTestApi();
      if (value) apply(value);
    });
  /** @param format 导出格式。 */
  const exportFile = (format: WebTestFormat): Promise<void> =>
    perform(async () => {
      await exportWebTestApi(plainFlow(), format);
    });
  /** @param step 编辑后步骤。 @param afterId 新增时的插入位置；undefined 表示替换或末尾追加。 @returns 是否保存成功。 */
  const saveStep = async (step: WebTestStep, afterId?: string): Promise<boolean> => {
    let saved = false;
    await perform(async () => {
      const flow = plainFlow();
      const existing = flow.steps.findIndex((item) => item.id === step.id);
      const data = JSON.parse(JSON.stringify(step)) as WebTestStep;
      if (existing >= 0) flow.steps.splice(existing, 1, data);
      else {
        const after = afterId
          ? flow.steps.findIndex((item) => item.id === afterId)
          : flow.steps.length - 1;
        flow.steps.splice(after + 1, 0, data);
      }
      apply(await updateWebTestApi(flow));
      saved = true;
    });
    return saved;
  };
  /** @param id 要删除的步骤 ID。 */
  const removeStep = (id: string): Promise<void> =>
    perform(async () => {
      const flow = plainFlow();
      flow.steps = flow.steps.filter((step) => step.id !== id);
      apply(await updateWebTestApi(flow));
    });
  /** 清空当前用例的操作及执行结果，保留用例信息与环境配置。 */
  const clearSteps = (): Promise<void> =>
    perform(async () => {
      const flow = plainFlow();
      flow.steps = [];
      apply(await updateWebTestApi(flow));
    });
  return {
    config,
    snapshot,
    loading,
    busy,
    validRecordSize,
    validReplaySize,
    passed,
    setStartUrl,
    record,
    replay,
    stop,
    importFile,
    exportFile,
    saveStep,
    removeStep,
    clearSteps,
  };
}
