---
name: font-split
description: Toolbox 字体网页分包工具（字体工具下，P3-16 第二轮）——cn-font-split 分包出 woff2 + CSS，subset-font 逐 chunk 转 woff/ttf 并重写 CSS 的 src 多格式回退；独立路由页 /font/split；含 dll 运行时下载与 asarUnpack 打包坑
---

# 字体网页分包（cn-font-split，独立路由页）

字体裁剪（[[font-subset]]）之后的第二种字体能力。与裁剪目标不同：裁剪是「给字符集裁一个精简文件」，分包是「一个大字体（尤其中文）自动切成几十上百个 unicode-range 小分包 + CSS」，给网站 `@font-face` 按需加载。**独立路由页** `font-split`、`/font/split`（不是裁剪页的 tab，用户定的）。

## 依赖与关键坑：cn-font-split 的二进制运行时下载

- **`cn-font-split`**（npm）。API：`import { fontSplit } from 'cn-font-split'`；`await fontSplit({ input: Uint8Array, outDir, chunkSize, targetType, testHtml, fontFeature, languageAreas, css:{fontFamily}, silent }): Promise<void>` —— **直接把产物写进 outDir**（分包 woff2 + CSS + 可选 test HTML/preview/reporter）。
- **走 Rust FFI（`koffi` 原生 .node）**，且**包里不自带 Rust 库**——`libffi-<platform>.dll` 由包的 `postinstall`（`node ./dist/cli.js i default`）**从 GitHub releases 下载**到 `node_modules/.../cn-font-split/dist/`。这与仓库其它「装完即用」依赖（sharp/ffmpeg 自带 prebuilt）不同。
- **pnpm 默认忽略 postinstall**（安全策略），必须在 package.json 的 `pnpm.onlyBuiltDependencies` 加入 `cn-font-split`，安装时才会自动跑 postinstall 拉 dll。否则报 `Failed to load shared library: 找不到指定的模块`。手动补救：`node node_modules/.../cn-font-split/dist/cli.js i default`。
- **字段名坑**：proto 选项是 `languageAreas`（复数）、`testHtml`（非 testHTML）、`targetType`（字符串 `'woff2'|'woff'|'ttf'|'eot'`）、`chunkSize`（字节）、`fontFeature`。
- **CSS 选项**（`css: {...}`）：`fontFamily` 自定义族名；**关注释**要三个都关 `commentUnicodes/commentBase/commentNameTable: false`；`fileName` 定 CSS 文件名。
- **`renameOutputFont` 模板必须含 `.[ext]`**（实测：`[index]` 无扩展名→0 产出；`chunk-[index].[ext]`/`[hash].[ext]` 才对）。占位符：`[index]` 序号、`[hash]` 哈希；`[name]` 无效（原样保留）。主进程对用户模板自动补 `.[ext]`。
- **多格式 / less-scss**：**cn-font-split 只出 woff2**——无论 `targetType` 传什么，磁盘产物恒为 woff2（实测三种 targetType 出的都是 `.woff2`、内容也是 woff2，基名哈希相同）。要 woff/ttf：**用 subset-font 把每个 woff2 chunk 逐个转格式**——读 chunk woff2 → `fontkit.create(buf).characterSet` 映射成完整字符串 → `subsetFont(buf, chars, { targetFormat })`（`ttf→'truetype'`、`woff→'woff'`），**传 chunk 自己的全字符集才不丢字**（实测 197 字形/96 字符原样保留）；写同基名不同扩展名文件。再**重写 CSS 的 src**：正则匹配 `url("./<hash>.woff2")format("woff2")`，按**用户所选且实际存在**的文件拼成多 url 回退，顺序 woff2→woff→ttf（format 关键字：woff2/woff/**truetype**）。
- **woff2 也是可选的**（用户要求）：woff2/woff/ttf 三者都是普通复选项。**分包阶段一定会先产生 woff2**（库的硬限制），若用户没勾 woff2，则转完其它格式后**删掉目录下所有 .woff2 中间文件**、且 CSS 的 src 里不出现 woff2。兜底：目标格式集为空时至少留 woff2（不产出空 src 的 CSS）；某个 chunk 一个格式都没转成功时该段 src 回退到 woff2。「保留原格式」= 按源扩展名（ttf/otf→ttf、woff→woff、其余→woff2）并入格式集。less/scss=把**重写后**的 css 内容复制成 `.less`/`.scss`。脚本验证两轮：多格式 37 断言（三格式齐全 + ttf 字形==woff2 不丢字 + src 顺序）；「只勾 ttf」4 断言（woff2 文件已删、ttf 在、CSS 无 woff2 引用、src 为 `local(...),ttf`）。

## 打包（electron-builder.yml）

**asarUnpack 加 `node_modules/cn-font-split/**` 与 `node_modules/koffi/**`**——koffi 的 `.node` 与下载来的 `libffi-*.dll` 都是原生二进制，打进 asar 无法加载。见 [[packaging]]。注意：打包机上必须已经跑过 postinstall 把当前平台的 dll 下下来，且**只覆盖打包机的平台**（跨平台分发需各平台各打）。

## 主进程（`electron/main/ipc/font.ts` 内，与裁剪同文件）

- `FONT_CHANNELS.split`。`splitFont(sourcePath, options)`：动态 `import('cn-font-split')`（ESM）→ `readFile` → 在 `options.outputDir/<字体名>/` 下 `mkdir` → `fontSplit({...})` 写产物 → `readdir` 扫描统计（chunkCount 按字体扩展名、cssPath、totalSize、fileCount）→ 返回 `FontSplitResult`。
- **子目录隔离**：产物几十个文件，落到「输出目录/字体名/」避免散落用户目录。
- 复用已有 `probeFont` 读源字体元信息（页面展示）。

## 契约 / 渲染

- types：`FontSplitFormat`(woff2|ttf|woff|eot)、`FontSplitOptions`(chunkSize/format/testHtml/fontFeature/languageArea/cssFontFamily/outputDir)、`FontSplitResult`(outDir/fileCount/chunkCount/cssPath/totalSize)。preload `window.api.font.split`；service `splitFontApi`（errorPrefix，非批量不 silent）。
- `src/views/font/FontSplitView.vue`：**单字体流程**（非列表，区别于裁剪页的批量表格）。主区：选/拖字体 → 源字体信息（**主标题用文件名 source.name、副标题才是 fontkit familyName**——CJK 字体 familyName 常是罗马名，用户认的是文件名）→ 处理后产物摘要 + 「打开输出目录」。右面板：单包大小 + **输出格式多选(woff2/woff/ttf 均可选，默认 woff2) + 保留原格式开关**（两者全空则禁用「开始分包」） + 分包文件名模板 + CSS font-family + **额外样式表 less/scss 多选** + 高级(CSS 保留注释/测试HTML/OpenType特性/按语言分区开关) + 输出目录。参数 `useToolConfig('font-split')` 持久化。
- 接线：navigation 字体组加 `{key:'font-split',label:'网页分包',path:'/font/split'}`；router import + `TOOL_COMPONENTS['font-split']`。recommend 无字体组，未加。

## 验证

typecheck(node+web)/build/lint 全绿。**脚本验证**（跑完即删，用 arial.ttf）：`fontSplit` 到临时目录 → 断言产出多个 woff2（arial 得 47 个）+ 1 CSS（含 `@font-face` 与 `unicode-range`）+ testHtml 开时有 html，160ms 完成。**验证前必须先让 dll 下载成功**（`cli.js i default`）——这是整个功能的前置门槛，dll 不在则 import 成功但运行报 FFI load error。UI 人工验证：选中文字体（分包才多）→ 设 chunkSize/格式 → 开始 → 产物摘要 → 打开目录看到分包+CSS(+test.html) → 浏览器开 test.html 验证按需加载。
