---
name: video-clip
description: Toolbox 视频剪切/画面裁剪（/media/video 第二个 tab，P4-19 续）——把主进程已实现的 trim/crop 接出 UI、胶片条+波形时间轴、在播放画面上拖裁剪框、偶数对齐与同路径守卫
---

# 视频剪切 / 画面裁剪（`/media/video` 第二个 tab）

[[video-compress]] 那轮把 `trim`/`crop` 在主进程实现完就停了（注释写明「本轮不接入 UI，为下一轮预留，使两页共用同一个 transcodeOne」）。这一轮把它们接出来，并修三处「一接 UI 就会炸或丢数据」的既有缺陷。

**渲染侧契约一行未加**：`trim`/`crop` 本来就是 `TranscodeOptions` 的可选字段，随现有 `video:transcode` 一起传，preload / `services/video.ts` 无需新方法。真正的工作量在 UI 与那三处缺陷。唯一新增通道是抽帧的 `video:frame`。

## 页面形态（用户定的四条）

- **`/media/video` 的第二个 tab，不新开页**：输出设置面板与压缩 tab 共用同一个 `useToolConfig('media-video')`，同一个概念配两遍只会互相打脸（同 [[media-audio]]）。文件从 `VideoCompressView.vue` **`git mv` 成 `VideoView.vue`**（引用只有 router 一处）。
- **单文件流程页**，不是批量列表：剪切要看着画面逐个定区间，批量表里没法给每个文件单独定。
- 时间轴是**缩略图胶片条 + 音频波形上下叠**。
- 本轮只做**单段** trim + crop，分段导出不做。

**`#main`/`#panel`/`#footer` 各只能有一个 `<template #slot>`**，双 tab 靠内部 `v-if/v-else` 分流——Vue 不许两个 `<template #x>` 指向同一具名插槽（精灵图、位图字体两轮都踩过）。原工具栏那排按钮因此从 `#toolbar` 挪进 `#main` 的 bar（`#toolbar` 只剩 tabs），照 AudioView 的 `audio__bar`。

## 三处既有缺陷（都是 trim/crop 没接 UI 才一直没暴露）

### 1. targetSize 反算码率用了源时长

`totalKbps = targetSizeMb*8*1024 / meta.duration` —— 剪出 1/N 时长时码率就差 N 倍。**实测**：12s 噪声源剪 3s 求 3MB，按源时长算得 `-b:v 2048k`、按剪切后算得 `8192k`，差 4.00 倍 = 12/3。修法是 `buildVideoArgs(options, effectiveDuration)`，`effectiveDuration = trim ? end-start : meta.duration`，同一个值同时喂给 `runFfmpeg` 的进度 `duration`。

**误差要如实写**：目标 3MB 实得 4.34MB（+45%）。加上 720p 噪声那组 +20%，UI 文案写的是「好压的画面会明显偏小、高噪画面超出 20%–45%」——不写单一数字，因为超出量跟画面复杂度走。

### 2. 奇数裁剪尺寸/偏移会被 ffmpeg 静默改掉

**不是报错，是静默**：`crop=641:361:11:11` 在 libx264 / libx265 / libvpx-vp9 / gif 四路上全部退出码 0，ffmpeg 当成 `640:360:10:10`；奇数**偏移**同样被下调（`320:180:501:301` 与 `320:180:500:300` 的像素 MAE = 0，而 502,302 对照组 MAE 明显非 0）。后果不是失败而是「面板写 641、文件里是 640」。

修法：`electron/shared/video.ts` 导出 `snapCropEven` / `MIN_CROP_SIZE` / `cropExceedsSource` / `hasCrop`，**放 shared 让两端用同一份**（理由同 `shared/audio.ts`：各存一份必然漂移，而这里漂移的表现格外难查）。`CropCanvas` 在 **commit 那一步**对齐，于是 v-model 里存的、面板显示的、下发 ffmpeg 的是同一个值。代价是开比例约束时对齐可能让比例差 1–2px，这比读数不实要好。

`MIN_CROP_SIZE = 16` 是**产品下限而非 ffmpeg 限制**（ffmpeg 连 2×2 也照裁）。

越界同样静默：源 1280 宽上 `crop=200:100:1200:10` 退出码 0、stderr 一句没有，偏移被悄悄钳到 1080 → 用户拿到**另一块区域**。ffmpeg 不说就只能 pre-flight 说。

### 3. 未开覆盖仍可能盖掉源文件

