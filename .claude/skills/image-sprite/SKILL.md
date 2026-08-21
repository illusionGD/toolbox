---
name: image-sprite
description: Toolbox 精灵图工具（P1-11，图片工具收尾）——多图网格合并成图集+JSON/CSS/plist坐标，图集按网格/切割线/导入坐标/透明连通域切割成多张小图，含 SpriteSliceCanvas 画布
---

# 精灵图 合并 / 切割（P1-11）

图片工具最后一个、也是数据格式最杂的一个。**一个页面两个 tab**（合并图集 / 切割图集），路由 key `image-sprite`（`/image/sprite`，导航/推荐里早有占位）。重处理走主进程 sharp，复用 [[image-compress]] 的 `writeOutput`/`clampRect`/`applyFormat`/Buffer 铁律，IPC 走 [[toolbox-ipc-contract]]。

**本轮范围**：合并只做**网格排列**（紧凑装箱 MaxRects 顺延，`SpriteLayout` 枚举先留位）；切割做**全部四种**方式。

## IPC（`electron/main/ipc/image.ts` 内新增，`IMAGE_CHANNELS` 加三条）

- `spriteMerge(options)` — 合并，写出图集 + 坐标文件。
- `spriteSliceProbe(filePath, options)` — **只算不写**（同 probeCrop/stylizePreview 形态），返回表尺寸 + 将切出的 `cells`，供画布预览框选。
- `spriteSlice(filePath, options)` — 切割，逐 cell `clampRect`→`extract`→`writeOutput`。

类型见 shared/types：`SpriteLayout`/`SpriteAlign`/`SpriteDataFormat`/`SpriteFrame`/`SpriteMergeOptions`/`SpriteMergeResult`/`SpriteSliceMethod`/`SpriteCell`/`SpriteGridSpec`/`SpriteSliceProbeOptions`/`SpriteSliceProbe`/`SpriteSliceOptions`/`SpriteSliceResult`。沿用 XxxOptions 入 / XxxResult 出、复用 `CropRect`。

## 合并（`mergeSprites`）

1. `readSpriteInputs`：各图 `readFile`→`sharp(buffer).metadata()` 取尺寸（**Buffer 输入铁律**，不 `sharp(path)`）；无法解码的跳过；重名追加 `_n` 保证坐标 key 唯一。
2. `layoutGrid`：按列数排布（`columns<=0` 时 `ceil(sqrt(n))` 近似正方形），**每列取最宽、每行取最高**（不强求等格，省空间且坐标如实反映各帧大小），前缀和 + spacing + padding 算出每帧 `{left,top,width,height}` 与画布总尺寸。`align='center'` 时小图在格内居中。
3. **`sharp({create:{w,h,channels:4,background透明}}).composite(frames.map(...))`** —— 全仓库首次用 composite，输入是各图 buffer（同 Buffer 铁律）。→ `applyFormat` → `writeFile`。
4. `serializeSpriteData`：JSON（PixiJS/TexturePacker hash，key 为 `name.png`）/ CSS（`.sprite-name{background-position:-Lpx -Tpx}`）/ plist（Cocos SpriteFrames，`{{x,y},{w,h}}` 字符串）/ none。坐标文件走 `fs.writeFile`（非图片，不经 writeOutput）。

## 切割（四种 → cells → extract）

- `cellsFromGrid`：按列/行数**或**单元宽高等分（给了数量就反算尺寸，否则用尺寸反算数量），含 spacing/margin。
- `cellsFromLines`：切割线 x/y 各补上 `[0, ...线, 边界]`、排序去重，相邻两条构成一段网格。
- `cellsFromImport`：解析 JSON/plist 反向。**plist 正则必须要求帧名含扩展名**（`[^<]+\.[A-Za-z0-9]+`），否则外层容器 `<key>frames</key>`/`<key>metadata</key>` 会被当成一帧（脚本验证时实测踩到，是真 bug）。
- `cellsFromAuto`：`sharp(input).ensureAlpha().raw()` 读像素，alpha>阈值算不透明，**4 邻接连通域用并查集**（两趟：一趟标记+合并左/上邻居，二趟按根聚包围盒），`minArea` 滤噪点，按 top/left 排序命名。用并查集而非递归 flood-fill 是避免百万像素爆栈。

