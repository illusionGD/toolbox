---
name: font-bitmap
description: Toolbox 位图字体（字体工具 P3-18）——双 tab 页 /font/bitmap，fontkit 取字形路径 + sharp 整页 SVG 栅格化，产出 PNG 图集 + BMFont 描述文件（.fnt / .xml / .json 三格式同源）；含 shelf 装箱、描边、kerning 与三阶段进度取消
---

# 位图字体（P3-18）

路由 key `font-bitmap`、路径 `/font/bitmap`。产出 **PNG 图集 + AngelCode BMFont 描述文件**，替代 BMFont / Hiero —— 游戏引擎（Cocos / Unity / Pixi / Phaser / LibGDX）用它渲染文字，避免运行时栅格化。

**两个方向同页两 tab**（照 [ImageSpriteView.vue](src/views/image/ImageSpriteView.vue) 的 merge/slice 分流）：

- **字体 → 位图**：给一支 ttf/otf/woff/woff2 + 一批字符 → 图集。字符集收集与 [[font-subset]] **完全同构**：手输 textarea + txt/json 文件提取（JSON 可只取 value）+ 预设勾选，三来源合并去重。
- **图片 → 位图**：一张图 = 一个字符，用户给每行填字符 → 图集。

PLAN 原文只写了后者，但主流需求是前者（从 ttf 烘）。两个都做。

IPC 走 [[toolbox-ipc-contract]]、`Api` 后缀；主进程 [electron/main/ipc/bitmapFont.ts](electron/main/ipc/bitmapFont.ts) 独立成文件（不并入 461 行的 `font.ts`，那边三套逻辑都是「字体进、字体出」，依赖 subset-font/fontverter；这里产出图片、依赖 sharp）。

## 依赖：一个都没新增

`fontkit`（已有）取字形路径与度量 + `sharp`（已有）SVG→PNG。仓库此前**零字形栅格化能力**，这是本功能唯一的技术风险点，全部靠实测排掉。

考虑过 `msdf-bmfont-xml`（2.8.0 MIT）但**排除**：它带 jimp / opentype.js / handlebars / update-notifier / cli-progress（含 CLI 与「检查新版本」这种在 Electron 里不该跑的东西），而我们只需要它的 packer 与 fnt writer，各几十行。自己写更可控。

## 五个实测结论（都写进了代码注释，改动前先看）

### 1. 必须「整页一个 SVG」，不能逐字形 composite

3500 CJK 字形：逐 tile composite **13524ms**，整页拼成一个 SVG **600ms**（22×）。且两法输出**像素完全相同**（alpha 差异 0，44450 px 逐字节比对）。

小样本同样成立：34 个 ASCII 字形，整页 3ms vs 逐字形 33ms。

验证脚本第 2 条就是守这个的 —— 谁改回 composite 会立刻挂。

### 2. bbox 取整必须**分轴** floor/ceil

```ts
const x0 = Math.floor(bbox.minX * s) - outlineWidth;
const x1 = Math.ceil(bbox.maxX * s) + outlineWidth;   // 不是 ceil((maxX-minX)*s)
```

我第一版写 `Math.ceil((maxX - minX) * s)`，左右各丢半个像素，导致「按 .fnt 度量逐字形摆放」与「整串直接排版」出现 **518 个像素级偏差（max diff 226）**。分轴后差异归零。这是我自己的取整 bug，不是 sharp 的问题。

实测 arial 65 个字形里有 **32 个**两种算法结果不同 —— 一半以上，不是边角情形。

### 3. 缺字必须用 `hasGlyphForCodePoint()`，不能看 `glyph.codePoints`

arial 上 `layout('中')` 返回 `id=0`（.notdef，符合预期），但该 glyph 对象的 `codePoints` 是 **`[20013]`** —— 上一次调用的残留脏值。照它判断会把缺字当成有字，用户拿到一张全是豆腐块的图集。

### 4. 描边 bbox = glyph bbox ± strokeWidth 刚好够

`stroke-linejoin="round"` + `stroke-linecap="round"` + `paint-order="stroke"`（描边画在填充**下面**，否则吃掉一半字面）。`stroke-width` 处在字形坐标系故要 `/ scale`，又因 stroke 以路径为中心向两侧各扩一半，要给 `outlineWidth * 2`。

W/A/g/@/M/#/j 七个字形 @64px + 4px 描边实测：`trim()` 出的 ink 尺寸与声明尺寸**完全相等**，既不溢出也不浪费。

