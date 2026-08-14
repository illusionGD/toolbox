# Toolbox 开发进度（Progress）

> 配合 [PLAN.md](./PLAN.md) 使用。PLAN 定"做什么、什么优先级"，本文件跟踪"做到哪、卡在哪"。
> 状态图例：⬜ 未开始 · 🟡 进行中 · 🔵 待 review · ✅ 已完成 · ⛔ 卡住 · ⏸ 暂缓

**最后更新**：2026-08-14

---

## 当前进展

- **当前里程碑**：M1（首页 + 图片压缩）→ Spine 预览 → 文件统计 → **M2 图片工具其余**
- **当前任务**：#12 批量重命名 🔵 待 review（#10 风格化图片同为 🔵 待 review）
- **下一步**：#11 精灵图（合并 / 可视化切割导出）—— 用户要求先做 #12，#11 顺延

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
| 8 | 图片格式转换 | 🔵 | ✅ | 待 review；**并入 #7 压缩页**（页面更名「压缩 / 转换」），不另建页 |
| 9 | 裁剪图片（透明区域+阈值） | 🔵 | ✅ | 待 review；自动去边 + 手动拉框 + 统一输出尺寸 |
| 10 | 风格化图片（马赛克/模糊等） | 🔵 | ✅ | 待 review；11 种可叠加效果 + 多区域局部打码 + 实时预览 |
| 11 | 精灵图（合并/可视化切割导出） | ⬜ | ⬜ | 较复杂；用户要求先做 #12，本项顺延 |

