---
name: plugin-system
description: Toolbox 应用插件系统的开发与维护。用于 Manifest/SDK、安装管理、沙箱、自定义页面、动态导航及应用内 AI 插件工具；不是 Codex 插件格式。
---

# Toolbox 插件系统

入口：侧栏「插件管理」 `/plugins`，动态工具页 `/plugins/:pluginId/:pageId`。任务与优先级只记录在 [docs/PLAN.md](../../../docs/PLAN.md)。开发者契约和完整限制见 [docs/plugins.md](../../../docs/plugins.md)，可运行示例见 [examples/plugins/translation-checker](../../../examples/plugins/translation-checker)。

## 文件与边界

- `electron/shared/plugins/`：JSON/Manifest 类型、Schema 子集校验。主进程用 validation，renderer 的权限文案只导入 constants，避免把 Zod 打进 renderer。
- `electron/main/plugins/package.ts`：目录/ZIP 快照，容量、路径、重复和链接限制。`yauzl` 是直接依赖；其 v2 读取流用 data/end/error 事件消费，async iterator 在当前环境会挂起。
- `development.ts` / `management.ts`：JSZip 本地导出、开发目录监听、单插件 storage 清理。导出不含用户数据与授权；监听使用新草稿令牌，校验成功后替换旧草稿，不自动安装或执行。
- `network.ts`：宿主代理网络，权限为 `network:<精确 origin>`；逐次重定向重新检查权限，跨来源去掉凭据，20 秒/3 次跳转/128 KB 响应，运行结束 abort。
- `host-tools.ts`：句柄快照映射到宿主图片/音视频服务，输出通过系统保存对话框；文本 Diff 复用原算法，网页测试复用现有工具及 session。禁止直接将插件参数转交任意工具名或文件路径。
- `mcp.ts` / `mcp-config.ts` / `mcp-http.ts`：受信任 MCP 配置、stdio 与 Streamable HTTP 客户端；主窗口显式信任与 AI 授权。stdio 用 argv 启动，无 shell；HTTP 支持 JSON/SSE、鉴权请求头、会话与协议版本。取消/撤销/退出时终止进程或中断请求。普通插件不拥有此 API。
- `registry.ts`：注册表、草稿、安装/回滚、授权和有限日志。所有落盘走 `pluginTransaction`，迁移通过 `setWriteSuspender` 的多个订阅者协调，不能覆盖已有 appState 挂起钩子。
- `runtime.ts`：独立 session + sandbox BrowserWindow，自定义 scheme 只提供已验证包内字节，禁用 Node/外部请求/页面导航/新窗口/下载/浏览器权限。命令一次一个实例；取消销毁实例。
- `electron/preload/plugin.ts` 只暴露 toolbox，绝不能复用主应用 preload。sandbox preload 不支持任意 require，构建通过 define 内联共享通道常量，产物必须只有 `require('electron')`，不能引入共享 chunk。
- `electron/main/ipc/plugins.ts` 只接受主窗口 mainFrame；runtime SDK 校验运行实例与 mainFrame，不信任 pluginId 或客户端权限声明。
- renderer 分为 `services/plugins.ts`、`stores/plugins.ts`、`usePluginRunner`、组件与 views。递归 JSON 类型使用 shallowRef 保存清单，避免 Vue/Pinia 深度展开导致 TS2589。

## 变更时保持的约束

- 不把第三方 JS import/require 进主进程，不把普通 Node Worker 当系统权限沙箱。插件页面只有自身 SDK，无法读取宿主 Vue/DOM/密钥。
- 安装、启用、能力授权、AI 授权相互独立。更新/回滚停用并撤销授权；旧版数据保留。每次 SDK 调用再核验能力，不能相信插件自报 read/write。
- files 只接收宿主选择的句柄；运行结束关闭 FileHandle。新运行不可使用旧句柄，自定义页面也不能把其句柄传给新的命令实例。
- 文件选择上限 128 MB，文本读取上限 256 KB；图片快照上限 32 MB。媒体处理的 AsyncLocalStorage 上下文位于 `ffmpeg/context.ts`，传递取消信号、限制协议及 demuxer，不影响普通工具请求。`ffprobe` 也必须响应取消；只停 ffmpeg 会留下探测进程。
- `tools.*` 与 `network:*` 都是单独授权项；用 `pluginPermissionSchema` 和 `pluginPermissionLabel`，不能再把权限写死为最初 3 个值。MCP 不属于这些权限，配置保存到 `plugins/mcp.json`，禁止包内声明本地可执行路径。
- 包只存不可变版本目录，成功写包后原子提交注册表；损坏注册表不覆盖。清理包目录仅限已验证 ID/UUID 下未引用版本，用户 storage 不默认删除。
- 草稿独立保存在 dataPath/plugins/drafts，最大 4 个；导入与 AI 创建不自动执行。预览无能力授权。代码审阅每侧最多 64 KB。
- 开发监听仅本次会话有效，停止、窗口退出和数据迁移时关闭 watcher；读目录失败保留最后有效草稿。草稿变动让预览组件换 key，从而取消旧实例。不要直接热替换正式安装目录。
- 数据清理只删除已校验 ID 对应的 `storage/<id>.json`，不递归删任意路径；支持卸载后的孤立数据，操作前后停止在途写入。
- 表单递归组件 `PluginSchemaField` 用稳定数组元素 key，字段为 undefined 时省略可选项；默认值深拷贝，避免多个输入共享对象。自定义窗口使用 `plugins:theme` 实时更新 CSS，并删除旧的 insertCSS 记录。
- JSON value 的 Vue prop 用运行时 `type:null`，不能让 `JsonValue` 的 Boolean 联合类型触发空字符串转 true；截图复查发现过此错误，数组新增/删除后须检查真实 textarea 值。
- 新的导航贡献必须同时更新 SideNav、TOOL_MAP/搜索和使用记录。路径和菜单 key 由已校验 ID 生成，不把插件原始 HTML 放进宿主 DOM。