### 5. 高度降序 shelf 装箱，不复用 image.ts 的固定网格

[image.ts](electron/main/ipc/image.ts) 的 `layoutSingleGrid` 是「每列最宽、每行最高」，字形尺寸差异极大时浪费惊人。94 个 ASCII @48px 实测：

| | 占用率 |
|---|---|
| 等宽固定网格 | 28.4% |
| 高度降序 shelf | **58.4%**（1021×113，页宽 1024） |
| 高度降序 shelf，装满的那一页 | **79.7%**（254×239，页宽 256） |

**占用率这个数要会读**：它强烈依赖页宽与末页装了多少。页宽大就摊成扁长条（1024 宽只排得下 3 行，最后一行只填了 23%）；页宽 256 时 94 个字形分两页，第二页几乎空着，把总数从 79.7% 拉到 55.5%。每行横向填充率实测 84%~100%，shelf 本身是有效的。**别拿单个占用率数字当回归断言**，要么比同页宽下的网格，要么量装满的那一页。

排序键 `(height desc, sortKey=codepoint asc)` 保证**确定性**：同参数两次运行产出的 PNG 字节完全相同（28949 B），输入顺序颠倒结果也一致。

## 描述文件：一份数据三种编码

`serializeBitmapFont(meta, chars, kernings, format)` 从**同一个 in-memory 结构**出三种编码，保证绝不漂移（验证脚本第 9 条逐字段比对 char 集合）。

- **text .fnt** → Cocos / Unity / LibGDX
- **.xml** → Pixi 默认解析这个
- **.json** → Phaser 3 / 自研引擎直接 import

字段按 AngelCode 规范核对齐全：`info`（face size bold italic charset unicode stretchH smooth aa padding spacing outline）/ `common`（lineHeight base scaleW scaleH pages packed alphaChnl redChnl greenChnl blueChnl）/ `page` / `chars count` + `char`（含 `chnl=15`，RGBA 全通道未做通道打包）/ `kernings count` + `kerning`。

两个容易搞错的点：

- **`scaleW`/`scaleH` 是 `common` 行上的全局字段，不是 per-page。** 所以 `packShelf` 把各页尺寸**统一取最大值**——否则按它算 UV 的引擎在非首页会整体错位。多页时除末页外本来就接近满高，浪费很小。
- **`info.padding` 是「每个字形的内边距」，不是图集外边距。** BMFont 没有描述图集外边距的字段，所以这里恒为 `'0,0,0,0'`，我们的 `padding` 只影响实际排布。

## kerning：成对 layout 反推，且必须限规模

fontkit 没有公开的 kern/GPOS 读表 API。用 `layout(a+b).positions[0].xAdvance - a 自己的 advanceWidth`，非 0 即为字距对。

实测 arial 95 个 ASCII → 9025 次 layout / **84ms** / 提取到 95 对（`A`+`V` = -4px，收紧，符合预期）。

`KERNING_CHAR_LIMIT = 200`。这是 O(n²)：3755 汉字是 **1410 万对**，彻底不可行，况且 CJK 本来几乎没有 kerning。前端在字符数超限时把开关**禁用并写明原因**，主进程也独立兜底一次（用户改 localStorage 也不会让它算几分钟）。

## 取消：出图循环之外还要补一查

照 `font.ts` 的 `convertOne` 范式：模块级 `canceledTasks: Set<string>`、纯 JS 无子进程可杀故取消只置标记、`canceled` 不是错误、`finally` 里 `delete`。

**验证脚本抓到的真 bug**：原本只在出图循环开头查取消，末页渲染期间点的取消**循环里查不到**（没有下一轮了），两页任务在第二页出图时取消会照样落盘一整套。修法是循环之后、`writeAllAtomic` 之前再查一次，`generateFromFont` 与 `packImages` 都加。

落盘用 `writeAllAtomic`：全部写 `.tbtmp` → 全部 rename → 任一步失败把已改名的也删掉。**缺一页 PNG 的 .fnt 是坏数据**，引擎会渲出空白字，比什么都没产出更难排查，所以宁可整套不留。

进度分三阶段 `render`/`pack`/`write`（3755 字时度量+装箱 178ms、kerning 视规模、出图 ~740ms/2 页）——阶段比编造的百分比更有信息量，同 [[font-convert]] 的既定态度。

