---
name: video-compress
description: Toolbox 视频压缩/转码工具（媒体工具下，P4-19）——主进程 ffmpeg 子进程、CRF/码率/目标大小、缩放降帧、音频、GIF 两趟调色板、tb-media 流式播放协议
---

# 视频压缩 / 转码（P4-19）

媒体工具下的首个真实转码工具。与图片各页的根本区别：**sharp 是进程内库、ffmpeg 是外部子进程**——参数、取消、进度、临时文件的处理方式都因此不同。套 [[image-compress]] 的 ToolPageLayout，复用 [[common-capabilities]] 的 useFolderImport / taskQueue / 受控分页。IPC 走 [[toolbox-ipc-contract]]，`Api` 后缀。

## ffmpeg 二进制（native）

- `@ffmpeg-installer/ffmpeg` + `@ffprobe-installer/ffprobe`（平台专属 optionalDependency，无安装脚本、不联网下载），被 `externalizeDepsPlugin` 外部化。
- `electron/main/ffmpeg/binary.ts` 的 `unpacked()` 把 `app.asar` → `app.asar.unpacked`——**asar 内的可执行文件无法 spawn**，打包时 electron-builder 须把这两个包配进 asarUnpack。开发环境是恒等变换。
- **必须探测真实能力**：打包的是 2018 年 4.1 构建，文档列的编码器不等于它有；开发机系统 ffmpeg 又更新得多。`probeCapabilities()` 解析 `ffmpeg -encoders`，UI 只列探测到的编码器（`copy` 例外，永远保留）。结果缓存一次进程生命周期。

## 主进程 / IPC（`electron/main/ipc/video.ts`）

`VIDEO_CHANNELS`：capabilities / probe / thumbnail / transcode / cancelTranscode / transcodeProgress(主→渲染)。类型见 shared/types：`VideoMeta`/`VideoCapabilities`/`VideoOutputFormat`(original|mp4|webm|mkv|gif)/`VideoCodec`(libx264|libx265|libvpx-vp9|copy)/`VideoAudioMode`/`VideoQualityMode`/`TranscodeOptions`/`TranscodeResult`。

- `probe` 成功即 `allowMediaPath()` 登记进播放白名单（每加一个文件都会 probe，不必另开 IPC）；`transcode` 成功再登记输出路径。
- **pre-flight 校验**：把注定失败的组合在开跑前拦成中文原因（同 [[file-rename]] 的 pre-flight 精神——别让用户等一轮才收到英文报错）。查的都是 ffmpeg 一定会拒的：`copy` 与滤镜（缩放/降帧/裁剪）互斥、容器装不下的编码流、构建里没有的编码器。
- **一律先写 `.tbtmp.` 临时文件再 rename**：① ffmpeg 不能读写同一文件，输出一开就把还在读的输入截断，覆盖模式必坏；② 取消/失败时输出必是坏文件（来不及写容器索引），删临时文件用户就看不到残骸。先 rename 再 unlink 源（反过来 rename 失败会两头空）。换扩展名时源已无用，删掉免留旧格式副本。
- `mkdir(dir,{recursive})`：ffmpeg 不自建输出目录，缺目录只报一句夹在几十行里的 "No such file or directory"。

### 参数组装（几条实测约定）

- **scale 用 `-2` 不用 `-1`**：都保比例，但 `-1` 会算出奇数宽度，H.264 的 yuv420p 要求偶数，直接报 "width not divisible by 2"。`-2` 是保比例并向偶数取整。缩放加 `force_original_aspect_ratio=decrease` + 源比目标小时不放大。
- **VP9 特殊两条**：默认 deadline 慢到不可用，须 `-row-mt 1 -deadline good -cpu-used 2`；quality 模式必须显式 `-b:v 0` 才是恒定质量，否则 `-crf` 被当成码率上限、又大又慢。x264/x265 不需要。
- **targetSize 单趟反算**：`videoKbps = 目标bit/时长 - 音频kbps`，误差 ±10%（UI 已写明）。时长未知（裸流/录制中 mkv）退回 CRF，硬算会 Infinity。
- **mp4 加 `-movflags +faststart`**：把 moov 索引移到文件头，否则播放器/tb-media 预览要下完整个文件才能播、无法即时 seek。
- **GIF 走两趟 palettegen + paletteuse**（`transcodeToGif`）：单趟固定 216 色带断层明显，两趟按实际画面统计 256 色最优调色板。GIF 必须限 fps 与宽度，1080p30 十秒不限能出几百 MB。GIF 的 codec 字段传 `libx264` 占位（不能是 copy，会被 pre-flight 拦），实际编码器用不上。

## 子进程执行（`electron/main/ffmpeg/run.ts`）

