import { computed, watch } from 'vue';
import { darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import { storeToRefs } from 'pinia';
import { useThemeStore } from '@/stores/theme';
import { darken, lighten, withAlpha } from '@/utils/color';

/**
 * 主题应用 composable：
 * - 根据主题 store 的主色派生 naive-ui 的主题与 overrides；
 * - 把主色相关的值同步为 `:root` 上的 CSS 变量，供 SCSS/Tailwind 使用。
 *
 * 在根组件（App.vue）调用一次即可。
 * @returns naive-ui 所需的 theme 与 themeOverrides（响应式）。
 */
export function useTheme() {
  const themeStore = useThemeStore();
  const { primaryColor, isDark } = storeToRefs(themeStore);

  // 当前仅深色，light 预留：始终返回 darkTheme
  const naiveTheme = computed(() => (isDark.value ? darkTheme : darkTheme));

  const themeOverrides = computed<GlobalThemeOverrides>(() => {
    const primary = primaryColor.value;
    const hover = lighten(primary, 0.12);
    const pressed = darken(primary, 0.12);
    const suppl = lighten(primary, 0.2);
    return {
      common: {
        primaryColor: primary,
        primaryColorHover: hover,
        primaryColorPressed: pressed,
        primaryColorSuppl: suppl,
      },
    };
  });

  /** 将主色派生变量写入 :root，供非 naive-ui 的样式复用。 */
  function syncCssVars(primary: string): void {
    const root = document.documentElement;
    root.style.setProperty('--tb-color-primary', primary);
    root.style.setProperty('--tb-color-primary-hover', lighten(primary, 0.12));
    root.style.setProperty('--tb-color-primary-pressed', darken(primary, 0.12));
    root.style.setProperty('--tb-color-primary-soft', withAlpha(primary, 0.16));
  }

  watch(primaryColor, (val) => syncCssVars(val), { immediate: true });

  return { naiveTheme, themeOverrides };
}
