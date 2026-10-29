import { NAV_ITEMS } from '@/constants/navigation';
import type { NavItem } from '@/types/navigation';
import { reactive } from 'vue';
import type { PluginRecord } from '@shared/plugins/types';

/** 扁平化后的工具信息。 */
export interface FlatTool {
  /** 工具 key。 */
  key: string;
  /** 展示名。 */
  label: string;
  /** 路由路径。 */
  path?: string;
  /** 顶级分类 key。 */
  category: string;
  /** 顶级分类展示名。 */
  categoryLabel: string;
}

/**
 * 递归扁平化导航树，记录每个节点的顶级分类。
 * @param items 导航项。
 * @param parent 顶级分类节点（顶层项自身即分类）。
 * @param acc 累加结果。
 * @returns key → FlatTool 的映射。
 */
function flatten(
  items: readonly NavItem[],
  parent: NavItem | null,
  acc: Map<string, FlatTool>,
): Map<string, FlatTool> {
  for (const item of items) {
    const category = parent ?? item;
    acc.set(item.key, {
      key: item.key,
      label: item.label,
      path: item.path,
      category: category.key,
      categoryLabel: category.label,
    });
    if (item.children) flatten(item.children, parent ?? item, acc);
  }
  return acc;
}

/** key → 工具信息 的全量映射。 */
const toolMap = reactive(flatten(NAV_ITEMS, null, new Map()));
export const TOOL_MAP: ReadonlyMap<string, FlatTool> = toolMap;

/** @param records 已安装插件快照；更新首页与使用记录的导航元数据。 */
export function updatePluginNavigation(records: PluginRecord[]): void {
  for (const key of toolMap.keys()) if (key.startsWith('plugin:')) toolMap.delete(key);
  for (const record of records.filter((r) => r.enabled)) {
    for (const page of record.manifest.contributes.pages) {
      const key = `plugin:${record.manifest.id}:${page.id}`;
      toolMap.set(key, {
        key,
        label: page.title,
        path: `/plugins/${record.manifest.id}/${page.id}`,
        category: page.category,
        categoryLabel: NAV_ITEMS.find((item) => item.key === page.category)?.label ?? '插件',
      });
    }
  }
}

/**
 * 按 key 获取工具信息。
 * @param key 工具 key。
 * @returns 工具信息，未找到返回 undefined。
 */
export function getTool(key: string): FlatTool | undefined {
  return TOOL_MAP.get(key);
}
