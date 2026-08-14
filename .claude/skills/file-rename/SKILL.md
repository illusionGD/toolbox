---
name: file-rename
description: Toolbox 批量重命名（文件工具下）——可拖拽排序的规则链（整名替换/插入/替换/大小写/删除/扩展名）、零 IPC 实时预览、主进程 pre-flight 整批不动、两趟改名防循环覆盖、撤销上一批
---

# 批量重命名（文件工具）

添加文件或文件夹 → 在面板上叠规则链 → 表格里实时看「原名 → 新名」→ 二次确认后落盘 → 需要时「撤销上一批」。基于 [[app-layout]] 的 ToolPageLayout，IPC 遵循 [[ipc-contract]]，页面骨架与列表交互沿用 [[file-stats]] / [[common-capabilities]]。

规则链共六种：**设置名称（整名替换）** / 插入文本（含「插入序号」快捷项）/ 查找替换 / 大小写 / 删除字符 / 扩展名。

## 与图片三页相反：预览不走 IPC

`image-compress` / `image-crop` / `image-stylize` 的预览必须走主进程（sharp 在主进程），于是各自带一套 debounce + reqId 防串。**重命名不需要这套，也不要照抄。**

重命名的全部计算就是字符串运算，`src/utils/rename.ts` 是纯函数：

```
items → sortRows(by, desc) → applyRules(rows, rules, {numbering, includeExt}) → names
                                                    ↓
                                       validateNames(rows, names) → issues[]
```

全在 `computed` 里，改一个字符整表立刻重算，无异步、无竞态、无 loading 态。主进程只负责渲染进程**看不到**的两件事：盘上是否已存在同名文件，以及真正落盘。

## 主进程 `electron/main/ipc/file.ts` — `renameBatch`

**这是本仓库唯一会直接改动用户原始文件的功能**（图片工具都有「输出到新目录」的退路），所以主进程这一侧的重点全在「宁可不做，也不能做错」。

- **pre-flight 全过才动手**。任一项不过 → 返回 `{done: [], conflicts, failures: [], twoPhase: false}`，**一个文件都不碰**。不做「改一半再报错」——半改的批次既难解释也难回滚。代价是一个坏名字会挡住整批，用户得先在预览里改掉；这是刻意的取舍。
- 校验项：新名非空 / 无非法字符与控制字符 / 非保留名 / 不以点或空格结尾 / 目标全路径 ≤ 259 / 批内目标不重复（忽略大小写）/ **目标不存在于盘上——除非该目标正是本批某个源**。
- **最后那个「除非」是关键**：少了它，`foo.txt → FOO.txt` 会被自己挡住（见下），`a→b, b→c` 也会被 b 挡住。
- **两趟改名**：`目标路径集合 ∩ 源路径集合 ≠ ∅`（忽略大小写）时启用——先全部改成 `<原名>.tbtmp-<i>`，再改成目标名；第二趟失败会尽力 rename 回原名。**只在真有循环时启用**，否则平白翻倍 syscall 且崩溃会留一地临时文件。
- **不为撤销单开通道**：撤销就是把 `{from, to}` 反过来再调一次 `renameBatch`，pre-flight 与两趟改名原样复用。
- `walk()` 加了 `depth` 参数配合 `ScanOptions.maxDepth`（1 = 只取当前层）。file-stats 不传该字段，行为完全不变。

### Windows 实测结论（脚本对照组验证，纠正了两条常见说法）

- **`fs.rename` 到已存在的目标不会抛错，会静默覆盖**，受害文件内容直接没了（libuv 走 `MoveFileEx` 的替换语义）。这是整个 pre-flight 存在的理由。
- **NTFS 不区分大小写**：只有 `foo.txt` 时 `existsSync('FOO.txt')` 返回 `true`。naive 的「目标存在即冲突」会把**每一次大小写修正**都拦下来。
- **结尾的点/空格不会被系统「悄悄吃掉」**（这条与很多资料的说法相反）：`x.` 和 `y ` 能被 Node 原样创建、能按精确名读回、能删除；问题是它们**无法通过普通 Win32 路径解析访问**（`x` 直接 ENOENT）。所以拦它们不是因为会被改写，而是因为会造出用户在资源管理器里处理不掉的文件。
- **`CON.txt` 能创建**（Node/libuv 允许），但**按名字读它会挂死**——解析到控制台设备后阻塞在 stdin 上。验证脚本第一版就是这么超时的。这让保留名的禁令比「创建会失败」更有必要。

## 渲染进程

