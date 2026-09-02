---
name: spine-preview
description: Toolbox Spine 预览工具（媒体工具下）——Pixi v8 + spine-pixi-v8 4.2，从原生 File/objectURL 加载 atlas+png+json，播放/切换/暂停、骨骼数量与最大骨骼深度统计
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

## 骨骼统计（骨骼数量 / 最大骨骼深度）

`src/utils/spine.ts` 的 `analyzeBones(bones)` → `{count, maxDepth, deepestChain}`，在 `load()` 里对 `skeletonData.bones` 算一次写进 `boneStats`。**放 utils 不放 composable**：纯函数，可脱开 Pixi/Spine 运行时单独跑断言（同 [[video-clip]] 的 `utils/timeline.ts`）。入参用结构化的 `BoneLike { name, parent }`，`BoneData` 天然兼容，测试也就不必造 Spine 实例。

- **深度口径：root 记作第 1 层**（不是 0）。面板要给人看「这套骨架有几层」，只有一根 root 说成「0 层」反直觉；这样 `deepestChain.length === maxDepth` 恒成立，读数与链条能互相对上。
- 面板顺带显示**最深的那一条链**（`root › hip › thigh › …`）。光给一个数字没法定位，给出链条才能直接去 Spine 里找那截。并列最深时取 `bones` 里靠前的一条（结果可复现）。
- **不跟随「显示包围盒」开关**，加载后常显——包围盒那块是调试用的临时开关，骨骼规模是每次导入都想看的。

### 实测记的几条（不是照文档抄的）

- 文档说 `SkeletonData.bones` "sorted parent first"，**实测合法文件确实如此**，所以单趟累加父深度本来就够。实现仍写成记忆化的「往上收集未定深度的祖先再自上而下回填」，只为不把别人的实现细节当前提；代价一个 Map，10000 根直链上反而比逐根上溯快 **18×**（3.8ms vs 68ms）。300 根的真实量级两者都是 0.06ms 级，无所谓。
- **json 里子骨骼写在父之前时 `SkeletonJson` 不报错**：它走 `skeletonData.findBone(parentName)`，前向引用找不到就**静默返回 null**，那根骨骼被当成又一个 root（Spine 自己的渲染也一样错位）。所以① 面板读数如实反映运行时手里的父子关系，不替它猜；② **环形父子引用在合法/非法文件里都不可能出现**，`analyzeBones` 里的环检测纯属保险（真出现也只能读数不准，不能把渲染进程转死）。
- `BoneData.parent` 是**对象**而非名字字符串；root 的 parent 为 `null`；多 root（森林）要能算，所以深度不是「到 bones[0] 的距离」而是「到自己那条链的顶」。

## 边界 / 后续

- 仅 Spine 4.2。多版本、缩放/拖拽画布、皮肤切换等未做（播放速度、包围盒、骨骼统计已做）。
- png 靠**文件名**与 atlas 里的 page 名匹配——文件名被改过会报“缺少贴图文件：xxx”。
- 未做打包验证；pixi/spine 纯 JS 依赖，随 renderer bundle 打包，无 native 问题（不同于 sharp）。
- 骨骼统计只算**骨骼**。IK/transform/path/physics 约束、slot、attachment、skin 的数量未统计；真要做性能评估这些也是成本项，属后续。

## 验证

`format/lint/typecheck/build/dev` 全绿。

`analyzeBones` 走 esbuild 打包法（同 [[video-clip]]）由 node 直跑生产代码，**20 条断言全绿**：A 组纯函数（空/单 root/直链/分叉/并列取靠前/打乱顺序/森林/环不死循环/深前缀宽树），B 组直接 `import '@esotericsoftware/spine-core'` 用真 `SkeletonJson` 解一份手写 4.2 json（无 slots/skins 时 attachmentLoader 用不上，可传桩），验运行时给出的 `bones` 形状与上面那几条实测结论，C 组成本。

实际渲染需人工：拖入一套 4.2 素材 → 显示模型、动画下拉可切、暂停/继续/重播生效；骨骼数量/最大深度与 Spine 编辑器里的层级对得上。