`spriteSlice`：每 cell `clampRect` 后**新建 sharp 实例** `sharp(input).extract(safe)`（不链式复用，否则 extract 坐标叠加），名字去重后 `writeFile`；非法单元计入 `skipped`。

## 渲染层

- `src/components/common/SpriteSliceCanvas.vue` — **真实 `<canvas>` 画 cell 框**（几百个 cell 用 DOM div 会卡，这是选 canvas 而非仿 RegionCanvas 的原因）+ DOM 层画可拖的切割线（数量少）。坐标机制照抄 [[image-crop]] 的 Crop/RegionCanvas：**对外一律原始像素，render 时乘 scale**；ResizeObserver 求 contain scale。切割线双击空白新增（同时加横+纵）、拖动调整、双击线删除；`v-model:columns`/`v-model:rows`。
- `src/views/image/ImageSpriteView.vue` — ToolPageLayout + `n-tabs`。**两 tab 各一套 `#main`/`#panel` 内容**，但因 Vue 不许两个 `<template #slot>` 指向同一具名插槽，必须在**单个** `#main`/`#panel` 内用 `v-if/v-else` 分流（踩过 `vue/valid-v-slot` 报错）。
  - 合并 tab：照抄 [[image-crop]] 的多图分页列表（`useFolderImport` + 受控分页 50/页 + `createTaskQueue(4)` 只给当前页排缩略图 + `thumbRequested` 防重复）。
  - 切割 tab：`getDataUrlApi` 读整图 data URL 显示（**不走 tb-media**——那是视频协议、要 probe 白名单，图片没登记会 403）；`<img>` 读 naturalWidth/Height 定尺寸；参数/切割线变化经 300ms debounce 触发 `spriteSliceProbe` 重算 cells。
- 两套配置各自 `useToolConfig('image-sprite-merge'|'image-sprite-slice', ...)`。
- `src/views/image/types.ts` 加 `SpriteMergeItem`（FileItem + thumbnail）。
- 接线：`src/router/index.ts` import `ImageSpriteView` + `TOOL_COMPONENTS['image-sprite']`（唯一离 placeholder 的改动）。service 三个 `Api`：`spriteMergeApi`/`spriteSliceProbeApi`（silent）/`spriteSliceApi`。preload `window.api.image.{spriteMerge,spriteSliceProbe,spriteSlice}`。

## 关键约定 / 边界

- 图集输出格式默认 **png**（保透明）；JPG 无透明，间距/空隙会变黑（UI 提示）。format 用 `Exclude<ImageOutputFormat,'original'>`，不给 original（图集一律显式格式）。
- 合并的坐标数据与像素位置由**同一个 `layoutGrid` 结果**生成，天然一致。
- 切割 cells 由**渲染进程确定后传给主进程**（probe 已算好），`spriteSlice` 不重算，只 extract——保证「看到的框」就是「切出的图」。

## 验证

typecheck（node+web）/ build / lint 全绿。**sharp 脚本验证**（跑完即删，未留仓库，共 12+ 断言全过）：
- 合并：3~5 张不同尺寸网格合并，校验画布总尺寸、每帧中心像素颜色落位正确、透明角 alpha=0。
- 切割：extract 每 cell 尺寸/颜色正确。
- 自动检测（**含对照组**）：两分离块→2 盒且包围盒精确；连通 L 形→1 盒；仅对角相邻（4 邻接下）→2 盒；1px 噪点被 `minArea` 滤掉。
- 坐标往返：JSON/plist 序列化→import 解析，帧名/坐标一致（plist 容器 key 不被误当帧——修 bug 后过）。

UI 需人工验证：合并 tab 导图→设列数/间距→合并出表+坐标文件（JSON/CSS/plist 各一）；切割 tab 选表→网格/拖切割线/导入坐标/自动检测各切一遍，画布 cell 框随参数实时变，导出小图。
