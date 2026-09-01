---
name: excel-i18n
description: Toolbox Excel 多语言工具（文件工具 P2-15）——exceljs 把多语言翻译表转成一种语言一个 i18n JSON，key 带点号转嵌套对象；含 cell.value 归一化坑、语言码解析规则、嵌套冲突策略
---

# Excel 多语言表 → i18n JSON（file-excel-i18n）

`/file/excel-i18n`。输入一张多语言翻译表（A/B 列分组说明含合并单元格、C 列前端 key、D 列起每列一个语言，表头形如「西班牙语-es」「中文原文-zh-hants」），输出**一种语言一个 JSON**。key 含点号转嵌套对象（`code.1008` → `{code:{"1008":…}}`）。

**明确不做多 excel 合并**（用户定的）：不同表的语言列位置不一致，逐文件配行列的操作成本高于收益。多 sheet 合并是支持的。

## 依赖：exceljs

`pnpm add exceljs`（4.4.0，MIT）。**纯 JS → 不需要 asarUnpack**；但因 `externalizeDepsPlugin` 必须在 `dependencies` 里而非 devDeps，否则主进程运行时解析不到。支持 `.xlsx`/`.xlsm`（`wb.xlsx.readFile`）与 `.csv`（`wb.csv.readFile`，**必须分流，用 xlsx 解析器读 csv 会报错**）。**不支持老的 .xls 二进制格式**——页面 accept 里不给这个后缀，解析失败的提示里点明。

选型时排除了 SheetJS `xlsx`：npm 上只有 0.18.5（旧、有原型污染 CVE），安全版本要从官方 CDN tarball 装，偏离仓库「依赖都从 npm 装」的惯例。

## 核心坑：`cell.value` 必须归一化

exceljs 的 `cell.value` 有七种形态：`string | number | boolean | Date | {richText:[]} | {formula|sharedFormula, result} | {hyperlink, text} | {error}`。**直接 `String(value)` 会把富文本和公式单元格变成 `[object Object]`**——翻译表里加粗某几个字、或用公式拼串都很常见，这个坑必踩。`cellText()` 逐形态取文本：`richText` 拼各段 `.text`、`result` 递归归一（公式/共享公式共用）、`text` 取显示文字（超链接不要 URL）、`error` 当空、Date 转 ISO，末尾 `.trim()`。

**归一顺序有讲究**：先判 `richText` 再判 `result` 再判 `text`——超链接对象也有 `text` 字段，如果把 `text` 判在前面，`{formula, result}` 那种没 `text` 的还好，但富文本对象一旦将来带上 text 就会误取。

合并单元格不需要特殊处理：本工具只读 key 列与语言列，A/B 的分组说明列（合并的那些）根本不碰。

## 语言码解析（`src/utils/excel.ts`，渲染侧纯函数）

`localeFromHeader(header)`：按 `-`/`_`/空格切段，**取第一个纯 ASCII 段起、到结尾的所有 ASCII 段用 `-` 拼回并小写**。

- `西班牙语-es` → `es`
- `中文原文-zh-hants` → `zh-hants` ——**不能只取最后一段**，否则得到 `hants`（这是本规则存在的唯一理由）
- 认不出（如 `中文原文`）→ 空串，页面回退成表头原文过 `sanitizeFileName`

同名（两列都解析出 `en`）时页面自动补列标 `en-C`，否则后写的文件会覆盖前面的。

`parseColumnRef`/`columnLabel`：列引用 **同时接受 `C` 与 `3`**（两种写法用户都会用，同二维码页「配置能手填且校验」的要求）。26 进制无 0，A=1、AA=27，上限 16384（XFD）。脚本验证 1..1000 往返一致。

## 点号嵌套与冲突（`setDeep`）

`nested` 关时整串当平铺 key（`"code.1008"`）。开时按 `.` 切段逐层建对象。**冲突不静默覆盖**：先有 `a.b`（对象）又来 `a`（字符串），或反之，返回 `false` 让调用方计数并汇总成一条 warning——静默覆盖会让用户丢翻译且毫无察觉。纯数字段当普通字符串 key（JSON 对象键本就是字符串，`{code:{"1008":…}}` 是对的）。

## 主进程 `electron/main/ipc/excel.ts`