## 顺手修掉的错：`COMMON_HANZI_3500` 名不副实

[src/constants/charset.ts](src/constants/charset.ts) 号称「常用汉字 3500」，**实际只有 322 字（去重 306）且有重复字**（切/呢/满/合 各出现多次）。裁剪场景下只是少裁几个字，位图字体场景下**字数直接决定图集页数与耗时**，用户按 3500 勾选却只得到 306 字会严重误判产物规模。

换成 **`COMMON_HANZI_GB2312_L1`（3755 字）**。选 GB2312 一级而非《现代汉语常用字表》的理由：前者有明确编码区间（**0xB0A1–0xD7F9**，注意末行 `0xD7` 只到 `0xF9` 不是 `0xFE`）可程序化重新推导并逐字校验，后者只能手抄、无法自证。生成脚本断言了 `length === 3755 && new Set().size === 3755 && 不含 �`，验证脚本每次重新推导一遍再比对。

> 名实不符比字少更糟 —— 一个可验证的 3755 胜过一个抄来的 3500。

## 渲染页要点

[src/views/font/BitmapFontView.vue](src/views/font/BitmapFontView.vue)。

- **Vue 不允许两个 `<template #slot>` 指向同一具名插槽**（精灵图那轮踩过），双 tab 必须在单个 `#main`/`#panel` 内部 `v-if/v-else` 分流。
- **两 tab 各一份 `useToolConfig`**（`font-bitmap-font` / `font-bitmap-images`），同 ImageSprite 的 merge/slice。
- **预览手动刷新，不 watch**：3755 字一次预览要秒级，参数一动就跑不可接受。参数变化只置 `previewStale` 并提示「参数已改，点刷新重算」。`buildFontOptions()` 被预览与生成**共用**，保证所见即所得。
- 预览图用**棋盘格背景**：位图字体多是白字透明底，纯色底看不出边界。
- 图片 tab 的「按文件名填字符」是**纯前端字符串运算不走 IPC**（同重命名页预览）：`a.png`→`a`、`U+4E2D.png`/`0x4E2D.png`/`uni4E2D.png`→`中`、`中.png`→`中`。码点要挡掉代理区与超范围，否则 `String.fromCodePoint` 会抛。
- 字符输入框只留第一个码点 —— 一行一个字符是 BMFont 的硬约束，粘进一串就取头一个。

## 验证

**esbuild 打包法**（同 [[excel-i18n]] / [[font-convert]]）：只把 `bitmapFont.ts` 里唯一一处会拖进 electron 运行时的 `import { handle } from './helper'` 换成记录型桩（`handlers: Map`），其余**逐字保留**，`--external:sharp --external:fontkit` 出 mjs 后 node 直跑**生产代码本身**。桩把 `handle` 注册的 fn 存进 Map，于是能连 `registerBitmapFontIpc` 一起验（取消、图片打包都是经真实 handler 跑的）。

假 `win` 的 `webContents.send` 是个好钩子：在收到 `stage:'write', done:1` 时回调 cancel handler，就能造出**真正的「中途取消」**而不是开跑前置标记。

12 组共 **46 条断言全绿**：度量正确性（从图集抠图按度量摆放 ≡ 整串排版，alpha 差异 **0**）、整页 SVG ≡ 逐字形 composite、分轴取整、描边不裁切、零面积字形、缺字、多页、装箱质量与确定性、三格式同源、kerning、取消不留残留、图片打包。

**性能基准**（后续判断回归用）：3755 CJK @48px pageSize=2048 → **2 页 2048×2037**，度量+装箱 **178ms**，出图 **742ms**（1.54MB + 1.39MB）。

写断言时踩的两个坑，记下来免得下次重犯：

- 参照排版必须也用**整数前进量**（`Math.round(xAdvance * s)`）。BMFont 的 `xadvance` 按规范就是整数，拿浮点 advance 当参照只会量出量化误差（over8=147 max=117），量不出度量对不对。改整数后差异归零。
- 断言占用率前先确认**没分页**。94 个 ASCII @pageSize 256 会分两页，第二页几乎空着，`built.occupancy` 是全图集的聚合值，跟单页占用率不是一回事。

**UI 人工验**（只有人能判断「字看起来对不对」）：勾 ASCII + 常用汉字生成 → 预览翻页看占用率 → 落盘后把 `.fnt` + PNG 丢进 Pixi 或在线 BMFont 查看器确认能正确渲染文字。
