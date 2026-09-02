---
name: home-page
description: Toolbox 首页——推荐工具(tab)、最近使用、使用统计(SVG 环形图)，使用记录本地持久化 + 路由守卫埋点
---

# 首页（P1-6）

首页展示：欢迎语 + 使用概览、推荐工具（分类 tab）、最近使用、使用统计环形图。基于 [[common-capabilities]]、[[app-layout]]。

## 决策

- **推荐区**：静态配置（真实工具）。
- **最近使用 + 统计**：走本地使用记录（持久化到数据保存目录，见 [[app-storage]]），无数据显示空态。
- **环形图**：纯 SVG 自绘，不引图表库。

## 文件与职责

- `src/types/usage.d.ts` — `UsageRecord`（key/count/lastUsedAt）、`CategoryUsage`。
- `src/stores/usage.ts` — `useUsageStore`：records（持久化到 `app-state.json` 的 `usage` 命名空间，见 [[app-storage]]）；getter `totalCount`/`recentTools`(近10,按时间倒序)/`categoryUsage`(按顶级分类聚合占比)；action `recordUsage(key, at)`/`clear`。**`at` 由调用方传时间戳**（store 内不直接取时间）。
- `src/utils/navigation.ts` — `TOOL_MAP`/`getTool(key)`：扁平化 NAV_ITEMS，每个工具带 `category`/`categoryLabel`（顶级分类）。统计聚合与埋点都靠它。
- `src/constants/recommend.ts` — `RECOMMEND_GROUPS`：推荐/图片处理/文件管理等 tab 分组的工具卡片。随工具开发补充。
- `src/utils/format.ts` — 新增 `formatRelativeTime(ts, now?)`（刚刚/N分钟前/…/日期）。
- `src/components/common/DonutChart.vue` — 纯 SVG 环形图：props `segments`(key/value/color)/`total`/`unit`/`size`/`thickness`；用 stroke-dasharray + dashoffset 画弧，中心显示总数。
- `src/composables/useToolLauncher.ts` — `openTool(key, path?)`：**只跳转**，不记录（避免与路由守卫重复计数）。
- `src/views/HomeView.vue` — 组装上述区块。

## 使用埋点（关键）

**在 `src/router/index.ts` 的 `afterEach` 守卫单点埋点**：进入带 `meta.navKey` 且在 TOOL_MAP 中的工具页时 `recordUsage`。这样首页卡片、最近使用、侧栏菜单**所有入口**都只计一次，不重复。首页/设置/关于不计。

## 关键约定

- 新增推荐工具：改 `RECOMMEND_GROUPS`（key 用 NavItem.key，保证跳转与埋点一致）。
- 统计分类来自 `getTool(key).category`，即工具在 NAV_ITEMS 的顶级分组——加新工具自动归类，无需改统计逻辑。
- 记录时间戳由调用方传入（`recordUsage(key, Date.now())`），符合"工具函数/ store 不内联取时间"的可测性约定。

## 边界 / 后续

- 推荐卡片图标目前用 vicons，视觉与 design.png 的彩色方块图标有差异，后续如需更贴图可换。
- "使用统计"仅按次数；若后续要按"节省体积/时长"等维度，扩展 usage store 的记录字段即可。
- 最近使用暂无"清空"入口 UI（store 有 clear action），需要时加。

## 验证

`format/lint/typecheck/build/dev` 全绿。首次进入无记录→最近使用/统计显示空态；点推荐卡片跳转并计数，返回首页可见最近使用与环形图；刷新后保持（持久化）。
