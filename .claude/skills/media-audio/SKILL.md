---
name: media-audio
description: Toolbox 音频工具（#20）——双 tab 页 /media/audio，ffmpeg 子进程做批量转码与剪切/分割，含响度归一、淡入淡出、声道采样率、按静音自动分割与波形选区；记录「音频编码单线程故并发 4 反而快 3.74×，与视频页串行结论相反」等实测边界
---

# 音频工具（#20）

路由 key `media-audio`、路径 `/media/audio`。**双 tab**：批量转码（列表页）+ 剪切/分割（单文件流程页，带波形选区）。

零新依赖 —— ffmpeg / ffprobe 二进制、`runFfmpeg` 系列、`tb-media` 协议、能力探测全部复用 [[video-compress]] 打下的底子。主进程独立成 [electron/main/ipc/audio.ts](electron/main/ipc/audio.ts)，**不并进 449 行的 `video.ts`**：那边整个文件都是视频语义（分辨率、帧率、GIF 两趟调色板），混进来只会让两组的容器/编码器表都变成「一半字段用不上」。

IPC 走 [[toolbox-ipc-contract]]，`Api` 后缀，进度推送是不 unwrap 的透传。

## 最重要的一条：**本页并发 4，与视频页的严格串行相反**

这是实测结论，不是偏好。**音频编码是单进程单线程**：

| | 结果 |
|---|---|
| 同一个十分钟文件 `-threads 1` | 10718 ms |
| 同一个十分钟文件 `-threads 8` | 10693 ms（**完全相同**）|

所以多开进程是真的赚：

| | 串行 4 个 | 并行 4 个 | 加速比 |
|---|---|---|---|
| 10 分钟 mp3 320k | 44733 ms | 11975 ms | **3.74×** |
| 10 分钟 flac lvl12 | 22708 ms | 6038 ms | **3.76×** |

[video.ts](electron/main/ipc/video.ts) 的注释写着「单个 ffmpeg 就会吃满所有核心，并发只是互相抢 CPU」——那句话**对视频成立、对音频不成立**。两处（`audio.ts` 文件头、`AudioView.vue` 的 `CONVERT_CONCURRENCY`）都写了警告，别照视频页的注释把这里改回串行。

并发带来的渲染进程差异：进度推送不能再按「当前唯一 `currentTaskId`」过滤（视频页的做法），改成 `runningIds: Set<taskId>`，按 taskId 找行；取消要杀**所有**在跑的 id，`onUnmounted` 也一样。队列用固定数量的 worker 轮取任务，不是 `Promise.all` 全发 —— 后者在上千文件时会同时开上千个 ffmpeg。

## 兼容矩阵放在 `electron/shared/audio.ts`，不在主进程

[electron/shared/audio.ts](electron/shared/audio.ts) 是**两端唯一的一份**：主进程 pre-flight 拿它拦非法组合，渲染进程拿它过滤下拉项（让用户根本选不到会失败的组合）。各存一份必然漂移，表现是「下拉里能选，点下去报错」。

渲染进程能 import shared 里的**运行时值**（不只是类型），`@shared` 别名在 `electron.vite.config.ts` 与 `tsconfig.web.json` 都配了，既有先例是 `src/services/ipc.ts` import `IPC_CODE`。

矩阵是 8×8 全跑一遍测出来的，**不是照文档抄的**，两个反直觉之处：

```ts
mp3:  ['mp3'],
m4a:  ['aac', 'alac'],
wav:  ['pcm_s16le', 'mp3', 'aac', 'vorbis', 'flac'],  // wav 意外地能装有损流
flac: ['flac'],
ogg:  ['vorbis', 'opus', 'flac'],
opus: ['opus', 'vorbis', 'flac'],                     // ogg 与 opus 两容器可互装
aac:  ['aac'],
```

用**流编码名**（`mp3`/`vorbis`）而非编码器名（`libmp3lame`/`libvorbis`）：重新编码与 `-c:a copy` 两条路都要查这张表，实测跑出的两张矩阵（编码器×容器、源编码×容器）**结构完全一致**，故合成一张 + `ENCODER_CODEC` 做名字换算。

不查表的代价是用户等 ffmpeg 跑完只收到一句 `Error initializing output stream`，完全看不出是容器装不了这个编码。

## `-vn` 必加，理由比原先记的更严重（已纠正）

规划时记的是「忘记 `-vn` 也能出 mp3 但码率被压到 64k」。**这条是错的** —— 那个 67407 是视频+音频 m4a 的容器平均码率，不是音频流码率。实测的真相更糟：

源是视频时，**能装视频的容器会把视频流一起重新编码进产物**：

| 输出容器 | 不加 `-vn` 的产物里 |
|---|---|
| m4a | 多一路 **libx264** |
| flac | 多一张 **png 附图** |
| ogg | 多一路 **theora** |
| mp3 / wav | 容器装不了视频，自动丢掉 —— **看不出问题** |

30 s 720p 转 m4a：不加 `-vn` 是 683125 B / 1434 ms，加了才是 220107 B / 660 ms。

