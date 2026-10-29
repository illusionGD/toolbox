import type { AiMessage, AiMessagePart, AiToolCall } from './types';

/** 主进程和渲染进程共用同一套分片累积规则。 */
type MessageContent = Pick<AiMessage, 'text' | 'reasoning' | 'parts' | 'toolCalls'>;

/** 旧消息没有顺序信息，保留原来的思考 → 正文 → 工具布局。 */
export function getAiMessageParts(message: MessageContent): AiMessagePart[] {
  if (message.parts) return message.parts;
  const parts: AiMessagePart[] = [];
  if (message.reasoning) parts.push({ type: 'reasoning', text: message.reasoning });
  if (message.text) parts.push({ type: 'text', text: message.text });
  if (message.toolCalls?.length) {
    parts.push({ type: 'tools', callIds: message.toolCalls.map((call) => call.callId) });
  }
  return parts;
}

/** 相邻的同类文本合并；跨过工具组后另起一段。 */
export function appendAiMessageDelta(
  message: MessageContent,
  type: 'text' | 'reasoning',
  delta: string,
): void {
  if (!delta) return;
  const parts = (message.parts ??= getAiMessageParts(message));
  const last = parts.at(-1);
  if (last?.type === type) last.text += delta;
  else parts.push({ type, text: delta });
  message[type] = (message[type] ?? '') + delta;
}

/** 首次调用才插入位置；状态更新原地覆盖，不能把旧卡片移到消息末尾。 */
export function upsertAiToolCall(message: MessageContent, call: AiToolCall): void {
  const parts = (message.parts ??= getAiMessageParts(message));
  const calls = (message.toolCalls ??= []);
  const index = calls.findIndex((item) => item.callId === call.callId);
  if (index >= 0) {
    calls.splice(index, 1, call);
    return;
  }
  calls.push(call);
  const last = parts.at(-1);
  if (last?.type === 'tools') last.callIds.push(call.callId);
  else parts.push({ type: 'tools', callIds: [call.callId] });
}
