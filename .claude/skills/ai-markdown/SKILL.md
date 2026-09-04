---
name: ai-markdown
description: Toolbox AI 对话渲染 markdown（#23c）——`marked` **只用 lexer**（绝不 `marked.parse`）→ 纯对象节点树 → `h()` 渲染，**零 v-html**；三条安全硬规则（html 当字面文本 / 只有 http|https|mailto 进 a / 永不产出 img）都落在纯函数层，桩测断言得了；流式是「历史全量 + 实时块级增量」，停流全量替换是安全绳；记「渲染是派生物，落盘与 history 永远只走原文」「marked 18 的 token 不做实体解码」「scoped 的 data-v 落不到同文件子组件上」「否掉 markstream-vue 的那张数据表」与实测的耗时 / 体积数字
---

# AI 对话渲染 markdown（#23c）

用户一句话需求：**「希望对话记录能渲染 md 的格式」**，外加一条**「落盘时也要把原本 ai 的对话保存，方便后续传历史记录时保存原有格式，省 token」**。

推翻的是 #23a 有意画下的边界（[[ai-chat]] 里那条「markdown 只做围栏代码块……本轮不值当」现在**过期**）：`src/utils/markdownLite.ts` 已删，取代它的是 `src/utils/markdown.ts`。

**选的是「加依赖」而不是「`v-html`」**：解析交给 `marked`，渲染由我们自己出 Vue 节点，模型输出永远不经过 `innerHTML`。

用户拍定的五条：渲染方式 = **自研精简版（marked lexer + `h()`）**；范围 = **只助手消息**；高亮 = **要，且只高亮已闭合的围栏**；链接与远端图片 = **CSP 不放开，图片退化成可点链接**；流式 = **历史全量 / 实时增量**（落成 marked 单引擎的块级增量）。

## 文件

- `src/utils/markdown.ts`（纯函数层：解析 + 安全规则 + 流式增量）
- `src/utils/highlight.ts`（hljs core + 15 种语言按需注册）
- `src/components/ai/AiMarkdown.vue`（渲染函数 + `MdBlock` + 样式）
- `electron/main/externalLinks.ts`（`setWindowOpenHandler` + **新补的 `will-navigate`**）
- 改：`AiMessageItem.vue`（按角色分叉）、`AiPanelWindow.vue`（`:hljs`）、`AiPanelWindowBody.vue`（滚动跟随改 `ResizeObserver`）、`electron/main/index.ts` 与 `electron/main/ai/panelWindow.ts`（换成共用的外链兜底）
- 桩测：`scripts/tbverify/renderer-ai-review.ts` 第 9 组（渲染进程 91 → **193** 条）

## 只用 lexer，中间落一层纯对象节点树

`marked.lexer(text, { gfm: true, breaks: false })` 拿 token，**绝不调 `marked.parse()`** —— 那个出 HTML 串，要塞进界面就只能 `v-html`，等于把模型输出接到 `innerHTML` 上。

token 与 vnode 之间那层 `MdNode`（`{tag, text?, children?, attrs?}`，纯对象、`structuredClone` 得过）**存在的理由就是为了能断言安全性**：它不碰 Vue、不碰 DOM，于是「XSS 有没有防住」变成一条桩测断言得了的纯函数性质，而不是一段要靠眼睛看的模板。理由与 [[ai-chat]] 把窗口坐标数学拎进 `aiPanel.ts` 一样。

### 三条渲染硬规则（全在 `markdown.ts` 里）

| # | 规则 | 反面是什么 |
|---|---|---|
| ① | `html` token（块级与行内）一律按**字面文本**输出 `token.raw` | 模型写的 `<script>`、`<img onerror=…>` 只能作为字符出现在界面上 |
| ② | 只有 `http:` / `https:` / `mailto:` 能进 `a`（`isSafeHref` 用 `new URL()` 判 scheme，**不是**字符串前缀匹配），其余整段按原文显示 | `javascript:` / `data:` / `file:` / `vbscript:`、以及 `JaVaScRiPt:` 这类变形 |
| ③ | **永不产出 `img`**，图片一律退化成一行 `md-image`（`🖼 图片：<alt 或地址>`，地址过 ② 才可点） | 远端图片、以及「诱导用户点开本机任意文件」的 `file:` 图片 |

