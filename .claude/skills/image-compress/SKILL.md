---
name: image-compress
description: Toolbox 图片压缩/转换工具 + 子页面通用模板(ToolPageLayout)，主进程 sharp 压缩/格式转换/动图/缩略图/预览
---

# 图片压缩 / 转换（P1-7，含并入的 P2-8 格式转换）+ 子页面模板

首个真实工具，同时定型子页面模板。基于 [[common-capabilities]]，重处理走主进程 sharp（见 [[project-scaffold]] 决策）。

**P2-8「图片格式转换」不再单独建页**：压缩页本就有输出格式选择器，另起 `/image/convert` 只会做出一个「参数少一半的压缩页」。改为在本页补齐（放开输入格式、增加 gif/tiff 输出、支持动图、页面更名「压缩 / 转换」），并移除 `navigation.ts` / `recommend.ts` 里的 `image-convert` 占位项。

## 子页面通用模板

`src/components/layout/ToolPageLayout.vue` — 所有工具子页的骨架，具名插槽：
- 固定区：面包屑（含返回首页）+ 标题/描述（props `title`/`desc`/`category`）。
- `#toolbar`（操作栏，可选）、`#main`（左侧主内容）、`#panel`（右侧参数面板，可选）、`#footer`（底部统计，可选）。
- **新工具页直接套用**：`<ToolPageLayout title="…"><template #toolbar/main/panel/footer>`。

## sharp（native 模块）

- **已验证在 Electron 运行时可用**（含 AVIF），sharp 0.35.3 走 prebuilt N-API binary，无需 rebuild。
- 被 `externalizeDepsPlugin` 自动外部化（不打进 main bundle）。
- **类型**：`import sharp, { type Sharp } from 'sharp'`（`sharp.Sharp` 命名空间在本 TS 配置下不解析，须具名 type import）。
- **打包注意（未来）**：electron-builder 打包时需把 sharp 的原生文件与 `@img/*` 依赖一并带上（asarUnpack），届时处理。

### 本构建的真实能力边界（实测得出，勿照抄 sharp 文档）

libvips 8.18.3 是裁剪构建，文档列的格式不等于能用。实测结论：

| 格式 | 解码 | 编码 |
|---|---|---|
| jpeg / png / webp / avif / gif / tiff | ✅ | ✅ |
| svg / heic / heif | ✅ | ❌（编码器未编入） |
| bmp | ❌ | ❌（需 magick loader，未编入） |
| jp2 / jxl | ❌ | ❌ |

- **`ImageOutputFormat` 只列可编码的 6 种** + `original`。
- **只读格式的 original 回退**：`EXT_TO_FORMAT` 里查不到（svg/heic）→ 回退 PNG。
- **`'bmp'` 曾错列在页面 ACCEPT 里**（本轮修掉）：加进来必定报 `Input buffer contains unsupported image format`。

## 主进程 / IPC

- `electron/shared/channels.ts` — `IMAGE_CHANNELS`（thumbnail/dataUrl/compress，+ [[image-crop]] 的 probeCrop/crop）。
- `electron/shared/types.ts` — `ImageOutputFormat`(original|jpeg|png|webp|avif|**gif|tiff**)、`CompressOptions`(+`keepAnimation`)、`CompressResult`(+`outputFormat`/`animated`)。
- `electron/main/ipc/image.ts` — `registerImageIpc()`：
  - `makeThumbnail`（64px webp data URL，列表预览）、`readDataUrl`（原图 data URL，对比大图）、`compressOne`。
  - `compressOne`：rotate() 修正 EXIF 方向 → 可选 resize(withoutEnlargement 仅缩小) → 按格式编码。**original 格式沿用源扩展名**。png 无 quality，用 `compressionLevel=(100-q)/100*9` 近似；gif 无 quality（调色板格式，体积由 `colours` 决定）；tiff 仅 `compression:'jpeg'` 时 quality 才生效。
  - `readDataUrl` 只对 Chromium 认识的 mime（jpg/png/webp/avif/gif/svg）原样回传（保住动图动画），**tiff/heic 等转 PNG 再回传**，否则 `<img>` 是空白。

### 四个必须记住的坑（都是踩过的）

