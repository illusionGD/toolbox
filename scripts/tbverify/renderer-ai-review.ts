/**
 * 渲染进程侧桩测：配置重读（多窗口）/ 重命名与 titleCustom / toolApproval 持久化 /
 * 配置草稿与复制 / 关窗口前能取消且分片按 requestId 落回原会话 /
 * 工具卡片的 upsert 与确认回答（23b）/ markdown 渲染的纯函数层（23c）。
 *
 * 生产代码逐字保留，只桩 `@/services/appState`、`@/services/ai` 与 `window`。
 *
 * **窗口几何不再在这里测**：AI 对话已经是独立的 `BrowserWindow`，拖动与缩放归 OS，
 * 位置数学搬到了 `electron/shared/aiPanel.ts`，由主进程侧那份桩测断言。
 *
 * 第 9 组测的是 `utils/markdown.ts`——它**故意**被写成不碰 Vue、不碰 DOM 的纯函数，
 * 就是为了让「XSS 有没有防住」「增量与全量收不收敛」变成断言得了的性质。
 */
import { createPinia, setActivePinia } from 'pinia';
import type { AiConversation, AiToolCall } from '@shared/types';
import { useAiConfigStore } from '@/stores/aiConfig';
import { useAiChatStore } from '@/stores/aiChat';
import {
  createMdStream,
  findStableCut,
  flattenMdStream,
  hasOpenFence,
  isSafeHref,
  pushMdStream,
  renderMarkdown,
  type MdNode,
} from '@/utils/markdown';
import { lastWritten, resetState, seedState, writeCounts } from './stub-app-state';
import {
  cancelCalls,
  chatCalls,
  copyCalls,
  emitStream,
  resetAiStub,
  savedConversations,
  seedConversations,
  seedKey,
  toolReplyCalls,
} from './stub-services-ai';

let passed = 0;
const failures: string[] = [];

/**
 * 断言相等。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 说明。
 */
function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    passed += 1;
    return;
  }
  failures.push(
    `${label}\n    实际: ${JSON.stringify(actual)}\n    期望: ${JSON.stringify(expected)}`,
  );
}

/**
 * 换一套干净的 store + 状态。
 */
function fresh(): void {
  resetState();
  resetAiStub();
  setActivePinia(createPinia());
}

/**
 * 等一会（防抖写盘用）。
 * @param ms 毫秒。
 * @returns promise。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* --------------------- 1 配置在 ai 命名空间里往返 --------------------- */

fresh();
{
  const config = useAiConfigStore();
  config.addConfig({ name: '甲', provider: 'anthropic' });
  await sleep(0);
  const written = lastWritten.ai as { configs?: unknown[]; activeId?: string };
  eq(written.configs?.length, 1, '配置写进 ai 命名空间');
  eq(typeof written.activeId, 'string', 'activeId 一起写下去');
  // 窗口 bounds 归主进程写的 aiWindow 命名空间：这边整块覆盖写，混在一起必然互相抹掉
  eq('panel' in (written as object), false, 'ai 命名空间里不再存窗口几何');
}

// 读回：模拟下一次启动
fresh();
seedState('ai', {
  configs: [{ id: 'c1', name: '存下来的配置', provider: 'anthropic', model: 'x' }],
  activeId: 'c1',
  toolApproval: 'auto',
});
{
  const config = useAiConfigStore();
  eq(config.configs.length, 1, '重启后配置读得回来');
  eq(config.activeId, 'c1', '重启后 activeId 读得回来');
  eq(config.toolApproval, 'auto', '重启后 toolApproval 读得回来');
}

// 坏数据不许把配置列表带成脏值
fresh();
seedState('ai', { configs: [{ noId: true }, 'nonsense', null], activeId: 42 });
{
  const config = useAiConfigStore();
  eq(config.configs.length, 0, '没有 id 的条目被过滤掉');
  eq(config.activeId, '', '非字符串的 activeId 回落成空串');
}

/* ------------------ 2 hydrate：主窗口改完配置，AI 窗口重读 ------------------ */

fresh();
{
  // AI 窗口是独立进程视图：它打开时读到的是当时的磁盘状态
  const config = useAiConfigStore();
  eq(config.configs.length, 0, 'AI 窗口打开时还没有配置');

  // 用户切到主窗口，在设置页加了一份配置并选中——落到同一份 app-state 里
  seedState('ai', {
    configs: [{ id: 'c9', name: '主窗口新加的', provider: 'anthropic', model: 'x' }],
    activeId: 'c9',
    toolApproval: 'auto',
  });
  eq(config.configs.length, 0, '不调 hydrate 的话这边还是旧的（就是这个 bug 才要 hydrate）');

  // 切回 AI 窗口触发 focus → refreshAppState() + hydrate()
  config.hydrate();
  eq(config.configs.length, 1, 'hydrate 后读到主窗口新加的配置');
  eq(config.activeConfig?.name, '主窗口新加的', 'hydrate 后当前配置就是新的那份');
  eq(config.toolApproval, 'auto', 'hydrate 一起把 toolApproval 带过来');
}

