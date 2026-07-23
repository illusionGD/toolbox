---
name: common-capabilities
description: Toolbox 通用能力——文件对话框/拖拽 IPC、渲染进程服务层、FileList/TaskProgress/StatusTag 通用组件、设置页
---

# 通用能力（P0-5）

给所有工具页打地基：文件选择/拖拽、通用文件列表、任务进度、设置页。基于 [[app-layout]]。

## 主进程 / IPC / 共享

- `electron/shared/channels.ts` — 新增 `DIALOG_CHANNELS`（openFiles / openDirectory）。
- `electron/shared/types.ts` — **主/渲染共享类型**：`OpenFilesOptions`、`PickedFile`（path/name/size/ext）。
- `electron/main/ipc/dialog.ts` — `registerDialogIpc(win)`：选文件（含 filters/multiple）返回 `PickedFile[]`（主进程 `stat` 补 size）、选文件夹返回路径。
- `electron/preload/index.ts` — 暴露 `window.api.dialog.{openFiles,openDirectory}` 与 `window.api.getPathForFile(file)`（用 `webUtils.getPathForFile`，因 `File.path` 在 Electron 已废弃）。

## @shared 别名

渲染进程可 `import ... from '@shared/types'` 复用主/渲染共享类型。配置两处：`electron.vite.config.ts` 的 renderer.resolve.alias + `tsconfig.web.json` 的 paths & include（`electron/shared/*.ts`）。

## 渲染进程

- `src/services/fs.ts` — 服务层门面：`pickFiles()` / `pickDirectory()` 包裹 `window.api`，**业务不直接碰 window.api**（便于后续加权限/日志/mock，呼应账号骨架）。
- `src/types/file.d.ts` — `TaskStatus`（pending/processing/done/error）、`FileItem extends PickedFile`（+id/status/progress/error）。
- `src/utils/format.ts` — `formatBytes()`。
- `src/composables/useFileDrop.ts` — `useFileDrop({onDrop, accept})`：返回 `isDragOver` + dragover/dragleave/drop 处理器；用 `getPathForFile` 解析拖入文件为 `PickedFile[]`，按 accept 扩展名过滤。
- `src/composables/useToolConfig.ts` — `useToolConfig(toolKey, defaults)`：**工具页配置持久化**。返回 `{ config, reset }`，config 是 reactive 对象，改动即写 `localStorage`（key `toolbox.config.<toolKey>`）；读取时与 defaults 浅合并（新增字段自动拿默认、废弃字段忽略）。工具页"记住上次配置"统一用它。
- `src/components/common/`：
  - `FileList.vue` — 操作栏（添加文件/文件夹/清空）+ 拖拽区 + `n-data-table` + 底部统计。**props**：`items`、`columns?`(自定义列，默认名/大小/状态/操作)、`accept?`、`acceptLabel?`；**emits**：`add`/`remove`/`clear`。父组件持有 items 并处理去重。
  - `TaskProgress.vue` — 进度条，按 `status` 着色。
  - `StatusTag.vue` — 任务状态标签（待处理/处理中/已完成/失败）。
- `src/views/SettingsView.vue` — 设置页，接入主题主色（预设+取色器+恢复默认），已替换路由占位。

## 关键约定

- **文件数据流**：FileList 是「受控」组件——父持有 `items`，通过 emit `add/remove/clear` 更新；列表项状态/进度由父在处理时回写。
- **服务层优先**：渲染进程访问系统能力走 `src/services/*`，不直接调用 `window.api.*`。
- **共享类型放 `electron/shared`**，用 `@shared/*` 引用，避免主/渲染类型漂移。
- 拖拽取路径必须用 `window.api.getPathForFile`，不要用 `file.path`。

## 边界 / 后续

- 「添加文件夹」当前仅返回路径并提示，**递归扫描目录内文件**交由具体工具按需实现（不同工具接受的扩展名不同）。
- FileList 未内置分页/多选/排序，需要的工具页自行通过 `columns` 或包装扩展。
- 实际处理逻辑（压缩等）由各工具的主进程 handler + services 提供，此处只有 UI 骨架。

## 验证

`format/lint/typecheck/build/dev` 全绿。设置页可改主题色并持久化；FileList 的完整交互在 P1 图片压缩页首次实际接入验证。
