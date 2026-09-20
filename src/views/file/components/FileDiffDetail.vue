<template>
  <n-modal
    :show="show"
    preset="card"
    size="small"
    :title="`差异详情 · ${FILE_DIFF_STATUS_LABELS[entry.status]}`"
    aria-label="差异详情"
    style="width: min(1440px, calc(100vw - 48px))"
    :content-style="{ maxHeight: 'calc(100vh - 180px)', overflow: 'auto' }"
    @update:show="updateShow"
  >
    <div class="diff-detail__paths">
      <div>
        <span>左侧：{{ entry.left?.path || '不存在' }}</span
        ><n-button v-if="entry.left" text size="tiny" @click="reveal(entry.left.path)"
          >定位</n-button
        >
      </div>
      <div>
        <span>右侧：{{ entry.right?.path || '不存在' }}</span
        ><n-button v-if="entry.right" text size="tiny" @click="reveal(entry.right.path)"
          >定位</n-button
        >
      </div>
    </div>
    <n-spin v-if="loading" size="small" />
    <n-alert v-else-if="error" type="error">{{ error }}</n-alert>
    <template v-else-if="detail">
      <p class="diff-detail__hint">{{ detail.message }}</p>
      <p v-if="detail.leftEncoding" class="diff-detail__hint">
        左侧编码：{{ detail.leftEncoding }} · 右侧编码：{{ detail.rightEncoding }}
      </p>
      <n-alert v-if="detail.simplified || detail.truncated" type="warning" :show-icon="false">
        <span v-if="detail.simplified">差异较多，中间内容按整段替换展示。</span>
        <span v-if="detail.truncated">预览已截断，文件状态仍基于完整内容比较。</span>
      </n-alert>
      <FileDiffSideBySide v-if="detail.lines.length" :lines="detail.lines" />
    </template>
    <template #footer>
      <n-button @click="close">关闭</n-button>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import { NAlert, NButton, NModal, NSpin } from 'naive-ui';
import type { FileDiffDetail, FileDiffEntry } from '@shared/fileDiff';
import { FILE_DIFF_STATUS_LABELS } from '@/constants/fileDiff';
import { showInFolderApi } from '@/services/file';

const FileDiffSideBySide = defineAsyncComponent(() => import('./FileDiffSideBySide.vue'));

interface Props {
  /** 是否显示详情弹窗。 */
  show: boolean;
  /** 当前选中文件。 */
  entry: FileDiffEntry;
  /** 已读取的差异，读取中为 null。 */
  detail: FileDiffDetail | null;
  /** 是否正在读文件。 */
  loading?: boolean;
  /** 读取失败信息。 */
  error?: string;
}
withDefaults(defineProps<Props>(), { loading: false, error: '' });
const emit = defineEmits<{ close: [] }>();
/** 关闭弹窗并保留结果列表的筛选和位置。 */
function close(): void {
  emit('close');
}
/** @param show 弹窗状态；关闭按钮、遮罩和 Esc 共用关闭事件。 */
function updateShow(show: boolean): void {
  if (!show) close();
}
/** @param path 在资源管理器显示文件。 */
async function reveal(path: string): Promise<void> {
  try {
    await showInFolderApi(path);
  } catch {
    /* 服务层已显示错误。 */
  }
}
</script>

<style scoped lang="scss">
.diff-detail {
  &__paths {
    display: grid;
    gap: var(--tb-space-2);
    word-break: break-all;
    > div {
      display: flex;
      align-items: center;
      gap: var(--tb-space-2);
    }
  }
  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
    margin: var(--tb-space-2) 0;
  }
}
</style>
