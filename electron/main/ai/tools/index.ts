/**
 * 把工具清单包成 SDK 认的 `ToolSet`。
 *
 * 三件事只在这里做一遍，不在各个工具里重复：确认（pending → 允许 / 拒绝）、状态事件
 * （pending / running / done / denied / error）、以及**把失败变成返回值而不是抛出**。
 */
import { randomUUID } from 'node:crypto';
import { tool, type ToolSet } from 'ai';
import { requestConfirm } from './confirm';
import { TOOLS } from './registry';
import type { AnyToolDef, ToolCtx } from './types';

/** 拒绝时回给模型的话（顺带告诉它别原地重试）。 */
const DENIED_MESSAGE = '用户拒绝了这次调用。不要重试，改问用户希望怎么做。';

/**
 * 跑一个工具的完整流程。
 *
 * **拒绝与失败都 `return`，不 `throw`。** 实测过抛出会怎样：SDK 并不会让整个请求失败，
 * 它发一个 `tool-error` 分片后继续循环，把错误喂回模型——但那个 `error` 字段序列化出来
 * 是 `{}`，**模型看到的到底是什么不在我们手上**。所以理由不是「抛了会崩」，而是「抛了
 * 就控制不住给模型的措辞」：被拒绝时它该改口径问用户，出错时它该看到中文原因。
 * @param def 工具定义。
 * @param input 模型给的入参（已由 SDK 按 schema 校验过）。
 * @param ctx 本次请求的上下文。
 * @returns 回给模型的结构。
 */
async function runTool(def: AnyToolDef, input: unknown, ctx: ToolCtx): Promise<unknown> {
  const callId = randomUUID();
  const startedAt = Date.now();
  let summary = def.name;
  try {
    summary = def.summarize(input);
  } catch {
    // summarize 只是给人看的一行字，它自己坏了不该拖累整次调用
  }
  const base = { callId, name: def.name, kind: def.kind, summary, startedAt } as const;

  const needConfirm =
    def.kind === 'write' && (ctx.mode === 'ask' || def.forceConfirm?.(input) === true);
  if (needConfirm) {
    ctx.emit({ ...base, status: 'pending' });
    const approved = await requestConfirm(ctx.requestId, callId);
    if (!approved) {
      ctx.emit({
        ...base,
        status: 'denied',
        result: '已拒绝',
        elapsed: Date.now() - startedAt,
      });
      return { denied: true, message: DENIED_MESSAGE };
    }
  }

  ctx.emit({ ...base, status: 'running' });
  try {
    const output = await def.run(input, ctx);
    ctx.emit({
      ...base,
      status: 'done',
      result: output.note,
      elapsed: Date.now() - startedAt,
    });
    // 只回 data：note 是界面文案，混进上下文只会让模型跟着复读
    return output.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.emit({ ...base, status: 'error', result: message, elapsed: Date.now() - startedAt });
    return { error: message };
  }
}

/**
 * 造这次请求要用的工具集。
 * @param ctx 请求上下文。
 * @returns SDK 的 ToolSet；`mode === 'off'` 时返回 undefined（**压根不下发 `tools`**，
 * 省掉十几个工具声明的 token，也绕开部分兼容端点见到 `tools` 直接 400）。
 */
export function buildTools(ctx: ToolCtx): ToolSet | undefined {
  if (ctx.mode === 'off') return undefined;

  const set: ToolSet = {};
  for (const def of TOOLS) {
    set[def.name] = tool({
      description: def.description,
      inputSchema: def.inputSchema,
      execute: (input: unknown) => runTool(def, input, ctx),
    });
  }
  return set;
}

export { denyPending, replyConfirm, requestConfirm } from './confirm';
export { killTasks, trackTask } from './tasks';
export type { ToolCtx } from './types';
