---
name: packaging
description: Toolbox 用 electron-builder 打 Windows 包——build:dir 出免安装 win-unpacked、build:setup 出 NSIS+portable 安装包，输出目录分开；asarUnpack 原生模块清单、统一图标、pnpm 平台包坑
---

# 打包 Windows 安装应用（electron-builder）

electron-vite 只产出 `out/`（JS，供 `preview` 跑）；分发用的安装包由 **electron-builder** 打。见 [[toolbox-sharp-native]]、[[project-scaffold]]。

## 命令与配置

- `pnpm build:dir` = typecheck → electron-vite build → `electron-builder --win --dir -c.directories.output=release/unpacked`。**只出 win-unpacked**（免安装、直接跑 `Toolbox.exe`），不打安装包，快。产物在 `release/unpacked/win-unpacked/`。
- `pnpm build:setup` = typecheck → electron-vite build → `electron-builder --win -c.directories.output=release/installer`。出 **NSIS 安装包 + portable**，产物在 `release/installer/`（`Toolbox Setup 0.0.1.exe` + `Toolbox 0.0.1.exe`）。
- 两条命令**输出目录分开**（用 `-c.directories.output` 覆盖 yml 里的 `release`），互不覆盖。`--dir` 是 electron-builder 跳过 installer 步骤的开关。
- `electron-builder.yml`（项目根）：`appId: com.toolbox.app`（与 `setAppUserModelId` 一致）、`productName: Toolbox`、`directories.output: release`（被命令行覆盖）、`directories.buildResources: build`、`files: [out/**, package.json]`、`win.target: [nsis, portable]`、`nsis.oneClick:false + allowToChangeInstallationDirectory:true`。
- electron-builder 读 package.json 的 `main`（`./out/main/index.js`）作入口，与 electron-vite 产物对齐，无需改。
- `release/` 已进 .gitignore。

## asarUnpack（关键，原生模块必须解包）

打进 asar 后 `.node` 无法 `require`、`.exe` 无法 `spawn`。`asarUnpack` 清单：
```
node_modules/sharp/**
node_modules/@img/**            # sharp 的 prebuilt binary，实际用的是 @img/sharp-win32-x64/lib/*.node
node_modules/@ffmpeg-installer/**
node_modules/@ffprobe-installer/**
```
`electron/main/ffmpeg/binary.ts` 的 `unpacked()` 把 `app.asar`→`app.asar.unpacked` 改写路径，正为此服务。**验证**：打完检查 `release/{unpacked,installer}/win-unpacked/resources/app.asar.unpacked/node_modules/` 下有：
- `@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node`
- `@ffmpeg-installer/win32-x64/ffmpeg.exe`、`@ffprobe-installer/win32-x64/ffprobe.exe`

**纯 JS 依赖不用往这个清单里加。** AI SDK 那八个包（`ai` / `@ai-sdk/*` / `zod`）被 `externalizeDepsPlugin` 带进 `node_modules` 后**打包实测确实完整进了 asar 且各带 `package.json`**，直接 `require` 得到，不需要解包——判据是「有没有 `.node` 要 `require` 或 `.exe` 要 `spawn`」，不是「是不是运行期解析的外部依赖」。核查手法与实测条目数见 [[ai-chat]]。

## 统一图标（一处替换处处生效）

标题栏 logo 是 `@vicons/ionicons5` 的 `CubeOutline`（[TitleBar.vue](src/components/layout/TitleBar.vue)）。唯一图标源：
- `build/icon.svg`：CubeOutline 三段 path + 主题紫 `#7c3aed` 描边 + 圆角深底方块，1024 画布。
- 一次性脚本用 **sharp**（`sharp(svg,{density:384}).resize(1024,1024).png()`）渲成 `build/icon.png` 与 `public/icon.png`（两份同图）。electron-builder 从 `build/icon.png` **自动生成 .ico**，不用手工做 ico。
- 三处引用：① `electron-builder.yml` `win.icon: build/icon.png`；② `BrowserWindow` `icon: join(__dirname,'../renderer/icon.png')`（[electron/main/index.ts](electron/main/index.ts)，指向 renderer 产物里的 `icon.png`，来自 `public/icon.png`，dev/prod 路径一致）；③ `index.html` `<link rel="icon" href="/icon.png">`。
- **换图标**：改 `build/icon.svg` 重跑渲染脚本覆盖两个 png 即可。

## pnpm + electron-builder 坑

- pnpm 10+ **不自动装其它平台的可选二进制**，打包时 electron-builder 会 warn 一串 `platform-specific optional dependencies not bundled`（darwin/linux/win32-ia32 等）——**只要本平台（win32-x64）的包在磁盘上就没事**，warn 可忽略。
- 若哪天报本平台 sharp/ffmpeg 缺失：确认 `@img/sharp-win32-x64`、`@ffmpeg-installer/win32-x64`、`@ffprobe-installer/win32-x64` 在 `node_modules` 下；必要时把它们加进 package.json 的 `optionalDependencies` 或用 `node-linker=hoisted`。
- 首次打包 electron-builder 会联网下 electron zip、nsis、7zip、winCodeSign 等缓存到本地，之后离线可复用。
- **输出目录在仓库里时可能打不出来**：解压 electron 之后那步 `rename win-unpacked.tmp -> win-unpacked` 在 `d:\web\toolbox\release\` 下会 `EPERM: operation not permitted`（目标并不存在，是有东西盯着仓库目录、握着刚解压出来的那 126MB 的句柄；连试三次都失败），换成 `-c.directories.output=%TEMP%/xxx` 一次就成。跑一次性实测时直接输出到 `%TEMP%`。
  - 后来量清了它**与内容有关而不是与目录有关**（见 [[ai-chat]]）：同目录下同数量同体积的普通文件 rename 成功，一放进 Electron 的 `.dll`/`.pak` 就 EPERM；`move` 报「拒绝访问」而 `rm -rf` 却成功，说明**不是句柄占用**，是本机 AV/过滤驱动挑内容。因此有**第二条绕法**：`-c.electronDist=node_modules/electron/dist`——electron-builder 认「已解包的 Electron 目录」，走复制而不是解压+改名，输出可以留在仓库内。要留在 `release/` 下就用它，要图省事就照旧输出到 `%TEMP%`。
- **从本仓库的 bash 里跑打包产物必须先 `unset ELECTRON_RUN_AS_NODE`**：这个变量在该 shell 里是设着的，不清掉就跑 `Toolbox.exe`，它会当裸 node 启动并**立刻以 0 退出**——没有窗口、没有日志、什么都不写，看着像打包版启动失败。清掉之后主进程的 `console.log` 会直接打到终端，是最省事的读数方式。

## 打包后各路径的实测值

见 [[app-storage]] 的「打包相关」一节：安装版 / portable 版下 `app.getPath('exe')`、`app.getAppPath()`、`PORTABLE_EXECUTABLE_DIR`、`userData` 各是什么。要点是 **portable 版的 `exe` 指向每次重新解压的随机临时目录**，任何「写到 exe 旁边」的功能都必须改用 `process.env.PORTABLE_EXECUTABLE_DIR`。

## 验证

`build:setup` 成功后：① `release/installer/` 有两个 exe；② 上面 asarUnpack 三个路径都在；③ 装/跑起来实测 **sharp**（图片压缩，尤其覆盖原文件）与 **ffmpeg**（视频转码 spawn）——这两条是打包后最易崩的原生路径；qrcode/jsqr 纯 JS 不涉及。win-unpacked（`build:dir` 出的 `release/unpacked/`）直接跑正常但安装版报错，多半是 asarUnpack 没覆盖到。
