---
name: ai-chat
description: Toolbox AI 对话（#23a）——Vercel AI SDK **钉死 ai@6**（ai@7 要 Node≥22，Electron 33 只有 Node 20.18.3）、四个包覆盖九个厂商、多配置 + 设置页单选列表 + 首页入口 + **独立的无边框 BrowserWindow**（流式 / 传图 / 多会话 / 命名 / 取消 / 置顶 / 最小化）；记「key 在 userData 而配置在 dataDir」「SDK 按 model id 分支」「`SharedV3Warning` 只有三种真实形状」「面板形态三连反转」「分片必须按 event.sender 推」「窗控只有关闭有 DOM API，置顶与最小化各走一条专用通道」等实测边界。工具调用见 [[ai-tools]]，markdown 渲染见 [[ai-markdown]]
---

# AI 对话（#23a）

用户的六条需求里，本轮做 1/2/3/5/6：兼容各厂商、可配多份「厂商+模型+自定义名称」选其一、配置在设置页、首页右上角入口打开对话、模型清单写死。**需求 4（AI 调用现有工具）是第二轮**（#23b，已交付，见 [[ai-tools]]）。第一轮交付后 review 回来七条（见「review 返工」），第二轮 review 又提两条（「可以拖拽出 app」「图片换个 icon 图标」），**对话形态因此换了三次**，见「形态三连反转」——现在它是一个独立窗口。第三轮 review 两条样式（两个下拉太宽、顶栏拖不动），第四轮一条：**加最小化按钮**（2026-09-04）。

**没有手写协议适配器。** 规划时打算自己写三套（Anthropic Messages / OpenAI Chat Completions / Google Gemini），包括 SSE 跨分片解析、三种图片 part 写法、system prompt 的三种位置、错误归一化，第二轮还要再写三套 tool_call 翻译——用户问「有没有现有的库已经集成各厂商的调用」，有，**Vercel AI SDK**，上面这些它全做了。手写方案作废。

文件：主进程 `electron/main/ai/{provider,chat,errors,keys,images,conversations,panelWindow}.ts` + `ipc/ai.ts` + `externalLinks.ts`（外链兜底，两个窗口共用）；共享 `electron/shared/ai.ts`（311 行，厂商×模型清单）+ `electron/shared/aiPanel.ts`（窗口位置尺寸数学）；渲染 `src/stores/{aiConfig,aiChat}.ts`、`src/services/ai.ts`、`src/components/ai/*.vue`（`AiPanelWindow` / `AiPanelWindowBody` / `AiComposer` / `AiMessageItem` / `AiMarkdown` / `AiSettingsCard` / `AiConfigDialog`）、`src/utils/{markdown,highlight}.ts`（#23c，见 [[ai-markdown]]）。

## 版本钉死：`ai@6` 不是 latest，照 latest 装出来的组合跑不起来

| 实测 | 后果 |
|---|---|
| **`ai@7` 的 `engines.node` 是 `>=22`** | Electron **33.4.11 自带 Node 20.18.3**，用不了。本机 dev node 是 v22.18.0，**两者绝不能混着看** |
| `ai@6.0.275` 的 `engines.node` 是 `>=18` | 这是可用的最高线 |
| provider 包大版本与 `ai` **不同步**（`@ai-sdk/anthropic` 的 v4 才配 `ai@7`） | 「装 latest」= 装出 provider@4 + ai@6 的错配 |

所以 `package.json` 里这五个是**精确版本、无 `^`**，改动前先量 Electron 的 Node 版本：

```
ai 6.0.275 / @ai-sdk/anthropic 3.0.116 / @ai-sdk/openai 3.0.106
@ai-sdk/google 3.0.120 / @ai-sdk/openai-compatible 2.0.74 / zod ^4.5.4
```

这些包 `exports` 都带 `require` 条件（dual CJS/ESM），**electron-vite 的 CJS 主进程产物直接 `require` 即可，不用改 module 格式**——这是规划时最大的未知风险，已排除。纯 JS 无 native，`externalizeDepsPlugin` 带得上、**不需要 asarUnpack**（见「验证」）。

**九个厂商只要四个包**：anthropic / openai / google 各自有协议，其余七家（deepseek / glm / minimax / kimi / qwen / grok / 混元 / 豆包）本来就是 OpenAI 兼容端点，全走 `createOpenAICompatible({name, baseURL, apiKey, fetch})`。不为每家装一个包（`@ai-sdk/deepseek`、`@ai-sdk/xai` 存在但没必要）。

没选：`langchain`（重）、`token.js`/`any-llm`/`llm.js`（小众，工具调用成熟度差）、`@openrouter/ai-sdk-provider`（要走中转，与「用户自己的各厂商 key」矛盾）、三家官方 SDK 各装一个（还得自己写统一层）。

## 两条只能靠实测拿到的 SDK 行为

