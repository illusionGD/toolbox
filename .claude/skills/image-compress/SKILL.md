---
name: image-compress
description: Toolbox 图片压缩工具 + 子页面通用模板(ToolPageLayout)，主进程 sharp 压缩/缩略图/预览
---

# 图片压缩（P1-7）+ 子页面模板

首个真实工具，同时定型子页面模板。基于 [[common-capabilities]]，重处理走主进程 sharp（见 [[project-scaffold]] 决策）。

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

## 主进程 / IPC

- `electron/shared/channels.ts` — `IMAGE_CHANNELS`（thumbnail/dataUrl/compress）。
- `electron/shared/types.ts` — `ImageOutputFormat`(original|jpeg|png|webp|avif)、`CompressOptions`、`CompressResult`。
- `electron/main/ipc/image.ts` — `registerImageIpc()`：
  - `makeThumbnail`（64px webp data URL，列表预览）、`readDataUrl`（原图 data URL，对比大图）、`compressOne`。
  - `compressOne`：rotate() 修正 EXIF 方向 → 可选 resize(withoutEnlargement 仅缩小) → 按格式编码。**original 格式沿用源扩展名**。png 无 quality，用 `compressionLevel=(100-q)/100*9` 近似。
  - **覆盖原文件**：先 `toBuffer()` 再 `sharp(buffer).toFile(sourcePath)`——sharp 不能读写同一路径，必须经 buffer 中转。
- `electron/preload` 暴露 `window.api.image.{thumbnail,dataUrl,compress}`；`src/services/image.ts` 门面。

## 渲染页

- `src/views/image/ImageCompressView.vue` — 套 ToolPageLayout：操作栏(添加文件/文件夹/清空) + 文件表(缩略图/文件名/原大小/压缩后/压缩率/状态/操作) + 参数面板(输出格式/压缩模式/质量/最大宽度/输出目录/覆盖原文件/开始压缩) + 底部统计(原总/压缩后/总压缩率)。
- `src/views/image/types.ts` — `CompressItem extends FileItem`（+thumbnail/compressedSize/ratio/outputPath）。
- `src/components/common/ImagePreviewModal.vue` — 原图/压缩后并排对比大图（懒加载 data URL）。
- 列表按 path 去重、缩略图异步加载不阻塞；压缩逐张串行、回写状态/进度。
- **勾选**：n-data-table `type:'selection'` 列 + `v-model:checked-row-keys`。有勾选时「开始压缩」只处理选中项（按钮文案变「压缩选中(N)」），无勾选处理全部；操作栏「移除选中」批量删。
- **缩略图响应式坑**：异步 setThumbnail 必须通过 id 回查 `items.value.find` 拿响应式项再赋值——不能改 push 前的原始对象（改不到代理，不触发更新）。
- **路由接入**：`src/router/index.ts` 的 `TOOL_COMPONENTS` 映射 `image-compress → ImageCompressView`；其余工具仍走 PlaceholderView。**新工具实现后在此表登记即可。**

## 关键约定 / 边界

- 压缩模式(快速/均衡/高质量)切换只是设默认 quality(60/75/90)，用户仍可微调滑块。
- **配置持久化**：整个参数面板经 `useToolConfig('image-compress', defaults)` 记住上次使用（格式/质量/模式/最大宽度/输出目录/覆盖/各格式高级选项）。见 [[common-capabilities]]。
- **按格式高级选项**：选非 original 格式时展开 n-collapse「高级设置」。类型见 shared/types 的 `FormatAdvanced`（jpeg: progressive/mozjpeg/chromaSubsampling；png: compressionLevel/progressive/palette；webp: lossless/effort；avif: lossless/effort）。主进程 `applyFormat` 消费；缺省用 sharp 默认。
- 「添加文件夹」目前仅提示，递归扫描后续实现。
- 压缩串行执行（稳、进度直观）；大批量若需提速可改并发池。
- 覆盖原文件时忽略输出目录；未覆盖时必须先选输出目录才能开始（canStart 约束）。
- 面包屑在 ToolPageLayout 里字号 12px（较小），gap 收紧。

## 验证

`format/lint/typecheck/build/dev` 全绿；sharp 压缩管线以真实图片验证（resize+webp 压缩率 92%、输出生成、覆盖路径 OK）。UI 交互需人工验证：加图→出缩略图→选参数→开始压缩→列表出压缩后大小/率、底部统计、预览对比。