- `src/utils/path.ts`（新建，纯函数）：`joinPath` / `dirnameOf` / `basenameOf` / `parentName` / `splitName` / `joinName`。`joinPath` 从 `fileStats.ts` 提出来共用（渲染进程没有 `path` 模块，按路径里的分隔符判平台）。`splitName` 按**最后一个点**拆，`.gitignore` 整体算基名。
- `src/utils/rename.ts`（纯函数，本功能核心）：
  - `RenameRule` 的**六种 kind 参数全部常驻同一对象**（而非联合类型）。这样在面板上来回切 kind 时已填的参数不会丢。
  - **`name`（设置名称 / 整名替换）单独成一种 kind**，不是「删除字符清空 + 插入文本」的组合。用户反馈里最先被问起的就是它——「把这批全改成 `照片_01`」是最常见的诉求，用清空再插入表达等于让用户自己发明一个套路。默认模板 `{name}` 是恒等变换，所以添加这条规则本身不会改动任何名字，得先编辑才生效。
  - `applyRules` 里**规则默认只作用于基名**。否则「把 a 替换成 b」会连 `.avi` 一起改，是这类工具最常见的踩坑。面板给一个全局开关；`extension` 规则不受它影响。`name` 规则受这个开关影响：关闭时只换基名保住 `.jpg`，打开时模板要自己写扩展名。
  - **`normalizeRules()` 是加新 kind 时的必经一步**：`useToolConfig` 的浅合并只兜到 config 顶层，够不到数组里的每条规则，老用户 localStorage 里存的链会缺新字段，模板里 `rule.name.text` 直接访问就炸。view 在 `useToolConfig` 之后立刻 `config.rules = normalizeRules(config.rules)`。以后再加 kind 照此在 `normalizeRules` 里补一行。
  - **变量取值一律来自原文件名**（`{n}{name}{ext}{parent}{date}{size}`），不取链上的中间结果——否则同一个 `{name}` 在链的不同位置含义不同。`{date}` 只到日不到时分，避免文件名带冒号。
  - **`{n}` 按 rows 的当前顺序取值**，所以排序是功能的一部分而非装饰。表头排序和面板「排序依据」写的是**同一份 config**（`sortOrderOf()` + `handleSorterChange()`），不能有两套顺序。
  - 非正则的替换要把替换文本里的 `$` 转义成 `$$`，否则用户输入的 `$&` 会被 `String.replace` 当成「整个匹配」。
  - **非法正则不抛错**：记进 `ruleErrors[rule.id] `、跳过该规则。用户正则打到一半时整表报错没法用。
  - `sortRows` 的 name 用 `Intl.Collator(numeric: true)`，`img2` 排在 `img10` 前。
- `src/views/file/RenameView.vue`：
  - 规则拖拽用**原生 HTML5 draggable**，不引第三方库。`draggable` 属性由 `draggableId` 门控，**只有 mousedown 在拖拽手柄上才置起**——否则在规则卡片的输入框里选文字会触发排序。
  - `dragover` 里直接换位、松手即定稿，不画落点指示线（链一般就三五条）。
  - 落盘后**只按 `result.done` 回写路径**，失败项保持原样，列表不会与盘上脱节。
  - 「有问题」时「开始重命名」直接置灰，不给「点了才知道不行」的机会。
  - `useToolConfig('file-rename', ...)` 持久化**整条规则链**——一套调好的规则会反复用，这是本页最值钱的用户输入。

## 边界 / 后续

- **撤销只有一级，且只在本页停留期间有效**（记在 view 的 ref 里）。离开页面列表本身也没了；硬做持久化撤销会给出「记录还在但文件早被别的程序动过」的假承诺。面板上已写明。
- 不跨目录移动：`RenamePair.newName` 只收文件名，含分隔符一律判非法。
- 只重命名文件，不重命名文件夹。
- 添加文件夹上限 5 万（重命名是逐个 syscall，量级比只读统计小）。
- 校验规则在主进程与 `utils/rename.ts` 里各写了一份（渲染侧少一条「盘上是否存在」）。两边必须同步改——目前靠脚本断言兜住。

## 验证

`format / lint / typecheck / build` 全绿。主进程 + 纯函数用临时脚本跑真实文件，**120 项断言全过**（esbuild 打包 + `electron` stub，跑的是真实的 `renameBatch`），覆盖：两文件交换、三方循环、链式 a→b→c、纯大小写改名、静默覆盖被拦且受害文件内容原封不动、5 个里 1 个冲突则另外 4 个也没动、七类非法输入 + 批内重名 + 源不存在、撤销往返、`maxDepth` 1/2/不传、`path.ts` 全部、约 30 项 `applyRules`（含调换规则顺序结果确实不同）、`validateNames`、`sortRows`，以及「规则链算出的名字真的落到盘上」的端到端一条。

`name` 规则与 `normalizeRules` 后补，另跑 **23 项断言全过**：恒等默认、整名替换保住扩展名、`{parent}`/`{date}`/`{n}` 从真实反斜杠路径展开、`name→case` 与 `case→name` 结果不同（顺序真实生效）、`includeExt` 打开时连扩展名一起写、空模板产出裸扩展名（`.jpg` **合法可创建，校验不该拦**）而空模板 + 移除扩展名才是空名被拦、非法字符/保留名被拦、整名替换成同一常量时「不同扩展名不算重名、强制同扩展名两行都标」、禁用规则被跳过，以及 6 项 `normalizeRules`（缺 `name` 的老规则、非数组、`name: {}`）。

**对照组同时验证了测试本身有鉴别力**：naive 单趟交换确实丢文件（只剩 `["a.txt"]`），naive 的存在性检查确实会拦下每一次大小写修正。

人工需验：拖入文件 → 加规则看预览实时变 → 拖动规则调序看结果跟着变 → 造一个冲突看红字与置灰 → 开始 → 确认 → 撤销 → 换文件夹 + 「包含子文件夹」开关。