### 1. openai 协议必须显式 `.chat()`

`createOpenAI(...)(id)` 默认走的是 **Responses API**（`POST /v1/responses`），拿 Chat Completions 的流喂它报「Received a Chat Completions stream while using the OpenAI Responses API」。`.chat(id)` 才是 `POST /v1/chat/completions`——官方端点与各种反代都吃这套。

### 2. SDK 按 model id 分支，同一份配置下发出去的 body 不一样

**生产代码不用改，但这是「参数怎么没生效」的唯一解释**，也是设置页那句提示的依据：

| 协议 / 模型 | system 的位置 | 最大长度字段 | temperature |
|---|---|---|---|
| openai `gpt-5.4` / `gpt-5.6-luna` | **`messages[0].role === 'developer'`** | **`max_completion_tokens`** | **整条丢掉**（`undefined`）+ 回一条 warning |
| openai `gpt-4o` / `gpt-4.1` | `role: 'system'` | `max_tokens` | 0.7 照下发 |
| anthropic `claude-opus-5` / `claude-opus-4-8` | 顶层 `system` | `max_tokens` | **整条丢掉** + warning |
| anthropic `claude-sonnet-4-6` / `claude-3-5-haiku` | 顶层 `system` | `max_tokens` | 0.7 照下发 |
| openai-compat（glm / deepseek / kimi） | `role: 'system'` | `max_tokens` | 0.7 照下发 |

推理模型丢 temperature **不是 bug 也不是我们丢的**，SDK 会把它作为 warning 返回，我们把 warning 一路推到消息气泡上——设置页写明「实测部分推理模型会把这个值整条丢掉并回一条告警，属正常」。第一版断言按「temperature 一定下发」写，三条红了；**没有放宽断言，而是写探针量出上表，再把两个分支各自断言**（reasoning 与非 reasoning 都测）。

其余测到的流形状：`fullStream` 的 part 顺序是 `start → start-step → text-start → text-delta → text-end → reasoning-start → reasoning-delta → reasoning-end → finish-step → finish`，**增量字段是 `part.text` 不是 `part.delta`**；usage 是 `inputTokens/outputTokens/totalTokens`；**abort 会发一个专门的 `abort` part 且流正常结束**（不抛），所以取消走的是取消分支不是错误分支。

`result.warnings` / `result.finishReason` 是 **`PromiseLike` 而不是 Promise，没有 `.catch`**，要 `Promise.resolve(...).catch(...)` 包一层，否则一处失败会变成未捕获拒绝。

## base URL：种子值不是结论，「测试连接」才是

`AI_PROVIDERS[].defaultBaseUrl` 是**种子**，每份配置可改。**末尾版本段（`/v1`、`/v1beta`、`/v4`）必须带上**：SDK 是在 baseURL 后直接拼 `/messages`、`/chat/completions`、`/models/x:streamGenerateContent`，少一段就是 404。尾斜杠要去掉，否则拼出 `//messages`。

`minimax` 与 `openai-compat` 的种子值**故意是空串**——不猜，猜错只会让报错更难查，这时逼用户自己填。注意由此产生的一个测试陷阱：拿 `provider:'openai'` 去测「地址为空要报错」永远测不出来，它有种子值会正常回落；要测这条得用 `openai-compat`。

真正的验证手段是配置卡上的**「测试连接」**：真发一次最小请求，把原始错误如实显示。没有各家真 key，这些地址在本机量不出来，不当结论写。

## 三样东西存三个地方

| 存什么 | 存哪 | 为什么 |
|---|---|---|
| 配置本体（id/名称/provider/model/baseUrl/systemPrompt/temperature + activeId） | `app-state.json` 的 `ai` 命名空间（`<dataDir>`） | 跟着数据目录迁移，零新增设施，直接用现成 `readState/writeState`（见 [[app-storage]]） |
| **API Key** | **`<userData>/ai-keys.json`**，逐条 `safeStorage.encryptString` | 数据目录设计成**可搬走、可指网盘**，把凭据一起搬出去是坑；且 Windows 上 safeStorage 是 DPAPI、绑当前账户，搬走也解不开。同「指针 settings.json 放 userData」一个理由 |
| 对话记录 | `<dataDir>/ai/conversations.json`，懒加载 + 防抖写 | **不塞 app-state.json**：那个文件启动时同步读进内存，聊天记录会让冷启动越来越慢 |
| 图片 | `<dataDir>/ai/images/<hash>.<ext>` | 图片是对话记录的一部分，放 cacheDir 会被「清空缓存」连聊天历史一起打断 |

**明文 key 只有一个方向、一次**：渲染进程 → `ai:setKey`。回来的永远只有 `{configId, hasKey, hint, encrypted}`，`hint` 是 `sk-a…wxyz` 这种掩码。`listKeyStatus` 也只回这个形状。

### safeStorage 实测（真 DPAPI，不是测试里那份 AES 桩）