`index.html` 的 CSP（`script-src 'self'` 没有 `'unsafe-inline'`、`img-src 'self' data: blob:`）**只是第二道防线**，不作为渲染层可以偷懒的理由。

### 外链是怎么串起来的

进 `a` 的节点一律带 `target="_blank" rel="noopener noreferrer"` → 命中主进程的 `setWindowOpenHandler` → `shell.openExternal` + `{action:'deny'}` → 系统浏览器打开，窗口不动。

**本轮顺手补了 `will-navigate`**（`electron/main/externalLinks.ts`，两个窗口共用）：`setWindowOpenHandler` 只管 `window.open` / `target=_blank`，**#23c 之前全仓库没有 `will-navigate`**，一个漏写 `target` 的 `<a href>` 被点到就把渲染进程整个导航走——AI 窗口是 frameless，没有地址栏也没有后退键，**回不来**。同源必须放行（dev 的 HMR 整页刷新、prod 的 `file://` 自身），判据里 `file:` 用 protocol 而不是 `origin`（`file://` 的 origin 恒为字符串 `'null'`）。

## 渲染是派生物：落盘与上下文只走原文 markdown

用户拍的那条要求，本轮把它钉成规则并加了断言。四个「不许」：**不给 `AiMessage` 加字段、不进 `persist()`、不进 `history`、不跨 IPC**。`MdNode[]` / `MdStream` 只活在组件里，组件卸载即消失。

**这条值得单独记，因为反着做非常顺手**：节点是纯对象，于是「顺手缓存进 `message` 免得切回会话再解析一遍」看起来很划算。代价是①一棵节点树的 JSON 比原文大好几倍，`conversations.json` 跟着翻几倍；②万一渲染结构混进 `history`，那是**为了显示而多烧的 token**，与用户的要求正好相反。要缓存就缓存在组件内（`MdStream` 就是那份缓存），随组件死。

顺带的好处：发出去的仍是原文 md，模型下一轮看到的是它自己写过的那段格式，一个字不丢也不多一个 token —— 本轮做的一切只发生在「显示」这一层。

桩测第 9.8 组守这条：跑一次完整 `send` + 三个 markdown 分片，断言落盘 JSON 里**搜不到 `"tag"`**、`messages[].text` 与 delta 拼接**逐字相等**、下一轮 `history[1].text` 也是原文。

## 流式：历史全量 / 实时块级增量

| 场景 | 走法 |
|---|---|
| 历史消息、**以及流结束的那一帧**（正常结束 / 取消 / 报错） | `renderMarkdown(全文)` 全量 —— 这是**权威结果** |
| 正在流的那一条 | `pushMdStream` 块级增量：定稿块只解析一次并缓存，每帧只重解析尾块 |

**停流那一刻丢掉增量状态、整棵树换成全量结果，这是整个设计的安全绳**：增量路径万一与全量有偏差，偏差的寿命只有流式那几秒，落盘与回看的永远是全量那一棵。

### 切点必须避开未闭合围栏（和松散列表）

`findStableCut(text, from)`：从末尾往前找最后一个空行（`/\n[ \t]*\n/`），逐个候选往前试，**跳过**两种：

1. `hasOpenFence(text.slice(from, pos))` —— 前缀里的围栏没闭合，说明这个空行是**代码块内部**的空行，切下去会把一个围栏劈成两半。**只扫 `[from, pos)` 而不是 `[0, pos)`**：`[0, consumed)` 是不变量意义上「围栏都闭合」的，于是每帧是 O(尾块) 而不是 O(全文)。
2. `splitsList(text, pos)` —— 切点前是列表项（或列表项的缩进续行）、后也是列表项。**模型很爱在列表项之间空一行**，不挡这条的话松散列表会被切成两个 `<ul>`。

