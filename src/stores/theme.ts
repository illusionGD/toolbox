import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { ThemeConfig, ThemeMode } from '@/types/theme';
import { DEFAULT_PRIMARY_COLOR, THEME_NS } from '@/constants/theme';
import { isValidHex } from '@/utils/color';
import { readState, writeState } from '@/services/appState';

/**
 * 读取主题配置，非法或缺失时回退默认。
 * 同步读——`initAppState()` 已在挂载前把状态读进内存，所以这里不必异步，
 * 主题色也就不会先闪一帧默认紫。
 * @returns 归一化后的主题配置。
 */
function loadThemeConfig(): ThemeConfig {
  const parsed = readState<Partial<ThemeConfig>>(THEME_NS);
  if (typeof parsed !== 'object' || parsed === null) {
    return { mode: 'dark', primaryColor: DEFAULT_PRIMARY_COLOR };
  }
  return {
    // 目前仅支持 dark，light 预留，读到非法值一律回退 dark
    mode: parsed.mode === 'light' ? 'light' : 'dark',
    primaryColor:
      typeof parsed.primaryColor === 'string' && isValidHex(parsed.primaryColor)
        ? parsed.primaryColor
        : DEFAULT_PRIMARY_COLOR,
  };
}

/**
 * 主题 store：管理明暗模式与主题主色，并持久化到数据保存目录。
 * 当前仅启用 dark 模式，light 结构已预留。
 */
export const useThemeStore = defineStore('theme', () => {
  // #region state
  const initial = loadThemeConfig();
  const mode = ref<ThemeMode>(initial.mode);
  const primaryColor = ref<string>(initial.primaryColor);
  // #endregion

  // #region getters
  const isDark = computed(() => mode.value === 'dark');
  // #endregion

  // #region actions
  /**
   * 设置主题主色。
   * @param color 合法 hex 颜色，非法则忽略。
   */
  function setPrimaryColor(color: string): void {
    if (!isValidHex(color)) return;
    primaryColor.value = color.startsWith('#') ? color : `#${color}`;
  }

  /**
   * 设置明暗模式。当前仅 dark 生效，light 为预留。
   * @param next 目标模式。
   */
  function setMode(next: ThemeMode): void {
    mode.value = next;
  }

  /** 恢复默认主题主色。 */
  function resetPrimaryColor(): void {
    primaryColor.value = DEFAULT_PRIMARY_COLOR;
  }
  // #endregion

  // 任意主题配置变化即持久化
  watch(
    [mode, primaryColor],
    () => {
      const config: ThemeConfig = { mode: mode.value, primaryColor: primaryColor.value };
      writeState(THEME_NS, config);
    },
    { flush: 'post' },
  );

  return { mode, primaryColor, isDark, setPrimaryColor, setMode, resetPrimaryColor };
});
