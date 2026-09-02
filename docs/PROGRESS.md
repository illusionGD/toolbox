# Toolbox 开发进度（Progress）

> 配合 [PLAN.md](./PLAN.md) 使用。PLAN 定"做什么、什么优先级"，本文件跟踪"做到哪、卡在哪"。
> 状态图例：⬜ 未开始 · 🟡 进行中 · 🔵 待 review · ✅ 已完成 · ⛔ 卡住 · ⏸ 暂缓

**最后更新**：2026-09-02（存储路径设施）

---

## 当前进展

- **当前任务**：设置页「存储」——数据缓存目录 + 数据保存目录（可改 + 迁移）🔵 **待 review** —— 新 `electron/main/storage/`（dirs/settings/paths/appState）+ `ipc/storage.ts` 9 通道 + `src/services/appState.ts`；主题色、各工具上次参数、使用统计从 localStorage 搬进 `<dataDir>/app-state.json`（一次性迁移，写盘成功才删旧键）。109 条断言全绿（主进程 74 + 渲染 35）、typecheck/lint/format/build 全绿，另在真实安装版与 portable 版打包产物上实测了路径解析。
- **下一步**：待用户定。候选：P5 #21 host 工具（唯一还没动的 PLAN 项，要处理管理员权限）/ 补 #15 遗留的「每个 sheet 各出一套 JSON」/ 视频分段导出（#19 续那轮只做单段）。
- **待人工验**：① #18 的图集观感只有人能判断 —— 生成后把 `.fnt` + PNG 丢进 Pixi 或在线 BMFont 查看器确认渲染正确；② #19 续剪切页 —— 拖选区导出后播放接缝是否连贯、裁剪框是否所见即所得、`copy` 模式起点偏移与文案是否一致；③ 骨骼读数 —— 拖一套真素材进去，骨骼数量与最大深度是否与 Spine 编辑器里的层级对得上；④ 本轮存储 —— 改保存路径 → 重启 → 主题色 / 各工具上次参数 / 使用统计**全都还在**（唯一能证明「搬对了」的动作）、清空缓存后占用归零、把路径指到另一个盘再指回来、装到 `C:\Program Files` 时设置页出现回退提示。

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
脚手架 / 工程配置 / 主题系统 / 整体布局 / 通用能力 / 账号计费横切骨架，均已 skill 化，build/typecheck/lint 通过。另含**存储路径设施**（2026-09-02，skill app-storage）：设置页两个可改目录 + 保存目录改后迁移 + 清空缓存，应用状态落 `<dataDir>/app-state.json`。

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
| 15 | excel 多语言转 JSON | 🔵 | ✅ | 待 review；exceljs 单表多 sheet 合并 → 一种语言一个 JSON，点号转嵌套 |

> ~~#13 word 转 pdf / #14 pdf 转 word~~ 已于 2026-08-26 取消（纯本地高保真转换依赖 LibreOffice/Office COM，代价大、性价比低）。

### P3 · 字体工具 — M4
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 16 | 字体裁剪 | 🔵 | ✅ | 待 review；subset-font 按字符裁+可选转格式 + fontkit 元信息 + 批量 + FontFace 实时预览 |
| - | 字体网页分包 | 🔵 | ✅ | 待 review；cn-font-split 独立页 /font/split，单字体切多 unicode-range 分包+CSS |
| 17 | 字体格式转换 | 🔵 | ✅ | 待 review；独立页 /font/convert，fontverter 无损转 TTF/WOFF/WOFF2（不做 otf） |
| 18 | 位图字体（图集+.fnt） | 🔵 | ✅ | 待 review；双 tab /font/bitmap，字体→位图 + 图片→位图，出 PNG 图集 + .fnt/.xml/.json 三格式 |

