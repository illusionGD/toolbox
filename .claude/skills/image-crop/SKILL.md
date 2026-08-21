---
name: image-crop
description: Toolbox 图片裁剪工具（P1-9），sharp trim 自动去边 + extract 手动拉框 + 统一输出画布，含 CropCanvas 交互组件
---

# 图片裁剪（P1-9）

PLAN 原文只写「透明区域裁剪 + 阈值」，但功能名叫「图片裁剪」，实现范围经确认扩到**两种模式**：

- **自动去边**：批量去掉透明 / 纯色边缘，可调阈值、内边距、线稿模式、指定背景色。
- **手动框选**：画布上拖框，逐张各自设定，另有「应用到全部」（序列帧 / 图集的常见需求）。
- **统一输出尺寸**：可选开关，默认关。开启后取所有结果的最大宽高作画布，各图居中放入、四周补透明边。

复用 [[image-compress]] 的全部地基（ToolPageLayout、sharp 能力边界、`resolveFormat`/`applyFormat`/`writeOutput`、`useToolConfig`、`useFileDrop`、`ImagePreviewModal`），只新写了一个 `CropCanvas.vue`。

## 主进程

`electron/main/ipc/image.ts` 追加两个 handler（走 [[ipc-contract]] 的 `handle()` wrapper）：

- **`probeCrop(filePath, auto)`** — 只算不写，返回 `{width, height, rect}`。列表在**处理前**就显示会裁成多大，而不是跑完才知道。
- **`cropOne(sourcePath, options)`** — `trim` 或 `extract` → 可选 `fitCanvas` → `applyFormat` → `writeOutput`。

### sharp 的裁剪行为（全部实测得出，勿照抄文档）

1. **`trim()` 不返回矩形**。唯一的位置信息是 `OutputInfo.trimOffsetLeft/Top`，且是**负数**（内容偏移取负），要 `-(offset)` 才是坐标。宽高从 `info.width/height` 拿。
2. **全透明图 `trim()` 不抛错**，返回的是**整张原画布**（实测 120x90 全透明 → rect 就是 120x90）。计划里假设它会抛错，是错的。仍保留 try/catch 兜底，但不能靠 catch 来判断「无内容」。
3. **`extract()` 的拒绝面比想象宽**：越界 → `extract_area: bad extract area`；小数 → `Expected integer between…`；负数、0 宽高（报 `parameter width not set`）同样报错。拉框来的坐标既可能是小数也可能差一两像素，**必须先 `clampRect` 取整 + 钳制**，别指望前端保证。
4. **`extend()` 不接受负 padding**：内容比目标画布大时直接抛错。故 `fitCanvas` 先比较尺寸，大了走 `resize({fit:'contain', background})`（自带居中补边），小了才 `extend`。奇数差值用 `floor`/`ceil` 分摊，保证加起来正好等于目标尺寸。
5. **裁剪绝不能开 `animated:true`**。多帧图在 sharp 里是**各帧按 pageHeight 竖排的一张长图**，`extract` 的坐标系会落到那张长图上，语义完全错（实测 `sharp(buf,{animated:true}).extract({...60x180})` 直接抛 `bad extract area`）。裁剪一律只处理首帧，面板上给明确提示。
6. **必须 Buffer 输入**——见 [[image-compress]] 第 3 条坑。裁剪要先 `metadata()` 探尺寸再处理，路径输入会留下句柄，覆盖模式必崩。

### 本轮修掉的一个跨功能缺陷

上一轮以为「只有覆盖模式要 Buffer 输入」，实际 **`makeThumbnail` 的路径输入就已经留下句柄**——列表里每张图加进来都会先生成缩略图，之后「覆盖原文件」照崩。已把 `makeThumbnail` / `readDataUrl` / `compressOne`（含非覆盖分支）/ `cropOne` 全改成 Buffer 输入。教训：句柄不随调用结束释放，「这次不写」不等于「不影响下次写」。

## 类型（`electron/shared/types.ts`）

`CropMode`(auto|manual)、`CropRect`(left/top/width/height，与 sharp Region 同形，渲染进程也用它表示拉框结果)、`AutoCropOptions`(threshold/margin/lineArt/background?)、`CropCanvas`(width/height)、`CropOptions`、`CropProbe`、`CropResult`(+`skipped`)。

- `background` 缺省 = sharp 默认行为（取左上角像素色）；显式给才去指定纯色边。
- `skipped` = 输出尺寸等于原图，即没有可裁的边。**如实告诉用户「无可裁边缘」，不假装做了事。**

## 渲染进程

### `src/components/common/CropCanvas.vue`（唯一新组件）

不引第三方裁剪库（naive-ui 没有，为一个页面引 cropperjs 不划算）。

