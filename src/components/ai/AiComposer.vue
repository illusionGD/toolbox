<template>
  <div
    class="ai-composer"
    :class="{ 'ai-composer--drag': isDragOver }"
    v-bind="handlers"
    @paste="handlePaste"
  >
    <div v-if="chat.draftImages.length" class="ai-composer__images">
      <div v-for="image in chat.draftImages" :key="image.id" class="ai-composer__image">
        <img :src="image.thumbnailDataUrl" :alt="`${image.width}×${image.height}`" />
        <button
          class="ai-composer__image-remove"
          title="移除"
          @click="chat.removeDraftImage(image.id)"
        >
          ×
        </button>
      </div>
    </div>

    <div class="ai-composer__selects">
      <n-select
        class="ai-composer__config"
        size="tiny"
        :consistent-menu-width="false"
        :value="configStore.activeConfig?.id ?? null"
        :options="configOptions"
        placeholder="没有可用配置"
        :disabled="configOptions.length === 0"
        @update:value="(id: string) => configStore.setActive(id)"
      />
      <n-select
        class="ai-composer__approval"
        size="tiny"
        :value="configStore.toolApproval"
        :options="APPROVAL_OPTIONS"
        @update:value="(v: AiToolMode) => configStore.setToolApproval(v)"
      />
    </div>

    <n-input
      v-model:value="draft"
      class="ai-composer__input"
      type="textarea"
      :placeholder="placeholder"
      :autosize="{ minRows: 2, maxRows: 8 }"
      :disabled="chat.activeBusy"
      @keydown="handleKeydown"
    />

    <div class="ai-composer__bar">
      <div class="ai-composer__left">
        <n-button
          size="small"
          quaternary
          :disabled="!visionOk || staging"
          :loading="staging"
          :title="visionOk ? '添加图片' : '当前模型不支持图片输入'"
          @click="pickImages"
        >
          <n-icon :size="17" :component="ImageOutline" />
        </n-button>
        <span class="ai-composer__hint">{{ hint }}</span>
      </div>

      <n-button
        v-if="chat.activeBusy"
        size="small"
        secondary
        type="warning"
        @click="chat.cancelActive()"
      >
        停止
      </n-button>
      <n-button v-else size="small" type="primary" :disabled="!canSend" @click="submit">
        发送
      </n-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NIcon, NInput, NSelect } from 'naive-ui';
import { ImageOutline } from '@vicons/ionicons5';
import { findModel, supportsVision } from '@shared/ai';
import type { AiToolMode } from '@shared/types';
import { useAiChatStore } from '@/stores/aiChat';
import { useAiConfigStore } from '@/stores/aiConfig';
import { pickFilesApi } from '@/services/fs';
import { stageAiImageApi } from '@/services/ai';
import { useFileDrop } from '@/composables/useFileDrop';
import { showError } from '@/utils/feedback';

/** 可接受的图片扩展名。 */
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'tiff'];

/**
 * 工具审批下拉项。
 *
 * 「关闭」是真的**不下发 `tools`**：省掉十几个工具声明的 token，也绕开部分兼容端点见到
 * `tools` 直接 400。三项标签故意一样长，下拉宽度就不用跟着选中项跳。
 */
const APPROVAL_OPTIONS: { label: string; value: AiToolMode }[] = [
  { label: '工具：询问', value: 'ask' },
  { label: '工具：自动', value: 'auto' },
  { label: '工具：关闭', value: 'off' },
];

// #region setup
const chat = useAiChatStore();
const configStore = useAiConfigStore();

/** 输入框内容。 */
const draft = ref('');
/** 是否正在暂存图片。 */
const staging = ref(false);

/** 当前模型是否支持图片输入。 */
const visionOk = computed(() => {
  const config = configStore.activeConfig;
  return Boolean(config && supportsVision(config.provider, config.model));
});

/** 配置下拉项（面板窄，标签是「名称 · 模型」）。 */
const configOptions = computed(() =>
  configStore.configs.map((config) => ({
    label: `${config.name} · ${findModel(config.provider, config.model)?.label ?? config.model}`,
    value: config.id,
  })),
);

/** 输入框占位文字。 */
const placeholder = computed(() =>
  configStore.activeConfig ? 'Enter 发送，Shift+Enter 换行' : '请先在设置页添加 AI 配置',
);

/** 底部提示：说明为什么不能传图。 */
const hint = computed(() => {
  if (!configStore.activeConfig) return '';
  return visionOk.value ? '' : '当前模型不支持图片';
});

/** 能否发送。 */
const canSend = computed(
  () =>
    Boolean(configStore.activeConfig) &&
    !chat.activeBusy &&
    (draft.value.trim().length > 0 || chat.draftImages.length > 0),
);

const { isDragOver, handlers } = useFileDrop({
  accept: IMAGE_EXTS,
  onDrop: (files) => void stage(files.map((f) => f.path)),
});
// #endregion

/**
 * 暂存若干来源（路径或 data URL）。
 * @param sources 来源列表。
 */
async function stage(sources: string[]): Promise<void> {
  if (!visionOk.value) {
    showError('当前模型不支持图片输入');
    return;
  }
  staging.value = true;
  try {
    for (const source of sources) {
      // 逐张串行：sharp 降采样吃 CPU，并发只会互相抢
      const image = await stageAiImageApi(source).catch(() => null);
      if (image) chat.addDraftImage(image);
    }
  } finally {
    staging.value = false;
  }
}

/** 选文件加图片。 */
async function pickImages(): Promise<void> {
  const files = await pickFilesApi({
    title: '选择图片',
    filters: [{ name: '图片', extensions: IMAGE_EXTS }],
  });
  if (files.length) await stage(files.map((f) => f.path));
}

/**
 * 粘贴图片：走 data URL 分支（剪贴板里的图没有磁盘路径）。
 * @param event 粘贴事件。
 */
function handlePaste(event: ClipboardEvent): void {
  const items = Array.from(event.clipboardData?.items ?? []).filter((i) =>
    i.type.startsWith('image/'),
  );
  if (items.length === 0) return;
  event.preventDefault();

  for (const item of items) {
    const file = item.getAsFile();
    if (!file) continue;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') void stage([reader.result]);
    };
    reader.readAsDataURL(file);
  }
}

/**
 * Enter 发送、Shift+Enter 换行。
 * @param event 键盘事件。
 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void submit();
}

/** 发送。 */
async function submit(): Promise<void> {
  if (!canSend.value) return;
  const text = draft.value;
  draft.value = '';
  await chat.send(text);
}
</script>

<style scoped lang="scss">
.ai-composer {
  padding: var(--tb-space-3);
  border-top: 1px solid var(--tb-border);

  &--drag {
    background: var(--tb-color-primary-soft);
  }

  &__images {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  &__image {
    position: relative;

    img {
      display: block;
      width: 56px;
      height: 56px;
      border-radius: var(--tb-radius-sm);
      border: 1px solid var(--tb-border);
      object-fit: cover;
    }
  }

  &__image-remove {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--tb-bg-elevated);
    color: var(--tb-text-primary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      background: var(--tb-bg-hover);
    }
  }

  &__selects {
    display: flex;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  // 两个下拉都**不撑满一行**：名字再长也只在这块地方省略，右边留白反而好认
  &__config {
    flex: 0 1 152px;
    min-width: 0;
  }

  &__approval {
    flex: 0 1 106px;
    min-width: 0;
  }

  &__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--tb-space-2);
  }

  &__left {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
  }

  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }
}
</style>