// hydrate 不许把配置清空成 undefined（磁盘上那个命名空间被整块删掉的情形）
fresh();
seedState('ai', { configs: [{ id: 'c1', name: '甲', provider: 'anthropic', model: 'x' }] });
{
  const config = useAiConfigStore();
  resetState();
  config.hydrate();
  eq(Array.isArray(config.configs), true, '磁盘上没了也仍是数组，不是 undefined');
  eq(config.configs.length, 0, '磁盘上没了就是空列表');
  eq(config.toolApproval, 'ask', '读不到时 toolApproval 回落到 ask');
}

/* --------------------------- 3 toolApproval 读写 --------------------------- */

fresh();
{
  const config = useAiConfigStore();
  eq(config.toolApproval, 'ask', '默认工具审批策略是「询问」');
  config.setToolApproval('auto');
  eq(config.toolApproval, 'auto', 'setToolApproval 生效');
  eq((lastWritten.ai as { toolApproval?: string }).toolApproval, 'auto', 'toolApproval 已持久化');
}
fresh();
seedState('ai', { configs: [], activeId: '', toolApproval: 'nonsense' });
eq(useAiConfigStore().toolApproval, 'ask', '认不出的 toolApproval 回落到 ask');

// 三态：off 也要存得下、读得回（少认一个值就会被静默当成 ask，用户以为关了其实没关）
fresh();
{
  const config = useAiConfigStore();
  config.setToolApproval('off');
  eq(config.toolApproval, 'off', 'setToolApproval 认「关闭」');
  eq((lastWritten.ai as { toolApproval?: string }).toolApproval, 'off', 'off 持久化下去了');
}
fresh();
seedState('ai', { configs: [], activeId: '', toolApproval: 'off' });
eq(useAiConfigStore().toolApproval, 'off', '重启后 off 读得回来');

/* --------------------------- 4 配置草稿 / 复制 --------------------------- */

fresh();
{
  const config = useAiConfigStore();
  const id = config.addConfig({ name: '原配置', temperature: 0.3 });
  eq(config.configs.length, 1, 'addConfig 加了一份');
  eq(config.configs[0].name, '原配置', 'addConfig 用了草稿里的名称');
  eq(config.configs[0].temperature, 0.3, 'addConfig 用了草稿里的温度');
  eq(config.activeId, id, '第一份配置自动成为当前配置');
  eq(typeof config.configs[0].createdAt, 'number', 'createdAt 由 store 补上');

  // 草稿式保存：改的是副本，只有 saveConfig 才落
  const before = config.configs[0].name;
  const draft = { ...config.configs[0], name: '改过的名字' };
  eq(config.configs[0].name, before, '改草稿副本不影响 store（取消就什么都不落）');
  config.saveConfig(id, {
    name: draft.name,
    provider: draft.provider,
    model: draft.model,
    baseUrl: draft.baseUrl,
    systemPrompt: draft.systemPrompt,
    temperature: draft.temperature,
    maxOutputTokens: draft.maxOutputTokens,
  });
  eq(config.configs[0].name, '改过的名字', 'saveConfig 才把草稿落下去');

  // 复制：新 id + 调了 copyKey
  seedKey(id, 'sk-original-1234567890');
  await config.refreshKeyStatus();
  const copyId = await config.duplicateConfig(id, {
    name: '原配置 副本',
    provider: config.configs[0].provider,
    model: config.configs[0].model,
    baseUrl: config.configs[0].baseUrl,
    systemPrompt: config.configs[0].systemPrompt,
    temperature: config.configs[0].temperature,
    maxOutputTokens: config.configs[0].maxOutputTokens,
  });
  eq(config.configs.length, 2, '复制后有两份配置');
  eq(copyId !== id, true, '复制出来的是新 id');
  eq(config.configs[1].name, '原配置 副本', '副本用了草稿里的名字');
  eq(copyCalls.length, 1, '复制调了主进程的 copyKey 通道');
  eq(copyCalls[0].fromId, id, 'copyKey 的源是被复制的那份');
  eq(copyCalls[0].toId, copyId, 'copyKey 的目标是新配置');
  eq(config.keyStatus[copyId]?.hasKey, true, '副本不用重填 key');
  eq(
    config.keyStatus[copyId]?.hint,
    config.keyStatus[id]?.hint,
    '副本的掩码提示与源一致（说明是同一个 key）',
  );

  // 源不存在时不该凭空造出配置
  const bogus = await config.duplicateConfig('not-there', config.draftDefaults());
  eq(bogus, '', '源不存在时 duplicateConfig 返回空串');
  eq(config.configs.length, 2, '源不存在时不加配置');

  // 删配置连 key 一起删
  await config.removeConfig(copyId);
  eq(config.configs.length, 1, 'removeConfig 删掉了副本');
  eq(config.keyStatus[copyId], undefined, '删配置时它的 key 状态也清了');
}

/* ------------------- 5 重命名 + titleCustom 不被自动标题覆盖 ------------------- */

