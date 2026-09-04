<template>
  <n-card class="ai-settings" title="AI 助手" size="small">
    <n-alert
      v-if="configStore.hasPlaintextKey"
      type="error"
      :bordered="false"
      class="ai-settings__alert"
    >
      系统凭据加密（safeStorage）在这台机器上不可用，已存的 API Key 是
      <strong>明文</strong>
      保存在用户数据目录里的。请勿在共用电脑上使用，或改用可随时作废的临时 key。
    </n-alert>

    <n-alert
      v-if="configStore.configs.length === 0"
      type="info"
      :bordered="false"
      class="ai-settings__alert"
    >
      还没有配置。添加一份「厂商 + 模型 + 自定义名称」的配置并填入 API Key，首页右上角的 AI
      按钮就能用了。
    </n-alert>

    <n-radio-group
      v-else
      class="ai-settings__list"
      :value="configStore.activeConfig?.id ?? null"
      @update:value="(id: string) => configStore.setActive(id)"
    >
      <div v-for="config in configStore.configs" :key="config.id" class="ai-settings__item">
        <n-radio class="ai-settings__radio" :value="config.id">
          <div class="ai-settings__info">
            <div class="ai-settings__name">
              <span>{{ config.name }}</span>
              <n-tag v-if="!configStore.keyStatus[config.id]?.hasKey" size="small" type="warning">
                缺 Key
              </n-tag>
            </div>
            <div class="ai-settings__model">
              {{ findProvider(config.provider)?.label ?? config.provider }} ·
              {{ findModel(config.provider, config.model)?.label ?? config.model }}
            </div>
          </div>
        </n-radio>

        <div class="ai-settings__ops">
          <n-button size="tiny" quaternary @click="openDialog('edit', config.id)">编辑</n-button>
          <n-button size="tiny" quaternary @click="openDialog('duplicate', config.id)">
            复制
          </n-button>
          <n-popconfirm @positive-click="removeConfig(config.id)">
            <template #trigger>
              <n-button size="tiny" quaternary type="error">删除</n-button>
            </template>
            删除「{{ config.name }}」及它保存的 API Key？
          </n-popconfirm>
        </div>
      </div>
    </n-radio-group>

    <div class="ai-settings__footer">
      <n-button size="small" secondary @click="openDialog('add', '')">添加配置</n-button>
    </div>

    <AiConfigDialog
      :show="dialog.show"
      :mode="dialog.mode"
      :source-id="dialog.sourceId"
      @cancel="dialog.show = false"
      @saved="dialog.show = false"
    />
  </n-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NPopconfirm,
  NRadio,
  NRadioGroup,
  NTag,
  useMessage,
} from 'naive-ui';
import { findModel, findProvider } from '@shared/ai';
import AiConfigDialog, { type AiConfigDialogMode } from './AiConfigDialog.vue';
import { useAiConfigStore } from '@/stores/aiConfig';

// #region setup
const configStore = useAiConfigStore();
const message = useMessage();

/** 配置弹窗状态。新增 / 编辑 / 复制共用同一个弹窗，只换 mode 与 sourceId。 */
const dialog = ref<{ show: boolean; mode: AiConfigDialogMode; sourceId: string }>({
  show: false,
  mode: 'add',
  sourceId: '',
});
// #endregion

/**
 * 打开配置弹窗。
 * @param mode 模式。
 * @param sourceId 源配置 id；新增时传空串。
 */
function openDialog(mode: AiConfigDialogMode, sourceId: string): void {
  dialog.value = { show: true, mode, sourceId };
}

/**
 * 删除一份配置（连它的 key 一起，不然密钥库里会留下访问不到的孤儿凭据）。
 * @param id 配置 id。
 */
async function removeConfig(id: string): Promise<void> {
  await configStore.removeConfig(id);
  message.success('已删除配置');
}

onMounted(() => {
  void configStore.refreshKeyStatus();
});
</script>

<style scoped lang="scss">
.ai-settings {
  width: 100%;
  margin-top: var(--tb-space-4);
  background: var(--tb-bg-surface);
  border: 1px solid var(--tb-border);

  &__alert {
    width: 100%;
    margin-bottom: var(--tb-space-3);
  }

  &__list {
    display: flex;
    flex-direction: column;
    width: 100%;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    overflow: hidden;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
    padding: var(--tb-space-2) var(--tb-space-3);

    & + & {
      border-top: 1px solid var(--tb-border);
    }

    &:hover {
      background: var(--tb-bg-hover);
    }
  }

  // 让 radio 占满剩余宽度，整行文字都能点选
  &__radio {
    flex: 1;
    min-width: 0;

    :deep(.n-radio__label) {
      display: block;
      width: 100%;
      padding-right: 0;
    }
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__name {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    color: var(--tb-text-primary);
  }

  &__model {
    color: var(--tb-text-secondary);
    font-size: 12px;
    word-break: break-all;
  }

  &__ops {
    display: flex;
    flex-shrink: 0;
    gap: var(--tb-space-1);
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--tb-space-3);
  }
}
</style>
