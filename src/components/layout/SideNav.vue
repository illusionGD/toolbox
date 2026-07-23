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
import { SettingsOutline, InformationCircleOutline } from '@vicons/ionicons5';
import type { Component } from 'vue';
import { NAV_ITEMS } from '@/constants/navigation';
import type { NavItem } from '@/types/navigation';

// #region setup
const route = useRoute();
const router = useRouter();

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

const footerOptions: MenuOption[] = [
  { key: 'settings', label: '设置', icon: renderIcon(SettingsOutline) },
  { key: 'about', label: '关于', icon: renderIcon(InformationCircleOutline) },
];

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
