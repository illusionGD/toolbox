# Toolbox 开发进度（Progress）

> 配合 [PLAN.md](./PLAN.md) 使用。PLAN 定"做什么、什么优先级"，本文件跟踪"做到哪、卡在哪"。
> 状态图例：⬜ 未开始 · 🟡 进行中 · 🔵 待 review · ✅ 已完成 · ⛔ 卡住 · ⏸ 暂缓

**最后更新**：2026-08-21

---

## 当前进展

- **当前任务**：#11 精灵图（合并图集 / 切割图集）🔵 待 review —— 网格合并 + JSON/CSS/plist 坐标；四种切割（网格/切割线/导入坐标/透明连通域）；含 SpriteSliceCanvas 画布，已配 skill。
- **下一步**：P1 图片工具至此全部完成。按 PLAN 优先级进入 P2 剩余（#13 word 转 pdf / #14 pdf 转 word）或按用户插队安排。

---

## 交付标准提醒（每个功能都要满足）

1. 功能可用，通过 review + debug
2. ESLint + Prettier 格式化，符合 `.claude/rules`
3. 写一份 skill 到 `.claude/skills/<skill-name>/SKILL.md`
4. 更新本进度文档

---

## 任务清单与状态

> 完成态的历史细节已归档到各自 skill；本表只留状态与一句备注。

### P0 · 基础框架 — M0（全部完成，🔵 待 review）
脚手架 / 工程配置 / 主题系统 / 整体布局 / 通用能力 / 账号计费横切骨架，均已 skill 化，build/typecheck/lint 通过。

### P1 · 首页 + 图片工具 — M1/M2
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 6 | 首页（推荐/最近使用/使用统计） | 🔵 | ✅ | |
| 7 | 图片压缩 / 转换（#8 格式转换并入本页） | 🔵 | ✅ | |
| 9 | 裁剪图片 | 🔵 | ✅ | 自动去边 + 手动拉框 |
| 10 | 风格化图片 | 🔵 | ✅ | 11 种可叠加 + 局部打码 |
| 11 | 精灵图（合并/可视化切割导出） | 🔵 | ✅ | 待 review；网格合并+JSON/CSS/plist 坐标；四种切割（网格/切割线/导入坐标/透明连通域）+ canvas 画布 |
| Q | 二维码（生成/解析） | 🔵 | ✅ | 待 review；多行批量生成(qrcode，预览/命名/PNG-JPG-SVG/容错/颜色) + 批量解析(jsqr+sharp) |

### P2 · 文件工具 — M3
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| F | 文件统计（按后缀数量/大小 + 明细） | ✅ | ✅ | review 通过 |
| 12 | 批量重命名 | 🔵 | ✅ | 可拖拽规则链 + 零 IPC 预览 + 撤销 |
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
| 19 | 视频压缩 / 转码（ffmpeg） | 🔵 | ✅ | CRF/码率/目标大小 + 缩放降帧 + 音频 + GIF 两趟调色板 + tb-media 流式预览；trim/crop 已在主进程预留未接 UI |
| 20 | 音频工具（压缩/转码/裁剪/预览） | ⬜ | ⬜ | |
| S | Spine 预览（Pixi v8 + spine 4.2） | 🔵 | ✅ | 用户插队优先做 |

### P5 · 网络工具及其他 — M6
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 21 | host 工具（类 SwitchHosts，需权限） | ⬜ | ⬜ | |
| 22 | 其他工具 | ⏸ | - | 待定 |

### P6 · AI 赋能 — M8+
| 23 | AI 能力接入点 | ⏸ | - | 待定 |

### P7 · 账号与计费（后端就绪后） — M7
| 24 | 账号体系（登录/注册/token） | ⬜ | ⬜ | 依赖后端 |
| 25 | 计费与权限（套餐/额度/付费墙） | ⬜ | ⬜ | 依赖后端 |

---

## 卡点记录（Blockers）

> 格式：`[日期] #任务 - 描述 - 状态/结论`

- 暂无。

---

## 决策与变更记录（Changelog）

> 只保留有复用价值的决策与踩坑；完成态功能的实现细节见对应 skill。

