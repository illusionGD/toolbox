# Toolbox 插件开发

插件管理入口在侧栏「插件管理」。首版支持本地 `.tbplugin` ZIP、开发目录快照、声明式表单和静态 HTML 界面；使用 JavaScript 编写命令，TypeScript 可引用 `packages/plugin-sdk/index.d.ts`。

## 快速体验

1. 选择「导入开发目录」，选择 `examples/plugins/translation-checker`（包含 `manifest.json` 的目录）。
2. 审阅版本、权限、变更文件及前后源码，点击「隔离预览」。示例默认返回缺失键 `bye`。
3. 点击「安装此版本」，然后在卡片的「授权 / 启用」中勾选启用。
4. 「文件工具」下出现「翻译检查」和「翻译检查 · 自定义页」。前者由宿主生成表单；后者打开独立沙箱窗口，离开对应页面时关闭。
5. 需要 AI 使用时，单独勾选「允许 AI 调用」。AI 选择「工具：询问」时逐次确认，「工具：自动」时直接执行已授权的插件命令。

开发目录导入的是快照；也可以用「监听开发目录」在保存修改后自动刷新草稿。安装与回滚都会停用插件并清除能力、AI 授权；审阅后重新启用。源码不在宿主中执行，安装不运行 npm、构建脚本或生命周期脚本。

## 插件格式

参考完整示例的 `manifest.json`。必填字段：`id`、`name`、`version`、`apiVersion`、`entry`、`permissions`、`contributes`；`description` 可省略。`id` 为 `author.plugin-name`，只允许小写字母、数字、连字符；版本为三段数字，接口版本为 `1`。

```js
window.toolbox.definePlugin({
  run: async (input) => {
    return { message: input.text };
  },
});
```

`definePlugin` 只调用一次，键必须与命令 `id` 一致。入口是预构建 `.js`，支持相对导入包内 JS。不能使用 Node、Electron、裸 npm import、CDN、`eval`、Worker 或直接网络请求；联网通过授权后的 `toolbox.network.fetch`。插件包不带 `node_modules`；Vue/React 自定义页面需在外部构建为静态资源，使用相对资源地址和无需动态编译模板的构建版本。

每条命令声明 `id`、`title`、`description`、`inputSchema`、`outputSchema`；`ai:true` 表示可向 AI 开放，用户仍须授权。命令输入必须为 object。

Schema 是明确受限的 JSON Schema 子集：

- 类型：object、array、string、number、integer、boolean、null。
- 通用字段：title、description、enum、default。
- object 必须声明 `properties` 和 `additionalProperties:false`，可声明 `required`。
- array 必须声明 `items`。
- 最多嵌套 8 层；其他关键词（包括 `$ref`、pattern、anyOf）拒绝导入。
- 表单自动提供文本框、数字框、布尔开关、枚举下拉，以及嵌套对象和数组的增删编辑。可选字段可取消填写。default 仅初始化表单，AI 和 SDK 调用不会自动补齐缺失的必填参数。
- 宿主在执行前后校验输入和输出。未知字段、非法类型不会悄悄传给插件。

页面声明 `id`、`title`、`category`，并选择 `command` 或 `entry` 之一。category 支持 file/dev/image/font/media/network/more。`command` 生成表单；`entry` 指向包内 HTML。自定义页面用 `window.toolbox.commands.run(command, input)` 调用命令，不能读取宿主 DOM、Vue 状态或主应用 `window.api`。

## SDK 与权限

| SDK                                                            | Manifest 权限            | 语义                                            |
| -------------------------------------------------------------- | ------------------------ | ----------------------------------------------- |
| `files.select()`                                               | `files.readSelected`     | 系统对话框选择文件，返回 `{handle,name,size}[]` |
| `files.readText(handle)`                                       | `files.readSelected`     | 读取该运行实例选择的文件；不接受路径            |
| `files.saveText(name, content)`                                | `files.save`             | 打开系统保存对话框；返回是否保存                |
| `storage.get(key)` / `storage.set(key, value)`                 | `storage`                | 插件专属 JSON 数据，缺失键返回 null             |
| `commands.run(command, input)`                                 | 无                       | 自定义页面调用自己的命令，命令中不可递归调用    |
| `log(message)`                                                 | 无                       | 最近诊断，单条最多 2000 字符                    |
| `network.fetch(options)`                                       | `network:<origin>`       | 宿主代理 HTTP(S) 文本请求，每个来源独立授权     |
| `image.probe(handle)` / `image.compress(handle, options)`      | `tools.image` + 文件权限 | 图片探测、压缩/转换；结果经保存对话框导出       |
| `media.probeVideo/probeAudio/convertVideo/convertAudio`        | `tools.media` + 文件权限 | 音视频探测/转码，复用工具箱现有处理逻辑         |
| `diff.compare(left, right)`                                    | `tools.diff`             | 比较两段文本，返回有界行差异                    |
| `webtest.status/readSteps/inspect/patchSteps/replay/wait/stop` | `tools.webtest`          | 与网页测试页面共用会话、步骤版本和取消逻辑      |

