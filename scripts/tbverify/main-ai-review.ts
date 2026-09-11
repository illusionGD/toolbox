/**
 * 主进程侧桩测入口：`describeWarning` 的文本 / `copyKey` 的行为 /
 * AI 窗口的位置尺寸数学 / `ai:chat` 按发送方推流与发送方销毁时取消 /
 * 工具的注册与包装 + 确认往返（23b）。
 *
 * 生产代码逐字保留，只桩 `electron`（`app.getPath` + safeStorage 的 AES 替身 +
 * 记录 handler 的 `ipcMain`）。
 * 上一轮这里漏掉的正是「断言 warning 的文本」——只断言了「有没有 warning」，
 * 于是 `describeWarning` 匹配错字段这件事一路漏到了界面上。
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { ToolSet } from 'ai';
import { AI_CHANNELS } from '../../electron/shared/channels';
import {
  AI_PANEL_MIN_HEIGHT,
  AI_PANEL_MIN_WIDTH,
  clampPanelBounds,
  defaultPanelBounds,
  parsePanelBounds,
} from '../../electron/shared/aiPanel';
import {
  PET_EDGE_GAP,
  PET_MENU_CHROME,
  PET_MENU_HEIGHT,
  PET_MENU_ITEM_COUNT,
  PET_MENU_ITEM_HEIGHT,
  PET_MENU_SIZE_ROW,
  PET_MENU_WIDTH,
  PET_SIZE_MAX,
  PET_SIZE_MIN,
  PET_TOPMOST_REASSERT_MS,
  PET_VISIBLE,
  clampPetBounds,
  clampPetSize,
  defaultPetBounds,
  dragPetBounds,
  parsePetBounds,
  petMenuBounds,
  petWindowSize,
} from '../../electron/shared/petWindow';
import {
  PET_MS_MAX,
  PET_MS_MIN,
  type PetConfig,
  type PetState,
  nextIdleLoopIndex,
  nextPetState,
  normalizePetConfig,
  resolvePetVisual,
} from '../../electron/shared/pet';
import {
  APP_CLOSE_ACTIONS,
  APP_CLOSE_ACTION_DEFAULT,
  normalizeCloseAction,
} from '../../electron/shared/appWindow';
import { cancelChat, describeWarning, runChat } from '../../electron/main/ai/chat';
import {
  buildTools,
  denyPending,
  replyConfirm,
  requestConfirm,
  trackTask,
} from '../../electron/main/ai/tools';
import { TOOLS } from '../../electron/main/ai/tools/registry';
import { runFfmpeg } from '../../electron/main/ffmpeg/run';
import {
  clearAllKeys,
  copyKey,
  deleteKey,
  getKey,
  listKeyStatus,
  setKey,
} from '../../electron/main/ai/keys';
import { registerAiIpc } from '../../electron/main/ipc/ai';
import type {
  AiChatRequest,
  AiConfig,
  AiToolCall,
  AiToolMode,
  IpcResponse,
} from '../../electron/shared/types';
import { invokeIpc, registeredChannels, setEncryptionAvailable } from './stub-electron';

let passed = 0;
const failures: string[] = [];

/**
 * 断言相等。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 断言说明。
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
 * 断言深相等（矩形对象）。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 说明。
 */
function deepEq(actual: unknown, expected: unknown, label: string): void {
  eq(JSON.stringify(actual), JSON.stringify(expected), label);
}

/* ------------------ describeWarning：三种真实形状 × 认得出/认不出 × 有无 details ------------------ */

// 截图里那条：认得出 feature，details 说的是同一件事，中文句已经说完，不再括号一遍
eq(
  describeWarning({
    type: 'unsupported',
    feature: 'temperature',
    details: 'temperature is not supported by claude-opus-4-8 and will be ignored',
  }),
  '该模型不支持采样温度，已忽略',
  'unsupported + 认得出 feature + 有 details：只出中文句，不带 details',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'temperature' }),
  '该模型不支持采样温度，已忽略',
  'unsupported + 认得出 feature + 无 details',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'tools' }),
  '该模型不支持工具调用，已忽略',
  'unsupported + tools → 工具调用',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'someNewKnob', details: 'not supported here' }),
  '该模型不支持someNewKnob，已忽略（not supported here）',
  'unsupported + 认不出 feature + 有 details：必须带上 details，否则信息全丢',
);
eq(
  describeWarning({ type: 'unsupported', feature: 'someNewKnob' }),
  '该模型不支持someNewKnob，已忽略',
  'unsupported + 认不出 feature + 无 details',
);
eq(
  describeWarning({ type: 'compatibility', feature: 'responseFormat' }),
  '以兼容模式使用结构化输出，结果可能不理想',
  'compatibility + 认得出 feature',
);
eq(
  describeWarning({ type: 'compatibility', feature: 'weirdThing', details: 'emulated' }),
  '以兼容模式使用weirdThing，结果可能不理想（emulated）',
  'compatibility + 认不出 feature + 有 details',
);
eq(
  describeWarning({ type: 'other', message: '这台机器上的时钟不对' }),
  '这台机器上的时钟不对',
  'other：原文照出',
);

// 形状再变时不能静默丢：兜底仍是 JSON，丑但不丢信息
eq(
  describeWarning({ type: 'brand-new-shape', payload: 1 }),
  '{"type":"brand-new-shape","payload":1}',
  '认不出的形状 → JSON 兜底',
);
eq(describeWarning(null), 'null', 'null → JSON 兜底不抛');
// 上一轮写错的那两个名字现在必须走兜底（回归：确认不是把错的改成另一个错的）
eq(
  describeWarning({ type: 'unsupported-setting', setting: 'temperature' }),
  '{"type":"unsupported-setting","setting":"temperature"}',
  'SDK 里不存在的 unsupported-setting 不该被特殊对待',
);

/* --------------------------------- copyKey --------------------------------- */

clearAllKeys();
setEncryptionAvailable(true);

setKey('src', 'sk-source-1234567890');
const copied = copyKey('src', 'dst');
eq(copied.configId, 'dst', 'copyKey 回的是目标配置 id');
eq(copied.hasKey, true, 'copyKey 后目标有 key');
eq(copied.encrypted, true, 'safeStorage 可用时目标是加密的');
eq(getKey('dst'), 'sk-source-1234567890', 'copyKey 后目标的明文与源一致');
eq(getKey('src'), 'sk-source-1234567890', 'copyKey 不动源');
eq(copied.hint, listKeyStatus(['src'])[0].hint, 'copyKey 后掩码提示与源相同');

// 源没有 key：不许把目标已有的抹掉
setKey('dst2', 'sk-target-abcdefghij');
const noSource = copyKey('missing', 'dst2');
eq(noSource.hasKey, true, '源没 key 时目标原有的 key 还在');
eq(getKey('dst2'), 'sk-target-abcdefghij', '源没 key 时目标明文没被清掉');

// 源没 key 且目标也没 key
const bothEmpty = copyKey('missing', 'dst3');
eq(bothEmpty.hasKey, false, '源与目标都没 key 时回 hasKey:false');
eq(bothEmpty.hint, '', '没 key 时掩码为空串');

// 目标已有 key：覆盖
setKey('dst4', 'sk-old-0000000000');
copyKey('src', 'dst4');
eq(getKey('dst4'), 'sk-source-1234567890', '目标已有 key 时被源覆盖');

// safeStorage 不可用：不许假装加密
setEncryptionAvailable(false);
const plain = copyKey('src', 'dst5');
eq(plain.hasKey, true, 'safeStorage 不可用时仍然复制得动');
eq(plain.encrypted, false, 'safeStorage 不可用时 encrypted:false，不许假装加密');
eq(getKey('dst5'), 'sk-source-1234567890', '降级明文也读得回来');
setEncryptionAvailable(true);

// 删掉源之后目标不受影响（两条独立记录，不是引用）
deleteKey('src');
eq(getKey('dst'), 'sk-source-1234567890', '删源不影响已复制出去的目标');

clearAllKeys();

/* ------------------------- AI 窗口的位置尺寸数学 ------------------------- */

/** 主显示器的工作区（1080p 减去任务栏）。 */
const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
/** 副屏在主屏左边（负坐标），这是最容易算错的一种摆法。 */
const leftScreen = { x: -1920, y: 0, width: 1920, height: 1080 };

// 默认位置：贴主窗口右侧、宽 380、高度基本与主窗口一致（顶栏 48 + 8 起算）
deepEq(
  defaultPanelBounds({ x: 400, y: 100, width: 1120, height: 720 }, workArea),
  { x: 400 + 1120 - 380 - 12, y: 100 + 56, width: 380, height: 720 - 56 - 12 },
  '默认位置：贴主窗口右侧、宽 380、从标题栏下方起、高度到底部留白',
);

// 主窗口在负坐标的副屏上：窗口要跟去那块屏，不能被拉回主屏
const onLeft = defaultPanelBounds({ x: -1500, y: 80, width: 1120, height: 720 }, leftScreen);
eq(onLeft.x, -1500 + 1120 - 380 - 12, '主窗口在负坐标副屏时，AI 窗口跟着算在那块屏上');
eq(onLeft.x < 0, true, '负坐标副屏上的 x 保持为负（没被夹回主屏）');

// 工作区比默认宽度还窄：宽度退到最小值而不是算出负数
const narrow = defaultPanelBounds(
  { x: 0, y: 0, width: 300, height: 400 },
  { x: 0, y: 0, width: 300, height: 400 },
);
eq(narrow.width, AI_PANEL_MIN_WIDTH, '工作区比默认宽度还窄时，宽度退到最小宽');
eq(narrow.height, AI_PANEL_MIN_HEIGHT, '工作区比最小高度还矮时，高度退到最小高');

// 夹紧：小于最小尺寸
deepEq(
  clampPanelBounds({ x: 100, y: 100, width: 10, height: 10 }, workArea),
  { x: 100, y: 100, width: AI_PANEL_MIN_WIDTH, height: AI_PANEL_MIN_HEIGHT },
  '尺寸小于 min 320×360 时被顶回最小值',
);

// 夹紧：不许比工作区还大（否则底部输入框会被挤到屏幕外）
deepEq(
  clampPanelBounds({ x: 0, y: 0, width: 5000, height: 5000 }, workArea),
  { x: 0, y: 0, width: 1920, height: 1040 },
  '尺寸大于工作区时被压到工作区大小',
);