fresh();
{
  const config = useAiConfigStore();
  const configId = config.addConfig({ name: '测试配置' });
  seedKey(configId, 'sk-test-1234567890');
  await config.refreshKeyStatus();

  const chat = useAiChatStore();
  const id = chat.newConversation();
  eq(chat.activeConversation?.title, '新对话', '新会话标题是「新对话」');

  // 没重命名过：首条消息自动取标题
  void chat.send('自动取的标题会是这一句');
  await sleep(0);
  eq(chat.activeConversation?.title, '自动取的标题会是这一句', '未命名时自动取首条消息为标题');
  chatCalls[0]?.resolve({
    text: 'ok',
    reasoning: '',
    finishReason: 'stop',
    canceled: false,
    warnings: [],
  });
  await sleep(0);

  // 重命名后：新消息不许再改标题
  chat.renameConversation(id, '我自己起的名字');
  eq(chat.activeConversation?.title, '我自己起的名字', 'renameConversation 生效');
  eq(chat.activeConversation?.titleCustom, true, '重命名后置 titleCustom');
  chat.newConversation();
  const id2 = chat.activeId;
  chat.renameConversation(id2, '第二个会话的名字');
  void chat.send('这句不该变成标题');
  await sleep(0);
  eq(
    chat.conversations.find((c) => c.id === id2)?.title,
    '第二个会话的名字',
    '命名过的会话，发新消息不会被自动标题覆盖',
  );
  chatCalls[1]?.resolve({
    text: 'ok',
    reasoning: '',
    finishReason: 'stop',
    canceled: false,
    warnings: [],
  });
  await sleep(0);

  // 空标题回落 + 清掉标记，于是下一条消息又能自动取名
  chat.renameConversation(id2, '   ');
  eq(chat.conversations.find((c) => c.id === id2)?.title, '新对话', '空标题回落成「新对话」');
  eq(
    chat.conversations.find((c) => c.id === id2)?.titleCustom,
    false,
    '空标题同时清掉 titleCustom（于是又允许自动取名）',
  );

  // 不存在的 id 不抛
  chat.renameConversation('nope', 'x');
  eq(true, true, '重命名不存在的会话不抛错');
}

/* ------------- 6 取消得动 + 分片按 requestId 落回原会话（不看「当前」） ------------- */

fresh();
{
  const config = useAiConfigStore();
  const configId = config.addConfig({ name: '测试配置' });
  seedKey(configId, 'sk-test-1234567890');
  await config.refreshKeyStatus();

  const chat = useAiChatStore();
  await chat.ensureLoaded();
  const conversationId = chat.newConversation();
  void chat.send('你好');
  await sleep(0);

  eq(chatCalls.length, 1, '发出了一次请求');
  eq(chatCalls[0].cloneOk, true, '下发的请求体是纯对象（structuredClone 过得去）');
  const requestId = chatCalls[0].request.requestId;
  eq(chat.activeBusy, true, '请求在跑');

  // 用户在生成过程中切到另一个会话：分片必须按 requestId 回到原会话，
  // 写「当前会话」就会把内容串到刚切过去的那个对话里
  const otherId = chat.newConversation();
  eq(chat.activeId, otherId, '已切到另一个会话');
  eq(chat.activeBusy, false, '另一个会话自己没有在跑的请求');
  emitStream({ requestId, type: 'text', delta: '写回' });
  emitStream({ requestId, type: 'text', delta: '原会话' });
  const conversation = chat.conversations.find((c) => c.id === conversationId);
  const assistant = conversation?.messages[conversation.messages.length - 1];
  eq(assistant?.text, '写回原会话', '切走后分片仍按 requestId 落回原会话');
  const other = chat.conversations.find((c) => c.id === otherId);
  eq(other?.messages.length, 0, '新切过去的会话没被串进内容');

  // 告警也照样落到那条消息上
  emitStream({ requestId, type: 'warning', message: '该模型不支持采样温度，已忽略' });
  eq(assistant?.warnings?.[0], '该模型不支持采样温度，已忽略', '告警文本落到消息的 warnings 上');

  // 关窗口之前要能主动取消（关窗口后由主进程按 sender 销毁兜住，见主进程侧桩测）
  chat.selectConversation(conversationId);
  eq(chat.activeRequestId, requestId, '切回去后 activeRequestId 就是它');
  eq(await chat.cancelActive(), true, 'cancelActive 发出了取消');
  eq(cancelCalls.length, 1, '取消确实发到了主进程通道');
  eq(cancelCalls[0], requestId, '取消带的是这次的 requestId');

  // 取消是主进程回一个 abort 分片 + canceled 结果，不走错误路径
  emitStream({ requestId, type: 'abort' });
  eq(assistant?.canceled, true, 'abort 分片把消息标成已取消');
  chatCalls[0].resolve({
    text: '写回原会话',
    reasoning: '',
    finishReason: 'abort',
    canceled: true,
    warnings: [],
  });
  await sleep(0);
  eq(chat.activeBusy, false, '流结束后不再忙');
  eq(assistant?.error, undefined, '取消不是错误，不该给消息打上 error');
}

// 没有在跑的请求时 cancelActive 不该乱发通道
fresh();
{
  const chat = useAiChatStore();
  eq(await chat.cancelActive(), false, '没有进行中的请求时 cancelActive 回 false');
  eq(cancelCalls.length, 0, '没有进行中的请求时不发取消通道');
}