`dir = overwrite ? dirname(source) : outputDir`，输出目录选成源目录且扩展名相同时 `outputPath === sourcePath`，`rename(tempPath, outputPath)` 就把源换掉了（ffmpeg 自己那句 "cannot edit existing files in-place" 拦不住我们——我们走的是临时文件 + rename）。`audio.ts` 有守卫、`video.ts` 没有。剪切场景极易触发：把 `a.mp4` 剪一段还存回原目录是最自然的操作。

两层处理：`TranscodeOptions.nameSuffix`（剪切 tab 默认 `-clip`）是**正常路径**，同路径守卫抛中文错是兜底。实测守卫触发后源文件 sha1 与 mtime 均不变、目录无 `.tbtmp` 残留。

## 剪切精度：实测把一个流传的说法否掉了

请求 6.5 → 9.5 s（12s 源，关键帧每 5s），ffprobe 读回：

| | 容器时长 | 视频流 | 帧数 |
|---|---|---|---|
| 重新编码 + 音轨 | 3.020 | **3.000** | 90 |
| 重新编码 `-an` | **3.000** | 3.000 | 90 |
| `copy` + 音轨 | 3.020 | **3.000** | 90 |
| `copy` `-an` | **3.000** | 3.000 | 90 |

**四种情况视频流都精确到 3.000s / 90 帧**。那多出来的 20ms 是 **aac 音频帧**（1024 样本 @44.1kHz ≈ 23ms）切不开而向上对齐的结果，容器时长取各流最大值所以显示 3.020。**与 `copy` 无关**——第一轮在另一个 fixture 上量到 +0.067s 时误记成了「copy 的代价」，加 `-an` 对照组才看清。写文案时别把它说成剪切不准。

起点位置只能用**有动作的源**验（testsrc2，每帧不同；纯色 fixture 上每帧长得一样，起点退没退根本看不出来）。首帧与源各秒比 MAE：

- 重新编码：vs 6.5s = **0.29** / vs 5.0s = 9.30
- `copy`（mp4）：vs 6.5s = **0**（同一批包，逐像素一致）/ vs 5.0s = 9.24

`copy` 真正的代价只有「起点必须落在关键帧上」，而**行为随容器不同**：mp4 有 edit list 保住起点；**mkv 没有，起点直接退到上一个关键帧**（同一请求实得 5.0s 起、时长 4.643s 而不是 3.000s）。差一整个关键帧间隔而不报错 = 给了用户另一段视频 → pre-flight 拦掉 mp4 之外的容器。

## 时间轴：扩展 `WaveformSelect`，不另写视频时间轴

它的拖拽/跳播/秒→百分比那套正是视频要的，重写只会有两份要同步的拖拽代码。只加一个 `frames?: string[]`：

- 有值时 `__strip` 内上排等宽缩略图、下排波形，高度改由内容决定（`--stacked`）。选区/候选段/播放头都是 `top:0;bottom:0`，**自然跨满两层，拖拽逻辑一行没改**。
- 帧格子 flex 必须给 `min-width:0`，否则被内容撑开、最后几格挤出容器。
- **无音轨的视频不显示「波形生成中…」占位**（那是谎报），改由页面说「该视频无音轨，时间轴不显示波形」。页面也**不发那次请求**——`showwavespic` 没有音轨时直接退出码 1。
- 波形直接复用 `audio:waveform` 通道：`showwavespic` 对视频文件同样有效（10 分钟文件 287ms 且与时长无关），不必新开通道也不必缓存。
- 音频页零改动（`frames` 默认空 → 走原来的单张拉满分支）。

## 裁剪：`CropCanvas` 加 `media` 插槽，直接在播放画面上拖框

它的坐标约定（对外一律源像素、渲染时乘 `scale`）与 `crop` 的「源像素矩形」正好同源，可原样复用。唯一改动是把内部 `<img>` 包进 `<slot name="media">`（默认内容不变 → 图片裁剪页与风格化页零改动），剪切 tab 往里塞 `<video>`。

于是**边播边在动画面上拖框、遮罩之外就是会被裁掉的部分**，不必抽静帧。`naturalWidth/Height` 传 `meta.video.width/height`，stage 本来就按源比例算，视频铺满即 1:1 对应。

传输控制自己做（播放/暂停、试听选区从 start 播到 end 自动停、`timeupdate` → playhead），照 AudioView 的 `handlePlaySelection` + `limitToSelection`。

**切文件 / 离开 tab / 卸载都要 `stopVideo()`**（`pause()` + `removeAttribute('src')` + `load()`）：只 pause 会让隐藏的 video 持有解码器与文件句柄，覆盖同一文件时写入失败（[[video-compress]] 的 VideoPreviewModal 已记过）。`watch(tab)` 要在 `<video>` 还挂着时跑，是 pre-flush 的。