所以这个坑**只在换到 m4a/flac/ogg 时才炸**，别因为「mp3 试过没事」就把这行删了。

## pre-flight 三条（都来自实测）

态度同 `video.ts` / `file:renameBatch`：**别让用户等一轮才收到一句英文报错**。

1. **libopus 只接受 48 kHz**：显式给 `-ar 44100` 直接**报错退出**（不是静默改）；不给 `-ar` 时它自己静默重采样到 48 k，那是允许的 —— 所以只拦**显式指定的非 48k**。前端更进一步：libopus 时采样率下拉只留「保持源 / 48000」。
2. **编码器 / 源流与容器不匹配** → 查 `CONTAINER_CODECS`。
3. **`-c:a copy` 与任何滤镜、声道数、采样率改动互斥**（ffmpeg 原话 "Filtering and streamcopy cannot be used together."）。**不能悄悄忽略** —— 用户开了响度归一却拿到原样文件，比报错更糟；报错文案里列出具体冲突的几项。

## 滤镜链顺序：`volume` → `loudnorm` → `afade`，两条都不能调

- **响度归一必须在音量增益之后**，否则手调的增益会被归一整个抵消掉。
- **afade 必须最后，且淡出起点按剪切后的时长算**。实测确认 `-ss` 放 `-i` 前时滤镜看到的时间轴**从 0 重新开始**（剪 2–5 s 的 3 秒产物里 `st=2` 的淡出落在末段：末段 RMS −31.3 dB vs 中段 −24.1 dB），所以传的必须是 `effectiveDuration` 而不是源时长。

**响度归一只走单趟**：源 −21.87 LUFS，单趟后实测 **−16.02**（目标 −16），双趟 −16.07 —— 双趟结果反而略差还要多跑一遍，不做。TP（−1.5）与 LRA（11）固定，只把目标 LUFS 开放给用户。

## 剪切精度如实回报，不假装精确

`-ss`/`-t` 放 **`-i` 之前**：实测放前放后精度**完全相同**（都是 3.030 s，音频没有视频那样的关键帧问题），但放前面不必解码整条，长文件快得多，且与 `-c:a copy` 兼容。

想要 3.000 s 的实测结果：

| | 得到 |
|---|---|
| wav | **3.000（0 误差）** |
| mp3 重新编码 | 3.030 |
| mp3 `-c:a copy` | 3.056 |

这是压缩格式帧对齐的硬限制。产物时长用 ffprobe 读回来如实显示，前端面板也写明「WAV 精确到毫秒 / MP3、AAC 约有 +0.03 s 误差」。

## 其余实测边界

| 结论 | 实测 |
|---|---|
| **不给 `-f`，扩展名推断全部正确** | mp3/m4a/ogg/opus/flac/wav/aac/mka/aiff/wma 十种各自选到预期编码器（m4a→aac、ogg→vorbis、wav→pcm_s16le、wma→wmav2）。故走扩展名即可 |
| **flac 无损可证，但 level 12 不值** | wav→flac→wav md5 **完全相同**。压缩率 level 0 → 9%、5 → 6%、12 → 6%，而 12 比 5 慢 48%（213 vs 144 ms）**只多省 1.5%** → 默认 5 |
| **silencedetect 精度约 15 ms** | 30 s 文件真值 5-7 / 14-16 / 22-25，测得 5.02-7.01 / 14.00-16.02 / 22.01-25.01 |
| **文件以静音结尾时不输出收尾的 `silence_end`** | ffmpeg 在流结束时就不再报了。不补这一刀，末尾那段静音会被整个漏掉 → 用 `meta.duration` 闭合 |
| **波形图成本与时长、尺寸都几乎无关** | 十分钟文件 1200×80 用 277 ms、2400×120 用 287 ms。故**不缓存、不落盘**，`runFfmpegToBuffer` 直出 stdout PNG |
| **`-progress` 对音频只在长文件上有意义** | 10 秒文件只推 1 次（结束时）；10 分钟 mp3 推 23 次、flac 推 12 次。短文件进度条基本是「0 → 100」，正常 |
| **元数据默认就保留** | title/artist 转码后自动带过去，要清除得显式 `-map_metadata -1` |
| **atempo 范围 0.5–2.0** | 0.4 直接报错，超范围要串联（`atempo=2,atempo=2`）。本轮没做变速，留着备查 |
| **输出=输入同路径 ffmpeg 自己会拒** | "cannot edit existing files in-place"。但我们走临时文件 + rename，**这句拦不住我们**，必须自己拦（见下） |

## 落盘与取消

一律 `.tbtmp` 临时文件 + 成功才 `rename`，同 `video.ts` 的两个理由：ffmpeg 不能读写同一文件（覆盖模式必坏），且取消/失败时输出必定是坏文件。

两个数据丢失防线：

- **没开覆盖却算出与源同名的输出路径** → 抛错。这是真实场景（`a.mp3` 输出目录选成源目录 + 格式 mp3），而 ffmpeg 那句 in-place 警告拦不住走临时文件的我们。
- **分割全成才落盘**：所有段先写临时文件，全部成功后才一起 rename。同位图字体 `writeAllAtomic` 的理由 —— 半套分段（3 段成功、第 4 段挂了）比一段都没有更难排查。