### P4 · 媒体工具 — M5
| # | 功能 | 状态 | skill | 备注 |
|---|------|------|-------|------|
| 19 | 视频工具（压缩转码 + 剪切裁剪） | 🔵 | ✅ | 双 tab 单页 `/media/video`：批量压缩（CRF/码率/目标大小 + 缩放降帧 + 音频 + GIF 两趟调色板 + tb-media 流式预览）+ **剪切/裁剪**（胶片条+波形时间轴、在播放画面上拖裁剪框）；skill video-compress + video-clip |
| 20 | 音频工具（压缩/转码/裁剪/预览） | ✅ | ✅ | review 通过；双 tab：批量转码（**并发 4**，实测 3.74×）+ 剪切/分割（波形选区 / 按静音 / 平均分段）；响度归一 + 音量 + 淡入淡出 + 声道采样率 |
| S | Spine 预览（Pixi v8 + spine 4.2） | 🔵 | ✅ | 用户插队优先做；含播放速度/包围盒/**骨骼数量与最大骨骼深度** |

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
- `2026-08-28` **#15 Excel 多语言转 JSON**（独立页 `/file/excel-i18n`）：新依赖 **exceljs**（4.4.0 MIT，纯 JS、主进程用、externalize 无 asarUnpack，但**必须在 dependencies**）；排除 SheetJS xlsx（npm 只有 0.18.5 旧版有 CVE，安全版要从官方 CDN 装，偏离仓库惯例）。**最大坑：`cell.value` 有七种形态**（string/number/boolean/Date/`{richText}`/`{formula,result}`/`{hyperlink,text}`/`{error}`），直接 `String()` 会把富文本和公式单元格变成 `[object Object]`——翻译表加粗几个字或用公式拼串很常见，必须逐形态归一（判定顺序 richText→result→text，超链接也有 text 会误取）。`.csv` 要走 `wb.csv.readFile` 分流，**不支持老 .xls**。**语言码解析取「第一个 ASCII 段起到结尾的所有 ASCII 段」**：`中文原文-zh-hants`→`zh-hants`，只取最后一段会得到 `hants`。点号嵌套冲突（先有 `a.b` 又来 `a`）**不静默覆盖**、返回 false 汇总 warning。`keyCount` 递归数叶子而非 `Object.keys().length`（嵌套后顶层 key 数远小于译文条数）。**预览只序列化被请求的一列**（几十个语言全量 JSON 过 IPC 又大又慢），且预览与落盘共用同一 `buildLocales` 保证所见即所写；预览不 watch 自动重算、置 stale 提示点刷新（同精灵图）。空译文不落 key（前端回退默认语言）、空 key 行整行跳过并计数。**多 excel 合并明确不做**（用户定：各表语言列位置不一致，逐文件配行列成本高于收益）；多 sheet 合并支持。列引用同时接受 `C` 与 `3`。**验证用 esbuild 打包法**（仓库首次）：只替换 excel.ts 里 channels/helper 两行 import 为桩、其余逐字保留，`--external:exceljs` 出 mjs 后 node 直跑，测的是生产代码本身；79 断言过（主进程 48 + 渲染纯函数 31）。见 skill excel-i18n。

**通用：文件夹导入 + 分页（2026-08-20，图片四页 + 重命名共用）**
- 收敛成一个 `useFolderImport`（复用 #12 的 `scanDirApi + maxDepth`）。**扩展名过滤必须在主进程遍历时做且放在 maxFiles 计数之前**（否则扫代码目录会被几千个 .js 占满名额）。列表**受控分页**每页 50 + 缩略图只为当前页加载 + `taskQueue` 限并发 4（否则文件夹导入上千张 = 上千并发解码卡死）。受控分页的代价：**表格不能开内部列排序**（切片按 items 顺序，重排就对不上）。「含子文件夹」放工具栏复选框（影响的是下次点添加的动作，与面板参数不同类）。

**通用：存储路径设施（2026-09-02，P0 补齐）**
- `2026-09-02` **数据缓存目录 + 数据保存目录**（设置页「存储」卡片，新 `electron/main/storage/` 四个文件 + `ipc/storage.ts` 9 通道 + `src/services/appState.ts`）：动手前 `grep` 确认**全仓库此前没有任何一处 `app.getPath()`**，应用至今没有自己的存储位置，真正持久化的三样东西（主题色 / `useToolConfig` 的 17 处调用 / 使用统计）全在渲染进程 localStorage 里——用户定「一并搬到数据路径」，否则「迁移数据」没有对象。**两层存储**：路径设置本身（指针）放 `%APPDATA%\toolbox\settings.json`，**不能放数据目录**（它就是指向数据目录的指针，放进去等于自己指自己，用户一改路径下次启动就凭空丢设置），且**只存被用户改过的键**（删空键而不是写默认值，这样默认值以后变了也能跟着走）；应用数据放 `<dataDir>/app-state.json`，**一个文件装全部命名空间**（`theme`/`usage`/`tools.<toolKey>`），迁移只搬一个文件、也不会半新半旧。**渲染进程用「一次异步快照」保住所有同步读**：三个 store 都是创建即同步读，改成 await IPC 就得三处全变异步、17 个调用点跟着改、主题色还会闪一帧默认色 —— 改成 `app.mount()` 前 **await 一次** `initAppState()` 把整个 blob 读进内存，`readState` 保持同步，**响应式形状与 17 个调用点一行没改**。**九条实测都推翻过直觉**：① **`fs.access(dir, W_OK)` 在 Windows 上说谎** —— 对 `C:\Program Files`、`C:\Windows\System32`、`C:\` 全都答「可写」而真写是 EPERM（它只看只读属性不看 ACL），故可写性一律**真写一个探测文件再删**；② **缓存默认不能用 `app.getPath('cache')`** —— 实测它在 Windows 上 = `%APPDATA%`（Roaming），系统清理根本不清，用 `app.getPath('temp')`（=`%LOCALAPPDATA%\Temp`）才符合用户要的「方便系统一起清理」；③ 跨盘 `rename` 文件与目录**都** EXDEV → 退化为 `fs.cp(recursive)`+`rm`；④ `rename` 到已存在的**目录**是 EPERM（哪怕空目录），到已存在的**文件**是静默覆盖（这才是临时文件+rename 原子的原因），前者也是最好用的「中途失败」注入手段；⑤ `rmdir` 非空 = ENOTEMPTY，故源目录用**非递归 rmdir**，别人往里放了东西就让它失败；⑥ **被其它进程 `r+` 持有的文件仍然能 unlink**（node 带 FILE_SHARE_DELETE），「文件被占用所以删不掉」在 Windows+node 下不易复现，`clearCache` 的 `failed` 清单是防御性的；⑦ 嵌套判断用 `path.relative` **不用 `startsWith`**（后者会把 `D:\dataX` 判成在 `D:\data` 之内）；⑧⑨ 打包后真机读数：安装版 `exe` = 安装目录、`PORTABLE_EXECUTABLE_DIR` = null；**portable 版 `exe` 指向每次重新解压的随机临时目录** `%TEMP%\3IlKHUdnRPRlwcjmD2lTMwJa13E\Toolbox.exe`，故 portable 必须用 `process.env.PORTABLE_EXECUTABLE_DIR`（数据写进临时目录下次运行就没了），`userData` = `%APPDATA%\toolbox`（**小写**，跟的是 package.json 的 `name` 而非 productName）。**迁移的顺序就是全部的重点**：suspend（await，等在途写盘落完）→ 校验 → 写归属标记 → 逐条 rename/EXDEV→cp+rm（任一失败**把已搬的搬回去**再抛中文错）→ 切内存 dataDir → **只有全成功才写指针** → resume（finally）。**验证脚本抓到两个 typecheck/lint/build 全绿的真 bug**：① `suspend()` 原本排在 `await assertUsableTarget(...)` **之后**，而校验自己要做磁盘 I/O，这段窗口里一次防抖写盘就在旧目录留下 `app-state.json.tmp-<pid>`，搬迁枚举到它、真去 rename 时它已被改名 → ENOENT → **整批回滚，一次本该成功的迁移变成失败**（真实崩过）；三处一起修：suspend 提到校验前、`suspend()` 改成 await 排空写队列（光拨开关不够，可能正卡在「临时文件已写好、还没 rename」）、`moveDirContents` 对「枚举后自己消失的条目」跳过而不回滚；把顺序改回去能让断言 G3 变红，证明这条回归不是空跑。② **`unwrap` 在 IPC 返回错误码时是抛错不是返回假值** —— 一次性迁移里没接住，异常冒出 `initAppState()` 就把 `app.mount()` 一起挡掉 = **整片白屏**；同一个教训在主进程也有一份：`initStoragePaths()` await 在 `createWindow()` 之前，一抛错就没有任何窗口、进程静默退出、用户看到双击图标毫无反应。两侧都改成兜住异常继续走——**存储坏掉的正确后果是「设置不持久化」，不是「应用打不开」**。一次性迁移**写盘成功才删旧键**，且只信 `write` 返回的 true（再 `read` 一次读到的是主进程内存副本，验证不了磁盘 = 假验证）；写失败时**数据先进内存**让本次会话照旧显示用户设置而不是像被重置过，旧键留着下次再试，下次启动发现文件里已有同名命名空间就顺手清掉残留。**归属标记 `.toolbox-cache`/`.toolbox-data` 是递归删除的前提**（清空缓存是 `rm -rf`，动手前必须能证明目录是我们的），非空且无标记一律拒绝接管、盘根一律拒绝、目标与当前互相嵌套一律拒绝（防「把自己搬进自己」和递归删自己）。缓存改路径**不迁移**（可丢弃数据）只清旧目录；**不做迁移进度推送**（目前数据目录只有一个 json，毫秒级，UI 只走按钮 loading）——有意的取舍。**验证 esbuild 打包法 109 条断言全绿**（主进程 74 + 渲染 35），`dirs.ts` 刻意不 import electron 就为了让风险最高的那部分能被 node 直跑。另外两个坑记在 skill 里：**本仓库这个 bash 里 `ELECTRON_RUN_AS_NODE` 是设着的，不 unset 直接跑打包出来的 exe 会当裸 node 启动并立刻以 0 退出**（没有窗口、没有日志，看着像打包版启动失败，排查花了三轮）；**electron-builder 的输出目录不能放在仓库里**（`rename win-unpacked.tmp -> win-unpacked` 在 `release/` 下必定 EPERM，换到 `%TEMP%` 一次就成）。见 skill app-storage。

**媒体工具**
- `2026-07-18` Spine 预览（插队）：Pixi v8 + spine-pixi-v8 4.2，原生 File+objectURL 渲染进程加载不经 IPC，CSP 加 blob:。见 skill spine-preview。
- `2026-08-21` **#19 视频压缩/转码**：ffmpeg（`@ffmpeg-installer`/`@ffprobe-installer` 打包，asarUnpack）。与 sharp 根本不同——外部子进程：argv 数组传参（绕开中文/空格路径引号问题）、`-progress` 管道节流进度（百分比只许前进、时长未知推 -1）、取消要真杀进程（GIF 两趟共用 taskId 靠 canceledTasks 拦趟间取消）、**一律临时文件 + 成功才 rename**（ffmpeg 不能读写同一文件、坏输出要删）。**必须探测真实编码器能力**（打包 4.1 构建 ≠ 文档）。pre-flight 拦注定失败的组合（copy 与滤镜互斥、容器装不下的流）。scale 用 `-2` 保偶数宽、VP9 需 `-b:v 0` + row-mt、mp4 加 faststart、GIF 两趟 palettegen。**tb-media 自定义特权协议**播放本地文件（file:// 被开发环境 Chromium 拦）：白名单为唯一安全边界、必须实现 Range 流式（否则进度条拖不动、大文件爆内存）。**处理严格串行**（单 ffmpeg 吃满全核，并发只抢 CPU，硬约束）。onUnmounted 杀在跑进程。`trim`/`crop` 已在主进程实现但未接 UI，为下一轮时间剪切/画面裁剪页预留共用 `transcodeOne`。见 skill video-compress。
- `2026-09-01` **#20 音频工具**（双 tab 页 `/media/audio`，媒体工具收官）：**零新依赖**，ffmpeg 二进制 / `runFfmpeg` 系列 / `tb-media` 协议 / 能力探测全部复用 #19；主进程独立成 `ipc/audio.ts` 不并进 449 行的 video.ts（那边整个文件都是视频语义）。**最重要的一条推翻了从视频页照搬的默认做法：本页并发 4，与视频页的严格串行相反** —— 音频编码是单进程单线程（同一个十分钟文件 `-threads 1` 用 10718ms、`-threads 8` 用 10693ms **完全相同**），故四进程并行实测 **3.74×**（10 分钟 mp3 320k 串行 44733ms → 并行 11975ms；flac lvl12 22708→6038ms）。视频页注释里「单 ffmpeg 吃满全核、并发只抢 CPU」对视频成立、**对音频不成立**，两处都写了警告防下一轮改回串行；渲染进程随之把「当前唯一 currentTaskId」改成 `Set<taskId>`，取消要杀全部。**兼容矩阵放 `electron/shared/audio.ts` 两端共用**（主进程 pre-flight 拦 + 渲染进程过滤下拉，各存一份必然漂移成「下拉里能选、点下去报错」；渲染进程能 import shared 的运行时值，先例是 services/ipc.ts 的 IPC_CODE），8×8 实测非文档，两个反直觉：**wav 能装 mp3/aac/vorbis/flac 有损流**、**ogg 与 opus 两容器可互装**；用流编码名而非编码器名（实测编码器×容器与源编码×容器两张矩阵结构完全一致，合成一张 + ENCODER_CODEC 换算，`-c:a copy` 也查同一张）。**`-vn` 的规划记录被实测推翻并纠正**：原记「忘了 -vn 也能出 mp3 但码率被压到 64k」——那 67407 是视频+音频 m4a 的**容器平均码率**，真相更糟：能装视频的容器会把视频流**一起重新编码**进产物（实测 m4a→libx264、flac→png 附图、ogg→theora），30s 720p 转 m4a 683125B/1434ms vs 加 -vn 的 220107B/660ms；**mp3 与 wav 装不了视频会自动丢掉、完全看不出问题**，所以这坑只在换到 m4a/flac/ogg 时才炸。pre-flight 三条实测：**libopus 显式给非 48kHz 直接报错退出**（不给 -ar 时它自己静默重采样到 48k，那是允许的，故只拦显式指定；前端更进一步只留「保持源/48000」）、容器×编码查表、**`-c:a copy` 与滤镜/声道/采样率互斥且不能悄悄忽略**（用户开了响度归一却拿到原样文件比报错更糟，文案列出具体冲突项）。滤镜链 **`volume`→`loudnorm`→`afade` 顺序不能调**：归一在增益后否则手调增益被整个抵消；**afade 最后且淡出起点按剪切后时长算**（实测 `-ss` 放 `-i` 前时滤镜时间轴从 0 重新开始，剪 2–5s 的产物里 st=2 的淡出落在末段：末段 RMS −31.3dB vs 中段 −24.1dB）。**响度归一单趟就够**：源 −21.87 LUFS 单趟得 −16.02（目标 −16）、双趟 −16.07，**双趟反而略差还多跑一遍**。**剪切精度如实回报不假装精确**：要 3.000s 时 wav 得 **3.000（0 误差）**、mp3 重编码 3.030、mp3 copy 3.056，`-ss` 放 `-i` 前后精度**完全相同**（音频没有关键帧问题）但放前面不解码整条快得多。其余实测：不给 `-f` 时十种扩展名推断全部正确；flac wav→flac→wav md5 完全相同但 **level 12 比 5 慢 48% 只多省 1.5%**（默认 5）；silencedetect 精度约 15ms 且**文件以静音结尾时不输出收尾的 silence_end**（要用 duration 补上，否则末段静音整个漏掉）；**波形图成本与时长尺寸几乎无关**（十分钟 1200×80 用 277ms、2400×120 用 287ms）故不缓存不落盘、`runFfmpegToBuffer` 直出 stdout PNG；`-progress` 对 10 秒文件只推 1 次（短文件进度条就是 0→100，正常）；元数据默认保留、清除要显式 `-map_metadata -1`。落盘两道数据丢失防线：**没开覆盖却算出与源同名的输出路径要自己拦**（ffmpeg 那句 "cannot edit existing files in-place" 拦不住走临时文件+rename 的我们）、**分割全成才落盘**（半套分段比一段都没有更难排查，同位图字体 writeAllAtomic）；分割各段共用一个 taskId 让 canceledTasks 能拦住后续段，段进度换算成整体否则每切一段从 0 重走。渲染进程：**单个 `useToolConfig('media-audio')` 而非两 tab 各一份**（输出设置是同一个概念，共用才能让那一大块留在 v-if 外面）、编码器下拉两层过滤（探测到的 ∩ 装得进容器）+ 失效时 watch 回落、**VBR 质量方向两者相反**（mp3 0 最好、vorbis 越大越好）故 label 必须写清、体积变化列**保留负数**（音频转码常常变大，截断成 0 是骗人）。新组件 `WaveformSelect.vue` 与 Crop/RegionCanvas **同源但单位不同**——那两个存原始像素乘 scale，这里**存秒换百分比**，因为波形图由 ffmpeg 按任意宽度现画再 `object-fit:fill` 拉满，没有「原始像素」可锚定；没动过的按下视为**跳播**而不是造一个零宽选区；波形用中性灰、只有手动选区用主色。「按静音分割」给的是**静音区间的补集**（说话的那几段）。**验证 esbuild 打包法 16 组 65 断言全绿**，三个自己踩的坑：`handle` 桩必须完整镜像 helper.ts 的 `{code,data,message}` 与 catch（否则 49 个矩阵格子全读成失败）、**「PNG 非空 525B」这种断言毫无意义**（纯正弦波的波形图压缩后就是 525B，换成 magic + IHDR 宽高 + 与静音产物不同）、**断言与源码注释冲突时先怀疑注释**（-vn 那条就是这么纠正的）；三处桩替换加了「一处都没命中就抛」的守卫。基准：10 分钟 mp3 320k 单个 11.3s。见 skill media-audio。**review 抓到两个 bug**：① 输出目录输入框全仓库 14 处**有 7 处是单向 `:value` 绑定**（光标能进、打字没反应），统一改 `v-model:value` 并去掉精灵图切割那处的 `readonly`、placeholder 统一「选择或粘贴输出目录」（六处落盘前都 `mkdir recursive`，手输不存在的路径会自动建）；② 手动选区导出报 **"An object could not be cloned"** —— `selection` 是 `ref`，`.value` 是**深层响应式 Proxy**，V8 结构化克隆不认，且 typecheck/build 全绿只在运行时炸，修法是在调用点重建纯对象。第二条仓库已踩第三次（图片压缩 `advanced`、文件统计 `ignoreDirs`），故把规则提到跨功能的 skill ipc-contract 而非只留局部注释。
- `2026-09-02` **#19 续 视频剪切 / 画面裁剪**（`/media/video` 第二个 tab，`VideoCompressView.vue` → `VideoView.vue`）：**零新依赖、渲染侧契约一行未加** —— `trim`/`crop` 本来就是 `TranscodeOptions` 的可选字段，随现有 `video:transcode` 一起传；唯一新通道是胶片条抽帧的 `video:frame`。用户定了四条：第二个 tab 而非新开页（输出设置与压缩 tab 共用同一个 `useToolConfig('media-video')`，同一概念配两遍只会互相打脸）、单文件流程页（剪切要看着画面逐个定区间）、胶片条+波形上下叠、本轮只做单段。**修了三处只有接 UI 才会暴露的既有缺陷**：① `targetSize` 反算码率用的是**源时长**，剪出 1/N 时长码率就差 N 倍（实测 12s 源剪 3s 求 3MB，按源时长算得 `-b:v 2048k`、按剪切后算得 `8192k`，差 4.00 倍 = 12/3），改成 `buildVideoArgs(options, effectiveDuration)` 且同一个值同时喂给进度；误差如实写进 UI（目标 3MB 实得 4.34MB **+45%**，加上 720p 噪声那组 +20%，文案写「高噪画面超出 20%–45%」不写单一数字）；② **奇数裁剪尺寸与偏移被 ffmpeg 静默改掉而不是报错** —— `crop=641:361:11:11` 在 libx264/libx265/libvpx-vp9/gif 四路全部退出码 0、被当成 `640:360:10:10`，奇数**偏移**同样下调（501,301 与 500,300 的像素 MAE=0，502,302 对照组明显非 0），后果是「面板写 641、文件里是 640」，故新建 `electron/shared/video.ts` 放 `snapCropEven`/`MIN_CROP_SIZE`/`cropExceedsSource`/`hasCrop` **两端共用**（同 shared/audio.ts）、`CropCanvas` 在 **commit 那一步**对齐让 v-model/面板/ffmpeg 三处同值；越界也静默（1280 宽上 `crop=200:100:1200:10` 退出码 0、stderr 一句没有，偏移被悄悄钳到 1080 → 用户拿到**另一块区域**），ffmpeg 不说就只能 pre-flight 说；③ **未开覆盖仍可能盖掉源文件** —— `outputDir` 选成源目录且扩展名相同时 `outputPath === sourcePath`，我们走临时文件+rename，ffmpeg 那句「cannot edit existing files in-place」拦不住（audio.ts 有守卫、video.ts 没有），剪切场景极易触发，故加 `nameSuffix`（剪切 tab 默认 `-clip`）作正常路径 + 同路径守卫抛中文错兜底。**剪切精度实测推翻了自己第一轮的记录**：请求 6.5→9.5s，四种组合（重编码/copy × 有音轨/`-an`）**视频流一律精确到 3.000s / 90 帧**，容器时长那多出来的 20ms 是 **aac 音频帧**（1024 样本@44.1kHz≈23ms）切不开而向上对齐、容器取各流最大值的结果，**与 copy 无关** —— 第一轮在另一 fixture 上量到 +0.067s 时误记成「copy 的代价」，加 `-an` 对照组才看清，主进程注释与 UI 文案都已纠正。起点位置只能用**有动作的源**验（testsrc2；纯色 fixture 每帧长得一样，起点退没退根本看不出来）：首帧 MAE 重编码 vs 源6.5s=**0.29**/vs 5.0s=9.30、copy(mp4) vs 6.5s=**0**（同一批包逐像素一致）/vs 5.0s=9.24。`copy` 真正的代价只有「起点必须落在关键帧上」且**行为随容器不同**：mp4 有 edit list 保住起点、**mkv 没有会退到上一个关键帧**（同请求实得 5.0s 起、时长 4.643s），差一整个关键帧间隔而不报错 = 给了用户另一段视频 → pre-flight 拦掉 mp4 之外的容器。**时间轴与裁剪框都靠扩展现有组件而非另写**：`WaveformSelect` 只加一个 `frames?: string[]`，选区/候选段/播放头本来就是 `top:0;bottom:0` → **自然跨满胶片+波形两层、拖拽逻辑一行没改**（另写只会有两份要同步的拖拽代码），无音轨时**不显示「波形生成中…」占位**（那是谎报）且**根本不发那次请求**（`showwavespic` 无音轨直接退出码 1），帧格子 flex 必须给 `min-width:0` 否则最后几格挤出容器；`CropCanvas` 把内部 `<img>` 包进 `<slot name="media">`（默认内容不变 → 图片裁剪页与风格化页零改动），剪切 tab 塞 `<video>` 于是能**边播边在动画面上拖框、遮罩之外就是会被裁掉的部分**，不必抽静帧，切文件/离开 tab/卸载都要 `stopVideo()`（`pause()`+移除 src+`load()`，只 pause 会持有解码器与文件句柄）。**胶片条抽帧否掉了两个「一趟出整条」的写法**（120s 720p，12 帧）：`-skip_frame nokey`+`tile` 最快 136ms 但**内容是错的**（拿前 12 个关键帧，本片关键帧每 5s 一个，整条只覆盖前 55s，末格 vs 源55s 的 MAE=2.38 / vs 源115s=9.9，与刻度对不上比没缩略图更误导）、`fps=12/120`+`tile` 405ms 覆盖正确但要**解完整条视频**、成本随时长线性涨；逐帧 `-ss` seek 是 **O(1) 于时长**且能一帧一帧先显示，实测串行 1286–1566ms / 并发 4 只要 406–565ms（**2.8–3.2×**）故定 `FRAME_CONCURRENCY=4`、12 帧、160px。`filmstripTimes` 取每格**中点**而非左边界（取左边界第一格必然是 0s，而相当多的片子第一帧是纯黑或版权页），放 `src/utils/` 而非 shared —— 主进程不需要它；`frameToken` 计数器丢弃换文件后才回来的陈旧帧、`frames` 先摆空串占位使条宽不跳。**跨 IPC 的 `trim`/`crop` 必须在调用处重建成朴素对象**，否则运行时抛 "An object could not be cloned" 而 typecheck/build 全绿 —— 本项目**第四次**踩（`advanced`/`ignoreDirs`/音频 `trim`/本轮），规则在 skill ipc-contract。**验证 esbuild 打包法 39 条断言全绿**（三处 import 换桩、其余逐字保留、node 直跑生产代码，`handle` 桩完整镜像 helper.ts 的 `{code,data,message}`+catch）；几条只有换个断言方式才查得出：裁剪坐标**必须读像素**（四象限各裁一次比中心像素最接近哪个参考色，只断言尺寸查不出「裁错位置」）、进度断言 3s 剪切在 12s 源上走到 100%（用源时长会停在 25%）、同路径守卫断言源文件 sha1 **与 mtime** 均不变（只比 sha1 查不出「重写了同样内容」）、GIF 断言宽160+时长3s+画面是右下象限（缺一项就漏掉两趟中的一趟）。见 skill video-clip。
- `2026-09-02` **Spine 预览补骨骼统计**（用户插队的小功能）：骨骼数量 + 最大骨骼深度。**零新依赖、零 IPC** —— Spine 解析本来就全在渲染进程，`skeletonData.bones` 现成。纯函数放 `src/utils/spine.ts`（`analyzeBones`），入参用结构化的 `BoneLike {name,parent}` 而非 `BoneData`，于是断言不必造 Spine 实例；这也是 utils 而非 composable 的理由（同 `utils/timeline.ts`）。**深度口径定为 root 记作第 1 层**（不是 0）：面板是给人看「这套骨架有几层」，只有一根 root 说成「0 层」反直觉，且这样 `deepestChain.length === maxDepth` 恒成立、读数与链条能互相对上。面板顺带显示**最深的那一条链**（`root › hip › thigh › …`）——光一个数字没法定位，给出链条才能直接去 Spine 里找那截；并列最深取 `bones` 里靠前的一条（可复现）。这块**不跟随「显示包围盒」开关**、加载后常显（包围盒那格是调试用的临时开关，骨骼规模是每次导入都想看的）。**两条实测**：① 文档说 `SkeletonData.bones` "sorted parent first"，实测合法文件确实如此，所以单趟累加父深度本来就够，实现仍写成记忆化回填只为不把别人的实现细节当前提，代价一个 Map、10000 根直链上反而比逐根上溯快 **18×**（3.8ms vs 68ms，300 根的真实量级两者都 0.06ms 级）；② **json 里子骨骼写在父之前时 `SkeletonJson` 不报错** —— 它走 `skeletonData.findBone(parentName)`，前向引用找不到就**静默返回 null**，那根骨骼被当成又一个 root（Spine 自己的渲染也一样错位），所以面板读数如实反映运行时手里的父子关系不替它猜，且**环形父子引用在任何文件里都不可能出现**，代码里的环检测纯属保险（真出现也只能读数不准，不能把渲染进程转死）。**20 条断言全绿**：A 组纯函数（空/单 root/直链/分叉/并列取靠前/打乱顺序/森林/环不死循环/深前缀宽树）、B 组直接 `import '@esotericsoftware/spine-core'` 用真 `SkeletonJson` 解手写 4.2 json 验上面两条（无 slots/skins 时 attachmentLoader 用不上、可传桩）、C 组成本。见 skill spine-preview。