**框架期（2026-07-16 ~ 07-17）**
- 技术选型：electron-vite / 重处理在主进程（sharp+ffmpeg）/ 打包 ffmpeg / 暂不做自动更新与多语言 / 账号计费 P0 只预留横切骨架。踩坑：勿加 `"type":"module"`（Electron ESM 崩）、shell 需 unset `ELECTRON_RUN_AS_NODE`、Tailwind 入口单独 .css。
- 约定成型：每功能随附一份 skill；**IPC 统一 `{code,data,message}`**（handle wrapper + unwrap 解包 + 全局 feedback，silent 可关）；services 函数加 `Api` 后缀；IPC 传参先 JSON 深拷贝去响应式；配色中性黑灰、紫色仅强调；权限只走 `useEntitlement().can`，收费与否是 NAV_ITEMS 的 tier 数据。

**图片工具（2026-07 ~ 08）**
- #8 格式转换**并入 #7 压缩页**而非另建（否则只是参数少一半的重复页）。先实测 libvips 真实能力边界（gif/tiff 可编解码、svg/heic 只读、bmp/jp2/jxl 不支持），别照 sharp 文档。
- **sharp 覆盖原文件的坑（影响全图片工具）**：libvips 任何一次路径输入就长期持有文件句柄，Windows 上写回同路径报 UNKNOWN、删源报 EBUSY。只测 png 会看到假绿（jpg/webp/gif 必现）。凡读图一律 `readFile`→Buffer 输入。写盘用 `writeFile(buffer)` 不用 `toFile()`（后者默认参数重编码丢质量）。
- #9 裁剪 sharp 实测：`trim()` 只返回负的 offset 不返回矩形、全透明图返回整张原画布不抛错；`extract()` 拒小数/负/越界须先 clamp；裁剪绝不能开 `animated:true`。
- #10 风格化的核心结论：**链式调用不是顺序管线**，同算子调两次只生效一次、不同算子先后由 libvips 内部固定顺序决定。要让面板顺序即执行顺序，每个效果各自一趟、趟间 raw buffer 中转。`grayscale()` 输出 ch=1 丢 alpha 改用 `modulate({saturation:0})`；`negate()`/`threshold()` 会连 alpha 一起处理需规避；局部区域不能用 `composite`（alpha 混合会把透明处透掉），改 raw 按行 `Buffer.copy`。
- `2026-08-21` **#11 精灵图**（图片工具收尾，两 tab）：合并用 **`sharp({create}).composite([...])`**（全仓库首次，输入各图 buffer）；网格布局每列取最宽/每行取最高（不强求等格）；坐标 JSON(PixiJS)/CSS/plist/none 由同一 `layoutGrid` 结果生成。切割四种：网格、切割线（补边界+去重相邻成段）、导入坐标、**透明连通域自动检测**（`ensureAlpha().raw()` + 4 邻接并查集两趟，非递归 flood-fill 免爆栈）。切割 cells 由渲染进程 probe 算好后传主进程，`spriteSlice` 只 extract 不重算（所见即所切）。**画布 SpriteSliceCanvas 用真实 `<canvas>` 画几百个 cell 框**（DOM div 撑不住）+ DOM 层画可拖切割线；坐标机制照抄 Crop/RegionCanvas（原始像素存、render 乘 scale）。切割图集用 `getDataUrlApi` 显示而非 tb-media（那是视频协议要白名单，图片会 403）。踩坑：① **plist import 正则须要求帧名含扩展名**否则外层容器 `<key>frames</key>` 被当成帧（脚本对照组抓到的真 bug）；② Vue 不许两个 `<template #slot>` 指向同一具名插槽，两 tab 内容要在单个 `#main`/`#panel` 里 `v-if/v-else` 分流。见 skill image-sprite。
- `2026-08-21` **#Q 二维码**（图片工具下，两 tab）：新依赖 **qrcode**（生成）+ **jsqr**（解析），均纯 JS、主进程用、externalize 无 asarUnpack。生成逐条 png/svg，**jpg 是 qrcode 不支持的、用 sharp 从 png 转码 + flatten 背景色**；单条超容量计 failed 不中断。解析 = Buffer 铁律 → `sharp.ensureAlpha().raw()` → `jsQR(Uint8ClampedArray,w,h)`，**识别不到返回 ok:false 不抛**。生成 tab 多行文本=多条 + 实时预览网格（防抖重建、按索引对齐保住手改名）+ 输出名模板 `{n}`/`{text}`（`{text}` 先替换 Windows 非法字符）；解析 tab 照搬裁剪页分页列表 + 结果列可复制。脚本验证 round-trip 7 例（中文/URL/长文本/各容错/SVG/非码 null/jpg）。见 skill image-qrcode。

