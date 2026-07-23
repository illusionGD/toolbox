---
name: app-layout
description: Toolbox 整体布局——无边框自绘窗控、顶部栏、左侧导航、hash 路由骨架与导航元数据
---

# 整体布局（P0-4）

应用外壳：无边框窗口 + 顶部栏（logo/搜索/窗控）+ 左侧导航 + 内容区路由。基于 [[theme-system]]。

## 决策

- **无边框自绘窗控**：主进程 `frame: false`，窗控按钮在渲染进程自绘，通过 IPC 调用。
- **hash 路由**：`createWebHashHistory`，避免 Electron 打包后 file:// 下的深链/刷新 404。

## 主进程 / IPC

- `electron/shared/channels.ts` — **通道名单一来源**（main 与 preload 共同 import），含 `WINDOW_CHANNELS` / `APP_CHANNELS`。
- `electron/main/ipc/window.ts` — `registerWindowControlIpc(win)`：注册 minimize/toggleMaximize/close/isMaximized，并在 maximize/unmaximize 时向渲染进程推送状态。
- `electron/main/index.ts` — 窗口 `frame:false` + `transparent:true`（让 DOM 圆角透出），创建后调用 `registerWindowControlIpc`。
- `src/composables/useWindowControls.ts` — 共享最大化状态 + minimize/toggleMaximize/close，引用计数管理监听。TitleBar 与 AppLayout 共用。
- `electron/preload/index.ts` — 暴露 `window.api.window.{minimize,toggleMaximize,close,isMaximized,onMaximizeChange}`；`onMaximizeChange` 返回取消订阅函数。

## 渲染进程结构

- `src/types/navigation.d.ts` — `NavItem`（key 兼作 featureKey）、`FeatureTier`（free/pro，计费骨架预留）。
- `src/constants/navigation.ts` — `NAV_ITEMS` 工具菜单树（首页 + 图片/文件/字体/媒体/网络工具 + 开发/系统/更多）。**新增工具在此登记**。
- `src/router/index.ts` — 从 `NAV_ITEMS` 递归生成叶子路由，未实现的指向 `PlaceholderView`；含 home/settings/about + 通配回退。
- `src/views/HomeView.vue`、`PlaceholderView.vue`（读 `route.meta.title`）。
- `src/components/layout/`：
  - `TitleBar.vue` — logo + 搜索框 + 窗控按钮；整条 `-webkit-app-region: drag`，交互控件 `no-drag`。
  - `SideNav.vue` — `n-menu` 由 NAV_ITEMS 驱动，settings/about 固定底部；`activeKey` 取 `route.meta.navKey`，选中跳路由。
  - `AppLayout.vue` — 组装 TitleBar + SideNav + `<router-view>` 内容区。
- `src/App.vue` — `n-config-provider`(主题+zhCN locale) + message/dialog provider 包裹 `AppLayout`。

## 关键约定 / 注意

- **圆角外壳**：无边框窗口 `transparent:true` + body `background:transparent`，圆角/边框由 `.app-layout` 承载（`--tb-radius-window`），`overflow:hidden` 裁切子元素。**最大化时** `.app-layout--maximized` 取消圆角与边框（据 `useWindowControls().isMaximized`）。透明窗口下 `backgroundColor` 不可设不透明色。
- **拖拽区**：无边框窗口靠 `-webkit-app-region: drag` 移动窗口，所有可点击控件必须 `no-drag`，否则点不动。
- **通道名勿硬编码**：统一从 `electron/shared/channels.ts` 引用，main/preload 两侧一致。
- **新增页面流程**：① 在 `NAV_ITEMS` 加项（带 path）② 路由自动生成占位 ③ 开发时把该 path 的 component 换成真实页面。
- `route.meta.navKey` 是导航高亮与占位标题的依据，新路由需带上 `meta.title` + `meta.navKey`。

## 边界 / 后续

- 顶部搜索框目前仅 UI，搜索逻辑后续接入。
- 账号入口（头像/登录）UI 归入账号骨架任务；设置/关于页为占位（设置页 P0-5、账号骨架 P0 末）。
- 无边框窗口在 Windows 下自绘窗控；macOS 若需红绿灯位后续再适配。

## 验证

`format/lint/typecheck/build/dev` 全绿。人工验证：窗控按钮可最小化/最大化(图标切换)/关闭、标题栏可拖拽、左侧菜单展开跳转、内容区显示占位页。