拿真 Electron 跑了两个进程，第二个进程读第一个写的密文：

```
{"mode":"write","available":true,"roundTrip":"sk-verify-…","note":"密文 55 字节，前 4 字节 v10","plaintextOnDisk":false}
{"mode":"read", "available":true,"roundTrip":"sk-verify-…","note":"上一进程写的密文本进程解开了"}
```

`available:true`、密文带 DPAPI 的 `v10` 头、盘上搜不到明文、**跨进程/跨重启解得开**。Windows 的 DPAPI 不绑应用身份（`CryptProtectData` 无额外 entropy），所以打包与否行为一致。

**不可用时不许假装加密**：`encrypted:false` 落明文并在设置页显著提示（`aiConfig.hasPlaintextKey`）。`isEncryptionAvailable()` 本身抛错、文件损坏、会话中途恢复（文件里明文与密文混着）三条分支都有断言。

## 图片：渲染进程不碰 base64

`ai:stageImage(source)` 收文件路径或剪贴板 data URL，主进程 sharp **长边 1568 / JPEG q80** 降采样落盘，返回 `{id, path, mediaType, width, height, bytes, thumbnailDataUrl}`（缩略图 64px webp data URL，只给列表回显）。发送时**只把 `path` + `mediaType` 过 IPC**，主进程读成 Buffer 交给 SDK 的 `{type:'image', image, mediaType}`，各家 part 格式由 SDK 转——实测确实转对了：openai 出 `image_url` 的 data URL、anthropic 出 `source.base64` + `media_type`、google 出 `inlineData.mimeType`。

- **1568 / q80 是选定值不是实测值**（各家尺寸与体积上限没真 key 量不出来）。原图直传会让 token 成本与失败率都不可控。不放大（小图原样）。
- 同内容哈希去重，删会话时连带删它引用的图片（`pruneImages(keepIds: Set<string>)`，**收 Set 不是数组**），否则 dataDir 只涨不减。
- **非 vision 模型禁用上传入口并说明原因**（清单的 `vision` 字段就是干这个的）；万一还是带了图，主进程降级成纯文本 + 一条 warning 推到界面，不静默丢。
- 拖入取路径必须 `window.api.getPathForFile`（`File.path` 已废弃）；粘贴走 data URL 分支。

## 错误归一化

`electron/main/ai/errors.ts`：`innermost` 剥到最里层 cause、`isAbortError`（含嵌套 cause）、`statusText`、`bodySnippet`。要点：

- **502 返回 HTML 错误页时收到的是一行中文，不是 `Unexpected token <`**——这是规划时点名要修掉的那类。
- 401 不重试；`MAX_RETRIES = 1`（**选定值**：SDK 默认 2 次重试共 3 次请求，撞 429 要干等两轮指数退避，且退避期间能否即时取消没验证过），实测 429 下**共请求 2 次**后放弃。
- 空 body 的 500、`{}` body 都有兜底文案。
- **取消不是错误**：`canceled:true` + `finishReason:'abort'`，已生成的半句保留，一条 error 事件都不发。第二次 `cancelChat(同 id)` 返回 false。

## 渲染进程

- **对话窗口是独立进程视图，只有它挂 `aiChat` store**；主窗口只订阅一条 `ai:navigateSettings` 推送（AI 窗口的 ⚙ → 主窗口 `router.push('/settings')`）。任何入口只要 `openAiWindowApi()`。
- **关窗口 = 渲染进程没了 → 主进程按 sender 销毁取消请求**。这条与第一轮的「关面板不取消请求」是同一个需求的两种形态下的答案，见「形态三连反转」。
- **分片按 requestId 找目标消息，不往「当前会话」写**：用户完全可能生成中途切会话。`pending: requestId → {conversationId, messageId}`，两路并发各归各家；会话被删掉则分片丢弃且不抛错。
- 首页入口：`.home__usage-card`（「已使用 N 次」）整块换成 `.home__ai-entry`。**信息没丢**——总次数在下方「使用统计」环形图中心还有一份。副标题在没配置时直接说「去设置页添加配置」，别让用户点进去才发现。紫色只在那个 44px 圆形图标上作强调（[[toolbox-color-scheme]]），外面包 `can('ai-chat')`（tier 表没这 key → 默认 free 放行，将来收费只需在 `NAV_ITEMS` 登记，见 [[toolbox-entitlement-pattern]]）。
- **出错的助手消息不进下一轮上下文**（否则把错误当成模型说过的话），空的助手占位也不下发。
- **助手消息渲染全量 markdown**（#23c 起）：`marked` 只用 lexer → 纯对象节点树 → `h()`，零 `v-html`，见 [[ai-markdown]]。**用户消息仍是 `white-space: pre-wrap` 纯文本**（自己打的 `*` `#` 缩进多半是字面意思），`reasoning` 与工具卡片同理。`markdownLite.ts` / `splitCodeBlocks` 已删，取代它的是 `src/utils/markdown.ts`；未闭合围栏 `open:true`（流式常态，界面据此不高亮也不给复制按钮）这条语义原封不动搬了过去。
- 两个 store 分开：`aiConfig`（配置 + key 状态）/ `aiChat`（会话 + 流）。**下发前重建纯对象**（`{...config}`、`JSON.parse(JSON.stringify(conversations))`）——见 [[ipc-contract]]，本仓库已踩五次。
- `AiComposer` 的图片按钮是 `<n-icon :component="ImageOutline" />` 而不是「图片」二字（第二轮 review 的第 2 条）。