**文件工具（2026-08）**
- #F 文件统计：**扫描一次拿全量，包含/排除后缀在前端过滤**（改条件不重扫）；`ScanFileEntry` 用 dirIndex 引用去重目录表（十万级文件不重复存长路径）；CSV 写 BOM 防 Excel 乱码。
- #12 批量重命名（**全仓库唯一直接改用户原始文件**，无「输出到新目录」退路）：预览**完全不走 IPC**（纯字符串运算放 computed，与图片预览那套相反）；pre-flight **不过就整批不动**；两趟改名（`.tbtmp-<i>` 中转）仅在目标集合∩源集合≠∅时启用。Windows 实测：结尾点/空格能创建但资源管理器处理不掉故要拦、`CON.txt` 能创建但按名读会挂死、`fs.rename` 静默覆盖、NTFS `existsSync` 大小写不敏感会拦下大小写修正。给规则链加 kind 必须同步 `normalizeRules()` 迁移老 localStorage。

**通用：文件夹导入 + 分页（2026-08-20，图片四页 + 重命名共用）**
- 收敛成一个 `useFolderImport`（复用 #12 的 `scanDirApi + maxDepth`）。**扩展名过滤必须在主进程遍历时做且放在 maxFiles 计数之前**（否则扫代码目录会被几千个 .js 占满名额）。列表**受控分页**每页 50 + 缩略图只为当前页加载 + `taskQueue` 限并发 4（否则文件夹导入上千张 = 上千并发解码卡死）。受控分页的代价：**表格不能开内部列排序**（切片按 items 顺序，重排就对不上）。「含子文件夹」放工具栏复选框（影响的是下次点添加的动作，与面板参数不同类）。

**媒体工具**
- `2026-07-18` Spine 预览（插队）：Pixi v8 + spine-pixi-v8 4.2，原生 File+objectURL 渲染进程加载不经 IPC，CSP 加 blob:。见 skill spine-preview。
- `2026-08-21` **#19 视频压缩/转码**：ffmpeg（`@ffmpeg-installer`/`@ffprobe-installer` 打包，asarUnpack）。与 sharp 根本不同——外部子进程：argv 数组传参（绕开中文/空格路径引号问题）、`-progress` 管道节流进度（百分比只许前进、时长未知推 -1）、取消要真杀进程（GIF 两趟共用 taskId 靠 canceledTasks 拦趟间取消）、**一律临时文件 + 成功才 rename**（ffmpeg 不能读写同一文件、坏输出要删）。**必须探测真实编码器能力**（打包 4.1 构建 ≠ 文档）。pre-flight 拦注定失败的组合（copy 与滤镜互斥、容器装不下的流）。scale 用 `-2` 保偶数宽、VP9 需 `-b:v 0` + row-mt、mp4 加 faststart、GIF 两趟 palettegen。**tb-media 自定义特权协议**播放本地文件（file:// 被开发环境 Chromium 拦）：白名单为唯一安全边界、必须实现 Range 流式（否则进度条拖不动、大文件爆内存）。**处理严格串行**（单 ffmpeg 吃满全核，并发只抢 CPU，硬约束）。onUnmounted 杀在跑进程。`trim`/`crop` 已在主进程实现但未接 UI，为下一轮时间剪切/画面裁剪页预留共用 `transcodeOne`。见 skill video-compress。

**工程 / 打包**
- `2026-08-21` **electron-builder 接入**：**两条命令、输出分开**——`pnpm build:dir` 出免安装 `release/unpacked/win-unpacked`（`--dir` 跳过 installer，快），`pnpm build:setup` 出 `release/installer/` 下 NSIS 安装包 + portable（各自 `-c.directories.output` 覆盖）。均先 typecheck + electron-vite build。配置在 `electron-builder.yml`。**原生模块 asarUnpack**：`sharp`/`@img`（sharp .node）、`@ffmpeg-installer`/`@ffprobe-installer`（.exe）——不解包则 asar 内无法 require/spawn；实测都落在 `app.asar.unpacked`。**统一图标**取标题栏的 `CubeOutline`：`build/icon.svg` → sharp 渲成 `build/icon.png`+`public/icon.png`，electron-builder 自动生成 .ico 并嵌入 exe（旧图标是 Windows 图标缓存未刷新，非配置问题），窗口/favicon/安装包三处同源，换图标只改 svg 重渲。pnpm 10+ 不装其它平台可选二进制，打包 warn 一串非本平台的包可忽略。见 skill packaging。