找不到合格位置就返回 `from`（这一帧不推进，全部留在尾块里）。切点**单调不退**，定稿块一旦生成就不再改写。

### `blocks` 按块存 + 「不是追加就整个重建」

- `blocks: MdNode[][]` 而不是拍平的 `MdNode[]`：**memo 需要一个逐块稳定的引用**。已有的数组引用永不替换（桩测断言 `===`）。
- `pushMdStream` 里唯一一处「状态可能对不上文本」的入口是 `isAppendOf`：`fullText.length < consumed`，或 `fullText.slice(consumed-16, consumed) !== sig`（16 字符指纹）→ `createMdStream()` 重来。堵这一处比在别处小心省事得多。
- 定稿块解析出空数组（纯空白）时**不占一个 block**，否则末态会比全量结果多一个空块、收敛性断言就红。

### 合帧节流：`FLUSH_MS = 64`

增量把**每帧的量**降下来了，但没降**帧数**（一秒三十个 delta 就是三十次 patch）。所以节流照旧，只是每帧的活现在是有界的。leading + trailing，四条不能漏：

- **一定要有 trailing flush**，否则最后一批增量（以及「停止」时那半句）永远停在屏幕外 —— 看起来像模型少说了一句。
- **`streaming` 由 true 变 false 时无条件立刻 flush 并切到全量**，不许被节流吞掉；取消与报错走同一条。
- **`onUnmounted` 清定时器**（生成中切会话会卸载组件，见 [[ai-chat]] 的「遗留计时器污染」）。
- **非流式消息一行 timer、一份 `MdStream` 都不该有**（懒创建）：打开 50 条历史的会话时只有 `computed` 跑全量。

### 三个可接受的 snap，第四个不该看得见

未闭合的构造 marked 天然按原文出（`**粗` 就是四个字符），所以不会「格式忽然生效又忽然失效」。全过程只有三处会跳一下，所有聊天客户端都是这样，**明确接受**：① 围栏闭合的一刻代码块上色 + 出现复制按钮；② 表格分隔行到达的一刻，那行带 `|` 的段落变成表格；③ 列表 / 引用第一行还没换行时就已经是列表项了。

**第四个 snap 不该看得见**：停流从增量树换成全量树，两棵正常一模一样（收敛性断言守这条）。只有跨块语法会真跳 —— 引用式链接定义（`[a]: http://…`）落在后一个块里时，流式期间那个链接暂时不是链接。**因为停流即被全量结果修正，代价从「永久错」降成「流式那几秒里长得不一样」**，桩测把这条偏差也断言下来了（明确记着它存在，而不是碰巧）。

### 每帧成本表（这套到底贵不贵）

| 每帧的活 | 成本 | 随消息变长而增长？ |
|---|---|---|
| lexer 解析**尾块** | 典型 50~500 B | **不** |
| `walk()` 建尾块 vnode | 与尾块节点数同阶 | **不** |
| Vue patch | 定稿块被 memo 跳过，只 patch 尾块 | **不** |
| hljs 高亮 | 只在围栏闭合那一次（`n-code` 只出现在闭合块上） | 不进每帧路径 |
| 定稿块解析 | 每段文本全程**恰好解析一次** | 总量 O(原文)，不是 O(原文²) |

**全量方案是每帧 O(全文)、一条回复累计 O(n²)；这套是每帧 O(尾块)、累计 O(n)。差的不是常数，是量级。**

三处诚实的代价：① **唯一的最坏情况是一整块超长围栏**（切点必须避开未闭合围栏，所以 800 行 diff 在闭合前全在尾块里，退化成全量）；② 打开会话时 N 条历史 = N 次全量解析，同步发生在那一帧（2 KB ≈ 0.32 ms，50 条 ≈ 16 ms，还在一帧里）；③ `MdStream.blocks` 与原文同阶，只在流式期间、只在内存里。

**「只高亮已闭合围栏」同时是性能决定**：hljs 是这条链上最贵的一环，把它挡在「闭合」这个一次性事件后面，等于让它彻底离开每帧路径。

### 滚动跟随必须从 `contentLength` 改成 `ResizeObserver`

