---
name: image-qrcode
description: Toolbox 二维码工具（图片工具下）——多行文本批量生成二维码（qrcode，可预览/自定义名/PNG-JPG-SVG/容错级别/颜色）+ 批量解析二维码图片（jsqr + sharp raw），两 tab
---

# 二维码 生成 / 解析

图片工具下的工具，路由 key `image-qrcode`、路径 `/image/qrcode`。单页两 tab（生成 / 解析），同 [[image-sprite]]。重处理走主进程，IPC 走 [[toolbox-ipc-contract]]、`Api` 后缀。

## 依赖（新引入，纯 JS，无原生编译）

- **生成**：`qrcode`（+ `@types/qrcode`）。`QRCode.toBuffer(text,{type:'png'...})` 出 PNG；`QRCode.toString(text,{type:'svg'})` 出 SVG 文本。
- **解析**：`jsqr`（自带类型）。喂 sharp 解出的 raw RGBA：`sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true})` → `jsQR(new Uint8ClampedArray(data), width, height)`。
- 两者只在**主进程**用，被 electron-vite `externalizeDepsPlugin` 外部化；纯 JS 不涉及 asarUnpack（区别于 sharp/ffmpeg）。

## 主进程（`electron/main/ipc/image.ts`，3 函数 + 注册）

`IMAGE_CHANNELS`：`qrGenerate` / `qrPreview` / `qrDecode`。类型见 shared/types：`QrErrorLevel`(L/M/Q/H)、`QrOutputFormat`(png/jpg/svg)、`QrGenerateItem{text,name}`、`QrGenerateOptions`、`QrGenerateResult{outputPaths,failed}`、`QrPreviewOptions`、`QrDecodeResult{path,name,text,ok}`。

- `generateQrCodes(options)` — 逐条生成：svg 走 `toString` 写文本；png 走 `toBuffer`；**jpg 是 qrcode 不支持的，用 sharp 从 png 转码**（`sharp(png).flatten({background:light}).jpeg()`，jpg 无透明须 flatten 到背景色）。文件名由渲染进程定好（模板/序号/手改），这里只重名去重（追加 `_n`）+ 落盘。单条失败（内容超容量/颜色非法）计入 `failed` 不中断整批。
- `generateQrPreview(options)` — 只算不写，返回 png data URL（形态同 stylizePreview）。
- `decodeQrCode(filePath)` — Buffer 输入铁律 → sharp raw → jsQR。**识别不到返回 `ok:false` 而非抛错**（列表每张都要有结果行）；解码异常（损坏/不支持）也吞掉当未识别。

## 渲染页（`src/views/image/QrCodeView.vue`）

- **生成 tab**：左 `n-input type=textarea` 多行（换行=多条，`genLines` computed 去空行）；右预览网格（每格二维码缩略图 + 可编辑名输入框 + 内容文本）。`rebuildGenItems` 防抖 300ms 重建条目 + 排队 `qrPreview`：**按索引对齐旧条目，内容没变则沿用旧名与旧预览**（保住用户手改的名字，不每次输入都重置）。参数面板：输出名模板(`{n}`序号/`{text}`内容)、尺寸、边距、容错、前景/背景色(`n-color-picker`)、格式、输出目录。
- **解析 tab**：照搬 [[image-crop]] 的分页文件列表（`useFolderImport` + 受控分页 50 + `createTaskQueue(4)` 懒加载缩略图 + `thumbRequested` 防重复）。列：缩略图/文件名/解析结果(ellipsis+tooltip)/状态/复制。「开始解析」逐条 `decodeQrApi` 回写 `result`/`decoded`/status；`decoded` 标记区分「未识别」与「还没解析」。结果可单条复制或「复制全部结果」(`name\t result` 逐行，走 `navigator.clipboard`)。
- 两 tab 内容在**单个** `#main`/`#panel` 里 `v-if/v-else` 分流（Vue 不许两个 `<template #slot>` 指向同一具名插槽，同 [[image-sprite]] 踩过）。

## 接线

`router` import `QrCodeView` + `TOOL_COMPONENTS['image-qrcode']`；`navigation.ts` image children 加 `{key:'image-qrcode',label:'二维码',path:'/image/qrcode'}`；`recommend.ts` image 组加项（icon `QrCodeOutline`）；`views/image/types.ts` 加 `QrDecodeItem`。preload `window.api.image.{qrGenerate,qrPreview,qrDecode}`；service `generateQrApi`/`qrPreviewApi`(silent)/`decodeQrApi`(silent)。

## 关键约定 / 边界

- 生成能否成功取决于**内容长度 vs 容量**（容错越高容量越小），超了在 `failed` 计数、UI 提示「内容可能超出容量」。
- `{text}` 做文件名时先替换 Windows 非法字符 `\ / : * ? " < > |` 为 `_` 并截断 40 字，否则落盘失败。
- 预览用小尺寸(240px)省算力，实际输出用面板尺寸；两者同一套 qrcode 参数，所见即所得。
- ACCEPT 解析端含 `bmp`（jsQR 不挑格式，sharp 能解就行；注意 sprite/compress 那边 bmp 是解不了的，此处经 sharp raw 同样受 libvips 限制——bmp 实际仍可能解不了，但不阻断，返回未识别）。

## 验证

typecheck(node+web)/build/lint 全绿。**脚本验证**（跑完即删，7 断言过）：`qrcode`→buffer→sharp raw→`jsqr` 往返：text/URL/中文/200 字长文本各级容错解回一致；SVG 输出 `<svg>...</svg>` 合法；非二维码纯色图 decode 返回 null；jpg 转码后仍能解。UI 人工验证：生成 tab 多行→预览多个码→改参数/改名→生成 PNG/SVG/JPG；解析 tab 批量导入→缩略图→开始解析→结果列；生成的码回喂解析闭环。
