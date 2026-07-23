import type { ThemePreset } from '@/types/theme';

/** 默认主色：紫色，对齐设计稿黑/紫色调。 */
export const DEFAULT_PRIMARY_COLOR = '#7c3aed';

/** 主题色本地持久化的存储键。 */
export const THEME_STORAGE_KEY = 'toolbox.theme';

/** 预设主题色列表，供设置页快速选择。 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { key: 'purple', label: '紫', color: '#7c3aed' },
  { key: 'blue', label: '蓝', color: '#2563eb' },
  { key: 'cyan', label: '青', color: '#0891b2' },
  { key: 'green', label: '绿', color: '#16a34a' },
  { key: 'rose', label: '玫红', color: '#e11d48' },
  { key: 'amber', label: '琥珀', color: '#d97706' },
] as const;