旧写法 `watch(contentLength) → nextTick → scrollTop = scrollHeight` 在节流之后**不成立**：文本长度每个 delta 都变，但 DOM 要等下一次 flush，`nextTick` 里量到的 `scrollHeight` 是**上一帧的** —— 视图持续落后一个节流周期，停流后还可能停在离底几十像素。改成观察消息列表高度：变化时若**原本就贴着底**（`scrollHeight - scrollTop - clientHeight < 40`）才滚到底。贴底状态必须在 `scroll` 事件里记，**不能在 RO 回调里量**（那时内容已经变高了）。顺带修掉旧写法「生成中用户没法往上翻」的毛病。切换 / 新建会话仍无条件滚到底（`messages.length` 那个 watch）。

## 高亮：`n-code` + `n-config-provider :hljs`

- `src/utils/highlight.ts`：`highlight.js/lib/core` + 按需 `registerLanguage` 15 种（bash css diff go ini java javascript json markdown python scss sql typescript xml yaml）。**不要 `lib/common`**（全量常用语言，体积翻几倍）。
- `highlight.js` 是 **naive-ui 的直接依赖**（`pnpm-lock.yaml`），但 naive-ui **不把它打进产物** —— 只在 `use-hljs.d.ts` 里引用，要由使用方通过 `n-config-provider` 的 `:hljs` 注入。`AiPanelWindow.vue` 加了这一条；**主窗口的 `App.vue` 不用加**（对话只在 AI 窗口里）。本轮把它从隐式传递依赖变成显式声明（靠 `shamefully-hoist` 拿到手是运气不是约定）。
- 走 `n-code` 的额外好处：**不用引 hljs 的配色样式表**，naive-ui 用自己的主题变量给 `.hljs-*` 上色，天然跟深色主题一致；而且我们一行 `v-html` 都不写。
- 语言认不出就**不传 `language`**（`n-code` 当纯文本渲染，不抛）；`attrs.open === true` 的块走 `<pre><code>`，不高亮、不给复制按钮（语义与 #23a 的 `open` 逐字一致）。

## 第 0 步探针量到的（与文档不一致处以探针为准）