`EXCEL_CHANNELS.probe / preview / toJson`，`registerExcelIpc()` 不需要 win（无进度推送、无对话框）。

- `probeExcel(filePath, headerRow)`：回各 sheet 的名字/行列数/**表头行各列文字**。`headers` 下标即 1-based 列号（`headers[0]` 是 A 列，空列为 `''`），让渲染进程能直接按列号取表头。
- `buildLocales(filePath, options)` 是**预览与落盘共用的唯一核心**——保证「看到的」就是「写下的」。从 `startRow` 逐行：key 列为空则整行跳过并计 `skippedRows`（分组标题行/空行）；每个语言列取文本，**空译文不落 key**（让前端回退默认语言，比留空串实用）并计该列 `emptyCount`。跨 sheet 同 key 后者覆盖 + 聚合 warning。
- **`preview` 只序列化被请求的那一列**，其余列只回统计。几十个语言的全量 JSON 一起过 IPC 又大又慢，而页面一次只看一列。
- `keyCount` 用 `countLeaves()` **递归数叶子**，不是 `Object.keys().length`——嵌套后顶层 key 数远小于真实翻译条数。
- `toJson`：`subDir` 时输出到 `输出目录/表格名/`（一张表出几十个 JSON，默认收进子目录免得散落）；文件名兜底补 `.json`（已带则不重复补）；`indent=0` 时 `JSON.stringify` 不传缩进 = 压缩单行。

## 渲染页 `src/views/file/ExcelI18nView.vue`

左右分栏（照抄精灵图合并页的 `__split` / `__split-left` / `__split-right` 那套）：

- 左：源文件信息 → sheet 多选 → **语言列列表**，每行 = 勾选框 / 列标+表头原文 / 文件名 `n-input` / 上次解析的译文数与空值数。点行切换预览语言。「重新识别」按当前行列配置重扫表头并重置文件名。
- 右：JSON 预览 `<pre>` + 刷新按钮 + warning 行 + 转换结果卡（打开目录）。
- **预览不做 watch 自动重算**（全表解析不便宜）：参数变化只置 `stale` 并提示「配置已变，点刷新」，同精灵图预览的处理。切换预览语言是例外——只序列化一列，代价可接受，直接重算。
- 「表头行」变了必须整个重探测（`loadSource`），否则识别到的语言列是错的。
- 面板：表头行/数据起始行（`n-input-number`）· key 列/多语言起始列（文本框 + `parseColumnRef` 校验，非法时 `status="error"` 并回显解析出的列号）· 点号转嵌套开关 · 缩进 2/4/压缩 · 输出目录 + 「放到表格名子目录」开关。`useToolConfig('file-excel-i18n')` 持久化。
- 识别时**跳过空表头列**（翻译表里常有分隔列/备注列）。

## 验证

typecheck(node+web)/build/lint 全绿。**脚本验证（跑完即删）**共 79 断言：

- 主进程 48：用 exceljs 现造仿截图的表（A 列合并单元格、`code.1008`/`code.1009` 点号 key、故意留空的 es 译文、空 key 行、富文本/公式/超链接单元格、`a` 与 `a.b` 冲突、第二个 sheet 有重名 key）→ 断言 cellText 七形态、`headers` 下标对齐、点号嵌套且同父多子并存、空译文该语言无此 key 而别的语言有、skippedRows 计数、冲突有 warning 且不破坏已有数据、`nested:false` 平铺、多 sheet 覆盖告警、落盘文件名/缩进/可 JSON.parse、`countLeaves` 与顶层 key 数确实不同、无语言列/无输出目录抛错。
- 渲染 31：`parseColumnRef` 字母+数字+非法输入、`columnLabel` 1..1000 往返、`localeFromHeader` 两种表头形态（尤其 `zh-hants` 不能变 `hants`）、`sanitizeFileName`。

**esbuild 打包法**（本仓库首次用于主进程逻辑测试）：把 `excel.ts` 里只有 electron 依赖的两行 import（channels/helper）替换成桩，其余逐字保留，`esbuild --bundle --external:exceljs` 出 mjs 后 node 直跑。测的是生产代码本身，不是复制品。

UI 人工验证：选表 → 改行列配置 → 重新识别 → 勾语言/改文件名 → 刷新看 JSON → 转换 → 打开目录核对文件。