## 形态三连反转：`n-modal` → 内嵌浮动面板 → 独立窗口

**这个对话界面的外壳被推翻了两次，三种形态各自的否掉理由记在这，别再走回头路。**

| 形态 | 谁提的 | 为什么废了 |
|---|---|---|
| ① `n-modal` 居中弹窗（第一轮交付） | 我 | 有遮罩（挡住工具页，而它的整个用途就是**边用工具边问**）、强制居中、不可拖 |
| ② 挂 `AppLayout` 的 `position:fixed` 浮动面板（第一轮 review 返工） | 用户否掉了我最初的独立窗口方案（「看起来独立窗口很麻烦」） | 第二轮 review：「**可以拖拽出 app**」——DOM 越不过窗口边界，拖到边上只会被裁掉 |
| ③ **独立的无边框 `BrowserWindow`**（现状） | 用户拍的：「直接单独脱离窗口就行，**不需要在 app 里面，不需要分离贴回**」 | — |

第三种形态**没有**「拖出去 / 贴回来」这回事：AI 对话**永远**是独立窗口，app 里不再有内嵌面板，所以也就没有两态之间的交接协议。当初为形态 ② 写的 `AiChatPanel.vue`、`useDragResize.ts`（八向缩放 + 视口夹紧 + `setPointerCapture`）、`AiConfigState.panel`、`AiPanelGeometry` **全部删掉了**——拖动与缩放归 OS。

形态 ② 留下来仍然有效的三条（**换成窗口后一条都没变，是同样的约束换了个容器**）：

- **「超框」的根因是缺 `display:flex`**：最早那版设了 `height:680px` 却没设 `flex-direction: column`，`.n-card__content` 的 `flex:1` 因此完全无效。现在 `AiPanelWindowBody` 是 `height:100vh` 的 flex 列，**只有消息区 `flex:1; min-height:0`**，`n-alert` 与 `.ai-composer` 都显式 `flex-shrink: 0`——不写这条，长告警会把输入框挤出去。
- `AiSessionList.vue` 早就删了（200px 的列表在 380px 宽里放不下），会话由顶栏 `n-select` 切换，标签是 `标题 · 相对时间 · N 条`。
- `AiMessageItem` 的 `&__warning` / `&__note` 要 `word-break: break-word`：认不出的 feature 会带**英文 details**，窄窗口里不断词就顶出去。

### 独立窗口那套（[panelWindow.ts](electron/main/ai/panelWindow.ts) + [aiPanel.ts](electron/shared/aiPanel.ts)）

