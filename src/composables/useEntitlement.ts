import { computed } from 'vue';
import type { FeatureTier } from '@/types/navigation';
import { NAV_ITEMS } from '@/constants/navigation';
import type { NavItem } from '@/types/navigation';
import { ACCOUNT_ENABLED } from '@/constants/config';
import { useUserStore } from '@/stores/user';

/**
 * 构建 featureKey → tier 的查找表。
 * 未显式声明 tier 的功能默认为 free。
 */
function buildTierMap(
  items: readonly NavItem[],
  map = new Map<string, FeatureTier>(),
): Map<string, FeatureTier> {
  for (const item of items) {
    map.set(item.key, item.tier ?? 'free');
    if (item.children) buildTierMap(item.children, map);
  }
  return map;
}

const FEATURE_TIER_MAP = buildTierMap(NAV_ITEMS);

/**
 * 权限门面：所有"功能是否可用"的判断的唯一入口。
 * 当前策略——账号能力关闭或功能为 free 时一律放行；
 * 后端就绪后只需改这里的判断逻辑，各调用方（页面/ProGuard）无需改动。
 * @returns can(featureKey) 判断函数与相关响应式状态。
 */
export function useEntitlement() {
  const userStore = useUserStore();

  /**
   * 判断某功能当前是否可用。
   * @param featureKey 功能标识（对应 NavItem.key）。
   * @returns 是否允许使用。
   */
  function can(featureKey: string): boolean {
    // 账号能力未启用：全部放行（预留骨架不影响现有功能）
    if (!ACCOUNT_ENABLED) return true;
    const tier = FEATURE_TIER_MAP.get(featureKey) ?? 'free';
    if (tier === 'free') return true;
    // 付费功能：需登录且为 pro
    return userStore.isLoggedIn && userStore.isPro;
  }

  /** 账号能力是否启用。 */
  const accountEnabled = computed(() => ACCOUNT_ENABLED);

  return { can, accountEnabled };
}
