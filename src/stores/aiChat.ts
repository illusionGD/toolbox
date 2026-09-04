import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AiConversation,
  AiImageRef,
  AiMessage,
  AiSendMessage,
  AiToolCall,
} from '@shared/types';
import {
  cancelAiApi,
  chatAiApi,
  loadAiConversationsApi,
  onAiStream,
  replyAiToolApi,
  saveAiConversationsApi,
} from '@/services/ai';
import { showError } from '@/utils/feedback';
import { useAiConfigStore } from './aiConfig';

/** 会话落盘防抖毫秒数。 */
const SAVE_DEBOUNCE = 500;
/** 自动标题取首条用户消息的前多少字。 */
const TITLE_LENGTH = 20;

/** 一个进行中的请求指向哪条消息。 */
interface PendingRequest {
  /** 所属会话 id。 */
  conversationId: string;
  /** 要写入增量的助手消息 id。 */
  messageId: string;
}

/**
 * AI 对话 store：会话列表 + 流式状态。
 *
 * **只在 AI 对话窗口里用**（`?ai=1` 那个独立窗口），主窗口不挂它。所以这里没有「面板
 * 开关」这种状态——窗口存在与否由主进程的 `panelWindow` 管；窗口一关渲染进程就没了，
 * 进行中的请求由主进程在 sender 销毁时取消。
 *
 * 会话存 `<dataDir>/ai/conversations.json`，窗口打开时才懒加载——聊天记录会越来越大，
 * 塞进启动时同步读的 `app-state.json` 会让冷启动一起变慢。
 */