- **同一个 `index.html` 加 `?ai=1`，不新增 rollup 入口**：dev 是 `${ELECTRON_RENDERER_URL}?ai=1`，prod 是 `loadFile(..., { query: { ai: '1' } })`。[electron.vite.config.ts](electron.vite.config.ts) 的 `input` 保持**一个**，省掉第二份 html + 第二份 bundle。[main.ts](src/main.ts) 按 `location.search` 分叉挂 `AiPanelWindow` 而不是 `App`，**且不 `app.use(router)`**（这个窗口没有路由）。
- 窗口选项照抄主窗口（`frame:false` / `transparent:true` / 同一份 preload / `sandbox:false`），加 `resizable`、`minWidth:320`、`minHeight:360`，**不设 `parent`**（要能独立于 app 之上或之下）。
- **每个窗口都得重建 naive-ui 的 provider 链**，`setMessageApi(useMessage())` 必须在 provider **内部**调——不注册的话这个窗口里的 `showError` 只会进 console。
- **顶栏 `-webkit-app-region: drag`，所有按钮与下拉 `no-drag`**（不加就点不动）。按钮：`会话下拉 ▾ / ✎ / ＋ / 🗑 / ⚙ / 📌 置顶 / ─ 最小化 / ✕ 关闭`——三个窗控，**没有「贴回」**（那个形态根本不存在，见上表）。最小化是第四轮 review 用户加的（「ai对话框加个最小化按钮」，2026-09-04），排在 ✕ 左边跟 Windows 一个顺序。
- **顶栏必须留一块空白给拖拽**（第三轮 review 的第 1 条）：会话下拉原来是 `flex: 1 1 0`，把顶栏铺满后只剩按钮之间的缝可以按，**窗口基本拖不动**。现在下拉是 `flex: 0 1 140px`（窄窗口下自己先让位），后面跟一个 `.ai-window__drag`（`flex: 1 1 auto; min-width: 32px`）——那个 div **不能标 `no-drag`**，它的整个用途就是当把手。加了最小化之后顶栏是**八个**元素，`min-width: 32px` 从「保险」变成**保命的那一条**：按钮不缩、下拉缩到 0 之后，那 32px 就是 320px 最窄宽度下唯一还能按住拖动的地方。重命名输入框与下拉同宽，切换时布局不跳。
- **下拉一窄，选项菜单也跟着窄，所以要 `:consistent-menu-width="false"`**：naive-ui 默认让弹层与触发器同宽，会话标签是 `标题 · 相对时间 · N 条`、配置标签是 `名称 · 模型`，140px 的触发器会把菜单里的选项也截断成认不出来。触发器窄 + 菜单按内容宽才是对的。输入框上方那两个下拉同理不撑满（`152px` + `106px`，右边留白）。
- **这个窗口里 `window.api.window.*` 控的是主窗口**（`registerWindowControlIpc(mainWindow)` 是闭包），所以绝不能用 `useWindowControls`——在这儿调 `minimize()` 会把整个 app 收进任务栏。三个窗控各走各的：**关闭是唯一有 DOM API 的**（`window.close()`，不用过 IPC）；置顶走 `ai:setWindowTop`；**最小化走 `ai:minimizeWindow`**，因为 DOM 的 `window` 压根没有 minimize。收起来之后从任务栏点回来，或者再点一次首页 AI 入口（`openPanelWindow` 本来就先 `isMinimized() → restore()`，所以不会开出第二个窗口）。
- **最小化不会把窗口位置写坏，不需要额外守卫**（真 Electron 探针量的，Windows + frameless + transparent）：最小化期间 `getBounds()` 回的仍是**还原后的**位置（Win32 那个 `-32000` 被 Electron 兜住了），而且最小化只触发 `move` 与 `minimize`，**不触发我们落盘用的 `moved` / `resized`** —— 于是它压根不会排一次写盘。**这条是先量后写的**：本来准备加一个「最小化时跳过 scheduleSave」的守卫，量完发现现有的 `moved`/`resized` 选择已经把这件事挡住了，就没加那段投机代码。
- ⚙ 是**跨窗口跳转**：`ai:openSettings` → 主进程聚焦主窗口 → 推 `ai:navigateSettings` → 主窗口 `router.push('/settings')`。所以 `navigateSettings` **是推送通道、不注册 invoke handler**（有断言守这条）。改完配置切回 AI 窗口，`window.focus` 里 `refreshAppState()` + `aiConfig.hydrate()` 重读磁盘——**不 hydrate 这边就一直停在打开时那份**。
- `host.on('closed')` → 销毁 AI 窗口。少这条，关掉主窗口后 `window-all-closed` 不触发，进程会剩一个 AI 窗口挂着不退。

### 窗口位置尺寸：主进程自己写 `aiWindow` 命名空间

- **不能塞进渲染进程持有的 `ai` 命名空间**：那个命名空间是 `aiConfig` store **整块覆盖写**的，两边都写必然互相抹掉。所以 bounds + `alwaysOnTop` 单独一个 `aiWindow` 命名空间，由主进程直接 `writeAppState`，`moved`/`resized` 防抖 ~400ms。
- 坐标数学拎进 [aiPanel.ts](electron/shared/aiPanel.ts) 当**不碰 Electron、不碰 DOM 的纯函数**（`defaultPanelBounds` / `clampPanelBounds` / `parsePanelBounds`），桩测才断言得了。
- 默认位置贴主窗口右侧：`x = host.x + host.width - 380 - 12`、`y = host.y + 56`、宽 380、`height = host.height - 56 - 12`（沿用形态 ② 那三个数，就是用户要的「窄、高度和 app 一致」）。**算出来要认工作区的原点**——主窗口在负坐标的副屏上时，x 必须保持为负，不许被夹回主屏。
- **存下来的 bounds 一定要夹进当前显示器的 `workArea`**：拔掉外接屏后，存的死值就在屏幕外，窗口开出来看不见。夹紧规则：不小于 320×360、不大于工作区、四个方向至少留 **120×60** 在工作区内、**`y` 不许小于工作区上边**（顶栏是唯一的拖拽把手，滑上去就再也拖不回来）。
- `parsePanelBounds` 要求四个数都是**有限数**，`NaN` / `Infinity` / 字符串数字 / 缺字段一律当没存过——`setBounds` 吃到 `NaN` 会抛，窗口根本开不出来。

## review 返工（第一轮交付后的七条）

七条里三条是我写错的实现（4、6 与配置卡边改边写盘），四条是形态要求（形态那部分见上一节）。

