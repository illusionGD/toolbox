---
name: ai-tools
description: Toolbox AI 工具调用（#23b）——13 个工具（读 8 写 5）挂给 Vercel AI SDK 的 `tool()` + `stopWhen: stepCountIs(8)`；记「工具返回值就是 token 所以必须封顶」「拒绝与失败都 return 不 throw」「`cancelChat` 漏了 `denyPending` 是挂死而不是报错」「只 abort HTTP 杀不掉 ffmpeg」「off|ask|auto 三态与 overwrite 强制确认」以及实测出来的 ai@6 tool part 形状。确认 UI 是消息流里的内联卡片
---

# AI 工具调用（#23b）

用户六条需求里的**第 4 条**：让 AI 调工具箱现有的能力。#23a（见 [[ai-chat]]）只会聊天，接缝留在那儿。用户拍定的四条：**工具范围** = 读 8 + 写 5；**确认 UI** = 消息流里的内联卡片（不是模态弹窗，确认过什么会作为记录留在会话里）；**overwrite 在 `auto` 下仍然确认**；**下拉加第三项「工具：关闭」**。

用了 SDK 之后我们只写三样：工具本体、确认往返、卡片。`tool({description, inputSchema, execute})` 交给 `streamText`，三家协议的 tool_call 翻译与**多步循环**都归 SDK，且循环发生在**一次请求内部**。

## 文件

```
electron/main/ai/tools/
  types.ts     ToolDef / ToolCtx / ToolOutput + defineTool（类型擦除收在一处）
  registry.ts  13 个工具本体（559 行，两条硬规则写在文件头）
  confirm.ts   requestConfirm / replyConfirm / denyPending
  tasks.ts     trackTask / untrackTask / killTasks（ffmpeg 子进程）
  index.ts     buildTools(ctx) + runTool 包装（确认 / 状态事件 / 失败变返回值）
```

`ToolDef` 是**主进程内部**的形状（带 zod schema 与函数，永不出主进程）；`AiToolCall` 是跨 IPC 的**记录**，**既是界面模型也是落盘模型**。#23a 留的占位 `AiToolSpec` 已删——它和 `ToolDef` 是两份定义。

```ts
interface ToolDef<S extends z.ZodType> {
  name: string;                                  // snake_case
  kind: 'read' | 'write';
  description: string;
  inputSchema: S;
  summarize(input): string;                       // 一行中文，确认卡与落盘共用
  forceConfirm?(input): boolean;                  // auto 也要确认
  run(input, ctx): Promise<{ note: string; data: unknown }>;
}
```

**`ToolOutput` 拆成 `note` / `data` 是有意的**：`note` 给人看（卡片那行 + 落盘），`data` 给模型看，**只有 `data` 回给模型**——界面文案混进上下文会让模型跟着复读一遍。

## 两条硬规则（加新工具前先读，也写在 registry.ts 顶部）

1. **没有删除、没有 shell、没有网络抓取。** 破坏性最强的是 `rename_files`，而它是原地改名 + 整批 preflight（有冲突一个都不碰）。判断标准是「模型最坏情况下能干出什么」，不是「多半会干什么」——**提示注入是从被处理的文件内容里进来的**（`read_text_file` 读到的东西会进上下文）。
2. **工具返回值就是 token。** 每个 `run` 只回精简且封顶的结构：`list_files` 最多 200 条（`scanDirectory` 单次能出 20 万条）、`read_text_file` 最多 64 KB，超出都把 `truncated` 置 true 并如实说明。不封顶的失败形式是「模型突然答得莫名其妙」，极难查。

另两条实现纪律：

- **底层能力一律直接调 `ipc/*.ts` 里的函数，不复制实现、不绕回 IPC。** 那些函数里是实测换来的守卫（同路径覆盖检测、临时文件 + rename、Windows 非法名与保留设备名、MAX_PATH、两趟改名、libvips 句柄），复制一份必然漏几条。为此把 `scanDirectory` / `renameBatch` / `writeTextFile` / `compressOne` / `probeImage` / `transcodeOne` / `convertOne` / `probeFont` / `probeExcel` 改成了 `export`。
- **重的选项对象不给模型看。** `TranscodeOptions` 18 个必填字段、`AudioConvertOptions` 15 个，原样暴露只会换来一堆瞎猜的值。schema 只暴露几个常用字段，其余由适配层按**界面上已经在用的那份默认值**补齐，另加 `format → codec` 映射表。

## 13 个工具

