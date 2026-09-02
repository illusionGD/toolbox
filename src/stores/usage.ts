import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { CategoryUsage, UsageRecord } from '@/types/usage';
import { getTool } from '@/utils/navigation';
import { readState, writeState } from '@/services/appState';

/** 使用记录在应用状态里的命名空间。 */
const USAGE_NS = 'usage';
/** 最近使用列表最大长度。 */
const MAX_RECENT = 10;

/**
 * 读取使用记录（同步，状态已在挂载前读进内存）。
 * @returns 记录数组，缺失或格式不对返回空数组。
 */
function loadRecords(): UsageRecord[] {
  const parsed = readState<unknown>(USAGE_NS);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (r): r is UsageRecord =>
      typeof r === 'object' && r !== null && typeof (r as UsageRecord).key === 'string',
  );
}

/**
 * 使用记录 store：记录各工具使用次数与最近使用，持久化到数据保存目录。
 * 首页的"最近使用""使用统计"由此驱动。
 */
export const useUsageStore = defineStore('usage', () => {
  // #region state
  const records = ref<UsageRecord[]>(loadRecords());
  // #endregion

  // #region getters
  /** 总使用次数。 */
  const totalCount = computed(() => records.value.reduce((sum, r) => sum + r.count, 0));

  /** 最近使用的工具（按最近时间倒序，最多 MAX_RECENT 个）。 */
  const recentTools = computed(() =>
    [...records.value].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_RECENT),
  );

  /** 按分类聚合的使用占比（按次数倒序）。 */
  const categoryUsage = computed<CategoryUsage[]>(() => {
    const total = totalCount.value;
    if (total === 0) return [];

    const byCategory = new Map<string, { label: string; count: number }>();
    for (const record of records.value) {
      const tool = getTool(record.key);
      const category = tool?.category ?? 'other';
      const label = tool?.categoryLabel ?? '其他';
      const entry = byCategory.get(category) ?? { label, count: 0 };
      entry.count += record.count;
      byCategory.set(category, entry);
    }

    return [...byCategory.entries()]
      .map(([category, { label, count }]) => ({
        category,
        label,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  });
  // #endregion

  // #region actions
  /**
   * 记录一次工具使用。
   * @param key 工具 key（对应 NavItem.key）。
   * @param at 使用时间戳（毫秒），默认外部传入以避免 store 内直接取时间。
   */
  function recordUsage(key: string, at: number): void {
    const existing = records.value.find((r) => r.key === key);
    if (existing) {
      existing.count += 1;
      existing.lastUsedAt = at;
    } else {
      records.value.push({ key, count: 1, lastUsedAt: at });
    }
    persist();
  }

  /** 清空所有使用记录。 */
  function clear(): void {
    records.value = [];
    persist();
  }

  /** 持久化到数据保存目录（防抖写盘）。 */
  function persist(): void {
    writeState(USAGE_NS, records.value);
  }
  // #endregion

  return { records, totalCount, recentTools, categoryUsage, recordUsage, clear };
});
