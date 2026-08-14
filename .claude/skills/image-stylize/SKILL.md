---
name: image-stylize
description: Toolbox 图片风格化工具（P1-10），sharp raw 中转多趟管线 + 11 种可叠加效果 + 多区域局部马赛克/模糊，含 RegionCanvas 交互组件与实时预览
---

# 图片风格化（P1-10）

PLAN 原文只写「马赛克、模糊等」，「等」的边界经确认取全量：

- **几何/邻域**：马赛克、高斯模糊、中值滤波、锐化
- **调色**：灰度、复古(sepia)、色调叠加(tint)、亮度/饱和度/色相、对比度、反色
- **二值化**：阈值
- **多效果可叠加，固定顺序**（面板顺序即执行顺序）
- **局部马赛克/模糊**：一张图可框多个区域，区域有**独立一组参数**（与全局效果互不干扰，所以「全图不动，只把人脸打码」成立），带**「作用于区域外」反选开关**（背景虚化）
- **选中行实时预览**，debounce 400ms

复用 [[image-compress]] / [[image-crop]] 的全部地基（ToolPageLayout、`resolveFormat`/`applyFormat`/`writeOutput`/`clampRect`、`useToolConfig`、`useFileDrop`、`ImagePreviewModal`、`StatusTag`），新写 `RegionCanvas.vue`。

## sharp 的关键行为（全部实测得出，勿照抄文档）

这几条**直接否掉了「一路 `.xxx().yyy()` 链下去」的朴素写法**，是本功能架构的由来。

### 1. 链式调用不是顺序管线，而是「填参数 + libvips 固定内部顺序执行」

- **同一算子调两次 = 只生效一次**：`blur(2).blur(2)` 的输出与 `blur(2)` **逐字节相同**，与 `blur(8)` 不同。`median` / `sharpen` 同样。
- **不同算子的先后与书写顺序无关**。实测 45 对算子：写 `blur().threshold()` 与写 `threshold().blur()` 结果完全相同，且都等于分趟的 **threshold→blur**（threshold 实际先执行）。`blur+sharpen` → blur 先；`blur+median` → median 先；`gray+tint` → tint 先。还有几对（`gray+sharpen`、`gray+modulate`、`negate+recomb`、`lin+recomb`）链式结果**两种分趟顺序都不等于**，说明 libvips 走了融合后的另一套算法。

**结论**：要让面板上的固定顺序真的是执行顺序，**每个效果必须各自一趟**（`toBuffer` 隔开）。否则用户看到的顺序是假的。

### 2. 马赛克必须分两趟，链式两次 resize 会被折叠成 no-op

`sharp(x).resize(8,8,{kernel:'nearest'}).resize(64,64,{kernel:'nearest'})` 的输出与原图**逐字节相同**——libvips 把两次 resize 合成了一次 64→64。分两趟（中间 `toBuffer`）才真的降采样。

### 3. 趟间中转用 raw；但 `grayscale()` 会把 raw 降到 1 通道

- PNG 中转每趟都要编解码，4000×3000 一趟 ~46ms 白烧，多趟累积。
- raw 中转（`{raw:{width,height,channels}}`）实测 4000×3000：decode→raw 23~25ms、modulate 129ms、blur5 32ms、median5 191ms、sharpen 370ms、encode 23ms；raw buffer 45.8MB，可接受。
- **陷阱**：`grayscale()` 输出的 raw 是 **ch=1**，alpha 直接丢失，下一趟按 ch=4 读就花屏。`ensureAlpha()` / `toColourspace('srgb')` 都救不回来（四种组合实测全是 ch=1）。
  **解法**：灰度走 `modulate({saturation: 0})` —— 像素值与 `grayscale()` **完全一致**（都是 `[119,119,119]`），但保持 ch=4。`recomb` 灰度矩阵虽也保 4 通道但结果不同（92 vs 119，走线性空间），不能替代。
- 其余算子（negate/threshold/blur/median/sharpen/modulate/linear/tint/recomb）raw 全部保 ch=4。
- `ensureAlpha()` 是安全的通用归一化：1 通道灰度 png、3 通道 jpeg、4 通道 rgba 实测全部得到 ch=4，管线可以全程假设 4 通道。