- **argv 数组传参，不拼命令行字符串**：中文/空格/`&` 路径在 Windows 上是最常见崩因，数组彻底绕开引号问题。
- 固定前置 `-nostdin`（ffmpeg 默认从 stdin 读交互命令，作管道子进程会挂着不退）、`-y`、`-progress pipe:1`。
- 进度靠 stdout 的 `-progress` 文本（`out_time`/`speed`/`progress=end`），节流 300ms（同 file:scanProgress）；**百分比只许前进**（gif 两趟会把 out_time 归零重走）；时长未知推 `percent=-1`，渲染端改显示已处理时间。用 `out_time` 不用 `out_time_ms`（后者部分版本实为微秒，命名历史错误）。
- 失败信息只在 stderr（退出码只 0/1），留最后 40 行、抛错时取尾部 6 行拼成 message。
- **取消要真杀进程**：`cancelFfmpeg` kill 子进程。GIF 两趟共用一个 taskId，用户可能卡在两趟之间点取消——此刻 runningTasks 里没进程可杀，靠 `canceledTasks` 集合让后续趟次开跑前自我了断。`clearCanceled` 由调用方在**整个任务结束后**调用（非每趟），否则下一趟读到过期标记。
- `runFfmpegToBuffer` 与 `runFfmpeg` 分开：抽帧时 stdout 是图片二进制而非 progress 文本，两者不能共用管道。

## 播放协议（`electron/main/protocol/media.ts`）

`tb-media://` 自定义特权协议。**不能用 `file://`**：开发环境 renderer 跑 http://localhost，Chromium 拦掉所有 file:// 子资源。

- `registerMediaScheme()` **必须在 app ready 之前**（放模块顶层），`registerMediaProtocol()` 在 ready 之后。`privileges: {standard,secure,supportFetchAPI,stream}`——后两个是 Range 支持的前提。
- **白名单是唯一安全边界**：只服务 probe 登记过的路径，否则等于开任意文件读取口子。路径规范化小写（Windows 大小写不敏感）。
- **必须实现 Range**：不支持则 `<video>` 只能从头顺序播、进度条拖不动（下一轮时间剪切页全靠拖进度条选区间）。始终走 `createReadStream` 流式，不 `readFile`，大文件才不会整个进内存。206 分片 + `Content-Range`。

## 渲染页（`src/views/media/VideoView.vue`）

页面已在下一轮改成双 tab（压缩 / 剪切），本节说的是 `compress` tab；剪切 tab 见 [[video-clip]]。

- 套 ToolPageLayout：操作栏(添加文件/文件夹/含子文件夹/移除选中/清空 + ffmpeg 版本号) + 文件表(缩略图/文件名/分辨率/时长/编码/原大小/处理后/体积变化/状态/操作) + 参数面板 + 底部统计(总时长/原大小/处理后/总体积变化)。
- **元信息异步填充**：视频的时长/分辨率/编码必须经 ffprobe 一次子进程才拿到（不像图片能从缩略图顺带得出）。`VideoItem` 全部字段可选，`probed` 标记区分「没有音轨」与「还没探测」，未探测显示「—」而非编默认值。
- **探测/缩略图只为当前页排队**，`PROBE_CONCURRENCY=2`（比图片的 4 保守——每条是真实 ffprobe/ffmpeg 子进程，进程创建开销远大于 sharp 解码，开多只互相抢 CPU）。`probeRequested` 防翻页重复请求。受控分页 `PAGE_SIZE=50`，同图片各页——因此**表格不能开列排序**（切片按 items 顺序）。
- **处理严格串行**（`handleStart`）：单个 ffmpeg 就吃满所有核心，并发只互相抢 CPU 还让内存翻倍——这是**硬约束**，与图片那边「串行更稳」的偏好不同。取消停在当前文件、剩余整队不启动、已完成结果保留。按 taskId 过滤进度推送（上一任务取消后可能有滞后推送，不过滤会写到新任务行上，同 file-stats 的 scanId）。
- **onUnmounted 必须杀掉在跑的 ffmpeg**，否则页面切走后它继续吃满 CPU。
- 预览组件 `src/components/common/VideoPreviewModal.vue`（不复用 ImagePreviewModal，那是「两张 img」语义）：src 走 tb-media；**关闭时必须 `pause()` + 移除 src + `load()`**，只 pause 会让隐藏 video 持有解码器与文件句柄，覆盖原文件再处理同一文件时写入失败。点预览前若未 probed 先补一次，否则协议 403 表现为「点了播不了」。
- 接线：main/index.ts `registerVideoIpc` + `registerMediaScheme/Protocol`、preload `window.api.video.*`、router `TOOL_COMPONENTS['media-video']`、navigation「媒体工具→视频工具」。

## 已由下一轮接出 UI

`TranscodeOptions.trim`/`crop`、主进程 `buildTrimArgs`/`buildFilters`(crop) 在本轮实现但刻意不接 UI，为下一轮「剪切 / 裁剪 tab」预留，使两个 tab 共用同一个 `transcodeOne` 不改签名。**下一轮已接出，见 [[video-clip]]**——同时修了三处只有接 UI 才会暴露的缺陷（targetSize 用源时长、奇数裁剪被静默改、未开覆盖仍可能盖源），并给 `TranscodeOptions` 加了 `nameSuffix`。trim 的 `-ss`/`-t` 放 `-i` 之前（accurate_seek 又快又准，`copy` 时只能落关键帧且行为随容器不同）；crop 必在 scale 之前（坐标是源像素）。

## 验证

typecheck/build/lint 需全绿。UI 人工验证：加视频→出缩略图与元信息→选编码器/模式/缩放→开始→进度条/体积变化/底部统计→预览前后对比（能拖进度条）→取消能停整队→覆盖原文件不残留 .tbtmp。GIF 输出验证两趟调色板质量。
