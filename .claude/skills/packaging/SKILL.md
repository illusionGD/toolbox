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

## 验证

`build:setup` 成功后：① `release/installer/` 有两个 exe；② 上面 asarUnpack 三个路径都在；③ 装/跑起来实测 **sharp**（图片压缩，尤其覆盖原文件）与 **ffmpeg**（视频转码 spawn）——这两条是打包后最易崩的原生路径；qrcode/jsqr 纯 JS 不涉及。win-unpacked（`build:dir` 出的 `release/unpacked/`）直接跑正常但安装版报错，多半是 asarUnpack 没覆盖到。