### 会话命名（第 3 条）

`AiConversation` 加 `titleCustom?: boolean`，`aiChat` 加 `renameConversation(id, title)`。**自动标题只在 `!titleCustom` 时才覆盖**——不加这个门，用户刚改完名，下一条消息就把它改回去。提交空串则回落「新对话」**并清掉 `titleCustom`**（于是又允许自动取名）。

### `SharedV3Warning` 只有三种形状——我上一轮认错了字段（第 4 条）

截图里 warning 显示成一行原始 JSON，是我写的 bug：`describeWarning` 判的是 `type === 'unsupported-setting'` + `w.setting`，**这两个名字 SDK 里都不存在**，所以**每一条** warning 都落到 `JSON.stringify` 兜底。真实定义在 `node_modules/@ai-sdk/provider/dist/index.d.ts:68`，就三种：

| 形状 | 输出 |
|---|---|
| `{type:'unsupported', feature, details?}` | 「该模型不支持<中文功能名>，已忽略」 |
| `{type:'compatibility', feature, details?}` | 「以兼容模式使用<中文功能名>，结果可能不理想」 |
| `{type:'other', message}` | 原文 |

- **`details` 只在 feature 认不出时才附上**：截图那句 details 是「temperature is not supported by claude-opus-4-8 and will be ignored」，中文句已经把它说完，再括号一遍是噪音；认不出 feature 时反过来必须留着，否则信息全丢。
- **教训在验证方式上，不在代码上**：上一轮探针只断言了「有没有 warning」，没断言文本，所以这个错一路漏到界面。现在桩测断言的是**逐字文本**，并且留了一条回归断言——旧的 `{type:'unsupported-setting', setting:'temperature'}` 必须落到 JSON 兜底（确认不是把一个错名字改成了另一个错名字）。

### 配置卡：单选列表 + 草稿式弹窗 + `copyKey`（第 7 条）

[AiSettingsCard.vue](src/components/ai/AiSettingsCard.vue) 从 `n-collapse`（459 行）改成 `n-radio-group` 列表（~200 行）：一行 = 单选 + 名称 + 「缺 Key」标签 + `厂商 · 模型` 副标题 + 编辑/复制/删除。radio 选中即 `setActive`。

- 旧的 collapse 是**边改边写盘**，没有「取消」的余地。新 [AiConfigDialog.vue](src/components/ai/AiConfigDialog.vue) 是**新增/编辑/复制三模式共用**一个 `n-modal`，改在 `reactive` 草稿副本上，`saveConfig(id, draft)` 才落。`updateConfig`（单字段立即写）保留给 radio 与 store 内部用——两个都在，别以为是重复。
- **复制必须连 key 一起**，否则「同一个 key 换个模型」这个复制的主要用途每次都要重新粘 key。明文拿不到渲染进程，所以只能加主进程通道 **`ai:copyKey(fromId, toId)`**：明文在主进程内从源流到目标，渲染进程只拿回目标的 `AiKeyStatus`。`getKey()` 依旧**不接任何通道**。
- `copyKey` 的两条边界：**源没 key 时不许把目标已有的 key 抹掉**（是 no-op 不是清空）；`safeStorage` 不可用时照样复制但 `encrypted:false`，不假装加密。

### 工具审批下拉（第 5 条）

`AiConfigState.toolApproval`（**全局一份，不是每配置一份**，默认 `'ask'`），位置在输入框上方、模型下拉右边。第一轮它只是个占位（`n-tooltip` 标着「下一轮上线」），**23b 已经让它生效并拓宽成 `off | ask | auto` 三态、tooltip 也删了**，取值语义与确认往返见 [[ai-tools]]。

## 验证

**esbuild 打包法**（同 [[media-audio]] / [[video-clip]]）：生产代码逐字保留，只桩 `electron`（`app.getPath` + safeStorage 的 AES 替身 + 记录 handler 的 `ipcMain`）与两个渲染服务模块（`@/services/appState`、`@/services/ai`），node 直跑。**主进程 11 组 149 断言 + 渲染进程 8 组 140 断言，全绿**；review 返工另加 `scripts/tbverify/`（`pnpm verify:ai`）**主进程 63 + 渲染进程 64 断言**（23b 加到 139 + 91，23c 把渲染加到 193，最小化那轮再给主进程 +3 → **142 + 193**），覆盖 `describeWarning` 的逐字文本、`copyKey` 四条边界、窗口位置尺寸数学（含负坐标副屏）、`ai:chat` 按 `event.sender` 推流与 sender 销毁取消、`aiConfig.hydrate()`、`titleCustom`、`toolApproval`、配置草稿与复制、`ai:minimizeWindow`（**通道必须存在** + 窗口没开时回 `false` 而不是抛）。