### 4. alpha 的三个坑

- **`negate()` 默认反转 alpha 通道**（透明处 0→255、实色处 255→0，整张图透明度反了）。必须 `negate({alpha:false})`。
- **`threshold()` 也会二值化 alpha**（alpha 128 的像素回来变 255），半透明图会被悄悄变成不透明。**这条不在计划里，是实现时发现的**。解法：该趟前后 `extractAlpha` / `restoreAlpha` 保存并写回 alpha 平面。
- `blur` / `sharpen` 是邻域算子，会把透明区的 RGB 混进边缘（`[200,60,40,0]` → `[0,0,0,0]`）。这是正常的，不处理，alpha 通道本身正确。

### 5. 局部区域必须用 raw 行拷贝，不能用 `composite`

`composite({blend:'over'})` 是 alpha 混合：区域内**原本透明**的像素处，处理结果会被底图透掉（贴一块不透明蓝上去，原透明处仍是 `[0,0,0,0]`）。对「打码」这是错的——打了码的区域就该是码。`blend` 也没有 `src`/`src-over`（报 `Expected valid blend name`）。

**解法**：raw buffer 上按行 `Buffer.copy` 精确替换。反选只是**底图与覆盖图互换角色**，同一个 `copyRegion` 循环：

```ts
// 反选时区域外生效 → 底图用处理后的，区域内拷回原像素；否则反过来
const base = region.invert ? processed.img : img;
const overlay = region.invert ? img : processed.img;
```

（第一版写成两条分支，其实是同一件事。）

### 6. 预览缩放后，像素级参数必须同步缩放

800×600 图 block=20 是 40 块/行；预览缩到 25% 后若仍传 block=20，只有 10 块/行——预览里的码看起来比实际大 4 倍，是假象。传 `block*scale` 才与全尺寸一致（实测两者都是 40）。blur sigma、median size、区域 rect 同理。median 还要强制回奇数：`Math.max(1, Math.round((size*scale-1)/2)*2+1)`。

### 7. 必须 Buffer 输入

libvips 对路径输入长期持有句柄，覆盖模式必崩（Windows `UNKNOWN(-4094)` / `EBUSY`）。见 [[image-compress]] 第 3 条与 [[image-crop]] 的跨功能修复。

## 主进程

`electron/main/ipc/image.ts` 追加一段 stylize 管线，复用现有 `resolveFormat`/`applyFormat`/`writeOutput`/`clampRect`：

- `RawImage { data, width, height, channels }` —— 趟间中转的统一载体。
- `toRaw(input, maxSize?)` —— `sharp(buf).rotate()` →（预览时 `resize({fit:'inside', withoutEnlargement:true})`）→ `.ensureAlpha().raw()`，一次解码。**不开 `animated:true`**（理由同 [[image-crop]] 第 5 条：多帧是竖排长图，坐标系全错）。
- `runPass(img, fn)` —— 一趟，每个效果各占一趟（坑 #1 的直接后果）。
- `applyMosaic(img, block)` —— 两趟 `runPass`（坑 #2）。
- `applyEffects(img, effects, scale)` —— 按 `EFFECT_ORDER` 遍历，返回 `{img, appliedCount}`。
- `copyRegion` / `applyRegions(img, regions, region, scale)` —— 整图处理一份，再按行拷贝（坑 #5）。
- `stylizeOne` / `stylizePreview`（预览编码 webp q80 → data URL，`scale = 预览宽/原宽`）。

### `EFFECT_ORDER` 的排序理由

```
mosaic → blur → median → sharpen → grayscale → sepia → tint → modulate → contrast → negate → threshold
```

几何/邻域类在前（先定形），调色在后（在已定形的像素上调），二值化最后（它把连续值压成 0/255，放前面会让后续调色全部失效）。mosaic 排 blur 之前是因为「先打码再柔化边缘」比反过来实用。

### 两个实现细节

- **对比度走 `linear(a, 128*(1-a))`**，绕中灰旋转。写成简单乘法会让「调对比度」连带变亮。
- **`appliedCount`** = 全局效果数 + (有区域 ? 1 : 0)，0 表示什么都没开、只重编码。

## 渲染进程

### `src/components/common/RegionCanvas.vue`（新组件）