**工程 / 打包**
- `2026-08-21` **electron-builder 接入**：**两条命令、输出分开**——`pnpm build:dir` 出免安装 `release/unpacked/win-unpacked`（`--dir` 跳过 installer，快），`pnpm build:setup` 出 `release/installer/` 下 NSIS 安装包 + portable（各自 `-c.directories.output` 覆盖）。均先 typecheck + electron-vite build。配置在 `electron-builder.yml`。**原生模块 asarUnpack**：`sharp`/`@img`（sharp .node）、`@ffmpeg-installer`/`@ffprobe-installer`（.exe）——不解包则 asar 内无法 require/spawn；实测都落在 `app.asar.unpacked`。**统一图标**取标题栏的 `CubeOutline`：`build/icon.svg` → sharp 渲成 `build/icon.png`+`public/icon.png`，electron-builder 自动生成 .ico 并嵌入 exe（旧图标是 Windows 图标缓存未刷新，非配置问题），窗口/favicon/安装包三处同源，换图标只改 svg 重渲。pnpm 10+ 不装其它平台可选二进制，打包 warn 一串非本平台的包可忽略。见 skill packaging。

**字体工具**
- `2026-08-26` **#16 字体裁剪**（第一轮，按字符裁单文件）：新依赖 **subset-font**（harfbuzz WASM 裁剪）+ **fontkit**（读元信息），纯 JS/WASM、主进程用、externalize 无 asarUnpack。`subsetFont(buf,chars,{targetFormat})` 的 targetFormat 只认 `truetype/sfnt/woff/woff2`（ttf→truetype、otf→sfnt）。三来源字符集合并去重（手输+文件提取+预设 charset.ts，滤掉换行）覆盖 #17 格式转换。**FontFace 实时预览**（用户要求）：`subsetPreview` 固定 woff2 → data URL → `new FontFace` 挂载渲染保留字符，缺字露豆腐块正好验证按字符裁；需 CSP 加 `font-src 'self' data:`，切换/卸载 `document.fonts.delete` 防累积。另加通用 `file:readText`。脚本验证 8 断言（含「只裁 A 时『世』落 .notdef」证明真按字符裁 + 四格式魔数）。**网页分包（cn-font-split）留第二轮**——与 subset-font 目标不同（分包+CSS vs 指定字符裁单文件）。见 skill font-subset。
- `2026-08-26` **字体网页分包**（#16 第二轮）：新依赖 **cn-font-split**（Rust FFI via koffi）独立路由页 `/font/split`，把大字体切成多个 unicode-range 分包 + CSS。**关键坑：包里不自带二进制**——`libffi-<平台>.dll` 由 postinstall 从 GitHub releases 下载；pnpm 默认忽略 postinstall，须把 `cn-font-split` 加进 `pnpm.onlyBuiltDependencies` 才自动拉，否则 FFI load 报错。打包 asarUnpack 加 `cn-font-split/**` + `koffi/**`（原生二进制），且只覆盖打包机平台。字段坑：`languageAreas`(复数)/`testHtml`/`targetType`(字符串)。单字体流程页（非批量列表），产物落「输出目录/字体名/」子目录。脚本验证 arial 切 47 分包+CSS(含 @font-face/unicode-range)+testHtml，160ms。见 skill font-split。
- `2026-08-26` **分包多格式输出**（font-split 增强）：实测 cn-font-split **只出 woff2**（targetType 无效），要 woff/ttf 回退用 **subset-font 逐 chunk 转格式**——读 chunk woff2 的完整字符集(`fontkit.characterSet`)喂 subset-font 才不丢字，再**重写 CSS 的 src** 为 `woff2,woff,truetype` 多 url 回退(format 关键字 ttf→truetype)。「保留原格式」按源扩展名并入。曾误做成多格式分目录，已纠正为单目录单 CSS + src 多格式。搜索确认无单库能「分包+多格式+CSS」(subfont/glyphhanger 不多分包或依赖 Python)，故 cn-font-split(分包)+subset-font(转格式) 组合。脚本 37 断言过（三格式齐全/不丢字/src 顺序）。**woff2 后改为同样可选**：分包必先产 woff2（库限制），未勾则转完其它格式后删掉 woff2 中间文件、CSS src 也不含它；全不选时前端禁开始、主进程兜底留 woff2。脚本另验「只勾 ttf」4 断言。
- `2026-08-28` **#17 字体格式转换**（独立页 `/font/convert`）：**实测否掉了 PLAN 原「subset-font 传全字符即纯转换、可并入 #16」的判断**，两条硬结论。① **subset-font 不转字形轮廓**：ttf 源传 `targetFormat:'sfnt'`(otf) 返回字节与 `'truetype'` 完全相同（同 sha1、魔数仍 `00010000`），OTTO 源不论传什么仍是 OTTO——ttf⇄otf 要重建全部轮廓（glyf↔CFF），现有依赖做不到，故**本页不给 OTF 选项**（给个实际输出 ttf 字节的「otf」是骗人），面板写明原因；OTTO 源勾 ttf 产物仍是 OTTO 这一限制也如实记录、不假装。② **「传全字符」会丢字形**：arial 4503 个字形喂全 `characterSet` 只剩 4161（丢 342，连字/异体字只经 GSUB 可达、cmap 无码位）。故转换改用 **`fontverter`**（本是 subset-font 的传递依赖，**仍要显式进 dependencies**，否则 subset-font 升级会静默炸 + externalizeDepsPlugin 只认 dependencies），API 仅 `detectFormat`/`convert`，纯 JS/WASM **无需 asarUnpack**、无 .d.ts 靠 `noImplicitAny:false` 通过（同 subset-font/fontkit）；三格式全部 4503 字形无损。**裁剪页继续用 subset-font（那里丢字形正是目的）**。四个坑：`.ttc` 提前判 `ttcf` 魔数给中文提示（否则 fontverter 抛无意义的英文 signature 错）、**目标路径 === 源路径时记 skipped 绝不原地重写**（毁源风险）、临时文件+rename、同格式转同格式仍照写（0ms 直通=拷贝，不做聪明省略）。**进度只到「第几个格式」粒度**：`convert` 是不可分割的 async 调用无回调，**不编造百分比**；因一格式一推故不需 300ms 节流（区别于 ffmpeg 每秒几十行）。取消无子进程可杀、只置标记在循环开头查，**正在编码的格式会跑完**（woff2 大字体最长 ~12s），`canceled` 不是错误、行退回 pending（`TaskStatus` 无 canceled 态）。woff2 慢是硬约束（simhei 9.7MB → 11.7s）故严格串行。`registerFontIpc()` 由无参改为收 `win`。脚本 44 断言过（含无损对照组、OTTO 限制、不毁源 sha1+mtime、round-trip、覆盖两向、取消两时机），另在**真实 Electron 主进程**验 fontverter 能加载 WASM。见 skill font-convert。
- `2026-08-31` **#18 位图字体**（双 tab 页 `/font/bitmap`，字体工具收官）：**零新依赖**——fontkit（已有）取字形路径与度量 + sharp（已有）读 SVG 出 PNG，仓库此前没有任何字形栅格化能力，全靠实测把风险排掉。排除 `msdf-bmfont-xml`（拖 jimp/opentype.js/handlebars/update-notifier/cli-progress，只为它几十行的 packer + fnt writer 不值）。**PLAN 原文只写了「图片 + 字符映射」一个方向，实际主流需求是反向的（从 ttf 烘），用户定两个都做同页两 tab**；字体→位图的字符集收集与 #16 裁剪**完全同构**（手输 + txt/json 提取 + 预设，三来源合并去重）。五条实测结论：① **必须整页一个 SVG，不能逐字形 composite**——3500 CJK 13524ms→600ms（22×）且两法**像素完全相同**（差异 0），验证脚本第 2 条就是守这个的；② **bbox 取整必须分轴 floor/ceil**，我第一版 `ceil(maxX-minX)` 左右各丢半像素、导致按度量摆放与整串排版差 518 个像素（max 226），arial 65 个字形里 32 个受影响，改分轴后归零；③ **缺字只能用 `hasGlyphForCodePoint()`**——`layout('中')` 在 arial 上返回 id=0 但 `glyph.codePoints` 是上次调用残留的 `[20013]`，照它判断会给用户一张全豆腐块的图集；④ 描边 bbox = glyph bbox ± strokeWidth **刚好够**（`paint-order="stroke"` 让描边在填充下面，`stroke-width` 在字形坐标系要 `/scale` 且 `×2`），7 个字形实测 ink 尺寸 === 声明尺寸；⑤ **高度降序 shelf 不复用 image.ts 的固定网格**（94 ASCII @48px：网格 28.4% vs shelf 79.7% 满页），**但占用率这数要会读**——它随页宽与末页装载量剧烈变化（1024 宽摊成扁长条 58.4%、256 宽分两页拉到 55.5%），别拿单个数字当回归断言。描述文件 **.fnt/.xml/.json 同源三编码**（Cocos/Unity/LibGDX、Pixi、Phaser 各吃一种）；**`scaleW/scaleH` 是 common 行的全局字段不是 per-page**，故各页尺寸统一取最大值，否则引擎在非首页整体错位。kerning 用成对 `layout()` 差值反推（fontkit 无公开读表 API），95 ASCII → 9025 次 / 84ms / 95 对，**硬限 200 字符**（3755 汉字是 1410 万对，且 CJK 本无 kerning），前端禁用 + 主进程兜底。落盘 `writeAllAtomic` 全成才留——**缺一页 PNG 的 .fnt 是坏数据**，引擎渲空白字比什么都没有更难查。**顺手修掉 `COMMON_HANZI_3500` 名实不符**（实际 322 字、去重 306、有重复字；裁剪场景只是少裁几个字，位图场景字数直接决定图集页数与耗时），换成可程序化推导校验的 `COMMON_HANZI_GB2312_L1`（0xB0A1–0xD7F9，末行只到 0xF9，3755 字）。**验证 esbuild 打包法 12 组 46 断言全绿**（只换 `./helper` 一处 import 为记录型桩，连 `registerBitmapFontIpc` 一起验），**抓到一个真 bug**：末页渲染期间收到的取消循环里查不到（没有下一轮），两页任务会照样落盘一整套——循环后补一查，`generateFromFont`/`packImages` 都加。自己踩的两个断言坑：参照排版必须也用整数前进量（BMFont `xadvance` 按规范是整数，拿浮点比只量得到量化误差）、断言占用率前先确认没分页。基准：3755 CJK @48px pageSize=2048 → 2 页 2048×2037，度量+装箱 178ms、出图 742ms。见 skill font-bitmap。
