---
name: engineering-config
description: Toolbox 的工程配置——Pinia、Tailwind v4、naive-ui、@vicons、ESLint flat config、Prettier 的接入方式与约定
---

# 工程配置（P0-2）

在脚手架（见 [[project-scaffold]]）之上接入状态管理、UI、样式与 lint/format 工具链。

## 接入清单与入口

- **Pinia**：`src/main.ts` 中 `app.use(createPinia())`；store 放 `src/stores/*.ts`（setup store 风格），示例 `src/stores/app.ts`。
- **naive-ui**：按需从 `naive-ui` 导入组件（`NButton`/`NConfigProvider` 等）；深色主题用 `darkTheme` + `n-config-provider`。未做全局自动注册，按需导入即可（tree-shaking 友好）。
- **@vicons/ionicons5**：图标组件包在 `n-icon` 内使用，如 `<n-icon><ConstructOutline /></n-icon>`。
- **Tailwind v4**：CSS-first，无 tailwind.config.js。入口 `src/assets/styles/tailwind.css`（仅一行 `@import 'tailwindcss'`），PostCSS 插件 `@tailwindcss/postcss`（见 `postcss.config.mjs`）。
- **SCSS**：`src/assets/styles/index.scss` 用 `@use` 聚合 `reset/tokens/theme`。

## 样式目录

```
src/assets/styles/
  tailwind.css   # 仅 @import 'tailwindcss'，单独引入（勿混入 scss）
  index.scss     # @use reset/tokens/theme 聚合
  reset.scss     # 基础重置
  tokens.scss    # 设计 tokens 占位（完整黑紫体系在 P0-3）
  theme.scss     # 主题占位（P0-3 完善）
```

main.ts 引入顺序：先 `tailwind.css` 再 `index.scss`。

## ESLint / Prettier

- **ESLint**：flat config，文件 `eslint.config.mjs`（用 `.mjs` 免 jiti 依赖）。
  组合：`@vue/eslint-config-typescript` 的 `defineConfigWithVueTs` + `vueTsConfigs.recommended` + `eslint-plugin-vue` flat/recommended + `@vue/eslint-config-prettier/skip-formatting`（须放最后，关掉与 Prettier 冲突的规则）。
  自定规则：`consistent-type-imports`（inline type imports）、`no-explicit-any` warn、关闭 `vue/multi-word-component-names`。
- **Prettier**：`.prettierrc`——`semi:true` / `singleQuote:true` / `tabWidth:2` / `printWidth:100` / `trailingComma:'all'` / `arrowParens:'always'` / `endOfLine:'lf'`。
- 脚本：`pnpm lint`（eslint --fix）、`pnpm format`（prettier --write）。

## 关键约定 / 踩坑

- **Tailwind 入口不能放进 SCSS**：`@import 'tailwindcss'` 若被 Sass 处理会触发 `@import` 弃用警告，且与 `@use` 的"须在最前"规则冲突。因此 Tailwind 单独用 `.css` 文件、SCSS 用 `@use`，两者在 main.ts 分别引入。
- **ESLint 配置用 `.mjs`**：`.ts` 配置需要 jiti，避免额外依赖。
- Tailwind 是 v4（CSS-first），网上大量 v3 教程（`tailwind.config.js` + `@tailwind base` 三段式）不适用。
- 验证命令全绿标准：`pnpm format && pnpm lint && pnpm typecheck && pnpm build` 无 error/warning。

## 验证页

`src/App.vue` 演示 naive-ui 组件 + vicons 图标 + Tailwind class + Pinia store + IPC，均正常即通过。
