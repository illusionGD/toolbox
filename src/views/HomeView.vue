<template>
  <div class="home">
    <!-- 顶部：欢迎语 + 使用统计概览 -->
    <div class="home__header">
      <div class="home__welcome">
        <h1 class="home__title">欢迎使用多功能工具箱</h1>
        <p class="home__subtitle">高效、实用、便捷的工具集合</p>
      </div>
      <n-card class="home__usage-card" size="small">
        <div class="home__usage-card-inner">
          <div>
            <p class="home__usage-count">已使用 {{ usageStore.totalCount }} 次</p>
            <p class="home__usage-hint">感谢你的使用</p>
          </div>
          <n-icon :size="28" color="#fff" class="home__usage-icon">
            <FlashOutline />
          </n-icon>
        </div>
      </n-card>
    </div>

    <!-- 推荐工具（分类 tab） -->
    <div class="home__section">
      <n-tabs v-model:value="activeTab" type="line" animated>
        <n-tab-pane
          v-for="group in RECOMMEND_GROUPS"
          :key="group.key"
          :name="group.key"
          :tab="group.label"
        >
          <div class="home__tools-grid">
            <button
              v-for="tool in group.tools"
              :key="tool.key"
              class="home__tool-card"
              @click="openTool(tool.key, tool.path)"
            >
              <div class="home__tool-icon">
                <n-icon :size="22"><component :is="tool.icon" /></n-icon>
              </div>
              <div class="home__tool-text">
                <span class="home__tool-name">{{ tool.label }}</span>
                <span class="home__tool-desc">{{ tool.desc }}</span>
              </div>
            </button>
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>

    <!-- 底部：最近使用 + 使用统计 -->
    <div class="home__bottom">
      <n-card class="home__panel" title="最近使用" size="small">
        <div v-if="recentRows.length" class="home__recent">
          <div v-for="row in recentRows" :key="row.key" class="home__recent-row">
            <span class="home__recent-name">{{ row.label }}</span>
            <span class="home__recent-time">{{ row.timeText }}</span>
            <n-button text type="primary" size="small" @click="openTool(row.key)">打开</n-button>
          </div>
        </div>
        <div v-else class="home__empty">还没有使用记录，去试试上面的工具吧</div>
      </n-card>

      <n-card class="home__panel" title="使用统计" size="small">
        <div v-if="usageStore.categoryUsage.length" class="home__stats">
          <DonutChart :segments="donutSegments" :total="usageStore.totalCount" />
          <div class="home__legend">
            <div
              v-for="(item, i) in usageStore.categoryUsage"
              :key="item.category"
              class="home__legend-row"
            >
              <span class="home__legend-dot" :style="{ background: colorAt(i) }" />
              <span class="home__legend-label">{{ item.label }}</span>
              <span class="home__legend-value">{{ item.percentage }}%</span>
            </div>
          </div>
        </div>
        <div v-else class="home__empty">暂无统计数据</div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { NButton, NCard, NIcon, NTabPane, NTabs } from 'naive-ui';
import { FlashOutline } from '@vicons/ionicons5';
import { RECOMMEND_GROUPS } from '@/constants/recommend';
import { useUsageStore } from '@/stores/usage';
import { useToolLauncher } from '@/composables/useToolLauncher';
import { getTool } from '@/utils/navigation';
import { formatRelativeTime } from '@/utils/format';
import DonutChart from '@/components/common/DonutChart.vue';

// #region setup
const usageStore = useUsageStore();
const { openTool } = useToolLauncher();

const activeTab = ref(RECOMMEND_GROUPS[0]?.key ?? 'recommend');

/** 分类统计配色。 */
const CATEGORY_COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#16a34a', '#d97706', '#e11d48'];

/**
 * 取第 i 个分类的配色（循环取用）。
 * @param i 序号。
 * @returns 颜色值。
 */
function colorAt(i: number): string {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
}

/** 最近使用列表（含展示名与相对时间）。 */
const recentRows = computed(() =>
  usageStore.recentTools.map((r) => ({
    key: r.key,
    label: getTool(r.key)?.label ?? r.key,
    timeText: formatRelativeTime(r.lastUsedAt),
  })),
);

/** 环形图分段。 */
const donutSegments = computed(() =>
  usageStore.categoryUsage.map((item, i) => ({
    key: item.category,
    value: item.count,
    color: colorAt(i),
  })),
);
// #endregion
</script>

<style scoped lang="scss">
.home {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-5);
  padding: var(--tb-space-5);

  &__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--tb-space-4);
  }

  &__title {
    margin: 0 0 var(--tb-space-2);
    font-size: 24px;
    color: var(--tb-text-primary);
  }

  &__subtitle {
    margin: 0;
    color: var(--tb-text-secondary);
  }

  &__usage-card {
    width: 260px;
    flex-shrink: 0;
    background: linear-gradient(135deg, var(--tb-bg-elevated), var(--tb-bg-surface));
    border: 1px solid var(--tb-border);
  }

  &__usage-card-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__usage-count {
    margin: 0 0 4px;
    font-size: 16px;
    font-weight: 600;
    color: var(--tb-text-primary);
  }

  &__usage-hint {
    margin: 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__usage-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: var(--tb-color-primary);
  }

  &__tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--tb-space-3);
    padding-top: var(--tb-space-2);
  }

  &__tool-card {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
    padding: var(--tb-space-3);
    text-align: left;
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    cursor: pointer;
    transition:
      border-color 0.15s,
      transform 0.15s;

    &:hover {
      border-color: var(--tb-color-primary);
      transform: translateY(-2px);
    }
  }

  &__tool-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: var(--tb-radius-sm);
    background: var(--tb-color-primary-soft);
    color: var(--tb-color-primary);
  }

  &__tool-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  &__tool-name {
    color: var(--tb-text-primary);
    font-weight: 500;
  }

  &__tool-desc {
    font-size: 12px;
    color: var(--tb-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__bottom {
    display: grid;
    grid-template-columns: 1fr 320px;
    gap: var(--tb-space-4);
  }

  &__panel {
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
  }

  &__recent {
    display: flex;
    flex-direction: column;
  }

  &__recent-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    align-items: center;
    gap: var(--tb-space-4);
    padding: var(--tb-space-2) 0;
    border-bottom: 1px solid var(--tb-border);

    &:last-child {
      border-bottom: none;
    }
  }

  &__recent-name {
    color: var(--tb-text-primary);
  }

  &__recent-time {
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__stats {
    display: flex;
    align-items: center;
    gap: var(--tb-space-5);
  }

  &__legend {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-2);
    flex: 1;
  }

  &__legend-row {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
  }

  &__legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__legend-label {
    flex: 1;
    color: var(--tb-text-secondary);
    font-size: 13px;
  }

  &__legend-value {
    color: var(--tb-text-primary);
    font-size: 13px;
  }

  &__empty {
    padding: var(--tb-space-5) 0;
    text-align: center;
    color: var(--tb-text-secondary);
    font-size: 13px;
  }
}
</style>
