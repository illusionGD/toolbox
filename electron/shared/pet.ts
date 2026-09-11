/**
 * 桌宠的动画状态机与状态映射 —— **需求 3 的全部语义都在这一个文件里**。
 *
 * 用户原话：「桌宠有几种动画配置：默认、点击后、拖拽时、拖拽后放下、长时间待机 N 种
 * 轮播，可以配置动画的映射……**没配置的状态同一默认**」。这条兜底规则最容易在模板里
 * 被写成一串 `??` 然后漏掉某个分支，所以它落在这里当纯函数——「兜底到底对不对」于是
 * 变成一条可以被桩测断言的性质，而不是一段要靠眼睛看的模板。
 *
 * 同理，**这里一个计时器都没有**：状态迁移只回「下一个状态 + 该状态存活多久」，真正
 * 的 `setTimeout` 全在渲染进程的 `usePetPresenter` 里。纯函数才测得动。
 *
 * 放 `shared/` 是因为**两端都要用**：渲染进程按它决定显示什么，主进程读它做配置校验
 * （`normalizePetConfig`）。不碰 Electron 也不碰 DOM，桩测能直接打包进来。
 */

/**
 * 桌宠的五种状态（就是需求 3 列的那五种）。
 *
 * - `idle`：默认，什么都没发生
 * - `click`：点击后（瞬时，`transientMs` 后回 `idle`）
 * - `drag`：拖拽中（持续，直到松手）
 * - `drop`：拖拽后放下（瞬时）
 * - `idleLoop`：长时间待机的 N 种轮播
 */
export type PetState = 'idle' | 'click' | 'drag' | 'drop' | 'idleLoop';

/** 资源类型。`spine` 与 `live2d` 分别是 #26b / #26c 的事，本轮只有 `image` 能选。 */
export type PetResourceKind = 'image' | 'spine' | 'live2d';

/**
 * 一个状态映射到什么。
 *
 * 值的**语义随 `kind` 变**：图片模式下是文件绝对路径，spine / live2d 模式下是动画名。
 * 这一层不关心语义（它只管兜底），所以 #26b 接 spine 时这个类型一个字都不用改。
 */
export interface PetStateMap {
  /** 默认态。留空 = 用 {@link PetConfig.defaultRef}。 */
  idle?: string;
  /** 点击后。 */
  click?: string;
  /** 拖拽中。 */
  drag?: string;
  /** 拖拽后放下。 */
  drop?: string;
  /** 长时间待机的 N 种轮播；空数组 = 不轮播（回落到默认）。 */
  idleLoop?: string[];
}

/** 桌宠配置（存在 `pet` 应用状态命名空间，由渲染进程整块写）。 */
export interface PetConfig {
  /** 资源类型。 */
  kind: PetResourceKind;
  /**
   * 默认态资源。图片模式是文件绝对路径，spine/live2d 是默认动画名。
   * **留空 = 用应用 logo / 库的默认状态**（需求 4）。
   */
  defaultRef: string;
  /** 五个状态各自的映射，留空的走兜底。 */
  states: PetStateMap;
  /**
   * **AI 对话里助手的头像**（图片文件绝对路径）。留空 = 用应用 logo。
   *
   * 它在这份配置里而不是在 `ai` 命名空间里，是 review 定的：用户原话是「ai 对话框的
   * ai 头像默认是 logo，**桌宠可以设置该头像**」——头像属于「这只小精灵长什么样」，
   * 而不属于「连哪个厂商的哪个模型」。所以**换一只桌宠就换一套形象**，AI 配置那边
   * 一个字都不用动；AI 窗口只是这份配置的读者。
   *
   * 与 `defaultRef` 刻意分开：桌宠站在桌面上的样子（可能是一整只角色）和聊天气泡边上
   * 那个 28px 的小圆头像，通常不是同一张图。
   */
  aiAvatarRef: string;
  /** 桌宠边长（DIP）。 */
  size: number;
  /** 静置多久进入待机轮播（ms）。 */
  idleAfterMs: number;
  /** `click` / `drop` 这类瞬时态的存活时长（ms）。 */
  transientMs: number;
  /** 待机轮播每张停留多久（ms）。 */
  idleLoopMs: number;
}