### P2 · 文件工具 — M3
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| F | 文件统计（按后缀数量/大小 + 明细） | ✅ | ✅ | review 通过（含多选汇总）；用户插队优先做 |
| 12 | 批量重命名 | 🔵 | ✅ | 待 review；六种规则的可拖拽规则链（含整名替换）+ 零 IPC 实时预览 + pre-flight 整批不动 + 撤销上一批 |
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
| S | Spine 预览（Pixi v8 + spine 4.2） | 🔵 | ✅ | 待 review；用户插队优先做 |

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
- `2026-07-17` services 函数统一加 `Api` 后缀（约定）。IPC 传参需去响应式（reactive Proxy 无法结构化克隆，用 JSON 深拷贝）。加 commitizen（pnpm commit，仅交互不强制）。
- `2026-07-18` Spine 预览（用户插队优先）：Pixi v8 + spine-pixi-v8 4.2，媒体工具下。原生 File+objectURL 渲染进程加载（不经 IPC），拖入 atlas+png+json/skel，播放/切换/暂停。CSP 加 blob:。见 skill spine-preview。
- `2026-08-07` P2-F 文件统计（用户插队优先）：文件工具下。主进程 file IPC（scan/cancelScan/scanProgress/showInFolder/saveText），递归扫描按后缀聚合数量+大小。**扫描一次拿全量，包含/排除后缀在前端过滤**（改条件不重扫）；展开行内嵌明细表开虚拟滚动；进度节流推送 + 可取消（返回部分结果）；CSV/JSON 导出（CSV 写 BOM 防 Excel 乱码）。**ScanFileEntry 用 dirIndex 引用去重目录表**，避免十万级文件重复存长路径。CATEGORY_COLORS/colorAt 从 HomeView 提到 constants/chart.ts 共用，DonutChart 的 total 放宽为 number|string。见 skill file-stats。
- `2026-08-07` P2-F 追加多选：主表加 `type: 'selection'`，勾选后缀后页脚显示选中汇总（类数/文件数/大小 + 占全部百分比），占比图与导出同步收敛到选中范围（沿用 image-compress「有勾选只处理选中」约定）。
- `2026-08-08` P1-8 图片格式转换：**决定并入压缩页而非另建 `/image/convert`**（压缩页本就有输出格式选择器，单独建页只会做出一个参数少一半的重复页）。页面更名「压缩 / 转换」，同步移除 navigation/recommend 里的 `image-convert` 占位项。新增 gif/tiff 输出（gif: colours/dither，tiff: compression）、动图保留（keepAnimation）、输出格式与体积变化列、预览右栏标签按是否转格式切「压缩后/转换后」。**先实测确定 libvips 真实能力边界**：gif/tiff 可编解码，svg/heic 只读（original 时回退 PNG），bmp/jp2/jxl 不支持。修掉三个既有缺陷：ACCEPT 里的 `bmp` 从来解不了、`toFile()` 会用默认参数重编码丢掉质量设置、覆盖模式下换格式会写出扩展名骗人的文件。见 skill image-compress。
- `2026-08-08` P1-8 踩坑（值得单列）：① `animated:true` 只能在目标格式支持多帧时开，否则各帧竖排拼成长图；avif 本构建编码后只剩 1 帧，不算动图格式。② **覆盖原文件必须用 Buffer 输入**——`sharp(路径)` 时 libvips 持有文件句柄，Windows 上写回同路径报 `UNKNOWN`、删源文件报 `EBUSY`（jpeg/gif 必现，png 恰好不复现），旧的「toBuffer 中转」说法不足以避开。（②的范围在 P1-9 被证明比这里写的更大，见下条）
- `2026-08-08` P1-9 图片裁剪：**两种模式都做**——自动去边（threshold/margin/lineArt/指定背景色，可批量）+ 手动拉框（逐张 rect + 应用到全部）+ 可选「统一输出尺寸」（默认关，取各结果最大宽高作画布、居中补透明边）。新增 `probeCrop`（只算不写，加入文件时就把「会裁成多大」显示在列表里）与 `crop` 两个 IPC；新写唯一组件 `CropCanvas.vue`（不引 cropperjs，**rect 一律以图片原始像素存，只在渲染时乘 scale**，否则窗口缩放会累积漂移）。**统一尺寸只需一轮 IPC**：画布由渲染进程从已有 rect 算出，不必先跑一遍探测再跑一遍处理。`compressOne` 的写盘段抽成公共 `writeOutput` 与 `cropOne` 共用。sharp 实测结论：`trim()` 不返回矩形，只有**负数**的 `trimOffsetLeft/Top`；全透明图 `trim()` **不抛错**而是返回整张原画布（计划里假设它抛错是错的）；`extract()` 拒绝小数/负数/0/越界，必须先 `clampRect`；`extend()` 不接受负 padding，内容大于画布时得改走 `resize({fit:'contain'})`；裁剪绝不能开 `animated:true`（坐标系会落到竖排长图上）。见 skill image-crop。
- `2026-08-08` P1-9 顺手修掉一个跨功能缺陷（**修正上面 P1-8 第②条**）：libvips 的文件句柄是**任何一次路径输入**就会长期持有，不随本次调用结束释放，与「这次要不要写盘」无关。于是**只 `makeThumbnail` 一处路径输入就足以让「覆盖原文件」必崩**——列表里每张图加进来都会先生成缩略图。已把 `makeThumbnail` / `readDataUrl` / `compressOne`（含非覆盖分支）/ `cropOne` 全改成 `readFile` → Buffer 输入。此缺陷影响已「完成」的 #7/#8，且**只测 png 会看到假绿**（jpg/webp/gif 必现，png/tif/avif 不复现），已按 6 种格式做「先生成缩略图再覆盖写」回归。
- `2026-08-11` P1-10 图片风格化：「马赛克、模糊等」的**「等」取全量**——11 种效果（马赛克/模糊/中值/锐化/灰度/复古/色调叠加/亮度饱和度色相/对比度/反色/阈值二值化）可任意叠加，另加**多区域局部马赛克/模糊**（独立一组参数、带「作用于区域外」反选做背景虚化）与**选中行实时预览**。新增 `stylizePreview`（只算不写，缩到 900px）/ `stylize` 两个 IPC，新写 `RegionCanvas.vue`（多矩形版 CropCanvas，无遮罩——局部效果要同时看清区域内外）。**架构由一条 sharp 实测结论决定：链式调用不是顺序管线**——同一算子调两次只生效一次（`blur(2).blur(2)` 与 `blur(2)` 逐字节相同），不同算子的先后由 libvips 内部固定顺序决定而非书写顺序（实测 45 对；写 `blur().threshold()` 实际是 threshold 先跑）。要让面板顺序真的是执行顺序，**每个效果必须各自一趟**，趟间用 raw buffer 中转（PNG 中转 4000×3000 每趟白烧 46ms）。马赛克同理必须两趟，否则两次 `resize` 被折叠成 no-op、输出与原图逐字节相同。见 skill image-stylize。
- `2026-08-11` P1-10 踩坑：① **`grayscale()` 输出 raw 是 ch=1**，alpha 直接丢，下一趟按 ch=4 读就花屏，`ensureAlpha()`/`toColourspace` 都救不回——改用 `modulate({saturation:0})`，像素值与 `grayscale()` 完全一致但保 4 通道。② `negate()` 默认**反转 alpha**，须 `{alpha:false}`。③ **`threshold()` 也二值化 alpha**（128→255，半透明图被悄悄变不透明），这条不在计划里、是实现时发现的，需在该趟前后存取 alpha 平面。④ 局部区域**不能用 `composite`**——`blend:'over'` 是 alpha 混合，区域内原本透明处会被底图透掉，打了码的地方还是透明；改在 raw 上按行 `Buffer.copy`，反选只是底图/覆盖图互换角色。⑤ **预览缩放后像素级参数必须同步缩放**（block/sigma/median size/rect），否则预览里的码比实际大 4 倍。⑥ 两个「测试本身是错的」：顺序回归最初用 `mosaic+threshold`，两种顺序逐字节相同（最近邻采样没有顺序敏感性），换 `blur+threshold` 并加正向对照才有区分力；「动图」fixture **从来不是动图**（sharp 此 build 无法从 raw 产出多帧 gif，各种写法都是 `pages:1`），手写 GIF89a 编码器造出真 2 帧 gif 后断言才成立——**fixture 缺少被测属性 = 静默假通过**，与 P1-8 同类。145 项脚本断言全过。