**桩测第一次就全绿时，先证明它会红。** 第一轮的自检：插一条必假的断言（确认 exit code 变 1、失败会打印），以及**把 `describeWarning` 改回上一轮那个错字段**跑一遍——红了 8 条，实际值正是截图上那行原始 JSON。改独立窗口这轮**逐条拆掉四个新行为再跑**：`clampPanelBounds` 去掉夹紧 → 红 9 条；去掉 `e.sender.once('destroyed', ...)` → 红 3 条；分片改回注册时闭包的那个窗口而不是 `event.sender` → 红 3 条；`hydrate()` 掏空 → 红 4 条；`findTarget` 改成「写当前会话」→ 红 2 条。最小化那轮两条：`minimizePanelWindow` 的无窗口分支改成 `return true` → 红 1 条；**去掉 `handle` 注册** → 红 3 条（第一次跑是挂死，见下）。每条都改回去了。没这一步，「全绿」和「什么都没测」长得一模一样。

**两条这轮才学到的「坏了却不报错」**——`verify:ai` 是 top-level await 的裸脚本，没有测试框架兜底：

- **一条线断了可能表现为整个套件挂死**：去掉 sender 销毁取消后，node 只打一句 `Warning: Detected unsettled top-level await` 然后 exit 1，**一条失败名都不打**。所以等一个请求结束必须用 `settledWithin(promise)`（1 秒 `Promise.race`，输的那条要 `void promise.catch(() => {})` 接住免得变未处理拒绝）。同理，去掉 `event.sender` 推流后 `streamed[0].payload` 直接 `TypeError` 崩掉整个进程——索引一律 `?.`，让它变成红断言而不是崩溃。**最小化那轮又撞了一次同一个坑，值得记下形式**：`invokeIpc` 对**没注册的通道是直接抛**，所以拆掉 `handle(minimizeWindow)` 这条突变第一次跑是整个套件挂死、连「N 条通过」那行都没打出来；把 `invokeIpc` 包一层 try/catch 映射成 `{code:-1,data:null}` 之后，同一个突变给出 **3 条有名字的红断言**。**规律**：桩测里凡是「东西可能压根不存在」的调用点，都要先接住抛出再断言，否则「坏了」与「崩了」长得一样。
- **「返回 false」的断言需要一个对照组**：`cancelChat(id)` 对「已取消」和「压根没注册」都回 `false`，所以先起一个 `req-control` 证明它对进行中的请求会回 `true`，那条 `false` 才有意义。

三条位置上的坑：桩测脚本**横跨主进程与渲染进程两套 tsconfig**，不属于任何一个 project，`eslint` 只会回 `parsing error`，所以 `scripts/tbverify/**` 与产物 `out-tbverify/**` 都进了 eslint ignores（后者不加的话 eslint 会去 lint 六万行 bundle）；`--alias:@=src` 与 `--alias:@/services/ai=桩` 同时给，esbuild 先试完整路径再逐段退到更短前缀，**精确路径赢**，所以两条能共存。

四条打包法上的坑，下次照抄能省时间：

1. **必须单一入口**。`conversations`/`images` 都依赖 `storage/paths` 的**模块级 `dataDir`**，分文件各打一个 bundle 就成了各自一份，`initStoragePaths()` 只初始化其中一份，另一份永远是空串。另开第二个 bundle 只为拿一份 `cache` 从没填过的干净 `keys.ts`（测「文件损坏」）。
2. **ESM 输出要补 `createRequire` banner**：依赖链上的 CJS 包 `@vercel/oidc@3.2.0` 会运行时 `require('path')`，不补就是 `Dynamic require of "path" is not supported`。
3. **banner 里有引号和分号，不能经 shell 传**（会被切词，报 `Must use "outdir" when there are multiple input files`）。把构建写成 `.cjs` 用 `execFileSync` 传 argv 数组。
4. **`structuredClone()` 就是「跨 IPC 是不是纯对象」的判据**。Vue 的 reactive 代理在它下面抛 DataCloneError，正是本仓库反复踩的那个坑，而 typecheck 与 build 一个都拦不住。所有下发点都用它断言。

两处**桩自己说谎**导致的假红，都不是生产代码的问题：

- 面板打开时会调 `refreshKeyStatus()`，而桩一律回 `hasKey:false`，把测试刚设好的状态刷掉 → `send` 被「还没有填 API Key」拦住。桩得真的记住哪些配置有 key（`seedKey`）。
- 防抖写盘的次数被**前几组 store 遗留的计时器**污染（`fresh()` 换得掉 store，换不掉已经排上的 `setTimeout`）。数之前先 `await sleep(650)` 让它们烧完再清账。

**打包后 asar 实测**（`@electron/asar` 列包内文件）：八个包全在、各自带 `package.json`，纯 JS 不需要解包。

```
ai 565 项 / @ai-sdk/anthropic 56 / openai 84 / google 71 / openai-compatible 48
@ai-sdk/provider 177 / provider-utils 136 / zod 733
```

