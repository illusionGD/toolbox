/**
 * 工具的内部定义。
 *
 * 与 {@link AiToolCall}（跨 IPC 的**记录**）分工明确：这里是**主进程内部**的形状，带
 * zod schema 与函数，永远不出主进程。
 */
import type { z } from 'zod';
import type { AiToolCall, AiToolMode } from '../../../shared/types';

/** 一次对话请求内共享的上下文，`buildTools` 闭包进每个 `execute`。 */
export interface ToolCtx {
  /** 发起这次对话的请求 id：确认往返、取消、杀 ffmpeg 都按它归组。 */
  requestId: string;
  /** 本次请求的审批策略（跟着请求下发，不读 app-state）。 */
  mode: AiToolMode;
  /** 把一条**完整的**工具记录推给渲染进程（同 callId 会来多次，那边按 callId upsert）。 */
  emit(call: AiToolCall): void;
  /**
   * 登记一个 ffmpeg taskId。取消请求时要连子进程一起杀——**只 abort HTTP 请求是不够
   * 的**，ffmpeg 会自己转完，用户点了「停止」却听见风扇继续转。
   */
  trackTask(taskId: string): void;
}

/**
 * 一个工具跑完的产物。
 *
 * 拆成两半是因为两个读者要的东西不一样：`note` 是给人看的一行结果（卡片上那行、也会
 * 落进会话文件），`data` 是给模型看的结构。**只有 `data` 会回给模型**，界面文案不该
 * 混进上下文让模型跟着复读。
 */
export interface ToolOutput {
  /** 一行中文结果摘要。 */
  note: string;
  /** 回给模型的结构。**必须精简且封顶**，见 registry.ts 顶部的两条硬规则。 */
  data: unknown;
}

/** 一个工具的定义。 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  /** 工具名，下发给模型（snake_case，与各家示例习惯一致）。 */
  name: string;
  /** 只读还是会写盘。`write` 在 `ask` 模式下逐次确认。 */
  kind: 'read' | 'write';
  /** 给模型看的说明。 */
  description: string;
  /** 入参 schema，由 SDK 转成各家的 JSON Schema。 */
  inputSchema: S;
  /** 一行中文参数摘要，确认卡与落盘记录共用。 */
  summarize(input: z.infer<S>): string;
  /**
   * 即使在 `auto` 模式也必须确认。
   *
   * 现在只有一个用途：`overwrite === true`。覆盖原文件是**不可逆的数据丢失**，而模型
   * 是可能被文件内容里的话带偏的，所以这条不给「自动」放行。
   */
  forceConfirm?(input: z.infer<S>): boolean;
  /** 真正干活。抛错由包装层接住并变成 `{error}` 回给模型。 */
  run(input: z.infer<S>, ctx: ToolCtx): Promise<ToolOutput>;
}

/** 注册表是异构数组，只能擦掉各自的 schema 类型。 */
export type AnyToolDef = ToolDef<z.ZodType>;

/**
 * 定义一个工具。
 *
 * 存在的唯一理由是**把类型擦除这件事收在一个地方**：注册表里十几个工具的 schema 各不
 * 相同，直接放进 `AnyToolDef[]` 会让每个 `summarize` / `run` 的入参都得写成 unknown。
 * @param def 工具定义（此处泛型仍然精确，写的时候有补全与检查）。
 * @returns 擦除 schema 类型后的定义。
 */
export function defineTool<S extends z.ZodType>(def: ToolDef<S>): AnyToolDef {
  return def as unknown as AnyToolDef;
}
