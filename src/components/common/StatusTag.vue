<template>
  <n-tag :type="tagType" :bordered="false" size="small" round>
    {{ label }}
  </n-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NTag } from 'naive-ui';
import type { TaskStatus } from '@/types/file';

interface Props {
  /** 任务状态。 */
  status: TaskStatus;
}

const props = defineProps<Props>();

const STATUS_META: Record<
  TaskStatus,
  { label: string; type: 'default' | 'info' | 'success' | 'error' }
> = {
  pending: { label: '待处理', type: 'default' },
  processing: { label: '处理中', type: 'info' },
  done: { label: '已完成', type: 'success' },
  error: { label: '失败', type: 'error' },
};

const label = computed(() => STATUS_META[props.status].label);
const tagType = computed(() => STATUS_META[props.status].type);
</script>

<style scoped lang="scss"></style>
