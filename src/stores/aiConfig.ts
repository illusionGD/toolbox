import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { AI_PROVIDERS, findProvider, modelsForProvider } from '@shared/ai';
import type { AiConfig, AiConfigState, AiKeyStatus, AiToolMode } from '@shared/types';
import { readState, writeState } from '@/services/appState';
import {
  copyAiKeyApi,
  deleteAiKeyApi,
  listAiKeyStatusApi,
  setAiKeyApi,
  testAiConnectionApi,
} from '@/services/ai';

/** AI 配置在应用状态里的命名空间。 */
const AI_NS = 'ai';

/**
 * 默认单次回复上限。
 *
 * **选定值不是实测值**。必须有个显式值：实测不传时 anthropic 协议会由 SDK 按 model id
 * 猜 `max_tokens`（`claude-opus-5` 之类猜到 128000），真实上限低于它就直接 400。
 * 4096 是各家都能接受的保守值，用户可在配置里调。
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
/** 默认温度。 */
const DEFAULT_TEMPERATURE = 0.7;

/** 新增 / 编辑配置时的草稿（不含 id 与创建时间，这两项由 store 管）。 */
export type AiConfigDraft = Omit<AiConfig, 'id' | 'createdAt'>;

/** 合法的工具审批策略，用于校验磁盘上读回来的值。 */
const TOOL_MODES: AiToolMode[] = ['off', 'ask', 'auto'];

/**
 * 校验磁盘上的审批策略。
 * @param value 读回来的值。
 * @returns 三态之一；认不出回落 `'ask'`（最保守的那个：写盘要问）。
 */
function parseToolMode(value: unknown): AiToolMode {
  return TOOL_MODES.includes(value as AiToolMode) ? (value as AiToolMode) : 'ask';
}

/**
 * 读取持久化的配置集合。
 * @returns 配置、选中项与工具审批策略；缺失或格式不对走默认值。
 */
function loadState(): AiConfigState {
  const parsed = readState<unknown>(AI_NS) as Partial<AiConfigState> | undefined;
  const configs = Array.isArray(parsed?.configs)
    ? parsed.configs.filter(
        (c): c is AiConfig => typeof c === 'object' && c !== null && typeof c.id === 'string',
      )
    : [];
  return {
    configs,
    activeId: typeof parsed?.activeId === 'string' ? parsed.activeId : '',
    toolApproval: parseToolMode(parsed?.toolApproval),
  };
}

/**
 * AI 配置 store：多份「厂商 + 模型 + 自定义名称」配置，选其中一个使用。
 *
 * 配置本体存 `app-state.json`（跟着数据目录迁移）；**API Key 不在这里**——它在主进程的
 * `<userData>/ai-keys.json` 里加密存放，这边只持有 {@link AiKeyStatus}。
 */