- `2026-08-14` P2-12 批量重命名：**用户要求跳过 #11 精灵图先做本项**，#11 顺延。范围取全量并按用户选择做成**可拖拽排序的规则链**（插入文本/查找替换/大小写/删除字符/扩展名，逐条开关，自上而下施加）+ 序号设置（起始/步长/补零/排序依据）+「撤销上一批」+「包含子文件夹」开关（默认关，走新加的 `ScanOptions.maxDepth`）。**架构与图片三页正相反：预览完全不走 IPC**——重命名全是字符串运算，`utils/rename.ts` 做成纯函数放 `computed` 里，改一个字符整表重算，不需要 debounce 与 reqId 防串（图片预览那套依赖 sharp 在主进程，这里照抄就是无谓复杂度）。主进程只管渲染进程看不到的部分：盘上是否已有同名文件，以及落盘。新增一个 `renameBatch` IPC，**撤销不另开通道**（把 `{from,to}` 反过来再调一次，pre-flight 与两趟改名原样复用）。见 skill file-rename。
- `2026-08-14` P2-12 的核心风险与取舍：这是全仓库**唯一直接改动用户原始文件**的功能（图片工具都有「输出到新目录」的退路），所以 pre-flight **不过就整批不动**——不做「改一半再报错」，代价是一个坏名字挡住整批。**两趟改名**（`.tbtmp-<i>` 中转）只在「目标集合 ∩ 源集合 ≠ ∅」时启用，避免平白翻倍 syscall。Windows 实测**纠正了两条计划里的假设**：① 结尾的点/空格**不会**被系统悄悄吃掉——`x.` / `y ` 能原样创建、能按精确名读回，只是无法通过普通 Win32 路径解析访问，拦它们是因为会造出用户在资源管理器里处理不掉的文件；② `CON.txt` **能**创建，危险的是**按名字读它会挂死**（解析到控制台设备阻塞在 stdin，验证脚本第一版就是这么超时的）——这让保留名禁令比「创建会失败」更有必要。确认的三条：`fs.rename` 到已存在目标**静默覆盖**、NTFS 下 `existsSync('FOO.txt')` 在只有 `foo.txt` 时为 true（naive 判定会拦下每次大小写修正）、naive 单趟交换确实丢文件。120 项脚本断言全过，另跑对照组证明测试有鉴别力。
- `2026-08-14` P2-12 review 反馈「好像少了，整个名称重命名功能」，补上第六种规则 **`name`（设置名称 / 整名替换）**：直接给出新名字模板、丢掉原基名，`IMG_1234.jpg → 照片_01.jpg` 从此是一条规则。原先要表达这个只能「删除字符清空 + 插入文本」，等于让用户自己发明套路——**规则链的完备性不等于易用性**，最常见的诉求得有最直白的入口。默认模板 `{name}` 是恒等变换，加了不编辑就不改名。顺带补一个 **`normalizeRules()`**：`useToolConfig` 的浅合并只兜到 config 顶层，够不到数组里的每条规则，老用户 localStorage 存的链会缺 `rule.name`，模板直接访问就崩——这是**每次给规则链加 kind 都要走的一步**。另跑 23 项断言全过（含 `name→case` 与 `case→name` 结果不同、`includeExt` 开关下的差异、6 项 normalizeRules 迁移）。两条**测试期望本身写错**：`{parent}-{date}-{n}` 我漏算了 `-{n}` 后缀；空模板产出的 `.jpg` 是**合法可创建**的 Windows 文件，validateNames 不拦它是对的，得叠上「移除扩展名」才是真空名。