1. **`animated:true` 只能在输出格式支持多帧时开**。sharp 的多帧内存布局是各帧按 `pageHeight` **竖排拼成一张长图**；若目标是 jpeg/png 这类静态格式，会原样编码出一条「帧胶片」长图。故先 `resolveFormat` 再判断 `ANIMATED_FORMATS.has(...)`。
2. **`ANIMATED_FORMATS` 只有 gif 和 webp**。avif 容器规范支持动画，但本构建编码后实测 `pages=1`——按实测而非规范列表。
3. **一切读图都必须用 Buffer 输入，不只是覆盖模式**：`sharp(路径)` 时 libvips 会**长期持有该文件句柄**（不随本次调用结束释放），Windows 上之后写回同一路径报 `UNKNOWN(-4094)`、`unlink` 报 `EBUSY`。实测 jpg/webp/gif 复现，png/tif/avif 不复现——只测 png 会看到假绿。
   - 最初只在 `compressOne` 的覆盖分支改了 Buffer，**仍然会崩**：`makeThumbnail` 是路径输入，而列表里每张图加进来都必然先生成缩略图，句柄早就留下了。`readDataUrl` 的非原生分支、`compressOne` 的非覆盖分支同理——都是「这次不写，却挡住下次写」。
   - 现在 `makeThumbnail` / `readDataUrl` / `compressOne` / `cropOne` 一律 `readFile` 成 Buffer 再交给 sharp。写新 handler 时照做，别为了省一次全文件读入而走路径输入。
4. **写盘用 `writeFile(buffer)`，不要 `sharp(buffer).toFile()`**：后者会用**默认参数重新编码**，前面设的 quality/effort 全丢，且写出的文件大小和返回给前端的 `compressedSize` 对不上。实测 q10=620B / q95=17180B 才算这条修对了。

### `writeOutput` 已抽公共（P1-9 起）

「解析输出路径 + 覆盖时按输出格式改扩展名 + `writeFile` + 换扩展名时 `unlink` 源」抽成了 `writeOutput(sourcePath, buffer, resolvedFormat, {outputDir, overwrite})`，`compressOne` 与 [[image-crop]] 的 `cropOne` 共用。这段逻辑踩过两个坑（扩展名骗人、残留旧格式副本），改动请改这一处，别复制。

### 覆盖模式的扩展名规则

覆盖时输出目录取 `dirname(sourcePath)`，但**文件名扩展名一律按输出格式定**：
- 格式没变 → 路径与源一致，真正的原地覆盖。
- 格式变了（`a.png` → JPEG）→ 写 `a.jpg` 并 `unlink('a.png')`。不这么做就会留下一个内容是 JPEG、名字叫 `.png` 的骗人文件，外加一份旧格式副本。

- `electron/preload` 暴露 `window.api.image.{thumbnail,dataUrl,compress,probeCrop,crop}`（后两个属 [[image-crop]]）；`src/services/image.ts` 门面。

## 渲染页

