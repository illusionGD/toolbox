/**
 * AI 对话的 IPC 层。
 *
 * 网络调用一律在主进程：① 明文 API Key 绝不进渲染进程；② Anthropic 在浏览器环境还要
 * 额外的 `anthropic-dangerous-direct-browser-access` 头、各家 CORS 也不一致；
 * ③ 工具调用本来就只能在主进程跑（`ai/tools/` 里直接调 `ipc/*.ts` 的能力函数）。
 */
import type { WebContents } from 'electron';
import { AI_CHANNELS } from '../../shared/channels';
import type {
  AiChatRequest,
  AiChatResult,
  AiConfig,
  AiConversation,
  AiImageRef,
  AiKeyStatus,
  AiStreamEvent,
  AiTestResult,
} from '../../shared/types';
import { cancelChat, runChat, testConnection } from '../ai/chat';
import { replyConfirm } from '../ai/tools';
import { copyKey, deleteKey, getKey, listKeyStatus, setKey } from '../ai/keys';
import { loadConversations, saveConversations } from '../ai/conversations';
import { stageImage } from '../ai/images';
import {
  focusHostSettings,
  minimizePanelWindow,
  openPanelWindow,
  setPanelTop,
} from '../ai/panelWindow';
import { handle } from './helper';

/**
 * 取该配置的 key，没配就抛一句能直接看的中文。
 * @param config AI 配置。
 * @returns 明文 key。
 */
function requireKey(config: AiConfig): string {
  const key = getKey(config.id);
  if (!key) throw new Error(`配置「${config.name}」还没有填 API Key`);
  return key;
}

/**
 * 造一个只往「发起这次对话的那个渲染进程」推分片的 sender。
 *
 * **不能推给某个固定窗口**：对话现在跑在独立的 AI 窗口里，若沿用注册时闭包住的主窗口，
 * 分片会全部推给一个没在听的页面，AI 窗口一个字都收不到。
 * @param sender 发起 `ai:chat` 的 webContents。
 * @returns 推送函数。
 */
function streamTo(sender: WebContents): (event: AiStreamEvent) => void {
  return (event: AiStreamEvent): void => {
    // 窗口可能在流跑一半时被关掉；这里不判会抛 "Object has been destroyed"
    if (sender.isDestroyed()) return;
    sender.send(AI_CHANNELS.chatStream, event);
  };
}

/** 注册 AI 相关 IPC。 */
export function registerAiIpc(): void {
  handle<boolean>(AI_CHANNELS.openWindow, async () => {
    await openPanelWindow();
    return true;
  });

  handle<boolean>(AI_CHANNELS.setWindowTop, (_e, top: boolean) => setPanelTop(top));

  // 最小化必须过 IPC：DOM 的 window 没有 minimize，而 window.api.window.* 控的是主窗口
  handle<boolean>(AI_CHANNELS.minimizeWindow, () => minimizePanelWindow());

  handle<boolean>(AI_CHANNELS.openSettings, () => focusHostSettings());

  handle<AiKeyStatus[]>(AI_CHANNELS.listKeyStatus, (_e, configIds: string[]) =>
    listKeyStatus(configIds),
  );

  handle<AiKeyStatus>(AI_CHANNELS.setKey, (_e, configId: string, key: string) =>
    setKey(configId, key),
  );

  handle<AiKeyStatus>(AI_CHANNELS.deleteKey, (_e, configId: string) => deleteKey(configId));

  // 明文只在主进程内从源流到目标；渲染进程只拿到目标的状态。getKey 依旧不接任何通道。
  handle<AiKeyStatus>(AI_CHANNELS.copyKey, (_e, fromId: string, toId: string) =>
    copyKey(fromId, toId),
  );

  handle<AiTestResult>(AI_CHANNELS.testConnection, (_e, config: AiConfig, key?: string) =>
    // 允许带上「还没保存的 key」直接测：先填 key 再点测试是常见顺序，
    // 逼用户先保存才能测会让第一次配置变成两步
    testConnection(config, key?.trim() ? key.trim() : requireKey(config)),
  );

  handle<AiChatResult>(AI_CHANNELS.chat, (e, request: AiChatRequest) => {
    // 关掉 AI 窗口就等于渲染进程没了：不在这儿取消，主进程会替一个没人接收的流白烧
    // token。这一条**同时也是工具确认的兜底**——`cancelChat` 会把等着回答的确认全判掉，
    // 否则窗口一关，`execute` 里那个 await 就再没有人能兑现了
    e.sender.once('destroyed', () => {
      cancelChat(request.requestId);
    });
    return runChat(request, requireKey(request.config), streamTo(e.sender));
  });

  handle<boolean>(AI_CHANNELS.cancel, (_e, requestId: string) => cancelChat(requestId));

  // 未知 / 已回答过的 callId 回 false 而不是抛：界面上那张卡片可能是从磁盘读回来的历史
  // 记录，点了没人接是正常的
  handle<boolean>(AI_CHANNELS.toolReply, (_e, callId: string, approved: boolean) =>
    replyConfirm(callId, approved),
  );

  handle<AiImageRef>(AI_CHANNELS.stageImage, (_e, source: string) => stageImage(source));

  handle<AiConversation[]>(AI_CHANNELS.loadConversations, () => loadConversations());

  handle<number>(AI_CHANNELS.saveConversations, (_e, conversations: AiConversation[]) =>
    saveConversations(conversations),
  );
}