## `video:frame`（唯一新增通道）

现有 `video:thumbnail` 把时间点与宽度写死成 1s / 160px，胶片条要任意时间点。主进程一行 `grabFrame(filePath, atSeconds, width)`，服务层 `getVideoFrameApi` 带 `{silent:true}`（单帧失败由调用方占位兜底，不弹窗）。

**两个「一趟出整条」的写法都被实测否掉**（120s 720p，12 帧）：

- `-skip_frame nokey` + `tile=12x1`：136ms 最快，但**内容是错的**——拿的是前 12 个关键帧，本片关键帧每 5s 一个，整条胶片只覆盖前 55s（末格 vs 源 55s 的 MAE=2.38、vs 源 115s 的 MAE=9.9）。缩略图与刻度对不上，比没有缩略图更误导。
- `fps=12/120` + `tile=12x1`：405ms，覆盖正确，但要**解完整条视频**，成本随时长与码率线性涨，十分钟 1080p 不可接受。

逐帧 `-ss` seek 是 **O(1) 于时长**的，且能一帧一帧先显示出来。实测 12 帧：

| 源 | 串行 | 并发 4 |
|---|---|---|
| 12s 纯色 | 1286ms | 406ms（3.2×） |
| 12s 噪声高码率 | 1566ms | 565ms（2.8×） |
| 120s 720p | 1523ms | 550ms（2.8×） |

故 `FRAME_CONCURRENCY = 4`、`FILMSTRIP_COUNT = 12`、`FILMSTRIP_WIDTH = 160`，并发交给渲染进程的 `createTaskQueue`。

`src/utils/timeline.ts` 的 `filmstripTimes(duration, count)` 取每格**中点**而非左边界：取左边界时第一格必然是 0s，而相当多的片子第一帧是纯黑或版权页，胶片条第一格就成了一块黑。放 `src/utils/` 而不是 shared —— 主进程不需要它。

**抽帧要防陈旧回填**：`frameToken` 计数器丢弃换文件后才回来的帧，`frames` 先摆满空串占位，条宽不会跳。

## 跨 IPC 的对象必须是「平的」

`handleExportClip` 里 `trim`/`crop` **必须在调用处重建成朴素对象**：`reactive()` 的嵌套字段、`ref` 里持有的对象直接下发会在运行时抛 "An object could not be cloned"，而 typecheck 与 build 全绿。这是本项目第四次踩（`advanced`、`ignoreDirs`、音频 `trim`、视频 `trim`/`crop`），见 [[toolbox-ipc-contract]]。

## 验证

`node_modules/.tbverify/verify.mjs`（**esbuild 打包法**，同 [[media-audio]]）：只把 `video.ts` 里 `electron` 类型、`./helper`、`../protocol/media` 三处 import 换成桩，其余逐字保留，node 直跑**生产代码本身**；`ffmpeg/*` 是纯 node + 子进程，原样保留。三处替换都带「一处没命中就抛」的守卫。**`handle` 桩必须完整镜像 helper.ts 的 `{code,data,message}` 包裹与 catch**，否则整张矩阵读成失败。

39 条断言全绿。fixture 三个：`v-quad.mp4`（12s 640×360 四象限纯色 + 正弦音轨、`-g 150`）、`v-motion.mp4`（testsrc2，验起点）、`v-noise.mp4`（不可压缩噪声，验 targetSize）。

几条只有换个断言方式才查得出的：

- **裁剪坐标**必须读像素：四象限各裁一次、比中心像素最接近哪个参考色，才能证明 x/y 没交换没翻转。只断言尺寸查不出「裁错位置」。
- **进度用的是剪切后时长**：断言 3s 剪切在 12s 源上百分比走到 100（用源时长会停在 25%）。
- **同路径守卫**：断言源文件 sha1 **与 mtime** 均不变，只比 sha1 查不出「重写了同样内容」。
- **GIF 两趟都带 trim/crop**：断言产物宽 160 + 时长 3s + 画面是右下象限，缺一项就漏掉一趟。

UI 人工验（只有人能判断）：拖选区导出后播放接缝是否连贯；裁剪框所见即所得；`copy` 模式起点偏移与文案一致。

## 相关

[[video-compress]]（同一页的压缩 tab、ffmpeg 层、tb-media 协议）、[[media-audio]]（波形选区与 `audio:waveform`、esbuild 验证法）、[[image-crop]]（CropCanvas 原主）、[[toolbox-ipc-contract]]。