`toolbox` 是 `window.toolbox`。文件选择授权只在当前运行中有效；不要持久化 handle。命令每次创建新实例；模块全局变量不会跨运行保留。自定义页面与命令实例的句柄也不共享，需要读取文件时在命令内选择。

用户只授权部分声明能力时，其他能力会在调用时拒绝。隔离预览不授予任何宿主能力（包括网络和已有工具）。取消、停用、更新、卸载、数据目录迁移时销毁实例；取消不能撤销已经成功保存的数据。

限制：选择的单文件最多 128 MB、读取文本最多 256 KB、图片处理输入最多 32 MB；命令输入/输出及单次 SDK 消息各 256 KB；JSON 深度 20 层；一次运行最多 20 个文件、1000 次 SDK 调用、16 个并发 SDK 请求；命令超时 60 秒（包含文件对话框等待与转码）；最多 8 个运行实例；每插件 storage 总计 1 MB。SDK 返回标准 Promise，失败抛出可显示的错误。

### 网络请求

Manifest 在 permissions 中加入 `network:https://api.example.com`。来源包含协议、主机和非默认端口，不含路径、尾斜杠、通配符或内嵌凭据；如内网接口需要 HTTP，显式声明 `network:http://localhost:8080`。授权面板逐项显示来源。

```js
const response = await toolbox.network.fetch({
  url: 'https://api.example.com/check',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
});
if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
return response.body;
```

请求最多 20 秒、3 次重定向、64 KB 请求体、128 KB 响应文本。不共享宿主 cookie 或凭据；跨来源重定向去掉 Authorization 与自定义头。仅接受 accept/content-type/authorization/x-* 请求头；返回 content-type 和原始文本，不自动解析 JSON。非 2xx 状态由插件按业务处理。

### 宿主处理

图片/媒体输入只能使用本次 `files.select()` 的句柄，不接收 outputDir、overwrite 或任意源路径。宿主将句柄内容复制到 `cachePath/plugins/processing` 的独立目录，复用图片/ffmpeg 实现；结果通过系统保存对话框导出，返回 `{saved,name,bytes}`。输入快照和中间文件在处理结束后清理，取消会中断 ffprobe/ffmpeg。媒体只支持自包含容器，解码器拒绝 HLS/concat 和外部协议。

`diff.compare` 两侧各最多 64000 字符，使用文件 Diff 的相同算法并保留截断标记。`webtest` 的参数与网页测试 AI 工具一致（例如 `readSteps` 对应 `webtest_read_steps`）；不提供任意 JS 或路径导入/导出。插件 `replay` 等待回放完成并返回最终状态，仍受整个命令 60 秒上限约束。示例见 `examples/plugins/host-tools`。

## 打包与发布

管理页中，已安装插件点「导出插件」、草稿点「导出草稿 .tbplugin」，选择保存位置即可。导出仅包含插件文件，不包含授权、日志、用户 storage 或 MCP 配置；生成的包可直接重新导入。底层使用 JSZip。

手动打包时 ZIP 根目录直接放 manifest.json 与资源，不要多包一层父目录。压缩后将扩展名改为 `.tbplugin`。ZIP 内文件必须为可移植相对路径（字母、数字、连字符、下划线、点），不接受隐藏路径、路径穿越、设备名、链接或加密包。插件市场相关功能已按用户要求取消。

最多 500 个条目，单文件 4 MB，总解压内容和压缩包各 20 MB。允许 js/json/html/css/svg/png/jpg/jpeg/webp/woff2/txt/md/map。路径区分大小写，但拒绝仅大小写不同的重复路径。纯 TS 源码需先编译成 JS。

## 存储与更新

所有数据通过 Toolbox 的 `dataPath` 保存，支持设置页迁移：

```text
<dataDir>/plugins/
  registry.json                    原子提交的安装/权限记录
  packages/<id>/<revision>/         已安装版本和上一版本
  drafts/<token>/                  可审阅的独立草稿
  storage/<id>.json                插件持久数据
```

草稿最多 4 个，重启恢复；可在审阅弹窗丢弃或导出。安装成功删除对应草稿，旧版本保留一版以便回滚。卸载移除注册表与包文件，保留插件 storage；「管理插件数据」同时列出已安装和已卸载插件的数据，单独确认后可清理。清理会终止该插件任务，不删除安装文件。回滚不回滚插件用户数据，插件作者需要兼容旧数据格式。

运行时资源使用内存快照与非持久会话；媒体处理中间结果使用可清理缓存。日志按插件保留本次会话最近 100 条；查看前点「运行日志」刷新。注册表损坏时保留原文件并显示错误，不能通过空列表覆盖损坏数据。

