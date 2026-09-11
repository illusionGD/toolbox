<template>
  <aside class="side-nav">
    <n-scrollbar class="side-nav__scroll">
      <n-menu
        :value="activeKey"
        :options="menuOptions"
        :root-indent="18"
        :indent="14"
        accordion
        @update:value="handleSelect"
      />
    </n-scrollbar>

    <div class="side-nav__footer">
      <n-menu
        :value="activeKey"
        :options="footerOptions"
        :root-indent="18"
        @update:value="handleSelect"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, h } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { NIcon, NMenu, NScrollbar, type MenuOption } from 'naive-ui';
import { SettingsOutline, InformationCircleOutline, SparklesOutline } from '@vicons/ionicons5';
import type { Component } from 'vue';
import { NAV_ITEMS } from '@/constants/navigation';
import type { NavItem } from '@/types/navigation';
import { useAiConfigStore } from '@/stores/aiConfig';
import { useEntitlement } from '@/composables/useEntitlement';
import { openAiWindowApi } from '@/services/ai';

// #region setup
const route = useRoute();
const router = useRouter();
const aiConfig = useAiConfigStore();
const { can } = useEntitlement();

/** 当前激活的菜单 key，取自路由 meta.navKey。 */
const activeKey = computed(() => (route.meta.navKey as string | undefined) ?? '');

/** 渲染图标为 naive-ui n-menu 需要的函数形式。 */
function renderIcon(icon?: Component) {
  if (!icon) return undefined;
  return () => h(NIcon, null, { default: () => h(icon) });
}

/** 将导航项递归转换为 n-menu 选项。 */
function toMenuOption(item: NavItem): MenuOption {
  return {
    key: item.key,
    label: item.label,
    icon: renderIcon(item.icon),
    children: item.children?.map(toMenuOption),
  };
}

const menuOptions = computed<MenuOption[]>(() => NAV_ITEMS.map(toMenuOption));

/** 「还没配置」那个小圆点。样式写成内联的：`h()` 出来的节点由 n-menu 渲染，拿不到本组件的 scoped 属性。 */
const DOT_STYLE = {
  display: 'inline-block',
  width: '6px',
  height: '6px',
  borderRadius: '50%',
  background: 'var(--tb-color-primary)',
} as const;

/**
 * 底部那几项。
 *
 * AI 助手**排在「设置」前面**（用户原话「ai 入口放在设置 tab 上面」），全 app 只留这一个
 * 入口（首页原先那块卡片已经删掉）。它和别的菜单项有两处不一样：
 *
 * - **不跳路由**，点了是开另一个窗口（见 {@link handleSelect} 的分流）。`:value="activeKey"`
 *   是路由派生的受控值，所以点完高亮不会粘在它上面——正是想要的。
 * - **紫色图标**：全站唯一的强调色用在唯一的 AI 入口上（守配色规范：背景保持中性）。
 *
 * 一个配置都没有时右侧挂个小圆点：不点进去也知道「还要先去设置」，这条信息原来是首页
 * 那块卡片的副标题在承担。
 */
const footerOptions = computed<MenuOption[]>(() => {
  const options: MenuOption[] = [];
  if (can('ai-chat')) {
    options.push({
      key: 'ai',
      label: 'AI 助手',
      icon: () =>
        h(NIcon, { color: 'var(--tb-color-primary)' }, { default: () => h(SparklesOutline) }),
      extra:
        aiConfig.configs.length === 0 ? () => h('span', { style: DOT_STYLE }) : undefined,
    });
  }
  options.push(
    { key: 'settings', label: '设置', icon: renderIcon(SettingsOutline) },
    { key: 'about', label: '关于', icon: renderIcon(InformationCircleOutline) },
  );
  return options;
});

/** 路径映射表：菜单 key → 路由 path。 */
const keyToPath = new Map<string, string>();
function collectPaths(items: readonly NavItem[]): void {
  for (const item of items) {
    if (item.path) keyToPath.set(item.key, item.path);
    if (item.children) collectPaths(item.children);
  }
}
collectPaths(NAV_ITEMS);
keyToPath.set('settings', '/settings');
keyToPath.set('about', '/about');

/**
 * 菜单项选中时跳转到对应路由。
 * @param key 选中的菜单 key。
 */
function handleSelect(key: string): void {
  // AI 助手不是一个页面：它开的是独立的无边框窗口（能拖到第二块屏、能置顶），
  // 所以这一项在 keyToPath 里没有条目，也不该走 router
  if (key === 'ai') {
    void openAiWindowApi();
    return;
  }
  const path = keyToPath.get(key);
  if (path && path !== route.path) {
    void router.push(path);
  }
}
// #endregion
</script>

<style scoped lang="scss">
.side-nav {
  display: flex;
  flex-direction: column;
  width: 200px;
  height: 100%;
  background: var(--tb-bg-surface);
  border-right: 1px solid var(--tb-border);

  &__scroll {
    flex: 1;
    padding: var(--tb-space-2) 0;
  }

  &__footer {
    border-top: 1px solid var(--tb-border);
    padding: var(--tb-space-2) 0;
  }
}
</style>
