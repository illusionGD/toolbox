---
name: font-convert
description: Toolbox 字体格式转换（字体工具 P3-17）——独立批量页 /font/convert，用 fontverter 做无损纯容器转换到 TTF/WOFF/WOFF2；不提供 OTF（轮廓格式互转做不到）；含格式级进度推送与取消
---

# 字体格式转换（P3-17）

独立批量页，路由 key `font-convert`、路径 `/font/convert`（导航 [src/constants/navigation.ts](src/constants/navigation.ts) 早有占位）。把字体在 **TTF / WOFF / WOFF2** 三种容器间无损互转，批量、串行、可取消。IPC 走 [[toolbox-ipc-contract]]、`Api` 后缀。

## 为什么独立成页，而不是并入 #16 字体裁剪

PLAN 原备注写「subset-font 传全字符即纯转换，可并入 #16」。**实测把这个假设推翻了**，两条硬结论：

### 1. subset-font 不能转字形轮廓 → 所以没有 OTF 选项

TTF 源传 `targetFormat: 'sfnt'`（即 otf）返回的字节与 `'truetype'` **完全相同**（同 sha1、魔数仍是 `00010000`）；OTTO/CFF 源不论传什么目标都仍是 `OTTO`。

原因：ttf 与 otf 的差别是字形轮廓的存储方式（glyf 二次贝塞尔 vs CFF 三次贝塞尔），互转要重建全部字形轮廓，harfbuzz / fontverter / subset-font 都不做这件事。**所以本页不提供 OTF 目标格式**——给一个实际输出 ttf 字节的「otf」选项是骗人。面板上写清了原因，因为用户一定会找它。

已知限制（如实记录、不假装）：**OTTO/CFF 源勾 TTF 会得到仍是 `OTTO` 魔数的文件**（容器是裸 sfnt，轮廓仍是 CFF）。要真的 CFF→glyf 得引入 fontTools（Python）级别的依赖。

### 2. 「传全字符」做转换会丢字形 → 所以用 fontverter 不用 subset-font

arial.ttf 有 4503 个字形，把 `fontkit.characterSet` 的全部字符喂给 subset-font 出来只剩 **4161**（丢 342）。因为连字 / 异体字 / 组合字形只能经 GSUB 到达，cmap 里没有码位，「所有字符」这个集合覆盖不到它们。格式转换工具丢用户没让丢的东西是错的。

实测对照（arial.ttf，同一支）：

| 目标 | fontverter | subset-font |
|---|---|---|
| sfnt/ttf | 1036584B / **4503** 字形 / 1ms | 926428B / 4161 字形 / 40ms |
| woff | 536892B / **4503** / 101ms | 513372B / 4161 / 68ms |
| woff2 | 413684B / **4503** / 2758ms | 402716B / 4161 / 1881ms |

**subset-font 体积更小是因为它丢了东西，不是因为压得好。** 裁剪页继续用 subset-font（那里丢字形正是目的），转换页用 fontverter。

## 依赖：fontverter（纯 JS/WASM，无 asarUnpack）

`fontverter` 2.0.0（BSD-3-Clause）本就是 subset-font 的传递依赖，但**显式写进 `dependencies`**——依赖传递依赖会在 subset-font 升级时静默炸掉，且 `externalizeDepsPlugin` 只外部化 `dependencies` 里的包。

API 只有两个：`detectFormat(buffer)` → `'sfnt'|'woff'|'woff2'`（**OTTO 也归为 `sfnt`**）、`convert(buffer, toFormat, fromFormat?)` → Buffer。传递依赖 `wawoff2`（WASM）+ `woff2sfnt-sfnt2woff`。

- **无 `.d.ts`**：靠基础 tsconfig 的 `noImplicitAny: false` + `skipLibCheck: true` 通过，与既有的 `subset-font`/`fontkit` 无类型 import 完全一致，不需要写 ambient 声明。
- 已在**真实 Electron 主进程**验证可 `require` 并跑通 WASM（不只是 node 下能跑）：arial→woff2 3196ms、魔数 `wOF2`。纯 JS/WASM 故**不需要 asarUnpack**（区别于 sharp/ffmpeg，见 [[toolbox-sharp-native]]）。
- `out/main/index.js` 里应是 `require("fontverter")` 而非内联打包——改构建配置后可用它自查。

## 主进程（`electron/main/ipc/font.ts` 的 `convertOne`）

`FONT_CHANNELS` 新增 `convert` / `cancelConvert` / `convertProgress`；类型 `FontConvertFormat`/`FontConvertOptions`/`FontConvertFile`/`FontConvertResult`/`FontConvertProgress`。

`CONVERT_TARGET` 映射：`ttf→sfnt`、`woff→woff`、`woff2→woff2`。复用既有 `firstFont()`（读字形数，顺带验证真是字体）。

四个容易踩的点，都在代码里有注释：