// 夹紧：四个方向都至少留 120×60 在工作区内
eq(
  clampPanelBounds({ x: 9999, y: 200, width: 380, height: 400 }, workArea).x,
  1920 - 120,
  '往右出界时至少留 120px 宽在工作区内',
);
eq(
  clampPanelBounds({ x: -9999, y: 200, width: 380, height: 400 }, workArea).x,
  120 - 380,
  '往左出界时至少留 120px 宽在工作区内',
);
eq(
  clampPanelBounds({ x: 10, y: -9999, width: 380, height: 400 }, workArea).y,
  0,
  'y 不许小于工作区上边（顶栏是唯一的拖拽把手，滑上去就再也拖不回来）',
);
eq(
  clampPanelBounds({ x: 10, y: 9999, width: 380, height: 400 }, workArea).y,
  1040 - 60,
  '往下出界时至少留 60px 高在工作区内',
);

// 夹紧要认工作区的原点：副屏在负坐标时不能拿 0 当左边界
const backFromUnplugged = clampPanelBounds({ x: 500, y: 200, width: 380, height: 400 }, leftScreen);
eq(backFromUnplugged.x, -1920 + 1920 - 120, '目标屏在负坐标时，右边界按该屏的 x + width 算');

// 存下来的坏值：一律当没存过（`setBounds` 吃到 NaN 会抛，窗口根本开不出来）
eq(parsePanelBounds(undefined), undefined, 'undefined → 当没存过');
eq(parsePanelBounds(null), undefined, 'null → 当没存过');
eq(parsePanelBounds('380x652'), undefined, '字符串 → 当没存过');
eq(parsePanelBounds({ x: 0, y: 0, width: 380 }), undefined, '缺 height → 当没存过');
eq(parsePanelBounds({ x: NaN, y: 0, width: 380, height: 400 }), undefined, 'NaN → 当没存过');
eq(
  parsePanelBounds({ x: Infinity, y: 0, width: 380, height: 400 }),
  undefined,
  'Infinity → 当没存过',
);
eq(
  parsePanelBounds({ x: '10', y: 0, width: 380, height: 400 }),
  undefined,
  '字符串数字 → 当没存过（不做隐式转换）',
);
deepEq(
  parsePanelBounds({ x: 10, y: 20, width: 380, height: 400, extra: 'x' }),
  { x: 10, y: 20, width: 380, height: 400 },
  '合法值只取四个字段，回的是纯对象副本',
);

/* ---------------- ai:chat 按发送方推流 + 发送方销毁时取消 ---------------- */

registerAiIpc();

const channels = registeredChannels();
for (const channel of [
  AI_CHANNELS.openWindow,
  AI_CHANNELS.setWindowTop,
  AI_CHANNELS.minimizeWindow,
  AI_CHANNELS.openSettings,
  AI_CHANNELS.chat,
  AI_CHANNELS.toolReply,
]) {
  eq(channels.includes(channel), true, `通道已注册：${channel}`);
}
// navigateSettings 是主 → 渲染的推送，不该占一个 invoke handler
eq(
  channels.includes(AI_CHANNELS.navigateSettings),
  false,
  'navigateSettings 是推送通道，不注册 invoke handler',
);

// 最小化必须**有一条自己的通道**：DOM 的 window 没有 minimize，而 window.api.window.*
// 闭包的是主窗口，在 AI 窗口里调它会把主窗口收起来。窗口没开时是 false 而不是抛错
// （桩里 panel 恒为 null，走的就是这条分支）。
// **invokeIpc 要包一层 try**：通道没注册它是直接抛，裸脚本没有测试框架兜底，一抛就是
// 整个套件挂死、一条失败名都不打（[[ai-chat]] 记过这条），包起来才变成一条红断言。
{
  let response: IpcResponse<boolean>;
  try {
    response = (await invokeIpc(AI_CHANNELS.minimizeWindow, {})) as IpcResponse<boolean>;
  } catch (error) {
    response = { code: -1, data: null, message: error instanceof Error ? error.message : '' };
  }
  eq(response.code, 0, '最小化：窗口没开也回成功码，不抛错');
  eq(response.data, false, '最小化：窗口没开时回 false');
}

/** 一个假的 webContents，记下收到的分片与注册的一次性监听。 */
interface FakeSender {
  /** 收到的 `(channel, payload)`。 */
  sent: { channel: string; payload: unknown }[];
  /** 一次性监听：事件名 → 回调。 */
  once: (event: string, listener: () => void) => void;
  /** 触发已注册的一次性监听。 */
  fire: (event: string) => boolean;
  /** 是否已销毁。 */
  isDestroyed: () => boolean;
  /** 推一条消息。 */
  send: (channel: string, payload: unknown) => void;
}

/**
 * 造一个假 sender。
 * @returns 假 sender。
 */
function fakeSender(): FakeSender {
  const listeners = new Map<string, () => void>();
  const sent: { channel: string; payload: unknown }[] = [];
  return {
    sent,
    once: (event, listener) => void listeners.set(event, listener),
    fire: (event) => {
      const listener = listeners.get(event);
      if (!listener) return false;
      listener();
      return true;
    },
    isDestroyed: () => false,
    send: (channel, payload) => void sent.push({ channel, payload }),
  };
}

setKey('cfg-stream', 'sk-stream-1234567890');

/** 指向本机 1 端口：秒级拒绝连接，不出网也不依赖任何真 key。 */
const refusedConfig: AiConfig = {
  id: 'cfg-stream',
  name: '连不上的配置',
  provider: 'openai-compat',
  model: 'whatever',
  baseUrl: 'http://127.0.0.1:1/v1',
  systemPrompt: '',
  temperature: 0.7,
  maxOutputTokens: 128,
  createdAt: 0,
};

{
  const sender = fakeSender();
  const bystander = fakeSender();
  const request: AiChatRequest = {
    requestId: 'req-stream',
    config: refusedConfig,
    messages: [{ role: 'user', text: '你好' }],
    // 这一组测的是错误分片，不需要工具声明跟着下发
    toolMode: 'off',
  };
  const response = (await invokeIpc(AI_CHANNELS.chat, { sender }, request)) as IpcResponse<unknown>;

  eq(response.code, 1, '连不上时 ai:chat 回错误码');
  // 这一条就是「分片必须按 event.sender 推」：以前推给注册时闭包的那个窗口，
  // 对话搬进独立的 AI 窗口后一个分片都收不到
  const streamed = sender.sent.filter((s) => s.channel === AI_CHANNELS.chatStream);
  eq(streamed.length > 0, true, '分片推给了发起这次对话的那个 sender');
  eq(
    streamed.some((s) => (s.payload as { type?: string }).type === 'error'),
    true,
    '推过去的分片里有 error',
  );
  eq(
    (streamed[0]?.payload as { requestId?: string } | undefined)?.requestId,
    'req-stream',
    '分片带着本次的 requestId',
  );
  eq(bystander.sent.length, 0, '没发起对话的其他窗口一条都收不到');
}

/**
 * 一个永远不返回、只在 abort 时 reject 的 fetch。
 *
 * `signal.aborted` 那条分支不能省：取消可能发生在 fetch 还没被调用之前，那时 `abort`
 * 事件早已过去，只挂监听就会永远挂住（桩测直接超时，看不出是哪儿的问题）。
 * @param _input 请求。
 * @param init 请求选项（要用它的 signal）。
 * @returns 永不 resolve、只会因 abort 而 reject 的 promise。
 */
const hangingFetch = ((_input: unknown, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    /**
     * 抛一个 AbortError。
     */
    const bail = (): void => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init?.signal?.aborted) {
      bail();
      return;
    }
    init?.signal?.addEventListener('abort', bail);
  })) as unknown as typeof globalThis.fetch;

/**
 * 起一个挂住不返回的请求。
 * @param requestId 请求 id。
 * @returns runChat 的 promise。
 */
function startHanging(requestId: string): Promise<{ canceled: boolean }> {
  return runChat(
    { requestId, config: refusedConfig, messages: [{ role: 'user', text: 'hi' }], toolMode: 'off' },
    'sk-stream-1234567890',
    () => {},
    hangingFetch,
  );
}

/**
 * 等一个 promise 落定，但**最多等 1 秒**。
 *
 * 不设上限的话，「取消那条线断了」的表现是整个桩测挂死在 top-level await
 * 上（node 只会打一句 unsettled await 警告），看不出是哪条断言坏了。
 * 工具确认也共用它：`denyPending` 漏了同样是挂死而不是报错。
 * @param promise 要等的 promise。
 * @returns 落定了就回结果，超时回 `'timeout'`。
 */
async function settledWithin<T>(promise: Promise<T>): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), 1000);
  });
  const result = await Promise.race([promise, timeout]);
  clearTimeout(timer);
  // 超时的那条 promise 还挂着，得让它有人接，否则是未处理拒绝
  void promise.catch(() => {});
  return result;
}

{
  // 对照组：一个没有窗口销毁的进行中请求本来就取消得动。
  // 没有这一组，下面那条「cancelChat 回 false」是废断言——请求压根没注册时也回 false。
  const control = startHanging('req-control');
  eq(cancelChat('req-control'), true, '进行中的请求取消得动（对照组）');
  const settled = await settledWithin(control);
  eq(settled !== 'timeout' && settled.canceled, true, '对照组：取消后 canceled 为 true');
  eq(cancelChat('req-control'), false, '已取消的请求不在进行中列表里（对照组）');
}

{
  // 真起一个挂住的请求，再让 IPC handler 注册的 destroyed 监听去取消它——
  // 只断言「监听装上了」证明不了它真的会取消，必须让它作用在一个在跑的请求上
  const inflight = startHanging('req-destroy');

  const sender = fakeSender();
  // 同一个 requestId 再 invoke 一次：runChat 会以「已在进行中」失败，但 handler 在调它
  // **之前**就把 destroyed 监听装上了，正好用来验证那条线
  const response = (await invokeIpc(
    AI_CHANNELS.chat,
    { sender },
    { requestId: 'req-destroy', config: refusedConfig, messages: [], toolMode: 'off' },
  )) as IpcResponse<unknown>;
  eq(response.code, 1, '同一 requestId 重复发起被拒');

  eq(sender.fire('destroyed'), true, 'handler 给 sender 装了 destroyed 一次性监听');
  const result = await settledWithin(inflight);
  eq(
    result !== 'timeout' && result.canceled,
    true,
    'sender 销毁 → 进行中的请求被取消（不再替没人接收的流烧 token）',
  );
  eq(cancelChat('req-destroy'), false, '取消过的请求已从进行中列表里摘掉');
}

/* --------------------- 工具的注册与包装（23b） --------------------- */