- `src/views/image/ImageCompressView.vue` — 套 ToolPageLayout：操作栏(添加文件/文件夹/清空) + 文件表(缩略图/文件名/原大小/输出后/**体积变化**/**输出**/状态/操作) + 参数面板(输出格式/压缩模式/质量/最大宽度/**保留动画**/输出目录/覆盖原文件/开始) + 底部统计。
- `src/views/image/types.ts` — `CompressItem extends FileItem`（+thumbnail/compressedSize/ratio/outputPath/**outputFormat/animated**）。
- `src/components/common/ImagePreviewModal.vue` — 原图/处理后并排对比大图（懒加载 data URL）。右栏标签由 `resultLabel` prop 控制（缺省「处理后」），页面按「源格式 == 输出格式」决定传「压缩后」还是「转换后」。
- 列表按 path 去重、缩略图异步加载不阻塞；压缩逐张串行、回写状态/进度。
- **勾选**：n-data-table `type:'selection'` 列 + `v-model:checked-row-keys`。有勾选时「开始压缩」只处理选中项（按钮文案变「压缩选中(N)」），无勾选处理全部；操作栏「移除选中」批量删。
- **缩略图响应式坑**：异步 setThumbnail 必须通过 id 回查 `items.value.find` 拿响应式项再赋值——不能改 push 前的原始对象（改不到代理，不触发更新）。
- **路由接入**：`src/router/index.ts` 的 `TOOL_COMPONENTS` 映射 `image-compress → ImageCompressView`；其余工具仍走 PlaceholderView。**新工具实现后在此表登记即可。**

### 转换相关的 UI 规则

- `qualityEnabled`：gif 恒为 false（调色板格式）；tiff 仅 `compression==='jpeg'` 时 true；其余 true。禁用时滑块灰掉并给 tooltip 说明原因，比默默无效好。
- `hasAnimatable`（列表里有 gif/webp）且 `targetSupportsAnimation`（目标是 original/gif/webp）时才显示「保留动画」开关——不满足时开关无意义，藏掉而不是留个假开关。
- **体积变化允许为负**：转格式经常变大（实测 svg→png +944%），如实显示负数并变色，不要 `Math.max(0, ...)` 把真相截断。
- `useToolConfig` 是浅合并 defaults，新增的 gif/tiff/keepAnimation 字段对老用户会自动补上，无需迁移。

## 关键约定 / 边界

- 压缩模式(快速/均衡/高质量)切换只是设默认 quality(60/75/90)，用户仍可微调滑块。
- **配置持久化**：整个参数面板经 `useToolConfig('image-compress', defaults)` 记住上次使用（格式/质量/模式/最大宽度/输出目录/覆盖/各格式高级选项）。见 [[common-capabilities]]。
- **按格式高级选项**：选非 original 格式时展开 n-collapse「高级设置」。类型见 shared/types 的 `FormatAdvanced`（jpeg: progressive/mozjpeg/chromaSubsampling；png: compressionLevel/progressive/palette；webp: lossless/effort；avif: lossless/effort；**gif: colours(2-256)/dither(0-1)；tiff: compression(lzw|deflate|jpeg|none)**）。主进程 `applyFormat` 消费；缺省用 sharp 默认。
- **「添加文件夹」+ 分页 + 懒加载缩略图是一套**，三条互相依赖，改一条要想到另两条：
  - 导入走 `useFolderImport`（见 [[common-capabilities]]），扩展名过滤在主进程遍历时完成。工具栏「含子文件夹」复选框控制，默认关。
  - 表格**受控分页**，每页 50 行（`PAGE_SIZE`）。分页器受控而非交给 n-data-table 自己管，是因为要知道「当前页是哪些行」才能只给它们加载缩略图。
  - 缩略图**只为当前页加载**，经 `createTaskQueue(4)` 限并发，`thumbRequested` 记已入队的 id 防止翻回上一页重复请求。原先是在 `addFiles` 里逐项 `void getThumbnailApi()`——手挑十几个文件没问题，文件夹导入上千张就是上千个并发 sharp 解码，界面连滚动都卡住。
  - 因此**表格不能开列排序**：分页切片按 `items` 顺序算，一旦表格内部按某列重排，切片与实际渲染的行就对不上，缩略图会加载到别的页去。要加排序得像 [[file-rename]] 那样做成受控排序、切片前先排。
  - `handleClear` 要同时 `thumbQueue.clear()` + `thumbRequested.clear()`，否则清空后重新导入同名文件不会再取缩略图。
- 压缩串行执行（稳、进度直观）；大批量若需提速可改并发池。
- 覆盖原文件时忽略输出目录；未覆盖时必须先选输出目录才能开始（canStart 约束）。
- 面包屑在 ToolPageLayout 里字号 12px（较小），gap 收紧。

## 验证

`format/lint/typecheck/build` 全绿；sharp 管线以真实图片验证（脚本跑完即删，不留在仓库里）：

- 非覆盖转换 7 例：png→webp/gif/tiff、gif→gif(3 帧保住)、gif→png(1 帧、60x60 不是竖排长图)、svg→original(回退 png)、jpg→avif。
- 覆盖模式 7 例：png→jpeg(生成 .jpg、源 .png 已删)、png→png(原地)、jpg/gif/tiff→original(原地，即上面第 3 条坑的回归)、gif→webp(动图)、gif→jpeg(静态)。
- 质量参数确实生效：同源 q10=620B vs q95=17180B。

UI 交互需人工验证：加图→出缩略图→选参数→开始→列表出输出格式/体积变化、底部统计、预览对比（含动图播放）。