1. **`.ttc`/`.otc` 提前拦**：判 `buf.subarray(0,4) === 'ttcf'` 抛中文「不支持字体集合（.ttc/.otc），请先拆成单个字体」。不拦的话 fontverter 抛 `Unrecognized font signature`，对用户毫无意义。
2. **绝不改写源文件**：目标路径 `=== sourcePath`（如 `a.ttf` 勾 TTF 且输出到同目录）时**记入 `skipped` 并跳过**。原地重写既无意义，中途失败还会毁掉用户的源文件。
3. **临时文件 + rename**：写 `<target>.tbtmp` 再 `rename`，`finally` 里 `unlink` 忽略 ENOENT。失败或取消不留半个坏字体（同视频转码与批量重命名的既有纪律）。
4. **同格式转同格式仍写文件**：fontverter 此时 0-1ms 直通返回原 buffer，等价于一次拷贝。用户勾了就给，不做「聪明」的省略。

**串行**：woff2 编码吃满单核（simhei.ttf 9.7MB → **11.7 秒**；arial 2.7s；woff/ttf 都在 650ms 内），并发只会互相抢 CPU——同 [[video-compress]] 的硬约束。

**`registerFontIpc()` 签名从无参改成收 `win: BrowserWindow`**（推进度用），[electron/main/index.ts](electron/main/index.ts) 的调用同步改。

### 进度只到「第几个格式」，不编造百分比

`fontverter.convert` 是一次不可分割的 async 调用，**没有进度回调**。所以 `FontConvertProgress` 只有 `{taskId, format, done, total}`，页面显示「woff2 2/3」。**不给 0-100 的假百分比**——单个大字体那 12 秒的空窗客观存在，能做的是告诉用户正在转哪个格式，而不是画一根匀速前进的假进度条。

因为一格式一推（最快也是 100ms 级），**不需要 300ms 节流**（视频那边要节流是 ffmpeg 每秒推几十行）。

### 取消：只置标记，正在编码的格式会跑完

没有子进程可杀（对比 ffmpeg），`cancelConvert` 往模块级 `canceledConvert: Set<string>` 加 taskId，格式循环在**每轮开头**检查。所以「转 woff 时点取消」的实际效果是 woff 转完、woff2 被拦——语义已写进类型注释与 UI 提示。`canceled: true` **不是错误**，页面把行退回 `'pending'`（`TaskStatus` 没有 `canceled` 态），已产出的格式仍留在产物列。`finally` 里 `delete(taskId)`，否则重跑立刻被旧标记拦掉。

## 渲染页（`src/views/font/FontConvertView.vue`）

结构照兄弟页 [src/views/font/FontSubsetView.vue](src/views/font/FontSubsetView.vue)：ToolPageLayout 四槽、`useFileDrop` + `useFolderImport`、受控分页 50 + `createTaskQueue(4)` 只探当前页（await 后**按 id 重查行**，用户可能已移除）、复用 `.font__*` SCSS。

- 行类型 `FontConvertItem`（[src/views/font/types.ts](src/views/font/types.ts)）**不复用 `FontItem`**：后者的 `subsetSize`/`ratio` 是裁剪语义，转换是无损的、且一行对应多个产物。
- 列：字体名 / 源格式 / 原大小 / 字形数 / **产物**（多格式一行内多个 `woff 524KB` 小标签，跳过的标灰）/ 状态（processing 时附「woff2 2/3」）。
- 源格式列：转换后用主进程探测的真实容器格式（`sfnt` 展示成「TTF / OTF」），转换前先按扩展名给近似值。
- 进度订阅：`onMounted` 订阅、`onBeforeUnmount` 退订**并取消在跑任务**（否则离开页面主进程还在转完整批）。handler 先 `if (p.taskId !== currentTaskId.value) return;`，再靠模块级 `currentRowId` 定位行——推送只带 taskId 不带行信息。
- 输出目录**留空 = 源文件同目录**（转换常就地进行，不像裁剪那样必须指定输出）。

## 验证

esbuild 打包法（同 [[excel-i18n]]）：只把 `font.ts` 的 `../../shared/channels`、`./helper`、electron 类型三处 import 换成桩，其余逐字保留，`--external:fontverter --external:fontkit --external:subset-font --external:cn-font-split` 出 mjs 后 node 直跑生产代码本身。**44 断言全过**，覆盖：

- 三格式产物字形数 === 源 4503（无损）+ 对照组证明 subset-font 只剩 4161
- 魔数 `00010000` / `wOFF` / `wOF2`；无 `.tbtmp` 残留；进度 done 从 0 递增、total 正确
- OTTO 源三格式字形 3875 不变 + **转 ttf 产物仍是 `OTTO`**（如实断言限制）
- `.ttc` 抛中文错而非英文 signature 错
- 不毁源：`skipped` 含 `ttf` 且源文件 sha1 与 mtime 均未变
- round-trip ttf → woff2 → ttf 字形数回到 4503
- 覆盖开关两向（false 记 skipped 且已存在文件未被动 / true 真覆盖且产物无损）
- 取消两种时机（开始前 → 零产出；转到一半 → 已完成格式保留、后续无文件无残留、标记被 finally 清理）

另在真实 Electron 主进程验证 fontverter 可加载（见上）。`pnpm typecheck` / `lint` / `format` / `build` 全绿。

## 已知限制

- **OTF 目标不提供**；OTTO 源勾 TTF 得到的仍是 OTTO 容器（见上文）。
- **不支持 `.ttc`/`.otc`**：会给出明确中文提示要求先拆分。
- **取消不是即时的**：当前格式转完才停，WOFF2 大字体最长约 12 秒。
- **不支持 EOT/SVG 字体**（fontverter 只做 sfnt/woff/woff2）。