/* ------------------ 7 工具卡片：按 callId upsert + 确认回答 ------------------ */

/**
 * 造一条工具记录（只改要改的那几个字段）。
 * @param patch 要覆盖的字段。
 * @returns 完整记录。
 */
function toolCall(patch: Partial<AiToolCall>): AiToolCall {
  return {
    callId: 'call-1',
    name: 'write_text_file',
    kind: 'write',
    summary: '写入 a.txt（12 B，不覆盖）到 D:\\out',
    status: 'pending',
    startedAt: 1,
    ...patch,
  };
}

fresh();
{
  const config = useAiConfigStore();
  const configId = config.addConfig({ name: '测试配置' });
  seedKey(configId, 'sk-test-1234567890');
  await config.refreshKeyStatus();
  config.setToolApproval('auto');

  const chat = useAiChatStore();
  await chat.ensureLoaded();
  const conversationId = chat.newConversation();
  void chat.send('把内容写到文件里');
  await sleep(0);

  eq(chatCalls[0].request.toolMode, 'auto', '当前的审批策略跟着请求下发（主进程不去读磁盘）');
  eq(chatCalls[0].cloneOk, true, '带上 toolMode 的请求体仍是纯对象');

  const requestId = chatCalls[0].request.requestId;
  const conversation = chat.conversations.find((c) => c.id === conversationId);
  const assistant = conversation?.messages[conversation.messages.length - 1];

  // 同一个 callId 来三次（pending → running → done）：**只能有一张卡**
  emitStream({ requestId, type: 'tool', toolCall: toolCall({ status: 'pending' }) });
  eq(assistant?.toolCalls?.length, 1, '第一条 tool 事件建出一张卡');
  emitStream({ requestId, type: 'tool', toolCall: toolCall({ status: 'running' }) });
  emitStream({
    requestId,
    type: 'tool',
    toolCall: toolCall({ status: 'done', result: '已写入 12 B', elapsed: 8 }),
  });
  eq(assistant?.toolCalls?.length, 1, '同一个 callId 来三次仍然只有一张卡（upsert 不是 push）');
  eq(assistant?.toolCalls?.[0].status, 'done', '卡片上是最后那次的状态');
  eq(assistant?.toolCalls?.[0].result, '已写入 12 B', '结果摘要写在卡片上');
  eq(assistant?.toolCalls?.[0].elapsed, 8, '耗时也跟着覆盖上去');

  // 不同 callId 是两张卡（多步调用要按顺序都看得见）
  emitStream({
    requestId,
    type: 'tool',
    toolCall: toolCall({ callId: 'call-2', name: 'probe_video', kind: 'read', status: 'running' }),
  });
  eq(assistant?.toolCalls?.length, 2, '不同 callId 是两张卡');
  eq(assistant?.toolCalls?.[1].name, 'probe_video', '第二张卡是另一个工具');

  // 切走之后 tool 事件也要按 requestId 落回原会话（同 text 分片的理由）
  const otherId = chat.newConversation();
  emitStream({
    requestId,
    type: 'tool',
    toolCall: toolCall({ callId: 'call-3', status: 'pending' }),
  });
  eq(assistant?.toolCalls?.length, 3, '切走后 tool 事件仍按 requestId 落回原会话');
  eq(chat.conversations.find((c) => c.id === otherId)?.messages.length, 0, '新会话没被串进卡片');

  // 「允许 / 拒绝」要真的发到 ai:toolReply，并先把本地状态推过去（按钮立刻不能再点）
  chat.selectConversation(conversationId);
  await chat.approveTool('call-3');
  eq(toolReplyCalls.length, 1, 'approveTool 打到了 ai:toolReply');
  eq(toolReplyCalls[0].callId, 'call-3', '带的是那张卡的 callId');
  eq(toolReplyCalls[0].approved, true, '允许就是 approved:true');
  eq(assistant?.toolCalls?.[2].status, 'running', '允许后本地先转 running');

  emitStream({
    requestId,
    type: 'tool',
    toolCall: toolCall({ callId: 'call-4', status: 'pending' }),
  });
  await chat.denyTool('call-4');
  eq(toolReplyCalls[1].approved, false, '拒绝就是 approved:false');
  eq(assistant?.toolCalls?.[3].status, 'denied', '拒绝后本地转 denied');

  // 已经落定的卡片不许被再次点动（否则历史记录会被改成 running）
  await chat.approveTool('call-1');
  eq(assistant?.toolCalls?.[0].status, 'done', '对已完成的卡片点允许不会把它改回 running');
  eq(toolReplyCalls.length, 3, '不过通道照样发（由主进程回 false，见主进程侧桩测）');

  chatCalls[0].resolve({
    text: '写好了',
    reasoning: '',
    finishReason: 'stop',
    canceled: false,
    warnings: [],
  });
  await sleep(0);
}

/* --------------- 8 从磁盘读回来的挂起卡片一律变「已中断」 --------------- */