**读（`kind:'read'`，直接跑，不确认）**

| 工具 | 底层 | 封顶 / 要点 |
|---|---|---|
| `list_files` | `scanDirectory(null, …)` | scanId 用 `ai-tool-<callId>`；≤ 200 条 `{path,name,size,ext}` + `{total,dirs,listed,truncated}`。**`files` 这个字段名在返回值里不存在**，桩测专门断言了这点 |
| `probe_image` | 新增私有 `probeImage`（sharp `metadata()`） | 宽高 / 格式 / 是否动图 / 字节 |
| `probe_video` / `probe_audio` | `probeVideo` / `probeAudio`（本来就导出） | |
| `probe_font` | `probeFont` | 字号 / 字形数 / 是否可变字体 |
| `probe_excel` | `probeExcel` | 工作表 / 表头 / 行数 |
| `read_text_file` | `readFile(path,'utf-8')` | ≤ 64 KB，截断如实说 |
| `storage_info` | `getPathsInfo` + `dirUsage` | 数据目录 / 缓存目录及占用 |

**写（`kind:'write'`，`ask` 下逐次确认）**

| 工具 | 底层 | `forceConfirm` |
|---|---|---|
| `compress_images` | `compressOne` **串行**（sharp 吃满 CPU，并发只会互相抢） | `overwrite === true` |
| `convert_video` | `transcodeOne(null, …)`，taskId `ai-<requestId>-<now>` + `trackTask` | `overwrite === true` |
| `convert_audio` | `convertOne(null, …)`，同上 | `overwrite === true` |
| `rename_files` | `renameBatch`（自带 preflight） | **总是** |
| `write_text_file` | 新增 `writeTextFile`（**不走 `saveText`**，那个会弹保存对话框） | `overwrite === true` |

> **与计划的偏差**：计划里 `write_text_file` 写的是「目标已存在时」强制确认。实现改成了 `overwrite === true`——「目标存在吗」要先 `stat` 一次，而 `forceConfirm` 是同步的；而且不带 `overwrite` 时底层本来就会因为文件已存在而报错，走的是 `{error}` 那条路，模型看得懂。

## 包装层（`index.ts` 的 `runTool`）

```
callId = randomUUID()；summary = def.summarize(input)（它自己抛错只降级成工具名，不拖累调用）
需要确认? = kind === 'write' && (mode === 'ask' || forceConfirm?.(input) === true)
需要确认 → emit(pending) → await requestConfirm(requestId, callId)
            拒绝 → emit(denied, result:'已拒绝') → return { denied:true, message:'用户拒绝了这次调用。不要重试，改问用户希望怎么做。' }
emit(running) → try run() → emit(done, result:note, elapsed) → return output.data
                catch      → emit(error, result:原因)        → return { error: 原因 }
```

**拒绝与失败都 `return`，不 `throw`。** 实测过抛出会怎样：SDK **并不会**让整个请求失败，它发一个 `tool-error` 分片后继续循环把错误喂回模型——但那个 `error` 字段序列化出来是 `{}`，**模型到底看到什么不在我们手上**。所以理由不是「抛了会崩」，而是「抛了就控制不住给模型的措辞」：被拒绝时它该改口径问用户，出错时它该看到中文原因。

**同一个 callId 会 emit 多次**（pending → running → done），每次发的都是**完整记录**（幂等，断一片不会留下半张卡），渲染进程按 callId **upsert**。工具事件**复用 `ai:chatStream`**（`AiStreamEvent.type` 加 `'tool'`），所以那边 `onAiStream` 一处订阅全包；新增的通道只有渲染 → 主的 **`ai:toolReply`**。

## 确认往返的四条边界（`confirm.ts`）

`Map<callId, {requestId, resolve}>`。四条都有桩测断言：

1. **`cancelChat(requestId)` 里必须 `denyPending(requestId)`。** 本轮唯一一处**漏了不报错、只挂死**的地方：`streamText` 的 `abortSignal` 管不到我们自己 await 的那个 promise，不主动判掉 `execute` 就永远挂着，请求既不结束也不报错，界面上是一条永远在转的消息。
2. **AI 窗口被关掉也要判掉。** 走的是 ipc 层现成的 `e.sender.once('destroyed')` → `cancelChat` → `denyPending`，所以 `requestConfirm(requestId, callId)` **不收 `WebContents` 参数**（计划里写的是收；实现发现没必要，那条链已经覆盖了，多一个参数只是多一处要保持同步的地方）。
3. 未知 / 重复的 callId 回 `false`，**不抛**——界面上那张卡片可能是从磁盘读回来的历史记录，点了没人接是正常的。
4. **不设超时。** 用户可能离开电脑，超时自动拒绝比一直等更糟（他回来只看到「已拒绝」，还得重问）。唯一出路是「停止」按钮。

