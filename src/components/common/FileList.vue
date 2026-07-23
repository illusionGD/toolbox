<template>
  <div class="file-list" :class="{ 'file-list--dragover': isDragOver }" v-bind="handlers">
    <!-- 操作栏 -->
    <div class="file-list__toolbar">
      <n-space>
        <n-button type="primary" @click="handleAddFiles">
          <template #icon>
            <n-icon :component="CloudUploadOutline" />
          </template>
          添加文件
        </n-button>
        <n-button @click="handleAddFolder">
          <template #icon>
            <n-icon :component="FolderOpenOutline" />
          </template>
          添加文件夹
        </n-button>
        <n-button quaternary :disabled="items.length === 0" @click="handleClear">
          <template #icon>
            <n-icon :component="TrashOutline" />
          </template>
          清空列表
        </n-button>
      </n-space>
      <slot name="toolbar-extra" />
    </div>

    <!-- 列表 / 空态 -->
    <div class="file-list__body">
      <n-data-table
        v-if="items.length"
        :columns="resolvedColumns"
        :data="items"
        :row-key="(row: FileItem) => row.id"
        flex-height
        class="file-list__table"
      />
      <div v-else class="file-list__empty">
        <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
        <p>拖拽文件到此处，或点击「添加文件」</p>
      </div>
    </div>

    <!-- 底部统计 -->
    <div class="file-list__footer">
      <span>共 {{ items.length }} 个文件</span>
      <span class="file-list__footer-size">总大小 {{ totalSizeText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h } from 'vue';
import { NButton, NDataTable, NIcon, NSpace, useMessage, type DataTableColumns } from 'naive-ui';
import { CloudUploadOutline, FolderOpenOutline, TrashOutline } from '@vicons/ionicons5';
import type { PickedFile } from '@shared/types';
import type { FileItem } from '@/types/file';
import { pickFilesApi, pickDirectoryApi } from '@/services/fs';
import { useFileDrop } from '@/composables/useFileDrop';
import { formatBytes } from '@/utils/format';
import StatusTag from './StatusTag.vue';

// #region props/emits
interface Props {
  /** 文件项列表（由父组件持有）。 */
  items: FileItem[];
  /** 自定义列；不传则使用默认列（文件名/大小/状态/操作）。 */
  columns?: DataTableColumns<FileItem>;
  /** 添加文件对话框的扩展名过滤（小写，不含点）。 */
  accept?: string[];
  /** 对话框过滤器的展示名，默认「文件」。 */
  acceptLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  columns: undefined,
  accept: undefined,
  acceptLabel: '文件',
});

const emit = defineEmits<{
  /** 新增文件（去重由父组件或此处按 path 处理）。 */
  add: [files: PickedFile[]];
  /** 移除单个文件。 */
  remove: [id: string];
  /** 清空列表。 */
  clear: [];
}>();
// #endregion

// #region setup
const message = useMessage();

const totalSizeText = computed(() =>
  formatBytes(props.items.reduce((sum, item) => sum + item.size, 0)),
);

const { isDragOver, handlers } = useFileDrop({
  accept: props.accept,
  onDrop: (files) => emit('add', files),
});

/** 默认列：文件名、大小、状态、操作。 */
const defaultColumns = computed<DataTableColumns<FileItem>>(() => [
  { title: '文件名', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '大小',
    key: 'size',
    width: 110,
    render: (row) => formatBytes(row.size),
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    render: (row) => h(StatusTag, { status: row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 80,
    render: (row) =>
      h(
        NButton,
        { text: true, type: 'error', size: 'small', onClick: () => emit('remove', row.id) },
        { default: () => '移除' },
      ),
  },
]);

const resolvedColumns = computed(() => props.columns ?? defaultColumns.value);

/** 打开文件选择对话框并追加。 */
async function handleAddFiles(): Promise<void> {
  const filters = props.accept?.length
    ? [{ name: props.acceptLabel, extensions: props.accept }]
    : undefined;
  const files = await pickFilesApi({ filters, multiple: true });
  if (files.length) emit('add', files);
}

/** 选择文件夹（当前仅返回路径，递归扫描交由具体工具实现）。 */
async function handleAddFolder(): Promise<void> {
  const dir = await pickDirectoryApi('选择文件夹');
  if (dir) message.info(`已选择文件夹：${dir}`);
}

/** 清空列表。 */
function handleClear(): void {
  emit('clear');
}
// #endregion
</script>

<style scoped lang="scss">
.file-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  border: 1px dashed transparent;
  border-radius: var(--tb-radius-md);
  transition: border-color 0.15s;

  &--dragover {
    border-color: var(--tb-color-primary);
    background: var(--tb-color-primary-soft);
  }

  &__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tb-space-3);
    padding-bottom: var(--tb-space-3);
  }

  &__body {
    flex: 1;
    min-height: 0;
  }

  &__table {
    height: 100%;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__footer {
    display: flex;
    gap: var(--tb-space-4);
    padding-top: var(--tb-space-3);
    color: var(--tb-text-secondary);
    font-size: 13px;
  }

  &__footer-size {
    color: var(--tb-text-primary);
  }
}
</style>