分割各段**共用一个 taskId**：取消时 `runFfmpeg` 的 `canceledTasks` 标记让后续段开跑前自我了断，不然杀掉当前段之后剩下的段还会照跑完。段进度要换算成整体（`(index + segPercent/100) / total`），否则进度条每切一段就从 0 重走一遍。

`canceled` 不是错误：行退回 pending，用户可以改参数重跑（`TaskStatus` 里没有 canceled 态）。

## 渲染进程

- **单个 `useToolConfig('media-audio')`**，不是两个 tab 各一份：输出格式/编码器/响度/淡入淡出是同一个概念，配两遍只会互相打脸，且共用一份才能让「输出设置」那一大块留在 `v-if` 外面不重复写。
- 双 tab 照 [ImageSpriteView.vue](src/views/image/ImageSpriteView.vue)：`#toolbar` 只放 `n-tabs type="segment"`，其余槽在**单个** `#main`/`#panel` 内 `v-if/v-else` 分流 —— **Vue 不允许两个 `<template #slot>` 指向同一具名插槽**（精灵图与位图字体两轮都踩过）。
- 编码器下拉两层过滤：`capabilities.audioEncoders`（打包的是 2018 年构建，文档列的不等于它有）**且** `codecFitsContainer`。选中项因换格式/换机器而失效时 watch 回落到第一个可用项，否则下拉显示空值。
- 码率模式跟着编码器变（无损编码器只有「无损」、只有 mp3/vorbis 有 VBR），且 **VBR 质量的方向两者相反**（mp3 0 最好，vorbis 越大越好），label 里必须写清。
- [WaveformSelect.vue](src/components/common/WaveformSelect.vue) 与 `CropCanvas`/`RegionCanvas` **同源但单位不同**：那两个存图片原始像素、渲染时乘 scale；这里存**秒**、渲染时换百分比。因为波形图不是「有原始尺寸的图片」——它由 ffmpeg 按任意宽度现画再 `object-fit: fill` 拉满容器，没有「原始像素」可锚定，百分比才是唯一不随容器宽度漂移的表示。拖拽用 `setPointerCapture`（拖出窗口不丢事件），没动过的按下视为**跳播**而不是造一个看不见的零宽选区。
- 波形用中性灰、只有手动选区用主色（见 [[toolbox-color-scheme]]）：主色是「你正在操作的这一个」的标记。候选段停用后只留虚线描边，一眼看出不会被导出。
- 播放走 `tb-media`（`toMediaUrl`），路径由 `audio:probe` 顺带登记白名单 —— 页面每加一个文件都会 probe，不必另开 IPC。
- 「按静音分割」给的是**静音区间的补集**（说话的那几段），不是静音本身；短于 0.2 s 的碎片不单独出文件。
- 手动选区走 `convert`（出一个同名文件），分段走 `split`（按 `{name}-{n}` 模板、序号按总段数补零，否则资源管理器里 `seg-10` 会排在 `seg-2` 前）。
- 体积变化列**保留负数**：音频转码常常变大（wav→flac 只省 6%、提码率必增大），截断成 0 是骗人。
- **`trim` 传给 IPC 前必须重建成纯对象**：`selection` 是 `ref`，读 `.value` 拿到的是深层响应式 Proxy，直传会报 "An object could not be cloned"（review 时抓到的运行时 bug，typecheck 与 build 都是绿的）。仓库第三次踩，规则记在 [[ipc-contract]]。

## 验证

**esbuild 打包法**（同 excel-i18n / font-convert / font-bitmap）：只把 `audio.ts` 里三处 electron 相关 import 换成桩（`electron` 类型、`./helper`、`../protocol/media`），其余逐字保留，node 直跑**生产代码本身**，ffmpeg 是外部进程不需要 external。**16 组 65 断言全绿**。

三个自己踩的坑：

1. **`handle` 桩必须完整镜像 helper.ts 的 `{code,data,message}` 包裹与 catch 语义**，否则 49 个矩阵格子全部读成失败、还会漏一个未捕获异常出来。
2. **「PNG 非空（525 B）」这种断言是没有意义的** —— 一条纯正弦波的波形图压缩后就是 525 B。换成 PNG magic + IHDR 宽高 === 请求值 + 与静音文件的产物不同，三条真断言。
3. **断言与源码注释冲突时，先怀疑注释**。`-vn` 对照组失败，重测发现记录的 64k 说法根本不复现，而真实行为比记录的更糟（见上）。改注释、改断言，两边都对上实测。

三处桩替换加了「一处都没命中就抛」的守卫：源文件结构变了要立刻炸，而不是静默测一个没打上桩的旧结构。

**UI 人工验（只有人能判断）**：拖波形选区剪一段 → 试听接缝处有没有爆音；响度归一后主观音量是否一致。页面为此留了「试听选区」按钮（从选区开头播到末尾自动停）。

## 基准

10 分钟 mp3 320k 单个 11.3 s；4 个并发 12.0 s（串行 44.7 s）。波形图 287 ms 以内，与时长无关。
