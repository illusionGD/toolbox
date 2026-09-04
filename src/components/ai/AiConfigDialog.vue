<template>
  <n-modal
    :show="show"
    preset="card"
    class="ai-config-dialog"
    size="small"
    :title="title"
    :mask-closable="false"
    :bordered="false"
    @update:show="(v: boolean) => !v && emit('cancel')"
  >
    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>名称</span>
        <span class="ai-config-dialog__hint">自己认得出就行，对话面板里按它选</span>
      </div>
      <div class="ai-config-dialog__control">
        <n-input v-model:value="draft.name" size="small" placeholder="如：日常问答" />
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>厂商与模型</span>
        <span class="ai-config-dialog__hint">
          模型清单是写死的；换厂商会自动切到该厂商的第一个模型与默认地址
        </span>
      </div>
      <div class="ai-config-dialog__control ai-config-dialog__control--inline">
        <n-select
          class="ai-config-dialog__select"
          size="small"
          :value="draft.provider"
          :options="providerOptions"
          @update:value="changeProvider"
        />
        <n-select
          v-model:value="draft.model"
          class="ai-config-dialog__select"
          size="small"
          :options="modelOptions"
        />
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>接口地址</span>
        <span class="ai-config-dialog__hint">
          内置的只是默认值、不是实测结论，可改成任意兼容端点。末尾的版本段（/v1、/v1beta、
          /v4）必须带上，缺了就是 404
        </span>
      </div>
      <div class="ai-config-dialog__control">
        <n-input
          v-model:value="draft.baseUrl"
          size="small"
          :placeholder="
            findProvider(draft.provider)?.defaultBaseUrl || '必填：该厂商没有内置默认地址'
          "
        />
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>API Key</span>
        <span class="ai-config-dialog__hint">
          {{ findProvider(draft.provider)?.keyHint }}。加密存放在用户数据目录，
          <strong>不会</strong>
          随数据目录一起搬走，也不进 app-state.json
        </span>
      </div>
      <div class="ai-config-dialog__control">
        <n-input
          v-model:value="keyDraft"
          size="small"
          type="password"
          show-password-on="click"
          :placeholder="keyPlaceholder"
        />
        <n-button
          v-if="mode === 'edit' && hasKey"
          size="tiny"
          quaternary
          class="ai-config-dialog__key-remove"
          @click="removeKey"
        >
          删除已保存的 Key
        </n-button>
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>系统提示词</span>
        <span class="ai-config-dialog__hint"> 留空则不下发（有些兼容端点对空 system 报 400） </span>
      </div>
      <div class="ai-config-dialog__control">
        <n-input
          v-model:value="draft.systemPrompt"
          size="small"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 6 }"
          placeholder="如：你是一个简洁的中文助手"
        />
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>采样温度</span>
        <span class="ai-config-dialog__hint">
          实测部分推理模型会把这个值整条丢掉并回一条告警，属正常
        </span>
      </div>
      <div class="ai-config-dialog__control ai-config-dialog__control--inline">
        <n-input-number
          class="ai-config-dialog__number"
          size="small"
          :value="draft.temperature"
          :min="0"
          :max="2"
          :step="0.1"
          @update:value="(v: number | null) => (draft.temperature = v ?? DEFAULT_TEMPERATURE)"
        />
      </div>
    </div>

    <div class="ai-config-dialog__row">
      <div class="ai-config-dialog__label">
        <span>单次回复上限</span>
        <span class="ai-config-dialog__hint">
          必须有个明确值：不下发时 Anthropic 协议会由 SDK 按模型 id 猜（能猜到 128000），
          超过模型真实上限会直接 400
        </span>
      </div>
      <div class="ai-config-dialog__control ai-config-dialog__control--inline">
        <n-input-number
          class="ai-config-dialog__number"
          size="small"
          :value="draft.maxOutputTokens"
          :min="256"
          :max="200000"
          :step="256"
          @update:value="
            (v: number | null) => (draft.maxOutputTokens = v ?? DEFAULT_MAX_OUTPUT_TOKENS)
          "
        />
      </div>
    </div>

    <n-alert
      v-if="testResult"
      :type="testResult.ok ? 'success' : 'error'"
      :bordered="false"
      class="ai-config-dialog__alert"
    >
      {{ testResult.message }}（{{ testResult.latencyMs }}ms）
    </n-alert>

    <template #footer>
      <div class="ai-config-dialog__footer">
        <n-button size="small" :loading="testing" :disabled="!canTest" @click="test">
          测试连接
        </n-button>
        <n-space size="small">
          <n-button size="small" quaternary @click="emit('cancel')">取消</n-button>
          <n-button size="small" type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  useMessage,
} from 'naive-ui';
import { AI_PROVIDERS, findProvider, modelsForProvider } from '@shared/ai';
import type { AiTestResult } from '@shared/types';
import { useAiConfigStore, type AiConfigDraft } from '@/stores/aiConfig';

/** 温度默认值（与 store 一致，清空输入框时回落到它）。 */
const DEFAULT_TEMPERATURE = 0.7;
/** 回复上限默认值。 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

/** 弹窗模式。 */
export type AiConfigDialogMode = 'add' | 'edit' | 'duplicate';

const props = defineProps<{
  /** 是否显示。 */
  show: boolean;
  /** 模式：新增 / 编辑 / 复制。 */
  mode: AiConfigDialogMode;
  /** 编辑与复制时的源配置 id；新增时为空串。 */
  sourceId: string;
}>();

const emit = defineEmits<{
  /** 取消（什么都不落）。 */
  cancel: [];
  /** 已保存。 */
  saved: [id: string];
}>();

// #region setup
const configStore = useAiConfigStore();
const message = useMessage();

