<template>
  <div class="task-progress">
    <n-progress
      type="line"
      :percentage="clampedPercentage"
      :status="progressStatus"
      :show-indicator="showIndicator"
      :height="height"
      :border-radius="4"
      :fill-border-radius="4"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NProgress } from 'naive-ui';
import type { TaskStatus } from '@/types/file';

interface Props {
  /** 进度百分比 0-100。 */
  percentage: number;
  /** 关联的任务状态，用于着色。 */
  status?: TaskStatus;
  /** 是否显示百分比文字，默认 true。 */
  showIndicator?: boolean;
  /** 进度条高度，默认 8。 */
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  status: 'processing',
  showIndicator: true,
  height: 8,
});

const clampedPercentage = computed(() => Math.min(100, Math.max(0, props.percentage)));

/** 将任务状态映射到 naive-ui 进度条状态。 */
const progressStatus = computed<'default' | 'success' | 'error' | 'info'>(() => {
  switch (props.status) {
    case 'done':
      return 'success';
    case 'error':
      return 'error';
    case 'processing':
      return 'info';
    default:
      return 'default';
  }
});
</script>

<style scoped lang="scss">
.task-progress {
  width: 100%;
}
</style>
