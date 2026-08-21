import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import type { Component } from 'vue';
import { NAV_ITEMS } from '@/constants/navigation';
import type { NavItem } from '@/types/navigation';
import { getTool } from '@/utils/navigation';
import { useUsageStore } from '@/stores/usage';
import HomeView from '@/views/HomeView.vue';
import SettingsView from '@/views/SettingsView.vue';
import PlaceholderView from '@/views/PlaceholderView.vue';
import ImageCompressView from '@/views/image/ImageCompressView.vue';
import ImageCropView from '@/views/image/ImageCropView.vue';
import ImageStylizeView from '@/views/image/ImageStylizeView.vue';
import ImageSpriteView from '@/views/image/ImageSpriteView.vue';
import QrCodeView from '@/views/image/QrCodeView.vue';
import FileStatsView from '@/views/file/FileStatsView.vue';
import RenameView from '@/views/file/RenameView.vue';
import SpinePreviewView from '@/views/media/SpinePreviewView.vue';
import VideoCompressView from '@/views/media/VideoCompressView.vue';

/**
 * 已实现工具的 key → 页面组件映射。
 * 未在此表中的工具走 PlaceholderView（功能开发中）。
 */
const TOOL_COMPONENTS: Record<string, Component> = {
  'image-compress': ImageCompressView,
  'image-crop': ImageCropView,
  'image-stylize': ImageStylizeView,
  'image-sprite': ImageSpriteView,
  'image-qrcode': QrCodeView,
  'file-stats': FileStatsView,
  'file-rename': RenameView,
  'media-spine': SpinePreviewView,
  'media-video': VideoCompressView,
};

/**
 * 从导航树递归收集所有带 path 的叶子项，生成路由。
 * 已实现的用真实组件，未实现的用占位页。
 * @param items 导航项列表。
 * @returns 路由记录数组。
 */
function buildToolRoutes(items: readonly NavItem[]): RouteRecordRaw[] {
  const routes: RouteRecordRaw[] = [];
  for (const item of items) {
    if (item.path && item.key !== 'home') {
      routes.push({
        path: item.path,
        name: item.key,
        component: TOOL_COMPONENTS[item.key] ?? PlaceholderView,
        meta: { title: item.label, navKey: item.key },
      });
    }
    if (item.children?.length) {
      routes.push(...buildToolRoutes(item.children));
    }
  }
  return routes;
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/home' },
  { path: '/home', name: 'home', component: HomeView, meta: { title: '首页', navKey: 'home' } },
  ...buildToolRoutes(NAV_ITEMS),
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: { title: '设置', navKey: 'settings' },
  },
  {
    path: '/about',
    name: 'about',
    component: PlaceholderView,
    meta: { title: '关于', navKey: 'about' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/home' },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
});

// 进入工具页时统一记录使用（首页/设置/关于不计）。
// 各入口（首页卡片、最近使用、侧栏）都经路由，故在此单点埋点避免重复计数。
router.afterEach((to) => {
  const navKey = to.meta.navKey as string | undefined;
  if (!navKey || navKey === 'home') return;
  const tool = getTool(navKey);
  if (!tool?.path) return;
  const usageStore = useUsageStore();
  usageStore.recordUsage(navKey, Date.now());
});
