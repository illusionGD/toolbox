/**
 * 对话记录：`<dataDir>/ai/conversations.json`。
 *
 * **不塞 `app-state.json`**：那个文件在渲染进程挂载前同步读进内存，聊天记录只会越来越
 * 大，塞进去等于让冷启动随着历史一起变慢。这里改成弹窗首次打开时才懒加载。
 *
 * 保存是**整体覆盖写**（渲染进程持有全量并防抖调用），一次写完就顺手把没人引用的
 * 图片清掉。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AiConversation } from '../../shared/types';
import { dataPath } from '../storage/paths';
import { pruneImages } from './images';

/**
 * 记录文件路径。
 * @returns 绝对路径。
 */
function conversationsFile(): string {
  return dataPath('ai', 'conversations.json');
}

/**
 * 读全部会话。文件缺失或损坏都当作「没有历史」，不抛错：
 * 聊天记录不是关键数据，为它拦住弹窗打开不值得。
 * @returns 会话数组，按更新时间倒序。
 */
export async function loadConversations(): Promise<AiConversation[]> {
  try {
    const raw = await readFile(conversationsFile(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as AiConversation[])
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  } catch {
    return [];
  }
}

/**
 * 覆盖写全部会话，并清理孤儿图片。
 * @param conversations 全量会话。
 * @returns 清掉的图片文件数。
 */
export async function saveConversations(conversations: AiConversation[]): Promise<number> {
  const file = conversationsFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(conversations), 'utf-8');
  // 临时文件 + rename：写一半断电也不会把历史整体弄成半个 JSON
  await rename(tmp, file);

  const keep = new Set<string>();
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      for (const image of message.images ?? []) keep.add(image.id);
    }
  }
  return pruneImages(keep);
}
