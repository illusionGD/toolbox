# Toolbox

实现新的内置工具或新增可执行操作时，同步接入 AI 助手。让页面和 `electron/main/ai/tools/` 下的工具定义调用同一个主进程实现。为模型提供参数校验、调用说明和有界结果，通过 `buildTools` 沿用现有的工具开关及写入确认流程。

在 `electron/shared/toolPages.ts` 的 `TOOL_PAGE_AI_ACTIONS` 中登记页面对应的操作名。新增工具和操作时运行 `npm run typecheck` 与 `npm run verify:ai`。历史页面补齐 AI 操作后，从 `LegacyToolPageKey` 移入 `TOOL_PAGE_AI_ACTIONS`。
