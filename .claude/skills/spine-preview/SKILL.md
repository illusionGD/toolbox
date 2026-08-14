---
name: spine-preview
description: Toolbox Spine 预览工具（媒体工具下）——Pixi v8 + spine-pixi-v8 4.2，从原生 File/objectURL 加载 atlas+png+json，播放/切换/暂停
---

# Spine 预览（媒体工具）

拖入/选择 Spine 4.2 素材（atlas + png + json/skel），Pixi 渲染并播放动画。基于 [[app-layout]] 的 ToolPageLayout。

## 技术栈（已探路验证包可用）

- **PixiJS v8**（`pixi.js ^8.19`）+ **`@esotericsoftware/spine-pixi-v8@~4.2.119`**（Spine 官方 4.2 runtime，peer `pixi.js ^8.16`）。
- **Spine runtime 版本必须匹配素材导出版本**：此工具锁 4.2，导入非 4.2 素材会解析失败。要支持其它版本需另装对应 spine-pixi-v8 主版本。

## 文件读取（不经 IPC）

- 用**原生 File 对象**：拖放取 `DataTransfer.files`，或隐藏 `<input type="file">`。**不走 useFileDrop/pickFilesApi**（那两个只给磁盘路径，渲染进程无法 `fetch('file://')`，会被 CSP 拦）。
- File 直接 `.text()`（atlas/json）、`.arrayBuffer()`（skel）、`URL.createObjectURL()`（png）。
- **CSP**：index.html 需 `img-src ... blob:` + `connect-src 'self' blob: data:`（Pixi 用 blob URL 加载纹理），已加。
- **Pixi + 严格 CSP**：Pixi v8 默认用 `new Function` 编译着色器，需 `unsafe-eval`。我们保持严格 CSP，改在 `main.ts` 顶部 `import 'pixi.js/unsafe-eval'`（官方 polyfill，用预编译替代 eval，**无需**开 unsafe-eval）。否则报 "Current environment does not allow unsafe-eval"。

## 核心实现

- `src/composables/useSpine.ts`：
  - `load(files)`：`new TextureAtlas(atlasText)` → 遍历 `atlas.pages`，按 `page.name` 从拖入 images 取 File → `Assets.load({src: objectURL, loadParser: 'loadTextures'})` → `page.setTexture(SpineTexture.from(tex.source))`。
  - skeleton：`.json` 用 `SkeletonJson.readSkeletonData(JSON.parse(text))`；`.skel` 用 `SkeletonBinary.readSkeletonData(Uint8Array)`；均配 `AtlasAttachmentLoader(atlas)`。
  - `new Spine(skeletonData)` 加到 stage，居中。
  - 播放：`spine.state.setAnimation(0, name, true)`；暂停：`spine.autoUpdate = false`。
  - objectURL 在 clearSpine 时 `revokeObjectURL` 释放；dispose 销毁 app。
- `src/views/media/SpinePreviewView.vue`：拖放区 + Pixi 画布容器 + 右侧动画下拉/暂停/重播；按扩展名分类 File（.atlas/.json|.skel/.png，png 进 Map 支持多张）。
- 路由：navigation 加 `media-spine`，router `TOOL_COMPONENTS['media-spine']`。

## 边界 / 后续

- 仅 Spine 4.2。多版本、缩放/拖拽画布、播放速度、皮肤切换等未做。
- png 靠**文件名**与 atlas 里的 page 名匹配——文件名被改过会报“缺少贴图文件：xxx”。
- 未做打包验证；pixi/spine 纯 JS 依赖，随 renderer bundle 打包，无 native 问题（不同于 sharp）。

## 验证

`format/lint/typecheck/build/dev` 全绿。实际渲染需人工：拖入一套 4.2 素材 → 显示模型、动画下拉可切、暂停/继续/重播生效。
