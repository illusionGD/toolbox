/**
 * 主题相关的公共类型。
 */

/** 主题明暗模式。当前仅实现 dark，light 预留以便后续扩展。 */
export type ThemeMode = 'dark' | 'light';

/** 预设主题色项。 */
export interface ThemePreset {
  /** 唯一标识。 */
  key: string;
  /** 展示名称。 */
  label: string;
  /** 主色 hex。 */
  color: string;
}

/** 主题持久化的配置结构。 */
export interface ThemeConfig {
  /** 明暗模式。 */
  mode: ThemeMode;
  /** 当前主题主色 hex。 */
  primaryColor: string;
}