/** 一次 buildTools 的上下文 + 它 emit 出来的记录。 */
interface ToolProbe {
  /** 建好的工具集（`off` 时为 undefined）。 */
  tools: ToolSet | undefined;
  /** emit 出来的完整记录，按到达顺序。 */
  emitted: AiToolCall[];
  /** 登记过的 ffmpeg taskId。 */
  tracked: string[];
  /** 是否每条记录都过得了 structuredClone。 */
  cloneOk: () => boolean;
}

/**
 * 按某个模式建一套工具，并把 emit 出来的记录收下来。
 * @param mode 审批策略。
 * @param requestId 请求 id。
 * @returns 探针。
 */
function probeTools(mode: AiToolMode, requestId = `req-${mode}`): ToolProbe {
  const emitted: AiToolCall[] = [];
  const tracked: string[] = [];
  let cloneOk = true;
  const tools = buildTools({
    requestId,
    mode,
    emit: (call) => {
      // 记录要跨 IPC 推给渲染进程：不是纯对象的话运行期抛 DataCloneError，
      // 而 typecheck 和 build 都发现不了（本仓库踩过五次）
      try {
        structuredClone(call);
      } catch {
        cloneOk = false;
      }
      emitted.push(call);
    },
    trackTask: (taskId) => void tracked.push(taskId),
  });
  return { tools, emitted, tracked, cloneOk: () => cloneOk };
}

/**
 * 像 SDK 那样调一个工具的 `execute`。
 *
 * **抛出来的会被接住换成 `{ threw: 原因 }`**：包装层的硬约束就是「拒绝与失败都 return
 * 不 throw」，而裸 await 一个会抛的 promise 只会让整个桩测进程当场死掉——退出码是红的，
 * 但一条断言名都不打，跟 `settledWithin` 兜挂死是同一个理由。
 * @param tools 工具集。
 * @param name 工具名。
 * @param input 入参。
 * @returns 回给模型的值；`execute` 抛了的话是 `{ threw: 原因 }`。
 */
