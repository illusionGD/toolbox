/**
 * 图表通用配色。
 * 首页使用统计与文件统计占比图共用，保证视觉一致。
 */

/** 分类配色序列（首色与主题主色同源）。 */
export const CATEGORY_COLORS = [
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#d97706',
  '#e11d48',
] as const;

/**
 * 取第 i 个分类的配色（循环取用）。
 * @param i 序号。
 * @returns 颜色值。
 */
export function colorAt(i: number): string {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length];
}
