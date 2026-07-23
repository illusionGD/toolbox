# Toolbox 开发进度（Progress）

> 配合 [PLAN.md](./PLAN.md) 使用。PLAN 定"做什么、什么优先级"，本文件跟踪"做到哪、卡在哪"。
> 状态图例：⬜ 未开始 · 🟡 进行中 · 🔵 待 review · ✅ 已完成 · ⛔ 卡住 · ⏸ 暂缓

**最后更新**：2026-07-16

---

## 当前进展

- **当前里程碑**：M1（首页 + 图片压缩）
- **当前任务**：P1-7「图片压缩」🔵 待 review
- **下一步**：review 通过后 M1 完成，进入 M2（图片工具其余：格式转换/裁剪/风格化/精灵图）

---

## 交付标准提醒（每个功能都要满足）

1. 功能可用，通过 review + debug
2. ESLint + Prettier 格式化，符合 `.claude/rules`
3. 写一份 skill 到 `.claude/skills/<skill-name>/SKILL.md`
4. 更新本进度文档

---

## 任务清单与状态

### P0 · 基础框架 — M0
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 1 | 项目脚手架（electron-vite + Vue3 + TS + pnpm） | 🔵 | ✅ | 待 review；build/typecheck/dev 均通过 |
| 2 | 工程配置（Pinia/Tailwind/SCSS/naive-ui/@vicons/ESLint/Prettier） | 🔵 | ✅ | 待 review；format/lint/typecheck/build 均通过 |
| 3 | 主题系统（黑/紫 tokens，切换基础） | 🔵 | ✅ | 待 review；深色+主题色预设/自定义+持久化 |
| 4 | 整体布局（顶部栏+窗口控制、左侧导航、路由骨架） | 🔵 | ✅ | 待 review；无边框窗控+顶部栏+侧栏+hash 路由 |
| 5 | 通用能力（IPC 封装、文件选择/拖拽、文件列表、进度、设置页骨架） | 🔵 | ✅ | 待 review；dialog IPC/服务层/useFileDrop/FileList/进度/设置页 |
| - | 账号/计费**骨架预留**（权限门面/user store/服务层/ProGuard/env 开关） | 🔵 | ✅ | 待 review；默认关闭全放行，见 PLAN 4.1 |

### P1 · 首页 + 图片工具 — M1/M2
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 6 | 首页（推荐/最近使用/使用统计） | 🔵 | ✅ | 待 review；本地使用记录 + SVG 环形图 + 路由守卫埋点 |
| 7 | 图片压缩（子页面模板） | 🔵 | ✅ | 待 review；sharp 主进程压缩 + ToolPageLayout 模板 + 对比预览 |
| 8 | 图片格式转换 | ⬜ | ⬜ | |
| 9 | 裁剪图片（透明区域+阈值） | ⬜ | ⬜ | |
| 10 | 风格化图片（马赛克/模糊等） | ⬜ | ⬜ | |
| 11 | 精灵图（合并/可视化切割导出） | ⬜ | ⬜ | 较复杂 |

### P2 · 文件工具 — M3
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 12 | 批量重命名 | ⬜ | ⬜ | |
| 13 | word 转 pdf | ⬜ | ⬜ | |
| 14 | pdf 转 word | ⬜ | ⬜ | |
| 15 | excel | ⏸ | - | 需求待定 |

### P3 · 字体工具 — M4
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 16 | 字体裁剪 | ⬜ | ⬜ | |
| 17 | 字体格式转换 | ⬜ | ⬜ | |
| 18 | 位图字体（图集+.fnt） | ⬜ | ⬜ | 较复杂 |

### P4 · 媒体工具 — M5
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 19 | 视频工具（压缩/转码/裁剪/预览，ffmpeg） | ⬜ | ⬜ | |
| 20 | 音频工具（压缩/转码/裁剪/预览） | ⬜ | ⬜ | |

### P5 · 网络工具及其他 — M6
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 21 | host 工具（类 SwitchHosts，需权限） | ⬜ | ⬜ | |
| 22 | 其他工具 | ⏸ | - | 待定 |

### P6 · AI 赋能 — M8+
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 23 | AI 能力接入点 | ⏸ | - | 待定 |

### P7 · 账号与计费（后端就绪后） — M7
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 24 | 账号体系（登录/注册/token） | ⬜ | ⬜ | 依赖后端 |
| 25 | 计费与权限（套餐/额度/付费墙） | ⬜ | ⬜ | 依赖后端 |

