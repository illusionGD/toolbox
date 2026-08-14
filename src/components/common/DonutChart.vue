<template>
  <div class="donut-chart">
    <svg class="donut-chart__svg" :viewBox="`0 0 ${size} ${size}`" :width="size" :height="size">
      <!-- 底环 -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke="trackColor"
        :stroke-width="thickness"
      />
      <!-- 各分段 -->
      <circle
        v-for="seg in arcs"
        :key="seg.key"
        :cx="center"
        :cy="center"
        :r="radius"
        fill="none"
        :stroke="seg.color"
        :stroke-width="thickness"
        stroke-linecap="round"
        :stroke-dasharray="`${seg.length} ${circumference - seg.length}`"
        :stroke-dashoffset="seg.offset"
        :transform="`rotate(-90 ${center} ${center})`"
        class="donut-chart__arc"
      />
    </svg>

    <div class="donut-chart__center">
      <span class="donut-chart__total">{{ total }}</span>
      <span class="donut-chart__unit">{{ unit }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/** 环形图分段。 */
export interface DonutSegment {
  /** 唯一 key。 */
  key: string;
  /** 数值。 */
  value: number;
  /** 颜色。 */
  color: string;
}

interface Props {
  /** 分段数据。 */
  segments: DonutSegment[];
  /** 中心显示的总量（数值或已格式化的文本，如 `1.2 GB`）。 */
  total: number | string;
  /** 中心单位文字，默认「次」。 */
  unit?: string;
  /** 画布尺寸（正方形边长 px），默认 140。 */
  size?: number;
  /** 圆环粗细 px，默认 16。 */
  thickness?: number;
  /** 底环颜色。 */
  trackColor?: string;
}

const props = withDefaults(defineProps<Props>(), {
  unit: '次',
  size: 140,
  thickness: 16,
  trackColor: 'var(--tb-bg-hover)',
});

// #region setup
const center = computed(() => props.size / 2);
const radius = computed(() => props.size / 2 - props.thickness / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);

/** 计算各分段在环上的弧长与偏移。 */
const arcs = computed(() => {
  const sum = props.segments.reduce((acc, s) => acc + s.value, 0);
  if (sum === 0) return [];
  let cumulative = 0;
  return props.segments.map((seg) => {
    const fraction = seg.value / sum;
    const length = fraction * circumference.value;
    // dashoffset 为负向前偏移到累计起点
    const offset = -(cumulative / sum) * circumference.value;
    cumulative += seg.value;
    return { key: seg.key, color: seg.color, length, offset };
  });
});
// #endregion
</script>

<style scoped lang="scss">
.donut-chart {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  &__arc {
    transition: stroke-dasharray 0.4s ease;
  }

  &__center {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
  }

  &__total {
    font-size: 26px;
    font-weight: 700;
    color: var(--tb-text-primary);
  }

  &__unit {
    font-size: 12px;
    color: var(--tb-text-secondary);
  }
}
</style>