### 开发监听

「监听开发目录」选择可直接运行的构建产物目录，每次变化防抖 350ms 后重新校验并生成新草稿令牌。校验失败显示错误、保留上一份可用草稿；草稿弹窗随刷新切换到新版本，运行中的旧预览随组件销毁取消。不会自动安装、授权或执行代码。最多同时监听 4 个目录，停止监听保留最后草稿；退出应用或迁移数据目录时停止监听。重启后恢复草稿，监听需重新开启。

### MCP 与扩展服务

在「MCP / 扩展服务」中点「添加 MCP 服务」，选择连接方式，确认信任后启用：

- **本地程序（stdio）**：填写可执行程序的绝对路径、参数数组和可选工作目录。可用 Node/Python 或原生程序提供 MCP 工具；这是使用当前用户系统权限的独立进程，**不属于普通 `.tbplugin` 沙箱**。Windows 脚本需选择解释器 exe，并将脚本路径放入参数。不运行 shell 拼接命令，不加载包内 `.node`。旧版没有 `transport` 的配置自动按 stdio 读取。
- **HTTP（Streamable HTTP）**：填写服务提供的 HTTP(S) MCP 端点（例如 `https://example.com/mcp`），可配置 JSON 请求头，例如 `{"Authorization":"Bearer your-token"}` 或 `{"X-API-Key":"your-key"}`。支持 JSON 和 SSE 响应、工具分页、会话 ID 与协议版本协商。工具参数发送给指定服务；请求头保存在本机连接配置中，不提供给 AI 工具元数据。不自动跟随重定向，请直接填写最终端点。协议头由客户端管理，请求头不能覆盖 Host、Content-Type、MCP-Session-Id 等。

支持 initialize、tools/list（分页）、tools/call 和 ping，协议版本 2025-03-26、2025-06-18、2025-11-25，stdio 额外兼容 2024-11-05。每次操作初始化独立进程或 HTTP 会话；结束或取消时终止进程、关闭响应流，HTTP 有会话 ID 时尝试 DELETE 清理。不自动重试工具调用，避免重复写入。HTTP 401/403 提示检查鉴权，失效会话提示重新发起。暂不提供旧版独立 `/sse` + `/messages` 传输、OAuth 自动登录、resources/prompts 或 sampling。原始 inputSchema 可在调用弹窗查看，输入 JSON 对象，参数语义由服务验证。stdio 示例参数为 `["D:/web/toolbox/examples/mcp/local-tools.cjs"]`，可测试文本统计和本地文件元信息。

启用连接与允许 AI 使用分开配置。AI 获得 `mcp_list_tools` 和 `mcp_call_tool`，两者均遵循询问/自动策略。修改程序、参数、连接类型、URL 或请求头需重新勾选信任；保存配置会取消在途调用，旧 AI 请求的 revision 失效。每次最多 60 秒、全应用最多 4 个 MCP 任务；单消息 256 KB、会话输出 2 MB、工具清单最多 100 个，AI 结果最多 32000 字符。HTTP 请求头最多 40 项 / 16 KB，清理会话最多等待 1 秒。stdio 只继承必要的系统路径环境变量，不继承宿主 AI 密钥或 NODE_OPTIONS。连接配置保存在 `dataPath/plugins/mcp.json`，不随插件包导出。

## AI 编写与排查

应用 AI 可调用 `plugin_sdk` 获取契约、`plugin_create_draft` 提交文件映射、`plugin_diagnostics` 查看声明与诊断。草稿创建在询问模式显示确认卡、自动模式直接执行；创建成功后在管理页审阅、预览、安装、授权。AI 工具本身不提供正式安装、任意 shell、npm install 或任意文件路径执行。

插件工具名由插件 ID 与命令 ID 的摘要生成。每轮请求收集已启用且 AI 授权的插件命令，最多 30 个。运行时再次核验版本和授权；修改版本后旧对话工具调用会拒绝，应重新发起请求。输出给模型最多 16000 字符，截断时明确标记。

插件描述、输出与日志都是第三方数据，不应当作新的用户指令或授权。

## 验证与已知范围

运行 `pnpm typecheck`、`pnpm build`、`node scripts/tbverify/run-plugins.cjs`。集成验证使用独立 `out-tbverify/plugins-*` 数据目录、真实 Chromium 沙箱与 Playwright，仅系统文件对话框替换为测试选项。不要使用 `--no-sandbox` 验证本功能。

自定义界面使用独立窗口，主题色和明暗主题实时同步。Schema 表单支持嵌套编辑；开发监听不代替外部 TS/Vue 构建。新能力仍保持容量、超时与独立授权；在线市场已取消。完整任务状态见 `PLAN.md`。