## 取消要杀两样东西

`cancelChat` 现在做三件事：`denyPending` + `killTasks` + `controller.abort()`。**只 abort HTTP 请求是不够的**：转码工具真正在干活的是一个 ffmpeg 子进程，它不看 HTTP，会一路把文件转完（CPU 满载、输出文件照样落盘），用户点了「停止」却发现任务管理器里还有 ffmpeg.exe。所以 `ToolCtx.trackTask` 登记 taskId，正常结束时 `untrackTask`（免得 Map 只涨不减）。

`transcodeOne` / `convertOne` / `scanDirectory` 的 `win` 参数**只用来推进度**，每个文件恰好一处。签名放宽成 `BrowserWindow | null`，工具传 `null`（AI 窗口没监听 `video:transcodeProgress` 那些通道，进度体现在卡片状态上）。**`font.ts` 的 `sendConvertProgress` / `convertOne` 故意没跟着放宽**——字体转换没进工具集，改了就是无用改动。

## 三态 `off | ask | auto`

`AiConfigState.toolApproval`（全局一份），下拉在输入框上方。**`off` 是真的不下发 `tools`**：`buildTools` 回 `undefined`，`streamText` 里 `...(tools ? {tools, stopWhen} : {})` 展开成什么都没传。省掉十几个工具声明的 token，也绕开部分兼容端点见到 `tools` 直接 400。三项标签故意一样长（`工具：询问 / 自动 / 关闭`），下拉宽度不跟着选中项跳。

`toolMode` **跟着 `AiChatRequest` 下发，主进程不去读 app-state**——同 `config` 整份下发的理由：主进程读了那个文件就是两份状态，必然漂移。`testConnection` 传 `toolMode:'off'`（「测试连接」带上十几个工具声明既费 token，又可能因为端点不吃 `tools` 把一次本来能通的连接测成失败）。

**`overwrite` 在 `auto` 下仍然确认**（用户拍的）：覆盖原文件是不可逆的数据丢失，而模型是可能被文件内容里的话带偏的。

## 实测出来的 ai@6 形状（别再量一遍）

- `fullStream` 的工具相关 part 顺序：`tool-input-start{id,toolName,dynamic}` → `tool-input-delta{id,delta}` → `tool-input-end{id}` → `tool-call{toolCallId,toolName,input}` → `tool-result{...}`。**全部落到 `default:` 静默丢弃**：界面要的东西我们自己 emit 过了，而且那份记录更好用。
- `execute` 第二个参数实测有 `["toolCallId","messages","abortSignal","experimental_context"]`。包装层一个都不用。
- 从 `execute` 抛错 → 发 `tool-error` 分片并**继续循环**，但 `error` 序列化成 `{}`。
- 撞上步数上限 → `finishReason === 'tool-calls'` 且 **`text === ''`**，助手气泡会是**空白的**。所以 `finish === 'tool-calls' && !canceled` 时补一条告警「已达到工具调用步数上限（8 步），模型还没来得及给出结论」。
- `MAX_TOOL_STEPS = 8`：多步循环每一步都是一次**真实请求**（上一步的结果拼进上下文再发一遍），这个数直接乘在账单上。8 步够走完「探测 → 处理 → 汇报」。

## 渲染进程

- `aiChat.subscribe()` 加 `type === 'tool'` 分支 → `upsertToolCall`（按 callId `splice` 替换，找不到才 push）。**无脑 push 的话一次调用会画出三张卡片。**
- `ensureLoaded()` 里做一次**净化** `sanitizeToolCalls()`：磁盘上读回来的 `pending` / `running` 一律改 `'interrupted'`。那些卡片主进程那边的 promise 早被判掉了，**没有任何人在等它**，不改就是一张永远在转、永远点不动的卡。
- `approveTool` / `denyTool` → `replyAiToolApi`，并**先把本地状态推到 `running` / `denied`**（按钮立刻不能再点），主进程随后的事件会覆盖成权威值。只动 `status === 'pending'` 的卡，否则历史记录会被改回 `running`。
- **`history` 保持只发 text，工具调用不进下一轮上下文。** 这是有意的边界：SDK 的多步循环发生在一次请求内部，跨轮只留模型自己写下的话。
- `AiMessageItem.vue` 的卡片：状态点 + 工具名 + 状态字 + 耗时 + `summary`（`word-break: break-word`，参数里全是绝对路径）+ 结果行；**只有 `pending` 才渲染「允许 / 拒绝」**（其余状态那边的 promise 已落定，点了没人接）。它**直接拿 store 而不是往上抛事件**——store 本身就是全局单例，穿三层 props 只是噪音。配色守 [[toolbox-color-scheme]]：卡片背景中性灰阶，只有「允许」是 primary。