**没改 `CropCanvas`**——它的语义是「单个受控矩形 + 比例约束」，硬塞多矩形会把两个页面都搞乱。新组件复用它验证过的坐标约定与拖拽骨架（**原始像素存储**、`setPointerCapture` + 元素自身挂 `pointermove`、`toImagePoint`、`ResizeObserver` 算 stage），换成多矩形语义：

- 空白处拖 = **新增**（不是覆盖）；矩形内拖 = 移动；手柄拖 = 缩放；角上 ✕ 删除；无比例约束。
- **无遮罩**——局部效果要同时看清区域内外，遮住反而看不出差别；改用半透明填充 + 边框 + 序号角标。
- 拖得太小（< `MIN_SIZE*2`）当误触丢弃，否则点一下画面就多一个看不见的框。
- 抬起时才 emit 并**取整**（raw 行拷贝只吃整数）。

### `src/views/image/ImageStylizeView.vue`

结构与前两页的唯一差异：**main 左右分栏**——左列表、右常驻实时预览区。

- 面板：`n-collapse` 每个效果一项，标题右侧 `n-switch` 加 **`@click.stop`**（不加的话点开关会连带展开/收起）。
- `useToolConfig('image-stylize', …)` 持久化整个面板，**不含 regions**——那是逐图数据，属于列表状态。
- 原图尺寸**不新增 IPC**：`getDataUrlApi` 拿到 data URL 后 `new Image()` 读 `naturalWidth/Height`，且只在打开局部弹窗时才读。

**实时预览的控制流**（本页唯一不平凡的部分）：

- debounce **400ms**（比 [[image-crop]] 探测的 300ms 长：这里是全套效果多趟处理，比单次 trim 重）。实测 4000×3000 全预览（900px、3 效果）158ms → 22KB，400ms 有余量。
- **并发防串**：每次请求带自增 `previewSeq`，回来时 `reqId !== previewSeq` 直接丢弃。滑动滑块时必然有多个请求在飞，慢的后到会盖掉新结果。
- 预览目标行：优先第一个勾选项，否则列表第一项。
- 没开任何效果时明确写「未启用任何效果，显示原图」，不留白。

## 验证

`format/lint/typecheck/build` 全绿。sharp 管线以真实图片脚本验证 **145 项全过**（脚本与素材放临时目录，验完即删）。

**两个「测试本身是错的」的教训**：

1. 顺序回归最初用 `mosaic + threshold`，两种顺序**逐字节相同**——最近邻采样取的是同一个像素，这对组合根本没有顺序敏感性。换成 `blur + threshold`（先模糊后二值 = 硬边，先二值后模糊 = 灰过渡），并加正向对照断言「链式 `.blur(5).threshold(128)` ≠ 分趟 blur→threshold」，确认测试有区分力。
2. 「动图」fixture 其实**从来不是动图**。sharp 在此 build 下无法从 raw 产出多帧 gif（`pageHeight` 入参、`gif({pageHeight})`、加 `delay`/`loop` 全是 `pages:1`）。手写了 GIF89a 编码器（LZW 字面码 + 周期 clear、NETSCAPE2.0 循环块、2 帧 2 色 GCT）造出真正的 2 帧 gif，验证 `pages:2` 后断言才成立。**fixture 缺少被测属性 = 静默假通过**，与 [[image-compress]] 那轮同一类坑。

覆盖面：每个效果单独生效、顺序真实（坑 #1）、马赛克不被折叠且块内像素一致（坑 #2）、三效果后 alpha 与通道数保真（坑 #3）、negate 与 threshold 不动 alpha（坑 #4）、单/多区域精确替换与 invert 反选与越界钳制（坑 #5）、全尺寸与预览块数一致且未缩放版明显不同（坑 #6）、覆盖 + 换格式、6 格式句柄回归、gif 单帧输出。

UI 交互需人工验证：拖入 → 开单效果看右侧预览 → 叠加 → 滑滑块看 debounce 与不串帧 → 局部弹窗框多区域 → 开反选 → 开始处理 → 预览对比 → 覆盖模式。

相关：[[image-compress]]、[[image-crop]]、[[ipc-contract]]、[[app-layout]]、[[common-capabilities]]。