export const useAiConfigStore = defineStore('aiConfig', () => {
  // #region state
  const initial = loadState();
  const configs = ref<AiConfig[]>(initial.configs);
  const activeId = ref<string>(initial.activeId);
  /**
   * 工具调用的审批策略（全局一份）：`off` 压根不下发工具 / `ask` 写盘前逐次确认 /
   * `auto` 直接跑。**跟着每次请求下发给主进程**，主进程不读这个文件。
   */
  const toolApproval = ref<AiToolMode>(initial.toolApproval ?? 'ask');
  /** 各配置的 key 状态，按配置 id 索引。 */
  const keyStatus = ref<Record<string, AiKeyStatus>>({});
  // #endregion

  // #region getters
  /** 当前选中的配置；选中项失效时回落到第一条。 */
  const activeConfig = computed<AiConfig | undefined>(
    () => configs.value.find((c) => c.id === activeId.value) ?? configs.value[0],
  );

  /** 当前配置是否已经能用（存在 + 填了 key）。 */
  const activeReady = computed(() => {
    const config = activeConfig.value;
    return Boolean(config && keyStatus.value[config.id]?.hasKey);
  });

  /** 是否存在「降级明文存储」的 key，设置页据此显著提示。 */
  const hasPlaintextKey = computed(() =>
    Object.values(keyStatus.value).some((s) => s.hasKey && !s.encrypted),
  );
  // #endregion

  // #region actions
  /** 持久化到数据保存目录（防抖写盘）。 */
  function persist(): void {
    writeState(AI_NS, {
      configs: configs.value,
      activeId: activeId.value,
      toolApproval: toolApproval.value,
    });
  }

  /**
   * 按磁盘上的最新状态重新灌一遍。
   *
   * **多窗口才需要**：AI 对话是独立窗口，用户在主窗口设置页改完配置后，这边的 store 还
   * 停在打开时读到的那份。配合 `refreshAppState()` 使用（先刷内存快照，再 hydrate）。
   */
  function hydrate(): void {
    const next = loadState();
    configs.value = next.configs;
    activeId.value = next.activeId;
    toolApproval.value = next.toolApproval ?? 'ask';
  }

  /**
   * 一份新配置的默认字段。
   * @param providerId 厂商 id，默认第一个厂商。
   * @returns 草稿。
   */
  function draftDefaults(providerId = AI_PROVIDERS[0].id): AiConfigDraft {
    const provider = findProvider(providerId) ?? AI_PROVIDERS[0];
    return {
      name: `${provider.label} 配置`,
      provider: provider.id,
      model: modelsForProvider(provider.id)[0]?.id ?? '',
      baseUrl: provider.defaultBaseUrl,
      systemPrompt: '',
      temperature: DEFAULT_TEMPERATURE,
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    };
  }

  /**
   * 按草稿新增一份配置。
   * @param draft 草稿；不传则用默认值。
   * @returns 新配置的 id。
   */
  function addConfig(draft?: Partial<AiConfigDraft>): string {
    const config: AiConfig = {
      id: crypto.randomUUID(),
      ...draftDefaults(draft?.provider),
      ...draft,
      createdAt: Date.now(),
    };
    configs.value.push(config);
    if (!activeId.value) activeId.value = config.id;
    persist();
    return config.id;
  }

  /**
   * 按草稿整体覆盖一份配置（弹窗点「保存」时调）。
   *
   * 与 {@link updateConfig} 的区别：这里是**草稿式**，用户在弹窗里改了什么一次落，取消
   * 则什么都不落；`updateConfig` 是即时改单个字段，留给 radio 与 store 内部用。
   * @param id 配置 id。
   * @param draft 完整草稿。
   */
  function saveConfig(id: string, draft: AiConfigDraft): void {
    const config = configs.value.find((c) => c.id === id);
    if (!config) return;
    Object.assign(config, draft);
    persist();
  }

  /**
   * 复制一份配置，**连 API Key 一起**。
   *
   * key 的复制只能在主进程做（明文拿不到渲染进程），见 `copyAiKeyApi`。不连 key 的话
   * 「同一个 key 换个模型」这个复制的主要用途每次都得重新粘一遍。
   * @param id 源配置 id。
   * @param draft 已经改过的草稿（弹窗里可能改了名字/模型）。
   * @returns 新配置 id；源不存在返回空串。
   */
  async function duplicateConfig(id: string, draft: AiConfigDraft): Promise<string> {
    if (!configs.value.some((c) => c.id === id)) return '';
    const newId = addConfig(draft);
    keyStatus.value[newId] = await copyAiKeyApi(id, newId).catch(() => ({
      configId: newId,
      hasKey: false,
      hint: '',
      encrypted: false,
    }));
    return newId;
  }

  /**
   * 新建一份配置。
   * @param providerId 厂商 id，默认第一个厂商。
   * @returns 新配置的 id。
   */
  function createConfig(providerId = AI_PROVIDERS[0].id): string {
    return addConfig(draftDefaults(providerId));
  }

  /**
   * 改一份配置。
   * @param id 配置 id。
   * @param patch 要合并的字段。
   */
  function updateConfig(id: string, patch: Partial<Omit<AiConfig, 'id' | 'createdAt'>>): void {
    const config = configs.value.find((c) => c.id === id);
    if (!config) return;
    Object.assign(config, patch);
    // 换厂商时原模型多半不属于新厂商，跟着切到新厂商的第一个，否则会拿着别家的 id 去请求
    if (patch.provider && !modelsForProvider(patch.provider).some((m) => m.id === config.model)) {
      config.model = modelsForProvider(patch.provider)[0]?.id ?? '';
      config.baseUrl = findProvider(patch.provider)?.defaultBaseUrl ?? '';
    }
    persist();
  }

  /**
   * 删一份配置，**连它的 key 一起删**（不然密钥库里会留下永远访问不到的孤儿凭据）。
   * @param id 配置 id。
   */
  async function removeConfig(id: string): Promise<void> {
    configs.value = configs.value.filter((c) => c.id !== id);
    if (activeId.value === id) activeId.value = configs.value[0]?.id ?? '';
    persist();
    delete keyStatus.value[id];
    await deleteAiKeyApi(id).catch(() => {
      // key 删不掉不影响配置已经删掉这件事，下次同 id 不会再出现
    });
  }

  /**
   * 切换当前配置。
   * @param id 配置 id。
   */
  function setActive(id: string): void {
    activeId.value = id;
    persist();
  }

  /**
   * 设置工具审批策略（全局一份，跟着下一次请求下发）。
   * @param value `'off'` 不下发工具 / `'ask'` 写盘前逐次确认 / `'auto'` 直接跑（覆盖
   * 原文件仍然会问，那条在主进程里强制，不受这里影响）。
   */
  function setToolApproval(value: AiToolMode): void {
    toolApproval.value = value;
    persist();
  }

  /** 刷新全部配置的 key 状态。 */
  async function refreshKeyStatus(): Promise<void> {
    const ids = configs.value.map((c) => c.id);
    if (ids.length === 0) {
      keyStatus.value = {};
      return;
    }
    const list = await listAiKeyStatusApi(ids).catch(() => []);
    const next: Record<string, AiKeyStatus> = {};
    for (const status of list) next[status.configId] = status;
    keyStatus.value = next;
  }

  /**
   * 保存某份配置的 key。
   * @param id 配置 id。
   * @param key 明文 key；空串等同于删除。
   */
  async function saveKey(id: string, key: string): Promise<void> {
    keyStatus.value[id] = await setAiKeyApi(id, key);
  }

  /**
   * 删除某份配置的 key（配置留着）。
   * @param id 配置 id。
   */
  async function removeKey(id: string): Promise<void> {
    keyStatus.value[id] = await deleteAiKeyApi(id);
  }

  /**
   * 测试某份配置。
   * @param id 配置 id。
   * @param tempKey 还没保存的 key（可选）。
   * @returns 测试结果；配置不存在时返回失败。
   */
  async function testConfig(
    id: string,
    tempKey?: string,
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const config = configs.value.find((c) => c.id === id);
    if (!config) return { ok: false, message: '配置不存在', latencyMs: 0 };
    // **必须转成纯对象**：reactive 代理跨 IPC 会在运行期抛 "could not be cloned"，
    // typecheck 和 build 都拦不住（本仓库已踩过多次）
    return testAiConnectionApi({ ...config }, tempKey);
  }

  /**
   * 测试一份**还没保存**的草稿（配置弹窗里的「测试连接」）。
   *
   * 新增模式下配置还不存在，所以不能走 {@link testConfig}。`id` 传现有配置 id 时，主进程
   * 会在 `tempKey` 为空时回落到已存的 key——这正是「编辑时不改 key 也能测」的来路。
   * @param draft 草稿。
   * @param id 关联的配置 id；新增时传空串。
   * @param tempKey 弹窗里填的 key（可空）。
   * @returns 测试结果。
   */
  function testDraft(
    draft: AiConfigDraft,
    id: string,
    tempKey?: string,
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    // 同 testConfig：必须是纯对象，reactive 代理跨 IPC 会在运行期抛 could not be cloned
    return testAiConnectionApi({ ...draft, id, createdAt: 0 }, tempKey);
  }
  // #endregion

  return {
    configs,
    activeId,
    toolApproval,
    keyStatus,
    activeConfig,
    activeReady,
    hasPlaintextKey,
    draftDefaults,
    addConfig,
    saveConfig,
    duplicateConfig,
    createConfig,
    updateConfig,
    removeConfig,
    setActive,
    setToolApproval,
    hydrate,
    refreshKeyStatus,
    saveKey,
    removeKey,
    testConfig,
    testDraft,
  };
});
