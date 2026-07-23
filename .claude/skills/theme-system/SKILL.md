---
name: theme-system
description: Toolbox 主题系统——黑/紫深色 tokens、主题主色（预设+自定义取色）、Pinia 持久化与 naive-ui 联动
---

# 主题系统（P0-3）

深色（黑/紫）主题体系，支持主题主色的预设选择与自定义取色，配置持久化到 localStorage，并与 naive-ui 联动。基于 [[engineering-config]]。

## 范围与决策

- **仅深色**：`ThemeMode` 定义了 `dark | light`，但当前只实现 dark；light 结构已在类型、store、tokens、composable 各处预留（`useTheme` 里 light 也返回 darkTheme，tokens 预留 `[data-theme='light']` 扩展位）。
- **主题色**：6 个预设色 + naive-ui `n-color-picker` 自定义取色，存 Pinia 并持久化。

## 文件与职责

- `src/types/theme.d.ts` — `ThemeMode` / `ThemePreset` / `ThemeConfig` 类型。
- `src/constants/theme.ts` — `DEFAULT_PRIMARY_COLOR`(#7c3aed)、`THEME_STORAGE_KEY`、`THEME_PRESETS`。
- `src/utils/color.ts` — 纯函数：`hexToRgb`/`rgbToHex`/`lighten`/`darken`/`withAlpha`/`isValidHex`。
- `src/stores/theme.ts` — `useThemeStore`：state `mode`/`primaryColor`，getter `isDark`，action `setPrimaryColor`/`setMode`/`resetPrimaryColor`；启动读 localStorage，`watch` 变化即写回。
- `src/composables/useTheme.ts` — `useTheme()`：由主色派生 naive-ui `themeOverrides`（primaryColor + hover/pressed/suppl），并把主色相关值写入 `:root` 的 CSS 变量。**在 App.vue 调用一次**。
- `src/assets/styles/tokens.scss` — 完整深色 tokens（背景层级、文本层级、边框、圆角、间距；主色变量运行时由 JS 注入，SCSS 里给兜底默认）。
- `src/assets/styles/theme.scss` — 应用 tokens 到 body + 自定义滚动条。

## 关键约定

- **主色单一数据源是 store**，`useTheme` 派生 naive-ui overrides + CSS 变量两条出口，二者保持一致。
- 非 naive-ui 的自定义样式统一用 CSS 变量（`var(--tb-color-primary)` / `--tb-bg-*` / `--tb-text-*` 等），不要硬编码颜色。
- 持久化 `watch` 用 `flush: 'post'`；读取时对非法 mode/hex 一律回退默认（`loadThemeConfig`）。
- naive-ui 组件必须包在 `n-config-provider`（绑定 `naiveTheme` + `themeOverrides`）内才应用主题。

## 边界 / 后续

- light 主题、跟随系统：类型与结构已留，未实现。
- 主题设置的正式 UI 归入 P0-5「设置页」；当前 App.vue 是临时验证页，P0-4 布局时替换。
- CSS 变量清单见 tokens.scss，新增颜色前先复用既有变量。

## 验证

App.vue 验证页：点预设色/取色器 → naive-ui 组件与标题图标即时变色 → 刷新后保持（持久化生效）。`format/lint/typecheck/build` 全绿。