fresh();
{
  const stored: AiConversation[] = [
    {
      id: 'conv-1',
      title: '上次关窗口时挂着确认',
      configId: 'c1',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          text: '',
          createdAt: 1,
          toolCalls: [
            toolCall({ callId: 'p1', status: 'pending' }),
            toolCall({ callId: 'p2', status: 'running' }),
            toolCall({ callId: 'p3', status: 'done', result: '已写入 12 B' }),
            toolCall({ callId: 'p4', status: 'denied' }),
          ],
        },
      ],
    },
  ];
  seedConversations(stored);

  const chat = useAiChatStore();
  await chat.ensureLoaded();
  const calls = chat.conversations[0].messages[0].toolCalls ?? [];
  eq(calls.length, 4, '读回来四张卡');
  // 主进程那边的 promise 早被判掉了，不改的话界面上是一张永远在转、永远点不动的卡
  eq(calls[0].status, 'interrupted', '磁盘上的 pending → 已中断');
  eq(calls[1].status, 'interrupted', '磁盘上的 running → 已中断');
  eq(calls[2].status, 'done', '已完成的卡片不动');
  eq(calls[3].status, 'denied', '已拒绝的卡片不动');
}

/* ------------- 9 markdown 渲染（23c）：纯函数层的安全 / 结构 / 流式增量 ------------- */

/**
 * 深度优先铺平一棵树。
 * @param nodes 节点数组。
 * @returns 所有节点（含自身与后代）。
 */
function allNodes(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children) out.push(...allNodes(node.children));
  }
  return out;
}

/**
 * 树里出现过的所有 tag。
 * @param nodes 节点数组。
 * @returns tag 集合。
 */
function tagsOf(nodes: MdNode[]): Set<string> {
  return new Set(allNodes(nodes).map((n) => n.tag));
}

/**
 * 树里所有文本拼起来（含代码块与图片那行）。
 * @param nodes 节点数组。
 * @returns 拼接文本。
 */
function textOf(nodes: MdNode[]): string {
  return allNodes(nodes)
    .map((n) => n.text ?? '')
    .join('');
}

/**
 * 找第一个某 tag 的节点。
 * @param nodes 节点数组。
 * @param tag 要找的 tag。
 * @returns 节点或 undefined。
 */
function firstTag(nodes: MdNode[], tag: string): MdNode | undefined {
  return allNodes(nodes).find((n) => n.tag === tag);
}

/**
 * 找最后一个某 tag 的节点。
 * @param nodes 节点数组。
 * @param tag 要找的 tag。
 * @returns 节点或 undefined。
 */
function lastTag(nodes: MdNode[], tag: string): MdNode | undefined {
  return allNodes(nodes)
    .filter((n) => n.tag === tag)
    .pop();
}

/**
 * 这棵树 `structuredClone` 得过吗（纯对象的判据，本仓库为这个踩过五次）。
 * @param value 任意值。
 * @returns 过得去则 true。
 */