/** 静置进入待机轮播的默认时长。 */
export const PET_IDLE_AFTER_MS_DEFAULT = 15_000;
/** 瞬时态默认时长。 */
export const PET_TRANSIENT_MS_DEFAULT = 800;
/** 待机轮播每张默认停留时长。 */
export const PET_IDLE_LOOP_MS_DEFAULT = 3_000;

/** 时长类配置的下限（ms）。太小会让状态在屏上一闪而过、还白烧渲染。 */
export const PET_MS_MIN = 100;
/** 时长类配置的上限（ms，10 分钟）。 */
export const PET_MS_MAX = 600_000;

/** 默认配置（第一次用、或存盘数据完全读不出来时）。 */
export const PET_CONFIG_DEFAULT: PetConfig = {
  kind: 'image',
  defaultRef: '',
  states: {},
  aiAvatarRef: '',
  size: 160,
  idleAfterMs: PET_IDLE_AFTER_MS_DEFAULT,
  transientMs: PET_TRANSIENT_MS_DEFAULT,
  idleLoopMs: PET_IDLE_LOOP_MS_DEFAULT,
};

/**
 * 夹紧一个时长配置。
 * @param value 任意输入。
 * @param fallback 不是有限数时用的兜底。
 * @returns [{@link PET_MS_MIN}, {@link PET_MS_MAX}] 内的整数。
 */
function clampMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.round(value), PET_MS_MIN), PET_MS_MAX);
}

/**
 * 取一个非空字符串，否则空串。
 * @param value 任意输入。
 * @returns 去首尾空白后的字符串；不是字符串时是空串。
 */
