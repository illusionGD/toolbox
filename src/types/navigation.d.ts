import type { Component } from 'vue';

/** 功能权限层级。free 免费，pro 需付费（计费骨架预留，当前全部 free）。 */
export type FeatureTier = 'free' | 'pro';

/** 导航菜单项。可含子项，形成一级/二级菜单。 */
export interface NavItem {
  /** 唯一标识，同时作为功能标识 featureKey 用于权限判断。 */
  key: string;
  /** 展示名称。 */
  label: string;
  /** 图标组件（naive-ui n-icon 内使用）。 */
  icon?: Component;
  /** 路由路径；有子项的分组节点可不提供。 */
  path?: string;
  /** 权限层级，默认 free。 */
  tier?: FeatureTier;
  /** 子菜单项。 */
  children?: NavItem[];
}