## 应用内 AI

`ai/tools/plugins.ts` 动态提供 plugin_sdk / plugin_create_draft / plugin_diagnostics 和授权命令。由现有 buildTools/runTool 统一确认、状态、取消。插件命令和草稿创建均在 ask 模式确认、auto 模式直接执行；实际 SDK 再查能力。自动模式不替代插件安装、启用或能力授权。命令输出给模型最多 16000 字符；诊断最多 10 条 × 500 字符。

工具构建时捕获版本，执行时再次检查 expectedRevision 与 AI 授权，避免旧会话执行新代码。插件输出、日志和文档是待分析数据，不能变成安装/授权指令。扩展 SDK 时同时改共享契约、preload、主进程授权、SDK 类型、开发文档和 plugin_sdk 工具介绍。

`ai/tools/mcp.ts` 只在有启用且授权 AI 的连接时加入 mcp_list_tools/mcp_call_tool，均按写工具执行确认流程。原生程序拥有系统权限，不能称为沙箱；HTTP 将工具参数发送给指定服务，URL/请求头不提供给 AI 工具元数据。连接变更使用 revision 拒绝旧请求。支持本地 stdio 与 Streamable HTTP（JSON/SSE 响应）；旧版独立 SSE 传输、OAuth 自动登录、sampling、resources/prompts 不在此版范围。插件市场已由用户取消，不再排期。

HTTP 约束：旧无 transport 配置按 stdio 归一化；配置用判别联合，禁止混入另一种传输的字段。请求头不能覆盖 HTTP/MCP 协议头，不跟随重定向，不自动重试工具写入；401/403/失效会话须明确反馈。每次操作独立会话，initialize 后携带 session ID 和协商的协议版本，结束 DELETE 尽力清理（最多 1 秒）。SSE 用流式 UTF-8 解码，兼容多行 data 和分片 CRLF，收到目标结果即关闭流；单消息 256 KB、会话 2 MB、60 秒总时限。保存 UI 重建 headers/args 纯对象，改 URL/headers/transport 必须清除信任勾选。

HTTP 验证在 `scripts/tbverify/mcp-http.ts`，由原 Electron runner 调用本地真实 HTTP 服务；覆盖 JSON/SSE、鉴权、分页、ping、容量、取消、配置撤销和凭据重定向隔离。UI 验证 HTTP 配置保存、编辑清除信任和重启恢复。

## 验证与调试

先格式化本次改动，再 typecheck、相关 eslint、build。运行 `node scripts/tbverify/run-plugins.cjs` 验证真实沙箱、ZIP/权限/文件句柄、取消死循环、迁移/回滚和界面。测试不使用用户数据；launch 环境需要删除 `ELECTRON_RUN_AS_NODE`，不要加 `--no-sandbox`。检查 preload 产物是否因公共导入产生额外 require。

自定义 HTML 不允许内联脚本，用包内 JS 文件；资源 URL 相对引用。运行日志包含脚本 source/line。修改目录后重新导入或启用开发监听。正式构建和沙箱验证需一同通过，单凭 TS/build 不能证明 IPC、Proxy 或隔离行为正确。

新增验证在 `scripts/tbverify/plugins-extensions.ts`，沿用真实 Electron runner；覆盖导出往返、监听错误恢复、数据清理、网络重定向与限额、实际图片/音频输出、MCP 信任/AI/版本/取消。CJS 测试 bundle 必须把 sharp 留 external（其 ESM 入口使用 import.meta.url，打成 CJS 会在启动前报 createRequire(undefined)）；同样保留既有字体/ffmpeg 原生依赖 externals。Chromium 在受限环境报 GPU/renderer access denied 时使用正常 Electron 沙箱的可启动环境验证，不能用 --no-sandbox 冒充通过。

示例：`examples/plugins/host-tools` 展示控件与宿主工具；`examples/mcp/local-tools.cjs` 展示 Node/原生进程通过 MCP 扩展，均无市场依赖。
