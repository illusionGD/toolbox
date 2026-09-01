---
name: font-subset
description: Toolbox 字体裁剪工具（字体工具下，P3-16 第一轮）——subset-font 按字符集裁字体+可选转格式(TTF/OTF/WOFF/WOFF2)，fontkit 读元信息，批量+FontFace 实时预览；网页分包(cn-font-split)留第二轮
---

# 字体裁剪（P3-16，第一轮：按字符裁单文件）

字体工具首个真实功能，路由 key `font-subset`、路径 `/font/subset`（导航/推荐早有占位）。按指定字符集裁出精简字体，顺带覆盖 #17 格式转换。重活走主进程，IPC 走 [[toolbox-ipc-contract]]、`Api` 后缀。

**范围**：本轮做「按字符裁单文件」（subset-font）；「网页分包+CSS」（cn-font-split，大字体→unicode-range 分包）留**同页第二 tab 下一轮**——两者目标不同，别混。

## 依赖（新引入，纯 JS/WASM，无原生编译、无 asarUnpack）

- **`subset-font`** — harfbuzz WASM + fontverter，`subsetFont(buffer, chars, { targetFormat })` → 裁剪后 Buffer。**targetFormat 只认 `'truetype'|'sfnt'|'woff'|'woff2'`**：我方 `ttf→truetype`、`otf→sfnt`、woff/woff2 同名（见 font.ts `TARGET_FORMAT`）。CommonJS 默认导出。
- **`fontkit`** — 读字体元信息。`fontkit.create(buffer)` 返回单字体或字体集合（TTC 有 `.fonts` 数组），用 `firstFont()` 统一取第一个；字体名 `font.familyName`、字形数 `font.numGlyphs`。
- 都被 electron-vite `externalizeDepsPlugin` 外部化；纯 JS/WASM 不涉及打包 asarUnpack（区别于 sharp/ffmpeg）。

## 主进程（`electron/main/ipc/font.ts`）

`FONT_CHANNELS`：`probe`（元信息）/ `subsetPreview`（只裁不写，固定 woff2 → data URL）/ `subset`（裁剪落盘）。类型 `FontOutputFormat`(original|ttf|otf|woff|woff2)/`FontMeta`/`FontSubsetOptions`/`FontSubsetResult`。

- `subsetOne`：`readFile`→`subsetFont`→`writeFile`。输出名沿用源基名+目标扩展名；覆盖模式写回源目录、格式变了 `unlink` 旧扩展名文件（同 image 的 writeOutput 语义）。`resolveFormat` 把 original 按源扩展名映射、未知回退 ttf。
- `subsetPreview(filePath, chars)`：只裁不写，**固定 `targetFormat: 'woff2'`**（体积小、FontFace 支持好）→ `data:font/woff2;base64,...`。空字符集用占位空格避免 subset-font 抛错。
- `probeFont`：fontkit 读 familyName/numGlyphs/size，失败不阻断（列表显示用）。
- `registerFontIpc()` 在 [electron/main/index.ts](electron/main/index.ts) 调用（无参，同 registerImageIpc）。
- **另加通用 `file:readText`**（file.ts）：读文本 utf-8，供「从文件提取字符」；service `readTextApi`。

## 渲染页（`src/views/font/FontSubsetView.vue`）

- ToolPageLayout。主区：字体列表（字体名/字形数/原大小/裁后/体积变化/状态，套 [[image-crop]] 分页 + `createTaskQueue(4)` 探测元信息，`probeRequested` 防重复）+ **底部预览区**。右面板：保留字符（三来源）+ 输出格式 + 输出目录 + 覆盖 + 裁剪按钮。
- **字符集三来源合并去重**（`finalChars` computed）：手输 textarea + 从文件提取（`pickFilesApi` 选 txt/json → `readTextApi` 全文）+ 预设勾选（`src/constants/charset.ts`：ASCII/数字/中英标点/常用汉字3500）。**过滤掉 `\n`/`\r`**（换行不该进字符集）。实时显示「共 N 个字符」。
- **FontFace 实时预览**（用户要求）：点「预览选中字体」→ `subsetPreviewApi` 拿裁剪后 woff2 data URL → `new FontFace(family, url(dataUrl))` → `await face.load()` → `document.fonts.add(face)`，预览区 `font-family` 指向它，渲染保留字符。缺字会退化默认字体/豆腐块，正好暴露漏裁。切换/卸载 `document.fonts.delete(oldFace)` 防累积（`onBeforeUnmount` 也清）。**CSP 需 `font-src 'self' data:`**（已加 index.html）。
- 批量：有勾选只裁选中、否则全部，串行回写行状态（同图片各页）。textarea 加 `spellcheck:false`（同二维码页，避免红波浪线）。

## 接线

`router` import `FontSubsetView` + `TOOL_COMPONENTS['font-subset']`（唯一离 placeholder 的改动）；`views/font/types.ts` 加 `FontItem`；preload `window.api.font.{probe,subsetPreview,subset}` + `window.api.file.readText`；service `src/services/font.ts`（probeFontApi/subsetPreviewApi/subsetFontApi，均 silent）+ file.ts 加 `readTextApi`。navigation/recommend 里 `font-subset` 已存在。

## 验证

typecheck(node+web)/build/lint 全绿。**脚本验证**（跑完即删，8 断言过，用 C:/Windows/Fonts/arial.ttf）：裁「Hello 世界」明显变小、fontkit 重解字形数减少、指定字符有非 .notdef 字形；四种 targetFormat 魔数正确（wOF2/wOFF/ttf 0100/sfnt 非空）；**只裁「A」时「世」落 .notdef**（证明真按字符裁）。UI 人工验证：导入字体→列表出字体名/字形数→输入字符/选文件/勾预设→选格式→裁剪→列表出裁后大小与体积变化；预览区用裁剪后字体渲染、**故意少输一字看豆腐块**；批量多字体同一字符集裁；覆盖模式换格式扩展名正确。

## 后续（不在本轮）
- 同页第二 tab「网页分包」用 cn-font-split（大字体→unicode-range 分包+CSS，给网站 @font-face 按需加载）。
- #17 独立格式转换：subset-font 传全字符集即等于纯转换，可并入本页。