function cloneOk(value: unknown): boolean {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

/** 注入用不上的三个 tag：一个都不许出现在树里。 */
const FORBIDDEN_TAGS = ['script', 'img', 'iframe'];

/**
 * 树里有没有出现被禁的 tag。
 * @param nodes 节点数组。
 * @returns 有则 true。
 */
function hasForbidden(nodes: MdNode[]): boolean {
  const tags = tagsOf(nodes);
  return FORBIDDEN_TAGS.some((t) => tags.has(t));
}

// 9.1 安全：裸 HTML 只能作为字符出现
{
  const script = renderMarkdown('<script>alert(1)</script>');
  eq(hasForbidden(script), false, '<script> 不会变成 script 节点');
  eq(textOf(script).includes('<script>alert(1)</script>'), true, '<script> 原文作为文本保留');
  eq(cloneOk(script), true, '节点树 structuredClone 过得去');

  const img = renderMarkdown('段落 <img src=x onerror=alert(1)> 尾');
  eq(hasForbidden(img), false, '行内 <img onerror> 不会变成 img 节点');
  eq(textOf(img).includes('onerror=alert(1)'), true, '行内 HTML 原文作为文本保留');

  const iframe = renderMarkdown('<iframe src="https://evil.com"></iframe>');
  eq(hasForbidden(iframe), false, '<iframe> 不会变成 iframe 节点');

  const bold = renderMarkdown('a <b>x</b> b');
  eq(textOf(bold).includes('<b>'), true, '行内 <b> 也是字面文本，不是 strong');
}

// 9.2 安全：链接白名单
{
  const ok = renderMarkdown('[点我](https://a.com/x?y=1)');
  const anchor = firstTag(ok, 'a');
  eq(anchor?.attrs?.href, 'https://a.com/x?y=1', 'https 链接进 a 且 href 原样');
  eq(anchor?.attrs?.target, '_blank', 'a 带 target=_blank（才会命中 setWindowOpenHandler）');
  eq(String(anchor?.attrs?.rel ?? '').includes('noopener'), true, 'a 的 rel 含 noopener');
  eq(tagsOf(renderMarkdown('[a](mailto:x@y.com)')).has('a'), true, 'mailto 也进 a');

  for (const bad of [
    '[x](javascript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)',
    '[x](file:///C:/Windows/System32/cmd.exe)',
    '[x](vbscript:msgbox)',
    '[x](/relative/path)',
  ]) {
    const tree = renderMarkdown(bad);
    eq(tagsOf(tree).has('a'), false, `不安全的 href 不进 a：${bad}`);
    eq(textOf(tree).includes('[x]('), true, `不安全的链接原文照显示：${bad}`);
  }

  eq(isSafeHref('https://a.com'), true, 'isSafeHref 认 https');
  eq(isSafeHref('javascript:alert(1)'), false, 'isSafeHref 不认 javascript');
  eq(isSafeHref(''), false, 'isSafeHref 不认空串');
}

// 9.3 安全：永不产出 img
{
  const remote = renderMarkdown('![风景](https://a.com/x.png)');
  eq(hasForbidden(remote), false, '远端图片不产出 img 节点');
  const image = firstTag(remote, 'md-image');
  eq(image?.text, '风景', '图片退化成一行，alt 当标题');
  eq(image?.attrs?.href, 'https://a.com/x.png', '安全地址仍给一个可点链接');

  const local = renderMarkdown('![x](file:///C:/a.png)');
  eq(firstTag(local, 'md-image')?.attrs?.href, undefined, '本地 file: 图片连链接都不给');
}

// 9.4 结构
{
  const heads = renderMarkdown('# 一\n\n## 二\n\n### 三\n\n#### 四\n\n##### 五\n\n###### 六');
  const tags = tagsOf(heads);
  eq(
    [1, 2, 3, 4, 5, 6].every((d) => tags.has(`h${d}`)),
    true,
    '# ~ ###### 对应 h1 ~ h6',
  );
  eq(tagsOf(renderMarkdown('####### 七')).has('h6'), false, '七个 # 不是标题（没有 h7）');

  const nested = renderMarkdown('- 甲\n  - 乙');
  const outerLi = firstTag(nested, 'li');
  eq(tagsOf(outerLi?.children ?? []).has('ul'), true, '嵌套列表的 ul 在 li 里面');

  eq(firstTag(renderMarkdown('3. 三\n4. 四'), 'ol')?.attrs?.start, 3, 'ol 的 start 带出来了');
  eq(firstTag(renderMarkdown('1. 一'), 'ol')?.attrs?.start, undefined, 'start 是 1 时不写属性');

  const task = renderMarkdown('- [x] 做完了\n- [ ] 没做');
  const items = allNodes(task).filter((n) => n.tag === 'li');
  eq(items[0]?.attrs?.checked, true, '任务列表第一项 checked');
  eq(items[1]?.attrs?.checked, false, '任务列表第二项未 checked');
  eq(textOf(task).includes('✅'), true, '勾选项渲染成 ✅ 前缀（不是 input 控件）');
  eq(tagsOf(task).has('input' as string), false, '任务列表不产出 input 控件');

  const table = renderMarkdown('| 甲 | 乙 | 丙 |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');
  const tableTags = tagsOf(table);
  eq(tableTags.has('thead') && tableTags.has('tbody'), true, '表格出 thead + tbody');
  const headCells = allNodes(table).filter((n) => n.tag === 'th');
  eq(headCells[0]?.attrs?.align, 'left', '表头第一列左对齐');
  eq(headCells[1]?.attrs?.align, 'center', '表头第二列居中');
  eq(headCells[2]?.attrs?.align, 'right', '表头第三列右对齐');
  eq(allNodes(table).filter((n) => n.tag === 'td').length, 3, '数据行三个单元格');

  eq(tagsOf(renderMarkdown('> 引用\n> 第二行')).has('blockquote'), true, '> 出 blockquote');
  eq(tagsOf(renderMarkdown('---')).has('hr'), true, '--- 出 hr');

  const inline = renderMarkdown('`x` **粗** *斜* ~~删~~');
  const inlineTags = tagsOf(inline);
  eq(
    ['code', 'strong', 'em', 'del'].every((t) => inlineTags.has(t)),
    true,
    '行内 code / strong / em / del 都认',
  );
  eq(tagsOf(renderMarkdown('一  \n二')).has('br'), true, '行尾两空格出 br');

  // marked 的 token 不解实体，得我们自己补，否则界面上是 &lt;div&gt;
  eq(
    textOf(renderMarkdown('&lt;div&gt; &amp; &#65;')).includes('<div> & A'),
    true,
    'HTML 实体解码了',
  );
  eq(
    textOf(renderMarkdown('`&amp;`')).includes('&amp;'),
    true,
    '代码里的实体不解（同 CommonMark）',
  );
}

// 9.5 流式标记：只高亮已闭合的围栏
{
  const open = renderMarkdown('前面\n\n```js\nconst a = 1;');
  eq(lastTag(open, 'md-code')?.attrs?.open, true, '未闭合围栏标 open');
  eq(lastTag(open, 'md-code')?.attrs?.lang, 'js', '未闭合围栏的语言也认得');

  const closed = renderMarkdown('```ts\nconst a: number = 1;\n```');
  eq(lastTag(closed, 'md-code')?.attrs?.open, false, '闭合围栏 open 是 false');
  eq(lastTag(closed, 'md-code')?.attrs?.lang, 'ts', '闭合围栏的语言认得');
  eq(
    lastTag(renderMarkdown('```ts title=a\nx\n```'), 'md-code')?.attrs?.lang,
    'ts',
    'info string 只取第一个词',
  );

  eq(lastTag(renderMarkdown('~~~\nabc'), 'md-code')?.attrs?.open, true, '~~~ 围栏同样算');
  eq(hasOpenFence('```\nx'), true, 'hasOpenFence：一个围栏 = 未闭合');
  eq(hasOpenFence('```\nx\n```'), false, 'hasOpenFence：两个围栏 = 闭合');
  eq(hasOpenFence('```\nx\n```\n\n```py\ny'), true, 'hasOpenFence：三个围栏 = 未闭合');
  eq(hasOpenFence('```\n~~~\nx'), true, 'hasOpenFence：另一种字符关不掉围栏');
  eq(hasOpenFence('~~~\n```\nx'), true, 'hasOpenFence：反过来也关不掉');
  eq(hasOpenFence('````\nx\n```'), true, 'hasOpenFence：闭围栏比开围栏短不算闭合');
  eq(hasOpenFence('```\nx\n``` js'), true, 'hasOpenFence：带 info 的行不能当闭围栏');
  eq(hasOpenFence('没有围栏的一段话'), false, 'hasOpenFence：没有围栏就是 false');
}

// 9.6 块级增量：收敛性 / 单调 / 引用稳定 / 围栏不被劈开
{
  // 样例覆盖大部分语法。**故意含一段「围栏内有空行」的代码块**与一个松散列表：
  // 前者验切点的围栏判断，后者验切点不把列表劈成两个 ul
  const sample = [
    '# 标题一',
    '',
    '一段**普通**文字，含 `行内代码` 与 [链接](https://example.com/a)。',
    '',
    '- 甲',
    '',
    '- 乙',
    '',
    '1. 一',
    '2. 二',
    '   - 嵌套',
    '',
    '| 列 | 值 |',
    '|:--|--:|',
    '| a | 1 |',
    '',
    '```ts',
    'const a = 1;',
    '',
    'function f() {',
    '  return a;',
    '}',
    '```',
    '',
    '> 一段引用。',
    '',
    '---',
    '',
    '最后一段话。',
    '',
  ].join('\n');

  const full = renderMarkdown(sample);
  let stream = createMdStream();
  let lastConsumed = -1;
  let monotonic = true;
  let refsStable = true;
  let everThrew = false;
  let everDirty = false;
  let everUncloneable = false;
  let prevBlocks: MdNode[][] = [];

  for (let cut = 0; ; cut += 7) {
    const prefix = sample.slice(0, Math.min(cut, sample.length));
    try {
      stream = pushMdStream(stream, prefix);
    } catch {
      everThrew = true;
      break;
    }
    if (stream.consumed < lastConsumed) monotonic = false;
    lastConsumed = stream.consumed;
    // 已有的块必须还是同一批引用（MdBlock 的 memo 全靠这条）
    for (let i = 0; i < prevBlocks.length; i += 1) {
      if (stream.blocks[i] !== prevBlocks[i]) refsStable = false;
    }
    prevBlocks = stream.blocks;
    const tree = flattenMdStream(stream);
    if (hasForbidden(tree)) everDirty = true;
    if (!cloneOk(stream)) everUncloneable = true;
    // **最后一帧必须是全文**：写成 `cut <= length` 的话，长度不是 7 的整数倍时末态就少几个字，
    // 收敛性那条断言会拿一个半截前缀去比全量结果
    if (cut >= sample.length) break;
  }

  eq(everThrew, false, '增量：逐个前缀喂进去都不抛错');
  eq(monotonic, true, '增量：consumed 单调不减');
  eq(refsStable, true, '增量：已定稿的块数组引用永不被替换');
  eq(everUncloneable, false, '增量：每个中间态都 structuredClone 得过');
  eq(everDirty, false, '增量：任何中间态都不出现 script / img / iframe');
  eq(stream.blocks.length > 1, true, '增量：确实切出了多个定稿块（不是全都堆在尾块）');
  eq(
    JSON.stringify(flattenMdStream(stream)),
    JSON.stringify(full),
    '增量：末态与全量解析逐字相等（整个增量设计的守卫）',
  );

  // 围栏内的空行不许成为切点
  const codeBlocks = allNodes(flattenMdStream(stream)).filter((n) => n.tag === 'md-code');
  eq(codeBlocks.length, 1, '增量：含空行的代码块没被切成两半（只有一个 md-code）');
  eq(codeBlocks[0]?.text?.includes('\n\nfunction f()'), true, '增量：代码块里的空行原样留着');

  // 列表也不许被空行劈开
  eq(
    allNodes(flattenMdStream(stream)).filter((n) => n.tag === 'ul').length,
    2,
    '增量：松散列表没被劈成多个 ul',
  );

  // findStableCut 直接测：未闭合围栏内的空行不算切点。
  // 4 = 「开头\n\n」的长度——只有第一个空行合格；围栏里那个空行必须被否掉
  const fenced = '开头\n\n```js\nconst a = 1;\n\nconst b = 2;';
  eq(findStableCut(fenced, 0), 4, 'findStableCut：只切到围栏之前');
  eq(findStableCut('只有一段话没有空行', 0), 0, 'findStableCut：没有合格切点就不推进');

  // 文本不是追加（换了一段完全不同的内容）→ 整个重建
  const other = '# 另一篇\n\n完全不同的内容。\n\n第二段。\n';
  const rebuilt = pushMdStream(stream, other);
  eq(
    JSON.stringify(flattenMdStream(rebuilt)),
    JSON.stringify(renderMarkdown(other)),
    '增量：文本被换掉时整个重建，结果等于新全文的全量解析',
  );
  eq(rebuilt.consumed <= other.length, true, '增量：重建后 consumed 不超过新文本长度');

  // 已知且**有意接受**的跨块偏差：引用式链接的定义落在后一个块里。
  // 这正是「停流那一刻整棵树换成全量结果」这条安全绳存在的理由
  const refDoc = '见 [文档][1] 一节。\n\n[1]: https://a.com\n';
  let refStream = createMdStream();
  refStream = pushMdStream(refStream, refDoc.slice(0, 12));
  refStream = pushMdStream(refStream, refDoc);
  eq(tagsOf(renderMarkdown(refDoc)).has('a'), true, '全量解析认得引用式链接');
  eq(
    tagsOf(flattenMdStream(refStream)).has('a'),
    false,
    '增量里跨块的引用式链接暂时不成链接（停流后由全量结果纠正）',
  );
  eq(textOf(flattenMdStream(refStream)).includes('文档'), true, '跨块偏差只影响排版，内容不丢');
}

// 9.7 健壮：坏输入不抛、内容不丢
{
  eq(renderMarkdown('').length, 0, '空串给空数组');
  eq(renderMarkdown('   \n\n  \t\n').length, 0, '只有空白给空数组');

  for (const bad of [
    '**粗',
    '| 甲 | 乙 |',
    '[链接',
    '- 一\n  - ',
    '#'.repeat(10),
    '```',
    '~~',
    '> ',
    'x'.repeat(20000),
    '![',
  ]) {
    let threw = false;
    try {
      renderMarkdown(bad);
    } catch {
      threw = true;
    }
    eq(threw, false, `半截语法不抛错：${JSON.stringify(bad).slice(0, 24)}`);
  }

  // 没做的语法至少还看得见原文
  eq(
    textOf(renderMarkdown('这里有脚注[^1]\n\n[^1]: 脚注内容')).includes('脚注内容'),
    true,
    '没做的语法内容不丢',
  );
}

// 9.8 落盘与上下文只走原文 markdown（第 0 节那条硬规则的守卫）

fresh();
{
  const config = useAiConfigStore();
  const configId = config.addConfig({ name: '测试配置' });
  seedKey(configId, 'sk-test-1234567890');
  await config.refreshKeyStatus();

  const chat = useAiChatStore();
  await chat.ensureLoaded();
  chat.newConversation();
  void chat.send('给我一段 markdown');
  await sleep(0);

  const requestId = chatCalls[0].request.requestId;
  const deltas = ['## 小标题\n\n', '- 甲\n- 乙\n\n', '```ts\nconst a = 1;\n```\n'];
  for (const delta of deltas) emitStream({ requestId, type: 'text', delta });
  const raw = deltas.join('');
  chatCalls[0].resolve({
    text: raw,
    reasoning: '',
    finishReason: 'stop',
    canceled: false,
    warnings: [],
  });
  await sleep(0);

  const assistant = chat.activeConversation?.messages[1];
  eq(assistant?.text, raw, '消息里存的就是分片拼起来的原文（一个字不差）');
  eq('nodes' in (assistant ?? {}), false, 'AiMessage 上没多出渲染字段');

  // 写盘：节点树的指纹是 "tag"，落盘的 JSON 里一个都不许有
  await sleep(600);
  const written = savedConversations[savedConversations.length - 1];
  const json = JSON.stringify(written);
  eq(json.includes('"tag"'), false, '落盘的 JSON 里没有节点树（搜不到 "tag"）');
  eq(json.includes('## 小标题'), true, '落盘的 JSON 里是原文 markdown');
  eq(
    written?.[0]?.messages?.[1]?.text,
    raw,
    '落盘的消息正文与喂进去的 delta 拼接逐字相等（省 token 靠这条）',
  );

  // 下一轮上下文同样只发原文
  void chat.send('接着说');
  await sleep(0);
  const history = chatCalls[1].request.messages;
  eq(history[1]?.text, raw, '下一轮 history 里带的是原文 markdown，不是渲染结果');
  eq(JSON.stringify(history).includes('"tag"'), false, 'history 里没有节点树');
  eq(chatCalls[1].cloneOk, true, '带 markdown 的请求体仍是纯对象');
  chatCalls[1].resolve({
    text: 'ok',
    reasoning: '',
    finishReason: 'stop',
    canceled: false,
    warnings: [],
  });
  await sleep(0);
}

/* --------------------------------- 汇总 --------------------------------- */

// 防抖写盘的计时器可能还排着，等它们烧完再汇总，免得干扰 exit code
await sleep(650);
void writeCounts;

console.log(`\n渲染进程桩测：${passed} 条通过，${failures.length} 条失败`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length > 0) process.exit(1);
