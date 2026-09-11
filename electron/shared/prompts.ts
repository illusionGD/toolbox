/**
 * AI 内置提示词 —— **全仓库唯一出处**。
 *
 * 凡是「写死之后再发给模型」的话术一律放这里，不要散在 chat.ts / provider.ts /
 * registry.ts 里。以后加新的人设、新功能的提示词（title 生成、摘要、专用助手……），
 * 都是**加一个具名常量**，而不是在调用点内联一段字符串。
 *
 * 放 shared 而不是主进程私有的原因同 `shared/ai.ts`：**两端都可能是使用方**。目前主进程
 * 是唯一调用方，但配置弹窗将来要预览/编辑预设时渲染进程也要读到同一份。纯常量、不碰
 * Electron 也不碰 DOM，所以 esbuild 打包法的桩测能直接打进来。
 *
 * **边界**：每份配置里用户可编辑的 `systemPrompt` 是**运行时数据**（在 `app-state.json`），
 * 不在这里；这里存的是**内置、写死**的提示词。工具描述（registry.ts 的 `description`）
 * 跟着每个工具的 schema 走、是结构化元数据，也已经集中在那一处，不归这里。
 */

/**
 * 「测试连接」发生时发给模型的用户消息。
 *
 * 要一句话戳中两件事：让模型回一个**可判定的固定短语**（校验连通性 + 模型真的回了），
 * 又**不烧 token**（这一步本来就是最小请求）。@ai-sdk 会把它当普通用户消息下发，
 * 系统提示词是否跟着发取决于 `buildSystemPrompt`。
 */
export const TEST_CONNECTION_PROMPT = '你好，请只回复「连接正常」四个字。';

/**
 * 组装真正下发的 system 提示词。
 *
 * **留空就不下发**（返回 undefined）：实测部分兼容端点对空字符串的 `system` 直接报 400，
 * 所以「空 = 没有 system」而不是「空 = 空 system」。调用方据此决定要不要把 `system`
 * 字段放进请求体。当前**没有**内置默认人设兜底（用户 review 拍的：只集中、不改行为），
 * 以后要加默认人设，改这里这一个函数即可。
 *
 * @param custom 每份配置里的 systemPrompt（用户可编辑，可能为空/纯空白）。
 * @returns 去首尾空白后的非空 system；空或纯空白返回 undefined。
 */
export function buildSystemPrompt(custom: string): string | undefined {
  const trimmed = custom.trim();
  return trimmed ? trimmed : undefined;
}
