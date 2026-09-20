<template>
  <n-data-table
    :columns="columns"
    :data="entries"
    :row-key="rowKey"
    :pagination="{ pageSize: 50 }"
    :max-height="420"
    :scroll-x="760"
  />
</template>

<script setup lang="ts">
import { h } from 'vue';
import { NButton, NDataTable, NTag, type DataTableColumns } from 'naive-ui';
import type { FileDiffEntry } from '@shared/fileDiff';
import { FILE_DIFF_STATUS_LABELS } from '@/constants/fileDiff';
import { formatBytes } from '@/utils/format';

interface Props {
  /** 按文件状态和搜索词筛选后的条目。 */
  entries: FileDiffEntry[];
  /** 详情读取期间禁用重复请求。 */
  detailLoading?: boolean;
}
const props = withDefaults(defineProps<Props>(), { detailLoading: false });
const emit = defineEmits<{ detail: [entry: FileDiffEntry] }>();
const rowKey = (row: FileDiffEntry): string => row.id;
/** @param row 要显示差异的条目。 */
function showDetail(row: FileDiffEntry): void {
  emit('detail', row);
}
const columns: DataTableColumns<FileDiffEntry> = [
  { title: '相对路径 / 文件', key: 'relativePath', minWidth: 280, ellipsis: { tooltip: true } },
  {
    title: '状态',
    key: 'status',
    width: 112,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          bordered: false,
          type:
            row.status === 'same'
              ? 'default'
              : row.status === 'error' || row.status === 'type-conflict'
                ? 'error'
                : 'warning',
        },
        { default: () => FILE_DIFF_STATUS_LABELS[row.status] },
      ),
  },
  {
    title: '左侧大小',
    key: 'left',
    width: 105,
    render: (row) =>
      !row.left ? '—' : row.left.kind === 'directory' ? '文件夹' : formatBytes(row.left.size),
  },
  {
    title: '右侧大小',
    key: 'right',
    width: 105,
    render: (row) =>
      !row.right ? '—' : row.right.kind === 'directory' ? '文件夹' : formatBytes(row.right.size),
  },
  {
    title: '差异',
    key: 'detail',
    width: 90,
    render: (row) =>
      h(
        NButton,
        { size: 'small', disabled: props.detailLoading, onClick: () => showDetail(row) },
        { default: () => '查看差异' },
      ),
  },
];
</script>