export const useAiChatStore = defineStore('aiChat', () => {
  // #region state
  /** 会话是否已从磁盘读过（只读一次）。 */
  const loaded = ref(false);
  /** 全部会话，按更新时间倒序。 */
  const conversations = ref<AiConversation[]>([]);
  /** 当前会话 id。 */
  const activeId = ref('');
  /** 输入区里待发送的图片。 */
  const draftImages = ref<AiImageRef[]>([]);
  /** 进行中的请求：requestId → 目标位置。 */
  const pending = ref<Record<string, PendingRequest>>({});
  // #endregion

  // #region getters
  /** 当前会话。 */
  const activeConversation = computed<AiConversation | undefined>(() =>
    conversations.value.find((c) => c.id === activeId.value),
  );

  /** 当前会话里进行中的请求 id；没有则为空串。 */
  const activeRequestId = computed(() => {
    const id = activeId.value;
    return Object.entries(pending.value).find(([, p]) => p.conversationId === id)?.[0] ?? '';
  });

  /** 当前会话是否正在生成。 */
  const activeBusy = computed(() => activeRequestId.value !== '');
  // #endregion

  // #region actions
  /** 防抖计时器。 */
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 防抖落盘。
   *
   * **必须做一次 JSON 往返**：store 里全是 reactive 代理，直接下发会在运行期抛
   * "An object could not be cloned"，而 typecheck 与 build 都发现不了。
   */
  function persist(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const plain = JSON.parse(JSON.stringify(conversations.value)) as AiConversation[];
      void saveAiConversationsApi(plain);
    }, SAVE_DEBOUNCE);
  }

  /**
   * 把一条增量写到它该去的地方。
   *
   * 按 requestId 找目标消息而不是往「当前会话」里写：用户完全可能在生成过程中切到别的
   * 会话，写当前会话就会把内容串到另一个对话里去。
   * @param requestId 请求 id。
   * @returns 目标消息；找不到返回 undefined。
   */
  function findTarget(requestId: string): AiMessage | undefined {
    const target = pending.value[requestId];
    if (!target) return undefined;
    const conversation = conversations.value.find((c) => c.id === target.conversationId);
    return conversation?.messages.find((m) => m.id === target.messageId);
  }

  /**
   * 把一条工具记录写进消息。
   *
   * **按 callId upsert，不能无脑 push**：同一个 callId 会来多次（pending → running →
   * done），push 的话一次调用会画出三张卡片。主进程每次发的都是完整记录，所以整条替换
   * 就是最新状态。
   * @param message 目标助手消息。
   * @param call 工具记录。
   */
  function upsertToolCall(message: AiMessage, call: AiToolCall): void {
    const list = message.toolCalls ?? (message.toolCalls = []);
    const index = list.findIndex((item) => item.callId === call.callId);
    if (index >= 0) list.splice(index, 1, call);
    else list.push(call);
  }

  /** 流式分片订阅的取消函数（只订一次）。 */
  let unsubscribe: (() => void) | null = null;

  /** 订阅主进程的流式分片。 */
  function subscribe(): void {
    if (unsubscribe) return;
    unsubscribe = onAiStream((event) => {
      const message = findTarget(event.requestId);
      if (!message) return;
      if (event.type === 'text') message.text += event.delta ?? '';
      else if (event.type === 'reasoning')
        message.reasoning = (message.reasoning ?? '') + event.delta;
      else if (event.type === 'warning') {
        message.warnings = [...(message.warnings ?? []), event.message ?? ''];
      } else if (event.type === 'error') message.error = event.message ?? '请求失败';
      else if (event.type === 'abort') message.canceled = true;
      else if (event.type === 'tool' && event.toolCall) upsertToolCall(message, event.toolCall);
    });
  }

  /** 窗口打开时读一遍磁盘并订阅分片。 */
  async function ensureLoaded(): Promise<void> {
    subscribe();
    if (loaded.value) return;
    loaded.value = true;
    conversations.value = await loadAiConversationsApi().catch(() => []);
    sanitizeToolCalls();
    if (!activeId.value) activeId.value = conversations.value[0]?.id ?? '';
  }

  /**
   * 把磁盘上读回来的 `pending` / `running` 工具记录改成「已中断」。
   *
   * 上次关窗口时挂着的确认卡，主进程那边的 promise 早已被判掉（sender 销毁 →
   * `cancelChat` → `denyPending`），重开后**没有任何人在等这张卡**，按钮点了也没人接。
   * 不改的话界面上就是一张永远在转、永远点不动的卡片。
   */
  function sanitizeToolCalls(): void {
    for (const conversation of conversations.value) {
      for (const message of conversation.messages) {
        for (const call of message.toolCalls ?? []) {
          if (call.status === 'pending' || call.status === 'running') call.status = 'interrupted';
        }
      }
    }
  }

  /**
   * 新建一个会话。
   * @returns 新会话 id。
   */
  function newConversation(): string {
    const now = Date.now();
    const conversation: AiConversation = {
      id: crypto.randomUUID(),
      title: '新对话',
      messages: [],
      configId: useAiConfigStore().activeConfig?.id ?? '',
      createdAt: now,
      updatedAt: now,
    };
    conversations.value.unshift(conversation);
    activeId.value = conversation.id;
    draftImages.value = [];
    persist();
    return conversation.id;
  }

  /**
   * 切换会话。草稿图片不跟着走（它属于刚才那个输入框）。
   * @param id 会话 id。
   */
  function selectConversation(id: string): void {
    activeId.value = id;
    draftImages.value = [];
  }

  /**
   * 重命名一个会话。
   *
   * 命名后置 `titleCustom`，让 {@link send} 里的自动标题不再覆盖它。传空串表示「清掉自定义
   * 名字」——回落成「新对话」并清掉标记，于是下一条消息又能自动取标题。
   * @param id 会话 id。
   * @param title 新标题。
   */
  function renameConversation(id: string, title: string): void {
    const conversation = conversations.value.find((c) => c.id === id);
    if (!conversation) return;
    const next = title.trim();
    if (next) {
      conversation.title = next;
      conversation.titleCustom = true;
    } else {
      conversation.title = '新对话';
      conversation.titleCustom = false;
    }
    persist();
  }

  /**
   * 删除一个会话。它引用的图片会在落盘时被一起清掉。
   * @param id 会话 id。
   */
  function removeConversation(id: string): void {
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (activeId.value === id) activeId.value = conversations.value[0]?.id ?? '';
    persist();
  }

  /**
   * 发一条消息。
   *
   * 流结束才 resolve；过程中的增量由订阅回调写进占位的助手消息。
   * @param text 用户输入。
   */
  async function send(text: string): Promise<void> {
    const configStore = useAiConfigStore();
    const config = configStore.activeConfig;
    if (!config) {
      showError('还没有 AI 配置，请先到设置页添加一个');
      return;
    }
    if (!configStore.keyStatus[config.id]?.hasKey) {
      showError(`配置「${config.name}」还没有填 API Key`);
      return;
    }

    const content = text.trim();
    const images = draftImages.value;
    if (!content && images.length === 0) return;

    const conversationId = activeId.value || newConversation();
    const conversation = conversations.value.find((c) => c.id === conversationId);
    if (!conversation) return;

    const now = Date.now();
    const userMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: content,
      ...(images.length > 0 ? { images: [...images] } : {}),
      createdAt: now,
    };
    const assistantMessage: AiMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: now,
    };
    conversation.messages.push(userMessage, assistantMessage);
    conversation.configId = config.id;
    conversation.updatedAt = now;
    // 用户手动命名过就不许自动标题再覆盖——否则刚改完名，下一条消息就把它改回去
    if (!conversation.titleCustom && conversation.title === '新对话' && content) {
      conversation.title = content.slice(0, TITLE_LENGTH);
    }
    draftImages.value = [];
    persist();

    // 上下文里带上刚加的用户消息，但不带那条空的助手占位。
    // **只发 text，不发 toolCalls**：这是有意的边界——SDK 的多步工具循环发生在**一次
    // 请求内部**，跨轮只留模型自己写下的话。把历史工具记录也塞回去，既涨 token 又会
    // 让模型以为那些调用还能续上（那些 callId 早就不在主进程的等待表里了）
    const history: AiSendMessage[] = conversation.messages
      .filter((m) => m.id !== assistantMessage.id && !m.error)
      .map((m) => ({
        role: m.role,
        text: m.text,
        ...(m.images?.length
          ? { images: m.images.map((i) => ({ path: i.path, mediaType: i.mediaType })) }
          : {}),
      }));

    const requestId = crypto.randomUUID();
    pending.value[requestId] = { conversationId, messageId: assistantMessage.id };

    try {
      const result = await chatAiApi({
        requestId,
        // 纯对象：reactive 代理跨 IPC 会在运行期抛 could not be cloned
        config: { ...config },
        messages: history,
        // 策略跟着请求走，主进程不去读 app-state（读了就是两份状态，必然漂移）
        toolMode: configStore.toolApproval,
      });
      // 以最终结果为准（分片累积理论上一致，但断流补齐时以它为准更稳）
      if (result.text) assistantMessage.text = result.text;
      if (result.reasoning) assistantMessage.reasoning = result.reasoning;
      if (result.canceled) assistantMessage.canceled = true;
    } catch (error) {
      // 错误多数已由 error 分片写进消息，这里兜住分片没来的情况
      if (!assistantMessage.error) {
        assistantMessage.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      delete pending.value[requestId];
      conversation.updatedAt = Date.now();
      persist();
    }
  }

  /**
   * 取消当前会话进行中的请求。
   * @returns 是否发出了取消。
   */
  async function cancelActive(): Promise<boolean> {
    const requestId = activeRequestId.value;
    if (!requestId) return false;
    return cancelAiApi(requestId).catch(() => false);
  }

  /**
   * 回答一次工具确认。
   *
   * 本地先把状态推过去（`running` / `denied`）只为了按钮立刻不能再点；**权威值随后由主
   * 进程的 tool 事件覆盖**，所以这里不必算得多准。
   * @param callId 工具调用 id。
   * @param approved 允许还是拒绝。
   */
  async function replyTool(callId: string, approved: boolean): Promise<void> {
    for (const conversation of conversations.value) {
      for (const message of conversation.messages) {
        const call = message.toolCalls?.find((item) => item.callId === callId);
        if (call && call.status === 'pending') call.status = approved ? 'running' : 'denied';
      }
    }
    await replyAiToolApi(callId, approved).catch(() => false);
  }

  /**
   * 允许一次工具调用。
   * @param callId 工具调用 id。
   */
  function approveTool(callId: string): Promise<void> {
    return replyTool(callId, true);
  }

  /**
   * 拒绝一次工具调用。
   * @param callId 工具调用 id。
   */
  function denyTool(callId: string): Promise<void> {
    return replyTool(callId, false);
  }

  /**
   * 往输入区加一张图片。
   * @param image 已暂存的图片引用。
   */
  function addDraftImage(image: AiImageRef): void {
    // 同一张图（内容哈希相同）不重复加
    if (draftImages.value.some((i) => i.id === image.id)) return;
    draftImages.value.push(image);
  }

  /**
   * 从输入区移掉一张图片。
   * @param id 图片 id。
   */
  function removeDraftImage(id: string): void {
    draftImages.value = draftImages.value.filter((i) => i.id !== id);
  }
  // #endregion

  return {
    loaded,
    conversations,
    activeId,
    draftImages,
    pending,
    activeConversation,
    activeRequestId,
    activeBusy,
    ensureLoaded,
    newConversation,
    selectConversation,
    renameConversation,
    removeConversation,
    send,
    cancelActive,
    approveTool,
    denyTool,
    addDraftImage,
    removeDraftImage,
  };
});