1. **未闭合围栏（``` 与 `~~~` 都是）marked 照样出 `code` token，不做任何标记** → `hasOpenFence` 必须自己数，闭合规则按 CommonMark：只能由**同种字符、不短于**开围栏、且**不带 info string** 的那行来关。
2. **marked 18 的 token 不做 HTML 实体解码**（`escaped: false`，`&amp;` 原样留着）→ 文本节点要自己 `decodeEntities`（命名 + 数字实体）；**`codespan` / `code` 不解**（CommonMark 也不解，代码里的 `&amp;` 就该显示成 `&amp;`）。
3. **任务列表项的 `checkbox` 是 `list_item.tokens` 里的第一个块级 token** → 块级与行内两处都要跳过它，否则多出一个 `[x] `。前缀用 `✅ ` / `⬜ ` 文本，**不用真的 `<input type=checkbox>`**（聊天记录里不该有可聚焦、点了又没语义的控件）。
4. **`[^1]: 脚注内容` 被 marked 认成 `def`**（`tag === '^1'`，`href === '脚注内容'`）。真正的引用式链接定义丢掉是对的（CommonMark 就不显示），但脚注定义丢掉是**把模型写的一段话凭空吞了**，所以标签以 `^` 开头的 def 回落成原文文本。正文里那个 `[^1]` 角标是个 href 不合法的 link，被规则 ② 变成纯文本 —— 刚好。
5. **Vue 在子组件 props 引用不变时确实跳过它的 render**（5.4 memo 的前提，不许想当然）。没有 jsdom，用 `@vue/runtime-core` 的 `createRenderer` + 桩 nodeOps 数 render 次数量出来：父组件改五次 → 子组件计数停在 1；新增一块 → +1；所有引用换掉 → 全部重渲染。**结论成立，所以不需要手动缓存 vnode 数组。**
6. **耗时**：`marked.lexer` 全量 2 KB / 8 KB / 32 KB = 0.322 / 0.690 / 2.433 ms；只解析尾部 512 B = 0.0233 ms、2 KB = 0.1552 ms（各 100 次取中位数）。→ **解析从来不是瓶颈，贵的是建 vnode + patch**，`FLUSH_MS = 64` 是按「一秒重排十几次够顺眼、又不至于每个 delta 都动 DOM」定的。
7. **marked 18 的 lexer 只吐这些 type**：块级 space / code / heading / table / hr / blockquote / list / list_item / html / def / paragraph / text，行内 escape / html / link / image / strong / em / codespan / br / del / text / checkbox（表格单元格是**没有 `type` 的**对象，只走 `cell.tokens`）。全部枚举了，**所以两个 `default: textNode(token.raw)` 分支今天走不到、桩测也钉不住**（红证第 ⑤ 条拆掉它一条都不红）—— 它们是留给 marked 升级多出新 token 类型的兜底，代码里写明了这件事。

## 一个会咬人的细节：scoped 的 `data-v` 落不到 `MdBlock` 上

`AiMarkdown.vue` 里所有后代选择器都套了 `:deep()`。**别改成裸选择器**：定稿块是同文件里那个 `MdBlock` 渲染的，它没有 `__scopeId`，而且根是 `Fragment`（拿不到根元素继承），所以 scoped 的 `data-v-*` 只落在本组件产出的元素上（根 `div` 与尾块）—— 裸选择器会出现「流式期间有样式、停流后（或反过来）没样式」这种诡异现象。没有改成不 scoped，是因为仓库规则里 `scoped` 是默认策略。

另外 `setup()` 返回渲染函数是对「模板优先」惯例的**一处有意例外**：markdown 是递归结构，模板里要写成十几个 `v-if` 加一个自递归组件，比 20 行的 `walk()` 难读得多。SFC 里的渲染函数照样吃 `<style scoped>`。

## 为什么没引第二个解析引擎

| 参考（用户点名的） | 量到的 | 结论 |
|---|---|---|
| `streamdown@2.6.0` | **React 专用**（peer 是 react / react-dom，组件全是 JSX）；内部做法就是**用 marked 切块 + 逐块 memo** | 包用不了，**做法正是我们这套** |
| `streaming-markdown@0.2.15` | 零依赖 82 KB，真 append-only，渲染器只 4 个回调；但**它是自己一套语法**（不支持引用式链接、表格列对齐、单行嵌套列表），且渲染器是命令式建 DOM | **否掉**：① 流式排版与停流后 marked 的排版会在这些语法上不一致；② 三条安全规则要在两条互不相干的路径上各写一份 —— **同一条安全规则有两处实现，就是迟早会漂的那种设计** |

单引擎的收益：**只有一套语法、只有一处安全规则、流式与停流后的排版天然一致**，代价只是尾块每帧重解析一次（0.02 ms 级）。

### 否掉 `markstream-vue` 的数据表（免得下次再评估一遍）

| 量到的 | 值 |
|---|---|
| 包体 | 1,020 KB / 50 文件（`exports.js` 单文件 290 KB），另加 `markstream-core@2.0.7`（248 KB）、`@floating-ui/dom`、`@chenglou/pretext`、`stream-markdown-parser` → 再拖 `markdown-it-ts@0.0.2` + 7 个 markdown-it 插件 |
| 样式 | 必须全局 `import 'markstream-vue/index.css'`，**90 KB**（当时整个 renderer 的 CSS 一共 98 KB） |
| 招牌能力用不上 | Mermaid / KaTeX / D2 走 `workers/*CdnWorker.js` —— **CDN 拉取**，被本仓库 CSP 直接拦掉，也与「不放开远端请求」这条决定冲突；虚拟窗口是给大文档的，我们的消息很短 |
| 维护面 | 单人项目、短期 30+ 版本、`markstream-core` 锁死同版本号；`markdown-it-ts@0.0.2` 会进入「解析模型输出」这条安全关键路径 |

它验证的**架构**是对的（node 树 → Vue 组件、`final` 标流结束），所以照抄架构、不照抄包。

## 体积（否掉别人时用了体积做理由，自己也得交这个数）

`out/renderer/assets/index-*.js`：**3,770,361 → 4,019,059 B（+248,698 B / +242.9 KiB）**；CSS 98,816 → 101,915 B（**+3,099 B**）。

拆开量过（把 hljs 注入摘掉再 build 一次）：**marked + 我们全部新代码 = +77,885 B；`highlight.js` core + 15 种语言 = +170,813 B**（占了 2/3）。比规划时估的 +50~90 KB 大，原因就是 hljs 那 15 种语言。

**没有为此改设计**：Electron 从 `file://` 读，没有网络下载成本，多出来的是几毫秒解析编译，而主 chunk 本来就 3.8 MB（+4%）。**下一档杠杆记在这**：`import('@/utils/highlight')` 动态加载、`:hljs` 从 `ref` 里给 —— 能把 167 KB 移出主 chunk，代价是多一个「代码块先无色后上色」的 snap。真到了启动时间要抠的那天再上，不凭感觉加。

## 验证

- **桩测第 9 组**（`renderer-ai-review.ts`，渲染进程 91 → **193** 条，主进程 139 条不变）：9.1 裸 HTML / 9.2 链接白名单（6 个坏 URL × 2 + `isSafeHref` 单测）/ 9.3 永不出 `img` / 9.4 结构（h1~h6、嵌套、`ol` start、任务列表、表格 align + thead/tbody、引用、hr、行内标记、`br`、实体解码与 codespan 不解码）/ 9.5 围栏 open 标记 + `hasOpenFence` 9 例 / **9.6 块级增量**（覆盖全语法的样例按 7 字符步长喂前缀：不抛错、`consumed` 单调、块引用稳定、每个中间态 `structuredClone` 得过且不含 script/img/iframe、**末态 JSON === `renderMarkdown(全文)` JSON**、代码块没被劈开、松散列表只有 2 个 `ul`、`findStableCut` 直测、换文本重建、跨块引用式链接的偏差）/ 9.7 健壮（空串、纯空白、10 种半截语法、脚注内容不丢）/ **9.8 落盘与上下文只走原文**。
- **循环写法有个坑**：`for (cut = 0; cut <= len; cut += 7)` 时，长度不是 7 的整数倍的话**末态少几个字**，收敛性断言会拿半截前缀去比全量。改成在循环体末尾 `if (cut >= len) break;`。
- **先证明它会红**（[[toolbox-workflow-conventions]] 的硬要求）：9 条突变逐条拆掉再跑，8 条按预期红 —— ① html 按 HTML 输出（2 红）② 去掉 `isSafeHref`（12 红）③ image 出 `img`（3 红）④ `hasOpenFence` 恒 false（12 红）⑥ `findStableCut` 不避开未闭合围栏（4 红，收敛性一起红）⑦ `pushMdStream` 每次重建 blocks（1 红）⑧ 去掉「不是追加就重建」（2 红）⑨ 把解析结果缓存到 `message` 上（2 红：落盘 JSON 里出现 `"tag"`）。**第 ⑤ 条（去掉未知 token 的 raw 兜底）一条都不红**，原因见探针第 7 项 —— 改成拆掉「`^` 开头的 def 回落成原文」这条，「没做的语法内容不丢」立刻红。
- 门禁：`typecheck`（node + web）/ `lint`（**`vue/no-v-html` 全程没被触发，一处 disable 都没有**；只为 `vue/one-component-per-file` 关了两行，理由写在注释里）/ `format` / `build` 全绿。
- **人工验还没做**（等 review 后一起）：窄窗口下的表格横滚、点链接开系统浏览器、`javascript:` 点不动、`<img onerror>` 显示成字符且控制台无 CSP 报错、`conversations.json` 里搜得到 `##` 搜不到 `"tag"`；需要真 key 的那部分是流式那七条（不闪烂、停流不跳、trailing 不漏字、取消半句完整、生成中能往上翻、切会话无残留计时器、20 KB 长回复的长任务不随长度增长）。