/**
 * 草稿——**改在副本上，取消就什么都不落**。
 *
 * 上一版是 `n-collapse` 里边改边写盘，用户点开只想看看也会留下改动、更没有取消的余地。
 */
const draft = reactive<AiConfigDraft>(configStore.draftDefaults());
/** key 输入草稿。**不回填已存的 key**（明文根本拿不到），留空表示不改动。 */
const keyDraft = ref('');
/** 最近一次测试结果。 */
const testResult = ref<AiTestResult | null>(null);
/** 是否正在测试。 */
const testing = ref(false);
/** 是否正在保存。 */
const saving = ref(false);

/** 弹窗标题。 */
const title = computed(
  () => ({ add: '添加配置', edit: '编辑配置', duplicate: '复制配置' })[props.mode] ?? '配置',
);

/** 源配置是否已存 key。 */
const hasKey = computed(() =>
  Boolean(props.sourceId && configStore.keyStatus[props.sourceId]?.hasKey),
);

/** key 输入框的占位文字。 */
const keyPlaceholder = computed(() => {
  if (props.mode === 'duplicate') {
    return hasKey.value ? '留空则沿用源配置的 Key' : '粘贴 API Key';
  }
  if (hasKey.value) {
    return `已保存（${configStore.keyStatus[props.sourceId]?.hint}），留空则不改动`;
  }
  return '粘贴 API Key';
});

/** 厂商下拉项。 */
const providerOptions = AI_PROVIDERS.map((p) => ({ label: p.label, value: p.id }));

/** 当前厂商的模型下拉项。 */
const modelOptions = computed(() =>
  modelsForProvider(draft.provider).map((m) => ({
    label: m.vision ? `${m.label}（支持图片）` : m.label,
    value: m.id,
  })),
);

/** 能否测试：新增/复制时必须先填 key（还没有已存的可用）。 */
const canTest = computed(() => Boolean(keyDraft.value.trim() || hasKey.value));

// 每次打开都按模式重置草稿：不重置的话上次改到一半的内容会串到下一次
watch(
  () => [props.show, props.mode, props.sourceId] as const,
  ([show, mode, sourceId]) => {
    if (!show) return;
    keyDraft.value = '';
    testResult.value = null;
    const source = configStore.configs.find((c) => c.id === sourceId);
    if (source && (mode === 'edit' || mode === 'duplicate')) {
      Object.assign(draft, {
        name: source.name,
        provider: source.provider,
        model: source.model,
        baseUrl: source.baseUrl,
        systemPrompt: source.systemPrompt,
        temperature: source.temperature,
        maxOutputTokens: source.maxOutputTokens,
      });
      if (mode === 'duplicate') draft.name = `${source.name} 副本`;
    } else {
      Object.assign(draft, configStore.draftDefaults());
    }
  },
  { immediate: true },
);
// #endregion

/**
 * 换厂商：模型与地址跟着切到新厂商的默认值。
 *
 * 不跟着切就会拿着别家的 model id 去请求，直接 404 / 400。
 * @param providerId 新厂商 id。
 */
function changeProvider(providerId: string): void {
  draft.provider = providerId;
  draft.model = modelsForProvider(providerId)[0]?.id ?? '';
  draft.baseUrl = findProvider(providerId)?.defaultBaseUrl ?? '';
}

/** 删除源配置已存的 key（只在编辑模式下出现）。 */
async function removeKey(): Promise<void> {
  await configStore.removeKey(props.sourceId).catch(() => undefined);
  message.success('已删除 Key');
}

/** 测试连接：真发一次最小请求，这是判断地址与 key 对不对唯一靠得住的办法。 */
async function test(): Promise<void> {
  testing.value = true;
  try {
    // 复制模式下 sourceId 指的是源配置，key 留空时主进程正好回落到源的 key
    testResult.value = await configStore.testDraft(
      { ...draft },
      props.sourceId,
      keyDraft.value.trim(),
    );
  } finally {
    testing.value = false;
  }
}

/** 保存：按模式落到 store，再处理 key。 */
async function save(): Promise<void> {
  if (!draft.name.trim()) {
    message.error('请填写名称');
    return;
  }
  saving.value = true;
  try {
    const payload: AiConfigDraft = { ...draft, name: draft.name.trim() };
    let id = props.sourceId;
    if (props.mode === 'edit') {
      configStore.saveConfig(id, payload);
    } else if (props.mode === 'duplicate') {
      // 复制走 store 的 duplicateConfig，它会顺带把源的 key 复制过去（明文只在主进程流转）
      id = await configStore.duplicateConfig(props.sourceId, payload);
    } else {
      id = configStore.addConfig(payload);
    }
    const key = keyDraft.value.trim();
    if (key && id) await configStore.saveKey(id, key);
    await configStore.refreshKeyStatus();
    message.success('已保存');
    emit('saved', id);
  } catch {
    // unwrap 已经弹过错误提示
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped lang="scss">
.ai-config-dialog {
  width: 560px;
  max-width: 92vw;

  // 每行只有 __label / __control 两个直接子元素（见 common-capabilities 的规矩）
  &__row {
    display: grid;
    gap: var(--tb-space-2);

    & + & {
      margin-top: var(--tb-space-4);
    }
  }

  &__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--tb-text-primary);
  }

  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  &__control {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-2);
    align-items: stretch;

    &--inline {
      flex-direction: row;
      align-items: center;
    }
  }

  &__select {
    flex: 1;
    min-width: 0;
  }

  &__number {
    width: 160px;
  }

  &__key-remove {
    align-self: flex-start;
  }

  &__alert {
    width: 100%;
    margin-top: var(--tb-space-4);
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