## 验证

`pnpm verify:ai`（esbuild 打包法，生产代码逐字保留，见 [[ai-chat]] 的四条打包坑）：**主进程 139 + 渲染进程 91 断言全绿**（23a 的 63 + 64 全部保留）。真跑了文件系统：`mkdtempSync` 造 500 个真文件验 `list_files` 的封顶，写工具确认前后**断言磁盘上有没有字节**（不是只看返回值）。

**桩测第一次全绿时先证明它会红**（[[toolbox-workflow-conventions]] 的硬要求）。五条逐个拆掉再跑，每条都改回去了：

| 拆掉 | 结果 |
|---|---|
| `cancelChat` 里的 `denyPending` | 红 2 条（**且没挂死**——正好验证 `settledWithin` 的兜底在起作用） |
| upsert 改回 push | 渲染红 10 条 |
| `forceConfirm` | 主进程红 4 条（`auto`+`overwrite`、`rename_files`） |
| `ensureLoaded` 的净化 | 渲染红 2 条 |
| 拒绝改成 `throw` | 红 2 条 |

**最后那条第一次跑是「整个进程被未捕获异常打死」**——退出码是红的，但一条断言名都不打。所以桩测的 `callTool` 现在**接住抛出换成 `{threw: 原因}`**，跟 `settledWithin` 兜挂死是同一个理由：坏了要变成一条红断言，不是变成崩溃。

`cancelChat` 杀 ffmpeg 是**行为断言**而不是 spy：取消后再 `runFfmpeg(['-version'],{taskId})` 拿到 `canceled:true`（压根没 spawn），并配一个活着的 taskId 做对照组回 `false`。

**tbverify 的五个 `--external:`**（23b 新增，理由写在 `run.cjs` 头）：主进程入口经 `registry.ts` 连上了 `ipc/{file,image,video,audio,font,excel}.ts`，于是拖进来两类打不进 ESM bundle 的东西——`cn-font-split`（`koffi` 里十几个 `.node` + `require('bun:ffi')`）、`subset-font` / `fontverter`（链上 `wawoff2` 是 emscripten 产物，**模块级**就用 `__dirname` 找 wasm）、`@ffmpeg-installer/ffmpeg` / `@ffprobe-installer/ffprobe`（`__dirname` 现算二进制路径 → `ERR_AMBIGUOUS_MODULE_SYNTAX`）。留成 external 由 node 按 CJS 原样加载，`ffmpegInstaller.path` 照样拿得到。这些都在桩测碰不到的路径上。`--alias` 救不了这个场景：它退不到相对导入路径。同时 `stub-electron.ts` 要补 `dialog` / `protocol`（`file.ts` 的另存、`protocol/media.ts`），少一个 bundle 就断。

**人工验，本机做得了的（不需要真 key）**：三项下拉切得动且落盘（关窗重开还在）、「下一轮上线」那句 tooltip 不见了。

**人工验，需要用户真 key**：问「D:\某目录 里有哪些 png，多大」→ `list_files` **直接跑完**（读工具不问）→ 模型用结果作答；「压成 webp 存到 out」→ 出现**待确认卡片**，允许 → running → done、输出文件真的在；拒绝 → 卡片标已拒绝且**模型接着说话**（不是整条消息报错）；切「自动」→ 不再问，但要求「覆盖原图」时**仍然弹确认**；切「关闭」→ 模型说自己没有工具；确认卡挂着时点「停止」→ 卡片变已拒绝、请求结束、不挂死；确认卡挂着时**直接关窗口** → 重开后那张卡是「已中断」；`convert_video` 跑到一半点「停止」→ **任务管理器里没有残留的 ffmpeg.exe**；多步：「看看这个视频多大、然后转成 720p」→ 一条消息里两张卡按顺序出现；不吃 `tools` 的兼容端点 → 气泡上是一句中文「该模型不支持工具调用，已忽略」而不是原始 JSON。
