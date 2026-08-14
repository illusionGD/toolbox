---
name: file-stats
description: Toolbox 文件统计工具（文件工具下）——递归扫描目录按后缀聚合数量/大小，前端过滤、展开明细虚拟滚动、进度与取消、CSV/JSON 导出
---

# 文件统计（文件工具）

选文件夹 → 主进程递归扫描 → 按后缀聚合数量与总大小 → 前端过滤 / 展开看明细 / 导出报告。基于 [[app-layout]] 的 ToolPageLayout，IPC 遵循 [[ipc-contract]]，页面结构参照 [[image-compress]]。

## 数据流

**一次扫描拿全量，过滤只在前端做**（改包含/排除后缀不重扫）。扫描选项（隐藏文件/忽略目录）才需要重扫，面板上分成两组并标注。

```
pickDirectoryApi → scanDirApi(ScanOptions) → ScanResult（内存中保留）
                                              ↓ computed
                          aggregateByExt(result, {include, exclude}) → ExtGroup[]
```

## 主进程 `electron/main/ipc/file.ts`

- **dirIndex 压缩**：`ScanFileEntry` 只存 `name + dirIndex`，目录路径去重后放 `ScanResult.dirs`。十万级文件时避免每条重复带一份长路径，IPC 序列化体积和内存都差一个量级。渲染侧 `fileStats.ts` 的 `joinPath()` 再拼回绝对路径（渲染进程没有 `path` 模块，按目录里的分隔符判平台）。
- **并行 stat**：同目录内的文件用 `Promise.all` 批量 stat，比逐个 await 快很多；目录之间仍是串行递归（并行递归会让并发的 fd 数失控）。
- **取消**：模块级 `Map<scanId, {canceled}>`，`cancelScan` 置位，`walk` 每层入口和子目录循环里检查。取消不是错误——照常返回已扫到的部分并置 `canceled: true`，让前端展示部分结果。
- **进度**：`win.webContents.send`，节流为「距上次 ≥300ms 或 新增 ≥2000 个文件」。不节流会在扫 node_modules 时每毫秒发一次把渲染进程压垮。
- **符号链接**：`entry.isFile()` 为假的一律跳过，既不下探也不计数 —— 防目录环。
- **容错**：单目录 readdir/stat 失败（EPERM 等）记入 `errors` 继续走，不让一个受限目录废掉整次扫描；`errors` 只回传前 50 条。
- **上限**：`maxFiles` 默认 20 万，超出置 `truncated: true`。**不静默截断**，页脚明确提示结果不完整。
- **saveText**：`dialog.showSaveDialog` + `writeFile`。**CSV 必须写 UTF-8 BOM**（`﻿`），否则 Excel 按本地编码解析，中文全乱码。

## 渲染进程

- `src/services/file.ts`：`scanDirApi / cancelScanApi / showInFolderApi / saveTextApi / onScanProgress`，经 `unwrap`。取消用 `silent: true`（失败无需打扰，扫描本身会正常收尾）。
- `src/utils/fileStats.ts`（纯函数）：`aggregateByExt` / `buildTotals` / `collectExtOptions` / `toCsv` / `toJson`。无扩展名归为 `(无扩展名)`（`ext === ''`）。
- `src/views/file/FileStatsView.vue`：
  - 主表 = 后缀分组，`type: 'expand'` 的 `renderExpand` 内嵌明细 `n-data-table`，**开 `virtual-scroll` + `maxHeight`** —— 单个后缀几万条明细也不卡。明细数据来自内存，展开不走 IPC。
  - **多选（`type: 'selection'`）**：勾选若干后缀后，页脚切换为「选中汇总」（类数/文件数/大小 + 占全部的数量与大小百分比），右侧占比图与导出也自动收敛到选中范围（沿用 image-compress 的「有勾选就只处理选中」约定）。`selectedGroups` 用 `groups.filter` 而非直接取 keys —— 过滤条件变化后失效的勾选会自然被忽略，不会统计到已被过滤掉的后缀。重新扫描/清空时清空勾选。
  - 进度订阅在 setup 期建立，回调里**用 `scanId` 过滤**，避免上一次扫描的滞后推送污染新扫描的进度。`onUnmounted` 同时退订 + 取消进行中的扫描。
  - 配置经 `useToolConfig`（`src/composables/useToolConfig.ts`，见 [[image-compress]]）持久化。`ignoreDirs` 传给 IPC 前要 `JSON.parse(JSON.stringify())` —— reactive Proxy 无法结构化克隆（同 image-compress 的坑）。
- `src/constants/chart.ts`（新增）：把原先写死在 `HomeView.vue` 里的 `CATEGORY_COLORS` / `colorAt()` 提出来共用。`DonutChart` 的 `total` prop 放宽为 `number | string`，以便按大小时直接显示 `1.25 GB`。

## 边界 / 后续

- 只按**后缀**归类，不识别文件真实类型（改过扩展名的会归错组）。
- 没做「按大类聚合」（图片/视频/文档），需要的话在 `fileStats.ts` 加一层 ext → category 映射即可。
- 明细排序只在展开的单组内生效，不跨组。
- 未做重复文件检测、空文件夹清理。

## 验证

`format / lint / typecheck / build` 全绿。功能需人工：选目录看数量大小是否对得上、扫大目录时取消能停、过滤即时联动不重扫、CSV 用 Excel 打开中文正常、明细「在资源管理器中显示」能定位。