- **坐标约定是核心**：对外与内部**一律用图片原始像素**存 rect，只在渲染时乘 `stage.scale` 换成显示像素，事件反向除回去。反过来（存显示像素）会在窗口缩放时累积舍入漂移，框越拖越偏。
- 容器尺寸靠 `ResizeObserver`，图片按 contain 算出 `stage.{width,height,scale}`。
- 三种拖拽共用 `resizeRect`：空白处按下 = create（等价于从零宽高的框拖 `se` 角）、选区内 = move、手柄 = resize。
- **钳制与比例的顺序**：先钳进画布再套比例。反过来的话钳制会破坏刚算好的比例。
- 拖拽中只更新本地 `local` ref，抬起时才 `emit` 并**取整**——主进程 `extract` 只吃整数，早点取整免得列表显示与实际结果对不上。
- 用 `setPointerCapture` + 在元素自身挂 `pointermove`，比往 window 挂 mousemove 干净，拖出窗口也不丢事件。
- 遮罩用 `box-shadow: 0 0 0 9999px rgba(...)` 外扩，比拼四块 div 省事且不会有缝。

### `src/views/image/ImageCropView.vue`

- 列：勾选 / 缩略图 / 文件名 / 原尺寸 / **裁剪框** / 输出尺寸 / 大小 / 状态 / 操作（✂ 仅手动模式可点、👁 预览、🗑 移除）。
- **加入文件时无论哪种模式都 `probeCrop` 一次**：自动模式要显示包围盒，手动模式要拿原图尺寸给画布用。
- 自动模式的任一参数（阈值/边距/线稿/背景色）变化 → **debounce 300ms 整表重探**。探测不写盘但仍是全图解码，不能每次滑动都打。
- `useToolConfig('image-crop', …)` 持久化整个面板。
- **统一尺寸不需要两轮 IPC**：画布由渲染进程用已有的 `rect`（自动=探测值 / 手动=用户框）取最大宽高算出，再带 `canvas` 一次性调 `cropImageApi`。没有框的项按原图尺寸参与计算，否则画布会小于它的实际输出。
- 手动模式开始前校验「每张图都设了框」，缺框直接拦下而不是默默跳过。
- 提示到位：含动图 → 「只处理首帧」；统一尺寸 + JPEG → 「不支持透明，补边会变成黑色」。

### 「添加文件夹」+ 分页 + 两条限并发队列

基础套路与 [[image-compress]] 完全一致（`useFolderImport` 导入、受控分页 `PAGE_SIZE = 50`、缩略图只为当前页加载 + `thumbRequested` 去重、表格不能开列排序），不重复。裁剪页多出三件事，都是因为它**每项还有一次 `probeCrop`**：

- **缩略图与探测各一条队列，不能合成一条**（`thumbQueue` / `probeQueue`，各 `createTaskQueue(4)`）。因为参数一改整表结果作废，**探测队列必须整条 `clear()` 重排**；而缩略图一旦进了 `thumbRequested` 就不会再入队，跟着被清掉的项会永远留着空白格。共用一条队列 = 调一次阈值滑块就丢掉一批缩略图。
- **`probeAll` 把当前页排在最前面**：`[...visibleItems, ...其余项]`。探测结果是「裁剪框」「输出尺寸」两列的内容，用户盯着的是当前页；按 `items` 原序排会让他先等完前面几百项。**但仍然要探全部项**，不能只探当前页——`computeCanvas`（统一尺寸）需要每一项的尺寸。
- **`handleStart` 因此多了一道闸**：`unifySize` 开启时若有目标项还没探到 `naturalWidth/Height`，直接拦下提示重试。队列化之前「整表探测完才可能点开始」，队列化之后「只探到一部分」成了常态——公共画布会按已知的那几项算出偏小的尺寸，然后**静默把内容裁掉**。`computeCanvas()` 返回 null 那道判断挡不住这种情况，它只管一个都没探到的极端。

`handleClear` 要清 `thumbQueue` + `probeQueue` + `thumbRequested` 三样。

## 验证

`format/lint/typecheck/build` 全绿。sharp 管线以真实图片脚本验证 **34 项全过**（脚本与素材放临时目录，验完即删）：

- 自动：透明边 PNG 包围盒精确等于内容块位置；纯色 JPG 指定 `#ffffff` 可去边；全透明图不崩。
- 阈值/margin：threshold 0 与 50 结果不同；margin=10 四边各多 10px、left/top 各减 10。
- 手动：精确尺寸匹配；越界 rect(180,140,999,999)→ 钳成 20x10；小数 rect → 取整成功；负坐标 → 钳制成功。
- 统一尺寸：三张不同尺寸图 → 输出全部 120x100；u2 内容 40 宽居中（左右各补 40）；内容大于画布 → 等比缩放不抛错。
- 覆盖 + 换格式：png/jpg/gif 各验「同格式原地写回」「换格式后旧文件删除」「新文件可读」。
- 动图：3 帧 GIF 输入 → 输出 40x40 单帧，不是竖排长图。
- **句柄回归**：6 种格式各验「先生成缩略图再覆盖裁剪」不报 UNKNOWN/EBUSY。

UI 交互需人工验证：拖入图片 → 自动模式看裁剪框列 → 调阈值看列联动 → 切手动 → 弹窗拉框（手柄缩放、比例约束、越界钳制）→ 应用到全部 → 开始 → 预览对比 → 覆盖模式生效。

相关：[[image-compress]]、[[ipc-contract]]、[[app-layout]]、[[common-capabilities]]。