打包本身在本机踩了 [[app-storage]] 已记过的那条：`rename win-unpacked.tmp -> win-unpacked` 在仓库内的 `release/` 下必定 EPERM。这次量清了它**与内容有关而不是与目录有关**——同目录下同数量同体积的普通文件重命名成功，一放进 Electron 的 `.dll`/`.pak` 就 EPERM（`move` 报「拒绝访问」而 `rm -rf` 却成功，说明不是句柄占用）。除了已记的「输出到 `%TEMP%`」，第二条绕法是 **`-c.electronDist=node_modules/electron/dist`**：electron-builder 认「已解包的 Electron 目录」，走复制而不是解压+改名，输出可以留在仓库内。

**人工验，本机做得了的（不需要真 key）**：首页点 AI 入口 → 独立窗口在主窗口右侧开出、宽窄与高度跟以前的面板一致 → 拖顶栏能移动、**拖到第二块屏幕**、拖边角能缩放（最小 320×360，**留意透明窗口缩放时有没有重绘残影**，真有就退回 `transparent:false` + 直角）→ 📌 置顶后覆盖住其他程序 → **点 ─ 只收起 AI 窗口、主窗口一动不动**（这条最容易写错，写错就是整个 app 被收进任务栏），任务栏点回来位置尺寸与置顶状态都没变、再点一次首页 AI 入口也能唤回且不会开出第二个窗口，**还原后透明窗口没有重绘残影、圆角还在**，关掉重开位置仍是最小化之前那份（验「最小化不写盘」）→ 关掉再开，位置尺寸与置顶状态都还在 → 主窗口切工具页 / 最大化都不影响它 → ⚙ 让主窗口跳到设置页、在那儿改完配置切回 AI 窗口，配置已刷新 → ✕ 关掉窗口，会话已落盘（重开还在）→ **关主窗口时 AI 窗口一起消失、进程退出** → 在 150% 缩放的屏幕上再走一遍（bounds 是 DIP，位置不许偏）→ **缩到 320px 最窄宽度，八个顶栏元素挤在一起时仍有地方能按住拖动**（下拉先让位，`.ai-window__drag` 那 32px 是保底）→ 输入框左边是图片图标而不是「图片」二字。

**人工验，需要用户真 key（本机做不了）**：配一个厂商 → 测试连接通过 → 对话**逐字流出**而非一次性蹦出（这条就是在验 `event.sender` 那处改动）→ 中途取消立刻停 → **生成中直接关掉窗口，主进程侧请求被取消**（不再空烧 token）→ vision 模型认出图片 / 非 vision 上传禁用 → **重启后配置/会话/图片都在** → `app-state.json` 里搜不到 API Key → 顶部下拉切会话、生成中切走再切回内容没串到别的会话 → ✎ 改名后发新消息标题不被改掉 → 长回复只在消息区滚动不超框 → `claude-opus-4-8` 的 temperature 告警显示成一句中文 → 配置的编辑/复制/删除走弹窗、取消不留痕、复制出来的不用重填 key。

## 第二轮（#23b 工具调用）已交付 → [[ai-tools]]

工具调用本身、13 个工具的清单、确认往返的四条边界都在 [[ai-tools]]，这里只留接缝的**去向**，免得两边各写一份：

- 第一轮占位的 `AiToolSpec { name, description, kind }` **已删除**——真正的形状是主进程私有的 `ToolDef`（带 `inputSchema` / `summarize` / `forceConfirm` / `run`）加上跨 IPC 的 `AiToolCall`（一次调用的状态记录，既上界面也落盘）。占位那份留着就是两份定义。
- `streamText` 调用处那行「本轮不注册任何工具」的注释换成了真的 `tools` + `stopWhen: stepCountIs(8)`。
- 已定的规则（用户拍的，23b 照做）：**只读工具直接跑**；**写盘类要确认**；确认策略就是那个下拉，且 **`overwrite` 在 `auto` 下仍然确认**。
- 工具事件**复用 `ai:chatStream`**（`AiStreamEvent.type` 加 `'tool'`），所以渲染进程 `onAiStream` 一处订阅全包；新增的只有渲染 → 主的 `ai:toolReply`。

素材是现成的全表 `file.* / image.* / video.* / audio.* / font.* / bitmapFont.* / excel.* / storage.* / dialog.*`（见 [[common-capabilities]]）。

相关：[[ai-markdown]]（#23c 助手消息的 markdown 渲染：只用 marked 的 lexer、零 `v-html`、流式块级增量、落盘只走原文）、[[ipc-contract]]（`{code,data,message}` 与纯对象铁律）、[[app-storage]]（两层存储与 userData/dataDir 分工）、[[packaging]]（asarUnpack 与输出目录）、[[home-page]]（首页卡片）、[[app-layout]]（全局弹窗挂载）。