function toRef(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 存盘值 → 合法配置。**任何脏数据都不许抛**。
 *
 * 这个函数是 `app-state.json` 与运行时之间唯一的闸门：文件是用户改得到的纯文本，
 * 手改坏一个字段不该让桌宠开不出来（更不该让主进程在建窗时崩掉）。
 * @param value 从应用状态里读到的任意值。
 * @returns 各字段都在合法区间的纯对象（可 `structuredClone`）。
 */
export function normalizePetConfig(value: unknown): PetConfig {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<PetConfig>;
  const kind: PetResourceKind = raw.kind === 'spine' || raw.kind === 'live2d' ? raw.kind : 'image';

  const rawStates = (
    typeof raw.states === 'object' && raw.states !== null && !Array.isArray(raw.states)
      ? raw.states
      : {}
  ) as Partial<PetStateMap>;

  const states: PetStateMap = {};
  for (const key of ['idle', 'click', 'drag', 'drop'] as const) {
    const ref = toRef(rawStates[key]);
    if (ref) states[key] = ref;
  }
  const loop = Array.isArray(rawStates.idleLoop)
    ? rawStates.idleLoop.map(toRef).filter((s) => s !== '')
    : [];
  if (loop.length > 0) states.idleLoop = loop;

  return {
    kind,
    defaultRef: toRef(raw.defaultRef),
    states,
    // 空串是有意义的值（= 用应用 logo），所以这里不需要「留空就删掉」那套处理
    aiAvatarRef: toRef(raw.aiAvatarRef),
    // 尺寸的合法区间归 petWindow.ts 管（那边还要拿它算 bounds），这里只保证是个有限数；
    // 真正的夹紧在 clampPetSize，两处都会调，不重复实现
    size: typeof raw.size === 'number' && Number.isFinite(raw.size) ? Math.round(raw.size) : 160,
    idleAfterMs: clampMs(raw.idleAfterMs, PET_IDLE_AFTER_MS_DEFAULT),
    transientMs: clampMs(raw.transientMs, PET_TRANSIENT_MS_DEFAULT),
    idleLoopMs: clampMs(raw.idleLoopMs, PET_IDLE_LOOP_MS_DEFAULT),
  };
}

/**
 * 待机轮播的下标推进（到头绕回 0）。
 * @param index 当前下标。
 * @param count 轮播条目数。
 * @returns 下一个下标；`count <= 0` 时恒为 0。
 */
export function nextIdleLoopIndex(index: number, count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  return (Math.floor(index) + 1) % Math.floor(count);
}

/**
 * 状态 → 实际要播的那个资源。**需求 3 的兜底就是这一个函数**。
 *
 * 三级回落，一级都不能少：
 * 1. 该状态自己配了 → 用它；
 * 2. 没配 → 用 `defaultRef`（用户原话「没配置的状态同一默认」）；
 * 3. `defaultRef` 也空 → 回 `null`，**由调用方用应用 logo / 库的默认状态**（需求 4）。
 *
 * `idleLoop` 多一层：数组为空或下标越界时，同样落到第 2 级而不是回空串——空串会让
 * `<img src="">` 去请求当前页面，比 `null` 难查得多。
 * @param config 桌宠配置。
 * @param state 当前状态。
 * @param loopIndex 待机轮播的下标（其他状态忽略）。
 * @returns 资源引用；没有任何配置时是 null。
 */
export function resolvePetVisual(config: PetConfig, state: PetState, loopIndex = 0): string | null {
  const fallback = config.defaultRef || null;
  if (state === 'idleLoop') {
    const loop = config.states.idleLoop ?? [];
    if (loop.length === 0) return config.states.idle || fallback;
    const index = Number.isFinite(loopIndex) ? Math.abs(Math.floor(loopIndex)) % loop.length : 0;
    return loop[index] || fallback;
  }
  return config.states[state] || fallback;
}

/** 推动状态机的事件。`timeout` 是瞬时态到点，`idleTick` 是静置计时到点。 */
export type PetEvent = 'click' | 'dragStart' | 'dragEnd' | 'timeout' | 'idleTick';

/** 一次迁移的结果。 */
export interface PetTransition {
  /** 迁移后的状态。 */
  state: PetState;
  /**
   * 该状态的存活时长（ms）；`null` = 不自动离开（等下一个交互事件）。
   *
   * `idle` 回的是 `idleAfterMs`：它不是「离开 idle」的倒计时，而是「静置多久开始
   * 轮播」的倒计时，到点由调用方发 `idleTick`。
   */
  holdMs: number | null;
}

/**
 * 状态迁移。**纯函数，不摸计时器、不摸 DOM。**
 *
 * 语义（与需求 3 逐条对应）：
 * - `idle --click--> click --timeout--> idle`
 * - 任意态 `--dragStart--> drag --dragEnd--> drop --timeout--> idle`
 * - `idle` 静置 `idleAfterMs` 后 `--idleTick--> idleLoop`，之后每个 `idleTick` 换下一张
 * - **`drag` 期间的 `idleTick` 一律忽略**（手正拖着它，不该自己开始待机轮播）
 * - **任何交互事件都立刻打断 `idleLoop`**（用户回来了，轮播就该让位）
 * @param current 当前状态。
 * @param event 发生的事件。
 * @param config 桌宠配置（取三个时长）。
 * @returns 迁移后的状态与它的存活时长。
 */
export function nextPetState(current: PetState, event: PetEvent, config: PetConfig): PetTransition {
  switch (event) {
    case 'dragStart':
      // 拖拽压倒一切：点击态、待机轮播都让位
      return { state: 'drag', holdMs: null };
    case 'dragEnd':
      // 没在拖也收到 dragEnd（比如 pointercancel）时不该凭空冒出一个 drop
      return current === 'drag'
        ? { state: 'drop', holdMs: config.transientMs }
        : { state: 'idle', holdMs: config.idleAfterMs };
    case 'click':
      // 拖拽中的 click 不存在（超过阈值就不算点击了），但真收到也不能打断拖拽
      return current === 'drag'
        ? { state: 'drag', holdMs: null }
        : { state: 'click', holdMs: config.transientMs };
    case 'timeout':
      // 只有瞬时态会到点；拖拽中与待机轮播中没有 timeout 可言
      return current === 'click' || current === 'drop'
        ? { state: 'idle', holdMs: config.idleAfterMs }
        : { state: current, holdMs: current === 'idle' ? config.idleAfterMs : null };
    case 'idleTick':
      // 拖着的时候不许自己进轮播
      if (current === 'drag') return { state: 'drag', holdMs: null };
      return { state: 'idleLoop', holdMs: config.idleLoopMs };
    default:
      return { state: current, holdMs: null };
  }
}