async function callTool(
  tools: ToolSet | undefined,
  name: string,
  input: unknown,
): Promise<unknown> {
  const entry = tools?.[name] as
    { execute?: (input: unknown, options: unknown) => Promise<unknown> } | undefined;
  if (!entry?.execute) throw new Error(`工具未注册：${name}`);
  try {
    // 第二个参数实测有 toolCallId / messages / abortSignal / experimental_context，
    // 我们的包装一个都不用，给足前两个就行
    return await entry.execute(input, { toolCallId: 'tc-1', messages: [] });
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 取最后一条 emit 出来的记录。
 * @param probe 探针。
 * @returns 记录；一条都没有时 undefined。
 */
function lastCall(probe: ToolProbe): AiToolCall | undefined {
  return probe.emitted[probe.emitted.length - 1];
}

/** 本组用的临时目录。 */
const toolDir = mkdtempSync(joinPath(tmpdir(), 'tbverify-tools-'));

eq(
  probeTools('off').tools,
  undefined,
  'toolMode 为 off 时 buildTools 回 undefined（压根不下发 tools）',
);

{
  const names = TOOLS.map((t) => t.name);
  eq(names.length, 13, '工具总数 13 个');
  eq(TOOLS.filter((t) => t.kind === 'read').length, 8, '只读工具 8 个');
  eq(TOOLS.filter((t) => t.kind === 'write').length, 5, '写盘工具 5 个');
  eq(new Set(names).size, names.length, '工具名不重复（重名会被后者顶掉，静默少一个能力）');
  deepEq(
    [...names].sort(),
    [
      'compress_images',
      'convert_audio',
      'convert_video',
      'list_files',
      'probe_audio',
      'probe_excel',
      'probe_font',
      'probe_image',
      'probe_video',
      'read_text_file',
      'rename_files',
      'storage_info',
      'write_text_file',
    ],
    '工具清单与约定的 8 读 + 5 写完全一致',
  );
  // 硬规则：没有删除、没有 shell、没有网络抓取。加工具时手滑最容易破的就是这条
  eq(
    names.some((n) => /delete|remove|shell|exec|spawn|fetch|http|download/i.test(n)),
    false,
    '工具名里没有删除 / shell / 网络抓取这类能力',
  );

  const ask = probeTools('ask');
  eq(Object.keys(ask.tools ?? {}).length, 13, 'ask 模式下 13 个工具都注册给了 SDK');
  eq(
    names.every((n) => typeof (ask.tools?.[n] as { execute?: unknown })?.execute === 'function'),
    true,
    '每个工具都有 execute',
  );
  eq(
    typeof (ask.tools?.list_files as { inputSchema?: unknown })?.inputSchema,
    'object',
    '工具带着 inputSchema 下发（SDK 靠它翻成各家的 JSON Schema）',
  );
}

// 只读工具：不确认、直接跑；返回值必须封顶
{
  const listDir = mkdtempSync(joinPath(tmpdir(), 'tbverify-list-'));
  for (let i = 0; i < 500; i += 1) writeFileSync(joinPath(listDir, `f${i}.txt`), 'x');

  const probe = probeTools('ask', 'req-read');
  const result = (await callTool(probe.tools, 'list_files', { dir: listDir })) as {
    total: number;
    listed: number;
    truncated: boolean;
    entries: { path: string; size: number; ext: string }[];
  };

  eq(probe.emitted[0]?.status, 'running', '只读工具第一条事件就是 running（没有 pending）');
  eq(
    probe.emitted.some((c) => c.status === 'pending'),
    false,
    '只读工具在 ask 模式下也不弹确认',
  );
  eq(lastCall(probe)?.status, 'done', '只读工具跑完是 done');
  eq(lastCall(probe)?.kind, 'read', '记录里带着 kind:read');
  eq(typeof lastCall(probe)?.elapsed, 'number', 'done 的记录带上了耗时');
  eq(probe.cloneOk(), true, 'emit 出去的记录都是纯对象（structuredClone 过得去）');
  eq(new Set(probe.emitted.map((c) => c.callId)).size, 1, '一次调用只用一个 callId');

  eq(result.total, 500, 'total 是真实总数');
  eq(result.entries.length, 200, `500 个文件只回 200 条（返回值就是 token，必须封顶）`);
  eq(result.listed, 200, 'listed 与实际条数一致');
  eq(result.truncated, true, '截断了就如实置 truncated');
  eq(result.entries[0]?.path.startsWith(listDir), true, '条目给的是绝对路径（模型下一步要用它）');
  eq(result.entries[0]?.ext, 'txt', '条目带扩展名');
  eq('files' in result, false, '不把 ScanResult.files 原样回给模型');
}

// 只读工具出错：也是 return { error }，不抛
{
  const probe = probeTools('ask', 'req-read-error');
  const result = (await callTool(probe.tools, 'probe_image', {
    path: joinPath(toolDir, '不存在.png'),
  })) as { error?: string };
  eq(typeof result.error, 'string', '读工具失败时 resolve 出 { error }，不 reject');
  eq(lastCall(probe)?.status, 'error', '失败的记录是 error 状态');
  eq(lastCall(probe)?.result, result.error, '卡片上的原因就是回给模型的那句');
}

// 写盘工具 + ask：先 pending，等回答才动手
{
  const probe = probeTools('ask', 'req-write-ask');
  const target = joinPath(toolDir, 'ask-approved.txt');
  const pending = callTool(probe.tools, 'write_text_file', { path: target, content: '同意后写入' });
  await new Promise((resolve) => setTimeout(resolve, 20));

  eq(probe.emitted.length, 1, 'ask 模式下写工具先只发一条 pending');
  eq(probe.emitted[0]?.status, 'pending', '第一条事件是 pending');
  eq(probe.emitted[0]?.kind, 'write', '记录里带着 kind:write');
  eq(
    probe.emitted[0]?.summary.includes('ask-approved.txt'),
    true,
    'pending 卡片上的摘要说得出动的是哪个文件',
  );
  eq(
    await readFile(target, 'utf-8').then(
      () => true,
      () => false,
    ),
    false,
    '没回答之前不许动盘',
  );

  const callId = probe.emitted[0]?.callId ?? '';
  eq(replyConfirm(callId, true), true, 'replyConfirm 找到了这条等待中的确认');
  const result = (await settledWithin(pending)) as { path?: string } | 'timeout';
  eq(result !== 'timeout', true, '回答之后 execute 落定（不挂死）');
  eq(await readFile(target, 'utf-8'), '同意后写入', '允许之后文件真的写进去了');
  eq(lastCall(probe)?.status, 'done', '允许后的终态是 done');
  eq(replyConfirm(callId, true), false, '同一条确认回答第二次回 false');
}

// 写盘工具 + 拒绝：resolve 出 { denied:true }，不 reject，也不动盘
{
  const probe = probeTools('ask', 'req-write-deny');
  const target = joinPath(toolDir, 'denied.txt');
  const pendingCall = callTool(probe.tools, 'write_text_file', { path: target, content: '不该写' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(replyConfirm(probe.emitted[0]?.callId ?? '', false), true, '拒绝也走 replyConfirm');

  const settled = await settledWithin(pendingCall);
  const denied = settled as { denied?: boolean; message?: string };
  eq(settled !== 'timeout', true, '拒绝后 execute 也落定');
  eq(denied.denied, true, '拒绝是 resolve 出 { denied:true }，不是 reject（否则整条消息报错）');
  eq(typeof denied.message, 'string', '连一句给模型看的中文一起回（让它改口径问用户）');
  eq(
    await readFile(target, 'utf-8').then(
      () => true,
      () => false,
    ),
    false,
    '拒绝后一个字节都没写',
  );
  eq(lastCall(probe)?.status, 'denied', '拒绝后的终态是 denied');
  eq(lastCall(probe)?.result, '已拒绝', '卡片上写着已拒绝');
}

// auto + 不覆盖：直接跑
{
  const probe = probeTools('auto', 'req-auto');
  const target = joinPath(toolDir, 'auto.txt');
  const result = (await callTool(probe.tools, 'write_text_file', {
    path: target,
    content: 'auto',
  })) as { path?: string };
  eq(result.path, target, 'auto 模式下写工具直接跑完');
  eq(
    probe.emitted.some((c) => c.status === 'pending'),
    false,
    'auto 模式下不覆盖原文件就不问',
  );
  eq(probe.emitted[0]?.status, 'running', 'auto 模式下第一条事件就是 running');
}

// auto + overwrite:true：**仍然确认**（不可逆的数据丢失，而模型是会被文件内容带偏的）
{
  const probe = probeTools('auto', 'req-auto-overwrite');
  const target = joinPath(toolDir, 'auto.txt');
  const pendingCall = callTool(probe.tools, 'write_text_file', {
    path: target,
    content: '覆盖内容',
    overwrite: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(probe.emitted[0]?.status, 'pending', 'auto 模式 + overwrite 仍然发 pending');

  eq(replyConfirm(probe.emitted[0]?.callId ?? '', true), true, '这条确认真的在等回答');
  await settledWithin(pendingCall);
  eq(await readFile(target, 'utf-8'), '覆盖内容', '确认之后才覆盖');
}

// rename_files 的 forceConfirm 恒为 true：改名是原地改动，任何模式都问
{
  const probe = probeTools('auto', 'req-auto-rename');
  const source = joinPath(toolDir, 'rename-me.txt');
  writeFileSync(source, 'x');
  const pendingCall = callTool(probe.tools, 'rename_files', {
    renames: [{ path: source, newName: 'renamed.txt' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  eq(probe.emitted[0]?.status, 'pending', 'auto 模式下 rename_files 也要确认');
  replyConfirm(probe.emitted[0]?.callId ?? '', false);
  await settledWithin(pendingCall);
  eq(
    await readFile(source, 'utf-8').then(
      () => true,
      () => false,
    ),
    true,
    '拒绝改名后原文件还在原处',
  );
}

// 写盘工具出错：resolve 出 { error } 且卡片是 error
{
  const probe = probeTools('auto', 'req-write-error');
  const result = (await callTool(probe.tools, 'write_text_file', {
    path: 'relative/path.txt',
    content: 'x',
  })) as { error?: string };
  eq(result.error, '必须是绝对路径', '底层守卫的中文原因原样回给模型');
  eq(lastCall(probe)?.status, 'error', '失败的记录是 error');
}

/* --------------------------- 确认往返（23b） --------------------------- */

{
  // 对照组：先证明「在等的 callId 回 true」，否则下面那些 false 全是废断言
  const waiting = requestConfirm('req-confirm', 'call-1');
  eq(replyConfirm('call-1', true), true, '在等的 callId → replyConfirm 回 true（对照组）');
  eq(await settledWithin(waiting), true, '回答 true 时 requestConfirm 就 resolve 出 true');
  eq(replyConfirm('call-1', true), false, '同一个 callId 第二次回 false');
  eq(replyConfirm('unknown-call', true), false, '未知 callId 回 false 而不是抛');

  const denied = requestConfirm('req-confirm', 'call-2');
  eq(replyConfirm('call-2', false), true, '拒绝也算回答到了');
  eq(await settledWithin(denied), false, '回答 false 时 resolve 出 false');
}

{
  // denyPending 只判自己那一个请求下的
  const mine = requestConfirm('req-a', 'call-a');
  const others = requestConfirm('req-b', 'call-b');
  eq(denyPending('req-a'), 1, 'denyPending 判掉了本请求下的 1 条');
  eq(await settledWithin(mine), false, '被判掉的确认 resolve 出 false');
  eq(denyPending('req-a'), 0, '同一个请求再判一次是 0 条');
  eq(replyConfirm('call-b', true), true, '别的请求下的确认没被连带判掉');
  await settledWithin(others);
}

{
  // **本轮最容易漏、且漏了不报错只挂死的一条**：cancelChat 必须 denyPending
  const waiting = requestConfirm('req-cancel', 'call-cancel');
  eq(cancelChat('req-cancel'), false, '这个 requestId 没有在跑的请求（只测确认那条线）');
  eq(
    await settledWithin(waiting),
    false,
    'cancelChat 把等着的确认判成拒绝（漏了这条会挂死，不会报错）',
  );
}

{
  // cancelChat 还要杀掉登记过的 ffmpeg 任务：只 abort HTTP 请求的话子进程会转完
  trackTask('req-ff', 'task-ff-killed');
  trackTask('req-ff-other', 'task-ff-alive');
  cancelChat('req-ff');
  // 判据不是「函数被调过」而是行为：被取消过的 taskId 再跑会直接回 canceled，不起进程
  eq(
    (await runFfmpeg(['-version'], { taskId: 'task-ff-killed' })).canceled,
    true,
    'cancelChat 杀掉了本请求登记的 ffmpeg 任务',
  );
  eq(
    (await runFfmpeg(['-version'], { taskId: 'task-ff-alive' })).canceled,
    false,
    '别的请求登记的 ffmpeg 任务没被连带杀掉（对照组）',
  );
}

{
  // ai:toolReply 通道：界面上的「允许 / 拒绝」走它
  const waiting = requestConfirm('req-ipc', 'call-ipc');
  const ok = (await invokeIpc(
    AI_CHANNELS.toolReply,
    { sender: fakeSender() },
    'call-ipc',
    true,
  )) as IpcResponse<boolean>;
  eq(ok.code, 0, 'ai:toolReply 正常返回');
  eq(ok.data, true, '在等的 callId 经通道回 true');
  eq(await settledWithin(waiting), true, '经通道的允许也真的兑现了那个 promise');

  const stale = (await invokeIpc(
    AI_CHANNELS.toolReply,
    { sender: fakeSender() },
    'call-from-disk',
    true,
  )) as IpcResponse<boolean>;
  eq(stale.code, 0, '对着历史记录里的卡片点，通道不报错');
  eq(stale.data, false, '没人在等的 callId 回 false');
}

{
  // 关掉 AI 窗口时也不许留下悬空的确认：ipc 层的 destroyed 监听 → cancelChat → denyPending
  const inflight = startHanging('req-tool-destroy');
  const sender = fakeSender();
  await invokeIpc(
    AI_CHANNELS.chat,
    { sender },
    { requestId: 'req-tool-destroy', config: refusedConfig, messages: [], toolMode: 'ask' },
  );
  const waiting = requestConfirm('req-tool-destroy', 'call-destroy');
  eq(sender.fire('destroyed'), true, 'handler 装上了 destroyed 监听');
  eq(
    await settledWithin(waiting),
    false,
    'AI 窗口被关掉 → 等着的确认判成拒绝（否则 execute 里那个 await 再没人能兑现）',
  );
  await settledWithin(inflight);
}

/* ============================ #26a 桌宠：几何 ============================ */

{
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  // 需求 1「右下角出现桌宠」：贴右下且留 PET_EDGE_GAP
  const home = defaultPetBounds(workArea, 160);
  deepEq(home, { x: 1744, y: 864, width: 160, height: 160 }, '默认位置贴工作区右下角');
  eq(
    workArea.x + workArea.width - (home.x + home.width),
    PET_EDGE_GAP,
    '右边距恰好是 PET_EDGE_GAP',
  );
  eq(
    workArea.y + workArea.height - (home.y + home.height),
    PET_EDGE_GAP,
    '下边距恰好是 PET_EDGE_GAP',
  );

  // 副屏（负坐标）也要贴那块屏自己的右下角，不是主屏的
  const leftScreen = { x: -1920, y: 0, width: 1920, height: 1040 };
  deepEq(
    defaultPetBounds(leftScreen, 160),
    { x: -176, y: 864, width: 160, height: 160 },
    '负坐标副屏上的默认位置按那块屏算',
  );

  eq(clampPetSize(10), PET_SIZE_MIN, '尺寸下越界夹到 PET_SIZE_MIN');
  eq(clampPetSize(9999), PET_SIZE_MAX, '尺寸上越界夹到 PET_SIZE_MAX');
  eq(clampPetSize('160' as unknown), 160, '尺寸是字符串 → 回默认值而不是 NaN');
  eq(clampPetSize(Number.NaN), 160, 'NaN 尺寸 → 回默认值');
  eq(clampPetSize(160.4), 160, '小数尺寸取整');

  // PET_VISIBLE：桌宠没有任务栏图标，整块拖出屏幕就再也点不到
  const outRight = clampPetBounds({ x: 99999, y: 500, width: 160, height: 160 }, workArea);
  eq(outRight.x, workArea.x + workArea.width - PET_VISIBLE, '右侧至少留 PET_VISIBLE 在屏内');
  const outLeft = clampPetBounds({ x: -99999, y: 500, width: 160, height: 160 }, workArea);
  eq(outLeft.x, workArea.x + PET_VISIBLE - 160, '左侧至少留 PET_VISIBLE 在屏内');
  const outBottom = clampPetBounds({ x: 500, y: 99999, width: 160, height: 160 }, workArea);
  eq(
    outBottom.y,
    workArea.y + workArea.height - PET_VISIBLE,
    '下方至少留 PET_VISIBLE 在屏内（这条漏了桌宠就永远拖不回来）',
  );
  const outTop = clampPetBounds({ x: 500, y: -99999, width: 160, height: 160 }, workArea);
  eq(outTop.y, workArea.y + PET_VISIBLE - 160, '上方至少留 PET_VISIBLE 在屏内');

  // 尺寸原样带过：菜单展开时窗口比精灵大，夹尺寸会把菜单裁掉
  const wide = clampPetBounds({ x: 100, y: 100, width: 308, height: 160 }, workArea);
  eq(wide.width, 308, 'clampPetBounds 不改宽（菜单展开时窗口比精灵宽）');
  eq(wide.height, 160, 'clampPetBounds 不改高');

  // 显示器被拔掉：存的位置来自一块已经不在的屏，要能拉回当前工作区
  const backFromUnplugged = clampPetBounds(
    { x: -3000, y: -2000, width: 160, height: 160 },
    workArea,
  );
  eq(
    backFromUnplugged.x >= workArea.x + PET_VISIBLE - 160 &&
      backFromUnplugged.x <= workArea.x + workArea.width - PET_VISIBLE,
    true,
    '旧屏坐标被拉回当前工作区（x）',
  );
  eq(
    backFromUnplugged.y >= workArea.y + PET_VISIBLE - 160 &&
      backFromUnplugged.y <= workArea.y + workArea.height - PET_VISIBLE,
    true,
    '旧屏坐标被拉回当前工作区（y）',
  );

  // 拖拽：绝对计算（起始 bounds + 累计位移），不许增量累加
  const start = { x: 500, y: 500, width: 160, height: 160 };
  deepEq(
    dragPetBounds(start, 77, 55, workArea),
    { x: 577, y: 555, width: 160, height: 160 },
    '拖拽落点 = 起始 + 位移',
  );
  const once = dragPetBounds(start, 77, 55, workArea);
  const twice = dragPetBounds(start, 77, 55, workArea);
  const thrice = dragPetBounds(start, 77, 55, workArea);
  deepEq(
    [once, twice, thrice].map((r) => `${r.x},${r.y}`).join('|'),
    '577,555|577,555|577,555',
    '同一组 (start,dx,dy) 反复算结果恒等（守「绝不增量累加」——setPosition 会回灌 move 事件）',
  );
  deepEq(
    dragPetBounds(start, Number.NaN, 10, workArea),
    { x: 500, y: 510, width: 160, height: 160 },
    'NaN 位移当 0，不把窗口位置污染成 NaN',
  );
  eq(
    dragPetBounds(start, 99999, 0, workArea).x,
    workArea.x + workArea.width - PET_VISIBLE,
    '拖出屏幕时落点仍被夹住',
  );

  // 菜单展开：窗口向左上长，精灵在屏幕上一动不动
  const pet = { x: 1744, y: 864, width: 160, height: 160 };
  const opened = petMenuBounds(pet, 160, true, workArea);
  const closed = petMenuBounds(opened, 160, false, workArea);
  eq(opened.x + opened.width, pet.x + pet.width, '菜单展开后右边缘不动（精灵锚在窗口右下角）');
  eq(opened.y + opened.height, pet.y + pet.height, '菜单展开后下边缘不动');
  eq(opened.width, 160 + PET_MENU_WIDTH, '展开后窗口宽 = 精灵 + 菜单宽');
  deepEq(closed, pet, '收起后逐字回到精灵矩形');
  eq(petMenuBounds(pet, 160, true, workArea).x < pet.x, true, '窗口向左生长（向右会长到屏幕外）');

  // review 往菜单里加了「退出桌宠 / 退出 app」两项、又加了一整块「实时调大小」之后，
  // 高度不再是随便一个常数：算少了会把最下面那项（也就是「退出 app」）裁在窗口边缘外
  eq(
    PET_MENU_HEIGHT >= PET_MENU_ITEM_COUNT * PET_MENU_ITEM_HEIGHT + PET_MENU_SIZE_ROW + 42,
    true,
    '菜单区高度装得下全部菜单项 + 大小那一块 + 容器余量（算少了最下面那项会被窗口边缘裁掉）',
  );
  // 大小块：标题行 16 + 间距 4 + 滑块与输入框那行 26 = 46，量的是 PetMenu.vue 的实际样式。
  // 它**不并进项数**，否则下面那条源码金丝雀（数 ITEMS 有几项）就永远对不上
  eq(PET_MENU_SIZE_ROW >= 46, true, '大小那一块的高装得下标题行与滑块行');
  // 42 = 容器内边距 8 + 边框 2 + 八个子元素间的 7 道 2px 间距 14 + **两条**分隔线
  // （各是 1 + 上下 4 = 9）18。低于这个数就等于「按项数算」也还是不够高
  eq(PET_MENU_CHROME >= 42, true, '容器余量覆盖内边距 + 边框 + 项间距 + 两条分隔线');
  // 精灵比菜单矮的情形（64px 的小桌宠 + 5 项菜单）：高度由菜单决定，
  // 而「精灵在屏幕上一动不动」这条**仍然**要成立——这时窗口是向上长的
  const small = { x: 1840, y: 960, width: 64, height: 64 };
  const smallOpen = petMenuBounds(small, 64, true, workArea);
  eq(smallOpen.height, PET_MENU_HEIGHT, '精灵比菜单矮时窗口高按菜单算');
  eq(smallOpen.x + smallOpen.width, small.x + small.width, '小精灵展开后右边缘不动');
  eq(smallOpen.y + smallOpen.height, small.y + small.height, '小精灵展开后下边缘不动');
  deepEq(petMenuBounds(smallOpen, 64, false, workArea), small, '小精灵收起后逐字回到精灵矩形');

  // petWindowSize：窗口该多大的**唯一**公式。抽出来是因为主进程不能信 getBounds() 的
  // 宽高——探针在本机 scaleFactor=1.25 下量到它会回 161 而不是 160
  deepEq(petWindowSize(160, false), { width: 160, height: 160 }, '收起态窗口就是精灵那么大');
  deepEq(
    petWindowSize(160, true),
    { width: 160 + PET_MENU_WIDTH, height: PET_MENU_HEIGHT },
    '展开态 = 精灵 + 菜单宽，高按菜单算',
  );
  eq(petWindowSize(512, true).height, 512, '精灵比菜单高时窗口高按精灵算');
  deepEq(petWindowSize(9999, false), { width: 512, height: 512 }, '越界尺寸先被夹进合法区间');
  // petMenuBounds 必须**用**这个公式而不是自己再算一遍，否则两处会各自漂移
  const sizeMatch = petMenuBounds(pet, 160, true, workArea);
  deepEq(
    { width: sizeMatch.width, height: sizeMatch.height },
    petWindowSize(160, true),
    'petMenuBounds 的宽高与 petWindowSize 逐字一致（同一个公式，不许各算各的）',
  );

  // 存盘值解析
  eq(parsePetBounds(undefined), undefined, 'undefined 不是合法 bounds');
  eq(parsePetBounds(null), undefined, 'null 不是合法 bounds');
  eq(parsePetBounds('160,160'), undefined, '字符串不是合法 bounds');
  eq(
    parsePetBounds({ x: Number.NaN, y: 0, width: 160, height: 160 }),
    undefined,
    'NaN 一律拒掉（setBounds 收到 NaN 会抛，窗口开不出来）',
  );
  eq(
    parsePetBounds({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 160 }),
    undefined,
    'Infinity 一律拒掉',
  );
  eq(parsePetBounds({ x: 1, y: 2, width: 3 }), undefined, '缺字段一律拒掉');
  deepEq(
    parsePetBounds({ x: 1, y: 2, width: 3, height: 4, junk: 'x' }),
    { x: 1, y: 2, width: 3, height: 4 },
    '合法值只取四个字段（多余的键不带进窗口选项）',
  );
}

/* ================= #26a 桌宠：状态映射（需求 3 的兜底） ================= */

{
  const base = normalizePetConfig({ defaultRef: 'default.png' });
  const allStates: PetState[] = ['idle', 'click', 'drag', 'drop', 'idleLoop'];

  // 全不配 → 五个状态全部回落到 defaultRef（用户原话「没配置的状态同一默认」）
  for (const state of allStates) {
    eq(resolvePetVisual(base, state), 'default.png', `没配 ${state} → 回落到默认资源`);
  }

  // defaultRef 也空 → 全部 null（调用方用 logo，需求 4）
  const empty = normalizePetConfig({});
  for (const state of allStates) {
    eq(resolvePetVisual(empty, state), null, `${state} 无配置且无默认 → null（调用方用 logo）`);
  }

  // 全配 → 各返回自己那条
  const full = normalizePetConfig({
    defaultRef: 'def.png',
    states: {
      idle: 'idle.png',
      click: 'click.png',
      drag: 'drag.png',
      drop: 'drop.png',
      idleLoop: ['a.png', 'b.png', 'c.png'],
    },
  });
  eq(resolvePetVisual(full, 'idle'), 'idle.png', '配了 idle 用 idle');
  eq(resolvePetVisual(full, 'click'), 'click.png', '配了 click 用 click');
  eq(resolvePetVisual(full, 'drag'), 'drag.png', '配了 drag 用 drag');
  eq(resolvePetVisual(full, 'drop'), 'drop.png', '配了 drop 用 drop');

  // 只配一个状态：其余四个仍回落
  const onlyClick = normalizePetConfig({ defaultRef: 'def.png', states: { click: 'click.png' } });
  eq(resolvePetVisual(onlyClick, 'click'), 'click.png', '只配 click：click 用自己的');
  for (const state of ['idle', 'drag', 'drop', 'idleLoop'] as PetState[]) {
    eq(resolvePetVisual(onlyClick, state), 'def.png', `只配 click：${state} 回落到默认`);
  }

  // 待机轮播：N 种依次轮播且到头绕回
  eq(resolvePetVisual(full, 'idleLoop', 0), 'a.png', '轮播下标 0');
  eq(resolvePetVisual(full, 'idleLoop', 1), 'b.png', '轮播下标 1');
  eq(resolvePetVisual(full, 'idleLoop', 2), 'c.png', '轮播下标 2');
  eq(resolvePetVisual(full, 'idleLoop', 3), 'a.png', '轮播下标越界后绕回 0');
  eq(
    [0, 1, 2, 3, 4].map((i) => nextIdleLoopIndex(i, 3)).join(','),
    '1,2,0,1,2',
    'nextIdleLoopIndex 在 3 条时的环绕序列',
  );
  eq(nextIdleLoopIndex(0, 1), 0, '只有一条轮播时下标恒为 0');
  eq(nextIdleLoopIndex(0, 0), 0, '零条轮播不除以 0');
  eq(nextIdleLoopIndex(Number.NaN, 3), 0, 'NaN 下标回 0');

  // 轮播为空 → 回落而不是空串（空串会让 <img src=""> 去请求当前页面）
  const noLoop = normalizePetConfig({ defaultRef: 'def.png', states: { idleLoop: [] } });
  eq(resolvePetVisual(noLoop, 'idleLoop'), 'def.png', '轮播为空数组 → 回落到默认，不是空串');
  eq(resolvePetVisual(noLoop, 'idleLoop', 5), 'def.png', '轮播为空时下标越界也不抛');
}

/* ================= #26a 桌宠：状态机 ================= */

{
  const cfg = normalizePetConfig({
    idleAfterMs: 15000,
    transientMs: 800,
    idleLoopMs: 3000,
  });

  eq(nextPetState('idle', 'click', cfg).state, 'click', 'idle --click--> click');
  eq(nextPetState('idle', 'click', cfg).holdMs, 800, 'click 态存活 transientMs');
  eq(nextPetState('click', 'timeout', cfg).state, 'idle', 'click --timeout--> idle');
  eq(nextPetState('idle', 'dragStart', cfg).state, 'drag', 'idle --dragStart--> drag');
  eq(nextPetState('idle', 'dragStart', cfg).holdMs, null, 'drag 态不自动离开（等松手）');
  eq(nextPetState('drag', 'dragEnd', cfg).state, 'drop', 'drag --dragEnd--> drop');
  eq(nextPetState('drag', 'dragEnd', cfg).holdMs, 800, 'drop 态存活 transientMs');
  eq(nextPetState('drop', 'timeout', cfg).state, 'idle', 'drop --timeout--> idle');
  eq(nextPetState('idle', 'timeout', cfg).holdMs, 15000, 'idle 的 holdMs 是「静置多久进轮播」');

  // 拖着的时候不许自己开始待机轮播
  eq(
    nextPetState('drag', 'idleTick', cfg).state,
    'drag',
    'drag 态下 idleTick 不改状态（手正拖着它）',
  );
  // 任何交互都立刻打断轮播
  eq(nextPetState('idleLoop', 'click', cfg).state, 'click', 'idleLoop 被 click 打断');
  eq(nextPetState('idleLoop', 'dragStart', cfg).state, 'drag', 'idleLoop 被 dragStart 打断');
  eq(nextPetState('idle', 'idleTick', cfg).state, 'idleLoop', 'idle 静置到点进轮播');
  eq(nextPetState('idleLoop', 'idleTick', cfg).state, 'idleLoop', '轮播中的 idleTick 换下一张');
  eq(nextPetState('idleLoop', 'idleTick', cfg).holdMs, 3000, '轮播每张停留 idleLoopMs');
  // 没在拖也收到 dragEnd（pointercancel）时不该凭空冒出一个 drop
  eq(nextPetState('idle', 'dragEnd', cfg).state, 'idle', '没在拖时的 dragEnd 不凭空产生 drop 动画');
  eq(nextPetState('drag', 'click', cfg).state, 'drag', 'drag 中收到 click 也不打断拖拽');
}

/* ================= #26a 桌宠：normalizePetConfig 的健壮性 ================= */

{
  // app-state.json 是用户改得到的纯文本，手改坏一个字段不该让桌宠开不出来
  const dirty: unknown[] = [
    undefined,
    null,
    {},
    [],
    'nonsense',
    42,
    { kind: 'nope', size: 'big', states: [1, 2, 3], defaultRef: 123 },
    { states: { idle: 42, idleLoop: 'not-an-array' } },
    { states: { idleLoop: ['a.png', '', '   ', 'b.png'] } },
    { idleAfterMs: Number.NaN, transientMs: -5, idleLoopMs: 1e12 },
  ];
  for (const value of dirty) {
    let config: PetConfig | null = null;
    let threw = false;
    try {
      config = normalizePetConfig(value);
    } catch {
      threw = true;
    }
    eq(threw, false, `normalizePetConfig(${JSON.stringify(value)}) 不抛`);
    if (!config) continue;
    eq(
      typeof config.kind === 'string' && typeof config.defaultRef === 'string',
      true,
      `normalizePetConfig(${JSON.stringify(value)}) 的字段类型正确`,
    );
    eq(
      Number.isFinite(config.size) &&
        Number.isFinite(config.idleAfterMs) &&
        Number.isFinite(config.transientMs) &&
        Number.isFinite(config.idleLoopMs),
      true,
      `normalizePetConfig(${JSON.stringify(value)}) 的四个数字都是有限数`,
    );
    // 纯对象的判据：本仓库因为 Vue 响应式代理踩过五次「An object could not be cloned」
    let cloneOk = true;
    try {
      structuredClone(config);
    } catch {
      cloneOk = false;
    }
    eq(cloneOk, true, `normalizePetConfig(${JSON.stringify(value)}) 的结果可 structuredClone`);
  }

  const cleaned = normalizePetConfig({ states: { idleLoop: ['a.png', '', '  ', 'b.png'] } });
  deepEq(cleaned.states.idleLoop, ['a.png', 'b.png'], '轮播里的空串被剔掉，不产生空 <img src>');
  eq(normalizePetConfig({ idleAfterMs: -5 }).idleAfterMs, PET_MS_MIN, '负时长夹到下限');
  eq(normalizePetConfig({ idleLoopMs: 1e12 }).idleLoopMs, PET_MS_MAX, '超大时长夹到上限');
  eq(normalizePetConfig({ kind: 'spine' }).kind, 'spine', '认得的 kind 保留（26b 要用）');
  eq(normalizePetConfig({ kind: 'nope' }).kind, 'image', '认不得的 kind 回落到 image');
  eq(
    normalizePetConfig({ defaultRef: '  C:/pet/idle.png  ' }).defaultRef,
    'C:/pet/idle.png',
    'defaultRef 去首尾空白',
  );
  eq(
    normalizePetConfig({ states: { idle: '   ' } }).states.idle,
    undefined,
    '纯空白的状态映射当没配（否则会被当成一条真配置，兜底就失效了）',
  );

  // AI 头像（review 加的）：默认空串 = 用应用 logo，和桌宠自己的资源是两张图
  eq(normalizePetConfig({}).aiAvatarRef, '', '没配 AI 头像时是空串（= 用应用 logo）');
  eq(
    normalizePetConfig({ aiAvatarRef: '  C:/pet/face.png  ' }).aiAvatarRef,
    'C:/pet/face.png',
    'AI 头像路径去首尾空白',
  );
  eq(
    normalizePetConfig({ aiAvatarRef: 42 as unknown }).aiAvatarRef,
    '',
    '类型不对的 AI 头像当没配（而不是让 <img src> 吃到一个数字）',
  );
  eq(
    normalizePetConfig({ aiAvatarRef: 'face.png' }).defaultRef,
    '',
    '配了 AI 头像不会连带把桌宠默认资源也设上（两者刻意分开）',
  );
  eq(
    normalizePetConfig({ defaultRef: 'pet.png' }).aiAvatarRef,
    '',
    '配了桌宠资源也不会顺手把 AI 头像设成同一张',
  );
}

/* ======== #26 桌宠：菜单项数与窗口高度必须同步（review 加两项后的守卫） ======== */

{
  // 这条是**源码级的哨兵**：菜单有几项住在 .vue 里，窗口要放大到多高住在 shared/ 里，
  // 两边对不上时最下面那项会被窗口边缘裁掉，而**跑起来才看得见**（还得刚好翻到最后一项）。
  // 代价是它认字符串，所以只认「ITEMS 数组里有几个 key:」这一件事，别往里加别的模式匹配。
  const source = await readFile('src/components/pet/PetMenu.vue', 'utf-8');
  const block = /const ITEMS[^=]*= \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
  eq(block.length > 0, true, 'PetMenu.vue 里找得到 ITEMS 数组（找不到说明结构变了，哨兵要跟着改）');
  eq(
    (block.match(/\bkey:/g) ?? []).length,
    PET_MENU_ITEM_COUNT,
    'PetMenu.vue 的菜单项数与 PET_MENU_ITEM_COUNT 一致（对不上会裁掉最下面那项）',
  );
  // 两个出口是 review 明确要的（原先菜单里一个出口都没有）
  eq(source.includes('closePetApi'), true, '菜单里有「退出桌宠」这条出口');
  eq(source.includes('petQuitAppApi'), true, '菜单里有「退出 app」这条出口');
  // 「实时调节大小的拖拽 + input 框」也是 review 明确要的。少了它 PET_MENU_SIZE_ROW
  // 那 46px 就变成菜单顶上一块白留的空
  eq(source.includes('n-slider'), true, '菜单里有调大小的滑块');
  eq(source.includes('n-input-number'), true, '菜单里有调大小的输入框');
  eq(source.includes('store.setSize('), true, '滑块与输入框接的是 usePetStore().setSize');
  // review 第三轮：「布局应该在 input 下面」。**只在 <template> 里比先后**——文件头注释
  // 里也讲了这个排版，拿整份文件去 indexOf 会命中注释（它恒在两个标签之上），顺序反过来
  // 也照样绿，那正是本功能已经栽过两次的坏金丝雀写法
  const tpl = /<template>([\s\S]*?)<\/template>/.exec(source)?.[1] ?? '';
  eq(tpl.length > 0, true, 'PetMenu.vue 里找得到 <template>（找不到说明结构变了，哨兵要跟着改）');
  const inputAt = tpl.indexOf('<n-input-number');
  const sliderAt = tpl.indexOf('<n-slider');
  eq(
    inputAt >= 0 && sliderAt >= 0 && inputAt < sliderAt,
    true,
    '输入框排在滑块之前（滑块单独占下面一整行，挤回同一行就只剩一百来像素可拖）',
  );
}

/* ======== #26 桌宠：三条只在运行时才看得见的顺序 / 样式约定（review 修 bug 后加的） ======== */

{
  // 1. **落盘必须排在广播之前。** writeState 是 300ms 防抖的，不 flush 就广播，
  //    收到广播的窗口 refreshAppState() 读回来的是**上一版**配置——表现就是 review 报的
  //    「桌宠图片每次都停留在上一次更新」。没有任何报错，类型系统也拦不住，只有顺序防得住。
  const store = await readFile('src/stores/pet.ts', 'utf-8');
  // 只在 persist() 那一段里看顺序：setSize 里也有一次 petApplyConfigApi（那次是**故意**
  // 不等落盘的，要的就是实时缩放），拿整份文件去 indexOf 会把它数进来，哨兵就废了
  const persist = /function persist\(\)[\s\S]*?\n  \}/.exec(store)?.[0] ?? '';
  eq(persist.length > 0, true, 'pet store 里找得到 persist()（找不到说明结构变了，哨兵要跟着改）');
  const flushAt = persist.indexOf('flushAppState(');
  const applyAt = persist.indexOf('petApplyConfigApi');
  eq(flushAt >= 0, true, 'persist() 里调了 flushAppState（不 flush 就是广播出去一份旧配置）');
  eq(
    flushAt >= 0 && flushAt < applyAt,
    true,
    'flushAppState 排在 petApplyConfigApi 之前（顺序反了 = 桌宠图片停留在上一次更新）',
  );

  // 2. **拖拽反馈不许改几何。** 桌宠窗口是贴着精灵大小的，而且 overflow:hidden，
  //    任何 scale / translate 都会把精灵顶出窗口边界被裁掉（review 报的「拖拽中图片会下移」）。
  const stage = await readFile('src/components/pet/PetStage.vue', 'utf-8');
  const dragging = /&--dragging\s*\{([\s\S]*?)\}/.exec(stage)?.[1] ?? '';
  eq(dragging.length > 0, true, 'PetStage.vue 里找得到拖拽态那条样式（找不到说明结构变了）');
  eq(
    /transform\s*:/.test(dragging),
    false,
    '拖拽态不含 transform（窗口贴着精灵大小 + overflow:hidden，一放大就被裁成「图片下移」）',
  );

  // 3. **菜单归右键。** review 定的（原来是左键单击弹菜单）。左键那一支只负责拖拽 / 单击动画。
  const presenter = await readFile('src/composables/usePetPresenter.ts', 'utf-8');
  eq(
    presenter.includes('event.button === 2'),
    true,
    '右键才弹菜单（review 改的交互，左键留给拖拽与点击动画）',
  );

  // 4. **主进程摆窗口一律 setBounds 且显式带宽高，绝不用 setPosition。**
  //    真 Electron 探针在本机（scaleFactor = 1.25）量到的：透明无边框窗口 setPosition
  //    连打 120 次，160×160 变成了 296×256——位置对，**尺寸自己一路膨胀**（非整数缩放下
  //    每次都要做一遍 DIP ↔ 物理像素往返取整）。同样 120 次换成 setBounds 带恒定宽高，
  //    尺寸逐字不变。渲染进程那边是 flex-end 贴底的，窗口一路长高精灵就一路往下掉，
  //    这就是 review 报的「拖拽中图片下移」+「n-config-provider 宽高越来越大」。
  const petWindow = await readFile('electron/main/pet/petWindow.ts', 'utf-8');
  eq(
    petWindow.includes('setPosition('),
    false,
    '桌宠窗口不用 setPosition（1.25 缩放下它会让窗口尺寸一路膨胀，探针量过 160→296）',
  );
  const move = /export function dragPetMove\([\s\S]*?\n\}/.exec(petWindow)?.[0] ?? '';
  eq(move.length > 0, true, '找得到 dragPetMove（找不到说明结构变了，哨兵要跟着改）');
  eq(
    /setBounds\(\{[^}]*width:[^}]*height:/.test(move),
    true,
    'dragPetMove 的 setBounds 显式带上宽高（漏了宽高就等于放任缩放取整改尺寸）',
  );
  // 5. **尺寸不许问 getBounds()。** 同一批探针量到 getBounds() 在 1.25 缩放下会回 161；
  //    而 petMenuBounds 是按右下角锚点反推左上角的，喂一个偏 1px 的宽高进去，
  //    每开合一次菜单精灵就挪一格。所以主进程统一走 currentPetRect()（尺寸取 petWindowSize）。
  eq(
    /const\s*\{\s*x,\s*y\s*\}\s*=\s*pet\.getBounds\(\)/.test(petWindow),
    true,
    'currentPetRect 只从 getBounds() 取 x/y（宽高按 petWindowSize 现算）',
  );
  eq(
    petWindow.includes('petMenuBounds(pet.getBounds()'),
    false,
    'petMenuBounds 不吃裸 getBounds()（1.25 缩放下宽高会偏 1px，锚点跟着漂）',
  );
  // 6. **applyPetConfig 必须先取锚点、再改 petSize。** currentPetRect() 用的就是 petSize：
  //    先改了它，算出来的右下角是「新尺寸摆在老位置上」的那个角，于是 petMenuBounds 反推出
  //    的左上角原地不动 = 窗口向**右下**长，桌宠每调一次大小就往右下角爬一截。
  //    顺序对了才是「右下角不动、向左上长」，跟菜单展开是同一个锚点。
  const apply = /export function applyPetConfig\([\s\S]*?\n\}/.exec(petWindow)?.[0] ?? '';
  eq(apply.length > 0, true, '找得到 applyPetConfig（找不到说明结构变了，哨兵要跟着改）');
  // 比的是**赋值语句**而不是裸函数名：上面那段注释里也写着 currentPetRect()，
  // 拿函数名去 indexOf 会一直命中注释（它恒在两行之上），顺序反过来也照样绿
  const rectAt = apply.indexOf('const current = currentPetRect()');
  const sizeAt = apply.indexOf('petSize = clampPetSize(');
  eq(rectAt >= 0 && sizeAt >= 0, true, 'applyPetConfig 里既取锚点也改 petSize');
  eq(
    rectAt >= 0 && sizeAt >= 0 && rectAt < sizeAt,
    true,
    'applyPetConfig 先取锚点再改 petSize（反了 = 调大小时桌宠往右下角爬）',
  );
}

/* ======== #26 桌宠：隐藏到托盘 + 置顶抢占（review 第四轮加的两条） ======== */

{
  const petWindow = await readFile('electron/main/pet/petWindow.ts', 'utf-8');
  // 托盘那份实现 26 之后被泛化成了全进程共用（主窗口的「最小化到托盘」也用它），
  // 从 pet/tray.ts 搬到了 main/tray.ts
  const tray = await readFile('electron/main/tray.ts', 'utf-8');
  const menu = await readFile('src/components/pet/PetMenu.vue', 'utf-8');

  // 1. **菜单里有「隐藏桌宠」这一项。** 少了它托盘那一整套就没有入口。
  eq(menu.includes('hidePetApi('), true, '菜单里有「隐藏桌宠」（接的是 hidePetApi）');

  // 2. **托盘图标的可用性必须自己查，不能靠 try/catch。** 真 Electron 探针量到：
  //    `new Tray(nativeImage.createEmpty())` 在 Windows 上**照建不误也不抛**，
  //    isDestroyed() 还是 false——只是任务栏上什么都看不见。而隐藏之后主窗口多半也是
  //    隐藏的、桌宠又 skipTaskbar，那就是一个叫不回来的 app。
  const ensure = /export function ensureTray\([\s\S]*?\n\}/.exec(tray)?.[0] ?? '';
  eq(ensure.length > 0, true, '找得到 ensureTray（找不到说明结构变了，哨兵要跟着改）');
  const emptyAt = ensure.indexOf('isEmpty()');
  const newTrayAt = ensure.indexOf('new Tray(');
  eq(emptyAt >= 0, true, 'ensureTray 自己查过图标是不是空的（空图标不抛，try/catch 守不住）');
  eq(
    emptyAt >= 0 && newTrayAt >= 0 && emptyAt < newTrayAt,
    true,
    '空图标在 new Tray 之前就被挡掉（顺序反了 = 建出一个看不见的托盘图标，用户叫不回桌宠）',
  );
  // 托盘是隐藏期间唯一的出口，所以它自己必须带一条真正的退出。
  // **只在 ensureTray 里那个 buildFromTemplate 数组里找**：文件头注释里也写着「菜单里必须有
  // 「退出 app」」，拿整份文件去 includes，把真菜单项改成别的字照样绿（红证抓出来的）。
  // 而且这一项必须是**本模块自己追加**的、不从 spec.items 来——那样「没有出口的托盘」
  // 在结构上就拼不出来（调用方漏写也不影响）
  const trayMenu = /Menu\.buildFromTemplate\(\[([\s\S]*?)\]\)/.exec(ensure)?.[1] ?? '';
  eq(trayMenu.length > 0, true, '找得到托盘菜单模板（找不到说明结构变了，哨兵要跟着改）');
  eq(trayMenu.includes('退出 app'), true, '托盘菜单里有「退出 app」（托盘是隐藏期间唯一的出口）');
  // 换 owner 时不清旧的左键监听，两边的回调会叠着跑（探针量过：监听数变成 2，一次 click
  // 把两个都跑了——表现就是「点一下托盘，桌宠和主窗口一起冒出来」）
  eq(
    ensure.includes("removeAllListeners('click')"),
    true,
    '换 owner 时先清掉旧的 click 监听（不清 = 两个持有者的回调叠着跑）',
  );

  // 3. **先确认托盘可用，再 hide()。** 只在函数体里比先后（JSDoc 里也讲了这条约定，
  //    拿整份文件去 indexOf 会命中注释——本功能已经栽过两次的那种坏金丝雀）。
  const hide = /export function hidePetWindow\([\s\S]*?\n\}/.exec(petWindow)?.[0] ?? '';
  eq(hide.length > 0, true, '找得到 hidePetWindow（找不到说明结构变了，哨兵要跟着改）');
  const ensureAt = hide.indexOf('ensureTray(');
  const hideAt = hide.indexOf('pet.hide()');
  eq(ensureAt >= 0 && hideAt >= 0, true, 'hidePetWindow 里既建托盘也藏窗口');
  eq(
    ensureAt >= 0 && hideAt >= 0 && ensureAt < hideAt,
    true,
    '托盘建起来了才 hide()（反了 = 先藏进一个没有出口的地方，主窗口也是隐藏的）',
  );

  // 4. **置顶要周期性抢回来。** alwaysOnTop 只把窗口放进「置顶那一层」，层内后来者在前：
  //    探针量到桌宠（名次 1）在新建一个同样 alwaysOnTop 的窗口后立刻掉到名次 2——
  //    会议软件共享屏幕那条悬浮条就是这么把它压下去的（review 报的「一录屏桌宠就不见了」）。
  //    抢回来只能主动重排，而且没有事件可听（悬浮条出现时桌宠不会 blur，它本来就没焦点）。
  const guard = /function startTopmostGuard\(\)[\s\S]*?\n\}/.exec(petWindow)?.[0] ?? '';
  eq(guard.length > 0, true, '找得到 startTopmostGuard（找不到说明结构变了，哨兵要跟着改）');
  // **只在守卫体里找 moveTop**：`showPetWindow()` 自己也调一次，拿整份文件去 includes，
  // 把守卫里那句换成别的照样绿（红证抓出来的）
  eq(
    guard.includes('moveTop()'),
    true,
    '桌宠会周期性主动抬回置顶（不抬就会被会议软件那条置顶悬浮条压下去）',
  );
  eq(
    guard.includes('PET_TOPMOST_REASSERT_MS'),
    true,
    '抬回置顶的周期走的是 shared 里那个常数（不许在这儿写死一个数）',
  );
  eq(
    PET_TOPMOST_REASSERT_MS >= 500 && PET_TOPMOST_REASSERT_MS <= 5000,
    true,
    '抬回置顶的周期在合理区间（太密会一直和别人的置顶窗口打架，太疏会被压住很久）',
  );
  // 5. **窗口销毁时必须停掉守卫并撤掉托盘。** interval 会把事件循环一直吊着；
  //    托盘留着的话，托盘区会剩一个点了什么都不会发生的图标。
  //    这个文件里有两个 `window.on('closed'`（一个是主窗口的），认 `pet = null` 那个。
  const closedBlocks = [
    ...petWindow.matchAll(/window\.on\('closed', \(\) => \{[\s\S]*?\n {2}\}\)/g),
  ]
    .map((m) => m[0])
    .filter((b) => b.includes('pet = null'));
  eq(closedBlocks.length, 1, '找得到桌宠窗口自己的 closed 处理器（找不到说明结构变了）');
  eq(
    (closedBlocks[0] ?? '').includes('stopTopmostGuard()'),
    true,
    '桌宠销毁时停掉置顶守卫（漏了这个 interval 会一直吊着事件循环）',
  );
  eq(
    (closedBlocks[0] ?? '').includes("releaseTray('pet')"),
    true,
    '桌宠销毁时撤掉自己那份托盘（漏了会剩一个点不动的图标；用 releaseTray 而不是 destroyTray，那一刻托盘可能归主窗口）',
  );
}

/* ======== 关闭主窗口时的行为：退出 / 收进托盘 / 每次询问（2026-09-11 追加） ======== */

{
  // 1. **归一化永不抛、脏值一律回默认。** 这个值从磁盘来（用户手改过、旧版本写过、
  //    半截写坏过都可能），而它决定「点 ✕ 会发生什么」——落到 default 分支等于关不掉窗口。
  for (const dirty of [undefined, null, {}, [], 0, '', 'TRAY', 'quit ', 'ask\n', NaN]) {
    eq(
      normalizeCloseAction(dirty),
      APP_CLOSE_ACTION_DEFAULT,
      `normalizeCloseAction(${JSON.stringify(dirty)}) 回默认值（脏值不许穿过去）`,
    );
  }
  for (const good of APP_CLOSE_ACTIONS) {
    eq(normalizeCloseAction(good), good, `normalizeCloseAction('${good}') 原样返回`);
  }
  eq(APP_CLOSE_ACTIONS.length, 3, '关闭动作恰好三态（询问 / 退出 / 托盘）');
  eq(new Set(APP_CLOSE_ACTIONS).size, APP_CLOSE_ACTIONS.length, '三态没有重复项');
  eq(
    (APP_CLOSE_ACTIONS as readonly string[]).includes(APP_CLOSE_ACTION_DEFAULT),
    true,
    '默认值就在这三项里',
  );
  // 默认必须是「每次询问」：另外两个都是不可逆的（退了任务就断、藏了要会用托盘），
  // 没存过设置的人第一次点 ✕ 不该被静默处理
  eq(APP_CLOSE_ACTION_DEFAULT, 'ask', '默认是「每次询问」（另外两个都不可逆）');

  const appClose = await readFile('electron/main/appClose.ts', 'utf-8');
  const nav = await readFile('electron/main/windowNav.ts', 'utf-8');
  const petWindow = await readFile('electron/main/pet/petWindow.ts', 'utf-8');
  const sideNav = await readFile('src/components/layout/SideNav.vue', 'utf-8');
  const home = await readFile('src/views/HomeView.vue', 'utf-8');
  const settings = await readFile('src/views/SettingsView.vue', 'utf-8');
  const modal = await readFile('src/components/layout/CloseConfirmModal.vue', 'utf-8');

  // 2. **`quitting` 的判断必须排在 preventDefault 之前。** `app.quit()` 会给每个窗口发
  //    `close`，拦截器一 preventDefault 就把退出吃掉了——托盘的「退出 app」、桌宠菜单的
  //    「退出 app」全压在这条顺序上（`quitAppFromPet` 早踩过一次同样的坑）。
  const closeHandler = /window\.on\('close', \(event\) => \{[\s\S]*?\n {2}\}\)/.exec(appClose)?.[0] ?? '';
  eq(closeHandler.length > 0, true, '找得到主窗口的 close 处理器（找不到说明结构变了）');
  const quittingAt = closeHandler.indexOf('if (quitting) return');
  const preventAt = closeHandler.indexOf('preventDefault()');
  eq(quittingAt >= 0 && preventAt >= 0, true, 'close 处理器里既看 quitting 也会拦下来');
  eq(
    quittingAt >= 0 && preventAt >= 0 && quittingAt < preventAt,
    true,
    'quitting 的放行排在 preventDefault 之前（反了 = 点「退出 app」被自己拦成最小化）',
  );
  // 标志由 before-quit 置上：真 Electron 探针量过它先于窗口的 close
  eq(
    /app\.on\('before-quit'[\s\S]{0,120}quitting = true/.test(appClose),
    true,
    'quitting 由 app.on(before-quit) 置上（探针量过它先于窗口 close）',
  );
  // 3. **桌宠那条规则优先。** 桌宠开着时主窗口的 close 由 petWindow 拦成 hide()，
  //    这里必须早退，不然会先弹一个「要退出吗」的框，而两个窗口寿命本该是独立的。
  eq(
    closeHandler.includes('isPetWindowOpen()'),
    true,
    'close 处理器里给桌宠模式留了早退（桌宠开着时不该弹关闭确认框）',
  );

  // 4. **先确认托盘可用，再 hide()**（同桌宠那条，只是换到主窗口上）。收进托盘这件事
  //    放在 windowNav.ts：桌宠的「退出桌宠」也要用它，而 appClose 反过来要用
  //    isPetWindowOpen()，放一起会成环。
  const hideHost = /export function hideHostToTray\([\s\S]*?\n\}/.exec(nav)?.[0] ?? '';
  eq(hideHost.length > 0, true, '找得到 hideHostToTray（找不到说明结构变了，哨兵要跟着改）');
  const hostEnsureAt = hideHost.indexOf('ensureTray(');
  const hostHideAt = hideHost.indexOf('window.hide()');
  eq(hostEnsureAt >= 0 && hostHideAt >= 0, true, 'hideHostToTray 里既建托盘也藏窗口');
  eq(
    hostEnsureAt >= 0 && hostHideAt >= 0 && hostEnsureAt < hostHideAt,
    true,
    '托盘建起来了才 hide() 主窗口（反了 = 藏进一个没有出口的地方，用户只剩任务管理器）',
  );
  eq(hideHost.includes('return false'), true, '托盘建不起来时 hideHostToTray 回 false（调用方据此保留窗口）');
  // 「两个托盘永不共存」这个结论的前提：主窗口那份托盘菜单里**不许**有通往桌宠的入口。
  // 认 `label:` 那个字面量而不是裸的「打开桌宠」——函数体里那段注释正解释着「为什么不放」，
  // 拿裸串去 includes 只会一直命中注释（这条哨兵第一次跑就是这么红的）
  eq(
    /label: '打开桌宠'/.test(hideHost),
    false,
    '主窗口的托盘菜单里没有「打开桌宠」那一项（那会打破单 Tray 的前提）',
  );

  // 5. **「最小化到托盘」失败不许变成静默退出。** 那会把正在跑的 ffmpeg 一起杀掉，
  //    比不藏糟得多——所以 tray 分支失败后走的是弹窗，而不是放行 close。
  const trayBranchAt = closeHandler.indexOf("closeAction === 'tray'");
  eq(trayBranchAt >= 0, true, 'close 处理器里有 tray 分支');
  eq(
    closeHandler.slice(trayBranchAt).includes('promptClose()'),
    true,
    'tray 分支失败后回落到弹窗（绝不静默退出，那会杀掉正在跑的转码）',
  );

  // 6. **退出桌宠 = 桌宠退场 + app 收进托盘，不把主窗口弹出来**（用户 2026-09-11 定的
  //    「退出桌宠不需要重新打开 app」）。托盘建不起来才回落到 showHostWindow。
  const closePet = /export async function closePetWindow\([\s\S]*?\n\}/.exec(petWindow)?.[0] ?? '';
  eq(closePet.length > 0, true, '找得到 closePetWindow（找不到说明结构变了，哨兵要跟着改）');
  const trayFirstAt = closePet.indexOf('hideHostToTray()');
  const showAt = closePet.indexOf("showHostWindow('app')");
  eq(trayFirstAt >= 0, true, '退出桌宠时把 app 收进托盘（而不是把主窗口弹出来）');
  eq(
    showAt < 0 || trayFirstAt < showAt,
    true,
    '显示主窗口只是托盘不可用时的回落（顺序反了 = 又变回「退出桌宠就弹 app」）',
  );
  // 销毁桌宠**之后**才没有出口了，所以托盘必须先立起来
  const destroyAt = closePet.indexOf('pet.destroy()');
  eq(
    destroyAt >= 0 && trayFirstAt < destroyAt,
    true,
    '托盘先立起来再销毁桌宠（反了 = 中间一段既没窗口也没托盘）',
  );

  // 7. **AI 入口排在「设置」上面**（用户原话「ai 入口放在设置 tab 上面」——顺序就是需求本身）。
  const footer = /const footerOptions = computed<MenuOption\[\]>\([\s\S]*?\n\}\);/.exec(sideNav)?.[0] ?? '';
  eq(footer.length > 0, true, '找得到侧栏底部那组菜单项（找不到说明结构变了）');
  const aiKeyAt = footer.indexOf("key: 'ai'");
  const settingsKeyAt = footer.indexOf("key: 'settings'");
  eq(aiKeyAt >= 0 && settingsKeyAt >= 0, true, '底部既有 AI 助手也有设置');
  eq(aiKeyAt < settingsKeyAt, true, 'AI 助手排在「设置」上面（用户原话就是这条）');
  // 8. **首页那块 AI 卡片删干净、入口没丢。** 两处一起断言：只删不加 = 用户找不到 AI 了。
  eq(home.includes('openAiWindowApi'), false, '首页不再有 AI 入口（全 app 只留侧栏那一个）');
  eq(sideNav.includes('openAiWindowApi'), true, '侧栏那一行真的会开 AI 窗口（入口没丢）');
  // AI 那一项不跳路由（它开的是独立窗口），所以 handleSelect 里必须有分流
  eq(
    /if \(key === 'ai'\)/.test(sideNav),
    true,
    'handleSelect 给 AI 那项做了分流（不然会去 keyToPath 找一个不存在的路由）',
  );

  // 9. **设置页的三选一必须覆盖全部三态。** 少一项 = 有个状态用户根本设不到。
  const optionValues = [...settings.matchAll(/value: '(ask|quit|tray)'/g)].map((m) => m[1]);
  eq(
    optionValues.length,
    APP_CLOSE_ACTIONS.length,
    '设置页的 radio 选项数等于关闭动作的态数（少一项 = 有个状态设不到）',
  );
  eq(new Set(optionValues).size, APP_CLOSE_ACTIONS.length, '三个选项各不相同');

  // 10. **弹窗三个出口都在，且托盘那条路的失败被处理了**（按钮置灰 + 保留弹窗）。
  for (const choice of ['cancel', 'quit', 'tray']) {
    eq(modal.includes(`'${choice}'`), true, `关闭确认弹窗里有 '${choice}' 这个出口`);
  }
  eq(
    modal.includes('trayFailed') && /:disabled="trayFailed"/.test(modal),
    true,
    '托盘不可用时那个按钮会置灰（弹窗留在屏幕上，窗口也还在）',
  );
}

/* ---------------------------------- 汇总 ---------------------------------- */

console.log(`\n主进程桩测：${passed} 条通过，${failures.length} 条失败`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length > 0) process.exit(1);
