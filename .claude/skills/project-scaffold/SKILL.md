---
name: project-scaffold
description: Toolbox 桌面应用的 electron-vite + Vue3 + TS 脚手架结构、构建脚本与已知启动问题
---

# 项目脚手架（P0-1）

Toolbox 的基础工程结构，基于 electron-vite 三段式（main / preload / renderer）。

## 用途与入口

- 提供可运行的 Electron + Vue3 + TS 空壳，主/渲染进程通过 IPC 打通。
- 验证页：`src/App.vue`（"测试 IPC 通信"按钮，点击调用主进程 `app:ping` 返回 `pong`）。

## 目录结构

```
electron/
  main/index.ts        # 主进程：创建窗口、注册 IPC（示例 app:ping）
  preload/index.ts     # 预加载：contextBridge 暴露 window.electron / window.api
  preload/index.d.ts   # window 上 electron/api 的类型声明
src/
  main.ts              # 渲染进程入口，createApp(App).mount('#app')
  App.vue              # 脚手架验证页
  env.d.ts             # vite client 类型 + *.vue 声明
index.html             # 渲染进程 HTML（放在项目根，config 里显式指定 root/input）
electron.vite.config.ts# 三段式构建配置 + @ 别名 + scss modern-compiler
tsconfig.json          # references 指向 node/web 两份
tsconfig.node.json     # 主进程/preload（electron-toolkit/tsconfig node）
tsconfig.web.json      # 渲染进程（vue-tsc 用），含 @/* 路径
```

## 关键实现与依赖

- **electron-vite** 负责 main/preload/renderer 三段式构建与 dev HMR。
- **@electron-toolkit/utils@^4**（不要用 3.0.0）、`@electron-toolkit/preload`、`@electron-toolkit/tsconfig`。
- **sass-embedded** 提供 SCSS（App.vue 用 `lang="scss"`），config 中设 `scss.api: 'modern-compiler'` 避免 legacy 警告。
- 路径别名 `@` → `src`（config + tsconfig.web.json paths 双处配置）。

## 构建脚本

- `pnpm dev`：electron-vite dev，起 renderer dev server + Electron。
- `pnpm build`：三段式生产构建，产物在 `out/{main,preload,renderer}`。
- `pnpm typecheck`：`typecheck:node`(tsc) + `typecheck:web`(vue-tsc)。

## 边界与已知限制 / 调试要点

- **不要给 package.json 加 `"type": "module"`**：会让主进程输出 ESM，Electron 的 ESM/CJS 混用加载器会崩（`Cannot read properties of undefined (reading 'exports')`）。保持 CJS 输出，main/preload 均为 `.js`。
- **环境变量 `ELECTRON_RUN_AS_NODE=1` 会让 electron.exe 以纯 Node 运行**，表现为 `electron.app` 为 undefined、`electron --version` 返回 Node 版本。启动前需 `unset ELECTRON_RUN_AS_NODE`。这是某些开发 shell 的环境问题，非项目问题。
- 无头/沙箱环境下 dev 会刷 `Unable to move the cache` / `GPU process exited` 报错，属正常噪音，不影响窗口。
- pnpm 10 需在 package.json 的 `pnpm.onlyBuiltDependencies` 列出 `electron`、`esbuild` 才会跑其 postinstall；electron 二进制下载可能因镜像超时，必要时用官方源重试 `install.js`。

## 后续（P0-2 起接入）

Pinia / Tailwind / naive-ui / @vicons / ESLint / Prettier、主题系统、整体布局、账号计费骨架，均在此脚手架上叠加。