---

## 卡点记录（Blockers）

> 格式：`[日期] #任务 - 描述 - 状态/结论`

- 暂无。

---

## 决策与变更记录（Changelog）

- `2026-07-16` 初版 PLAN 与 PROGRESS 建立。
- `2026-07-16` 确认：electron-vite / 主进程 sharp+ffmpeg / 打包 ffmpeg / 暂不做自动更新与多语言。
- `2026-07-16` 追加账号与计费（P7），P0 阶段预留横切骨架。
- `2026-07-16` 约定：每个功能完成需随附一份 skill（`.claude/skills/`）。
- `2026-07-17` P0-1 脚手架完成：electron-vite 三段式跑通，build/typecheck/dev 通过。踩坑：勿加 `"type":"module"`（Electron ESM 崩）、`@electron-toolkit/utils` 用 ^4、shell 的 `ELECTRON_RUN_AS_NODE=1` 需 unset。
- `2026-07-17` P0-2 工程配置完成：Pinia + Tailwind v4(CSS-first) + naive-ui + @vicons + ESLint flat config + Prettier。约定 ESLint flat config、Prettier 分号+单引号+2空格+printWidth100。踩坑：Tailwind 入口单独 .css（勿混 SCSS 的 @use）、eslint config 用 .mjs。
- `2026-07-17` P0-3 主题系统完成：确认只做深色（预留 light）、主题色预设+自定义取色。落地 color 工具/theme 类型常量/theme store(持久化)/useTheme composable/完整黑紫 tokens。CSS 变量为自定义样式统一出口。
- `2026-07-17` P0-4 整体布局完成：确认无边框自绘窗控 + hash 路由。落地 window IPC(shared/channels 单一来源)、NAV_ITEMS 导航树(key 兼 featureKey)、路由骨架(占位页)、TitleBar/SideNav/AppLayout。新增页面流程：NAV_ITEMS 登记→路由自动占位→替换真实组件。
- `2026-07-17` P0-4 追加：整体圆角外壳（transparent 窗口 + .app-layout 圆角，最大化取消），窗控状态抽为 useWindowControls。配色改为中性黑灰、紫色仅作强调（design.png 对齐）。
- `2026-07-17` P0-5 通用能力完成：dialog IPC(选文件/文件夹)、@shared 别名、services/fs 服务层门面、useFileDrop(webUtils.getPathForFile)、FileList/TaskProgress/StatusTag 通用组件、SettingsView(主题设置)。约定：业务走 services 不直连 window.api；FileList 为受控组件。
- `2026-07-17` P0 账号骨架完成：env 开关(默认关)、account 类型、auth/billing 服务层(mock)、user store、useEntitlement 权限门面(can)、ProGuard、AccountEntry。原则：调用方无感/默认放行/可开关；收费与否是 NAV_ITEMS 的 tier 数据。**至此 P0 基础框架全部完成。**
- `2026-07-17` P1-6 首页完成：确认推荐真实+统计本地+SVG 环形图。落地 usage store(localStorage)、navigation 扁平化工具(TOOL_MAP/分类)、RECOMMEND_GROUPS、DonutChart、useToolLauncher；**埋点统一在路由 afterEach 守卫**（所有入口只计一次）。
- `2026-07-17` P1-7 图片压缩完成：确认输出 JPG/PNG/WebP/AVIF、缩略图+对比大图、抽 ToolPageLayout 模板。**sharp 已验证 Electron 运行时可用(含 AVIF)**，走主进程 externalize。落地 image IPC(缩略图/压缩/预览)、ToolPageLayout、ImageCompressView、ImagePreviewModal；路由 TOOL_COMPONENTS 映射真实页。覆盖原文件需 toBuffer 中转。**M1 完成。**
- `2026-07-17` P1-7 优化：面包屑缩小；新增 **useToolConfig** hook（工具配置 localStorage 持久化，通用）；CompressOptions 增 **FormatAdvanced**（各格式高级选项，按格式 n-collapse 展开），压缩页全参数经 useToolConfig 记忆。
- `2026-07-17` IPC 统一返回契约：业务 IPC 统一 `{code,data,message}`。主进程 `handle` wrapper 自动包裹/catch；渲染 `unwrap` 解包 + 全局 feedback 统一提示（silent 可关，默认显示）；dialog/image 全量改造。见 skill ipc-contract。
