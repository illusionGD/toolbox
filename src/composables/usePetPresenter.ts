/**
 * 桌宠的运行时：把 `@shared/pet` 那台**纯状态机**接上真实计时器、真实指针事件、
 * 以及「资源引用 → 能塞进 `<img src>` 的东西」这一步。
 *
 * 分工是刻意的：**纯模块里一个计时器都没有**（那样才测得动），所有 `setTimeout` 只在
 * 这一个文件里出现，且全部在 `onUnmounted` 里清干净。
 */
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import {
  nextIdleLoopIndex,
  nextPetState,
  resolvePetVisual,
  type PetEvent,
  type PetState,
} from '@shared/pet';
import { PET_DRAG_THRESHOLD } from '@shared/petWindow';
import { getDataUrlApi } from '@/services/image';
import { petDragEndApi, petDragMoveApi, petDragStartApi, petSetMenuOpenApi } from '@/services/pet';
import { refreshAppState } from '@/services/appState';
import { usePetStore } from '@/stores/pet';

/** 没配任何资源时用的应用 logo（需求 4）。`img-src 'self'`，dev 与 prod 路径一致。 */
const PET_LOGO = './icon.png';

/** 桌宠运行时暴露给模板的东西。 */
export interface PetPresenter {
  /** 当前动画状态。 */
  state: Ref<PetState>;
  /** 当前该显示的图片 src（data URL 或 logo）。 */
  src: Ref<string>;
  /** 菜单是否展开。 */
  menuOpen: Ref<boolean>;
  /** 是否正在拖拽（拖拽中要把菜单和 hover 效果都停掉）。 */
  dragging: Ref<boolean>;
  /** 精灵边长（px）。 */
  size: ComputedRef<number>;
  /** 按在精灵上（左键开始拖 / 右键弹菜单）。 */
  onPointerDown: (event: PointerEvent) => void;
  /** 关菜单（点到菜单外、或菜单项被点掉之后）。 */
  closeMenu: () => void;
}

/**
 * 建一个桌宠运行时。
 * @returns 给 `PetStage` / `PetMenu` 用的状态与事件处理器。
 */
export function usePetPresenter(): PetPresenter {
  const store = usePetStore();

  const state = ref<PetState>('idle');
  const loopIndex = ref(0);
  const menuOpen = ref(false);
  const dragging = ref(false);
  const src = ref(PET_LOGO);

  /** 状态存活计时器（`click`/`drop` 到点、`idle` 静置到点都用它）。 */
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** 按下那一刻的屏幕坐标。 */
  let startScreen: { x: number; y: number } | null = null;
  /** 已经越过阈值、这次算拖拽而不是点击。 */
  let passedThreshold = false;
  /** rAF 节流句柄（拖拽每帧最多发一次 IPC）。 */
  let moveFrame: number | null = null;
  /** 最近一次 pointermove 的位移，等下一帧发出去。 */
  let pendingDelta: { dx: number; dy: number } | null = null;
  /** 捕获指针的那个元素（松手时要还回去）。 */
  let captureTarget: { el: Element; pointerId: number } | null = null;
  /** 取消订阅配置广播。 */
  let offConfigChanged: (() => void) | null = null;

  const size = computed(() => store.config.size);

  /** 清掉状态存活计时器。 */
  function clearHold(): void {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  /**
   * 推一次状态机，并按它回的 `holdMs` 排下一次自动迁移。
   *
   * `idle` 回的 `holdMs` 语义不同：它不是「离开 idle」的倒计时，而是「静置多久开始
   * 轮播」，所以到点发的是 `idleTick` 而不是 `timeout`。
   * @param event 发生的事件。
   */
  function dispatch(event: PetEvent): void {
    const before = state.value;
    const next = nextPetState(before, event, store.config);
    // 轮播里每个 idleTick 换下一张；从别的状态进轮播时从头开始
    if (next.state === 'idleLoop') {
      loopIndex.value = before === 'idleLoop' ? nextIdleLoopIndex(loopIndex.value, loopCount()) : 0;
    }
    state.value = next.state;

    clearHold();
    if (next.holdMs === null) return;
    const follow: PetEvent =
      next.state === 'idle' || next.state === 'idleLoop' ? 'idleTick' : 'timeout';
    holdTimer = setTimeout(() => {
      holdTimer = null;
      dispatch(follow);
    }, next.holdMs);
  }

  /**
   * 待机轮播有几条。
   * @returns 条数；没配时是 0。
   */
  function loopCount(): number {
    return store.config.states.idleLoop?.length ?? 0;
  }

  /** 已经转好的 data URL 缓存（同一张图不重复过 IPC）。 */
  const cache = shallowRef(new Map<string, string>());

  /**
   * 「资源那部分配置」的指纹。
   *
   * 配置变更广播是**整份配置**的（大小、时长、图片路径共用一条），而清缓存只在**图片路径
   * 真的变了**的时候才该做——不然拖一次大小滑块就把所有图重新过一遍 IPC（每一步都读盘 +
   * base64），拖起来会一顿一顿的。
   * @returns 只包含影响画面的字段的字符串。
   */
  function visualSignature(): string {
    const { kind, defaultRef, states } = store.config;
    return JSON.stringify([kind, defaultRef, states]);
  }

  /** 上一次见到的资源指纹（用来决定要不要清缓存）。 */
  let lastSignature = visualSignature();

  /**
   * 把当前状态该播的资源变成 `<img src>` 能吃的东西。
   *
   * 走 `image:dataUrl` 而不是 `file://` 或 `tb-media:`：CSP 的 `img-src` 里有 `data:`
   * 但没有那两个，而我们**不为桌宠松 CSP**。主进程那条对 png/gif/webp/svg 是原样回传
   * （**gif 动画不会丢**），其余用 sharp 转 png。
   */
  async function syncSrc(): Promise<void> {
    const ref = resolvePetVisual(store.config, state.value, loopIndex.value);
    // 没配任何资源 → 应用 logo（需求 4）
    if (!ref) {
      src.value = PET_LOGO;
      return;
    }
    const hit = cache.value.get(ref);
    if (hit) {
      src.value = hit;
      return;
    }
    try {
      const url = await getDataUrlApi(ref);
      cache.value.set(ref, url);
      // 等 IPC 回来的这段时间状态可能已经变了，别把过期的图贴上去
      if (resolvePetVisual(store.config, state.value, loopIndex.value) === ref) src.value = url;
    } catch {
      // 图读不出来（被删了、换了盘符）不该让桌宠变成一块空白，回落到 logo
      src.value = PET_LOGO;
    }
  }

  watch([state, loopIndex, () => store.config], () => void syncSrc(), { deep: true });

  /**
   * 展开 / 收起菜单。
   *
   * **先等主进程把窗口放大再显示菜单**：窗口还是精灵那么小的时候画菜单，会被裁掉一大半，
   * 用户看到的是「闪了一下才出来」。
   * @param open 是否展开。
   */
  async function setMenu(open: boolean): Promise<void> {
    if (menuOpen.value === open) return;
    if (open) {
      await petSetMenuOpenApi(true);
      menuOpen.value = true;
    } else {
      menuOpen.value = false;
      await petSetMenuOpenApi(false);
    }
  }

  /** 关菜单（模板里点到菜单外、或菜单项被点掉之后调）。 */
  function closeMenu(): void {
    void setMenu(false);
  }

  /** 把攒着的位移在下一帧发出去（每帧最多一次 IPC）。 */
  function flushMove(): void {
    moveFrame = null;
    if (!pendingDelta) return;
    const { dx, dy } = pendingDelta;
    pendingDelta = null;
    void petDragMoveApi(dx, dy);
  }

  /**
   * 松开指针捕获。
   *
   * 单独抽出来是因为三条路径都要做：正常 `pointerup`、`pointercancel`、以及组件卸载。
   */
  function releaseCapture(): void {
    if (!captureTarget) return;
    const { el, pointerId } = captureTarget;
    captureTarget = null;
    try {
      if ('releasePointerCapture' in el) {
        (el as Element & { releasePointerCapture(id: number): void }).releasePointerCapture(
          pointerId,
        );
      }
    } catch {
      // 指针早就没了（窗口失焦、设备拔了），忽略
    }
  }

  /**
   * 结束一段按下：区分点击与拖拽，并收尾。
   * @param silent 卸载时用：只拆监听、不再推状态机也不再动菜单。
   */
  function finishPointer(silent = false): void {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    releaseCapture();
    if (moveFrame !== null) {
      cancelAnimationFrame(moveFrame);
      moveFrame = null;
    }
    pendingDelta = null;

    const wasDrag = passedThreshold;
    const wasDown = startScreen !== null;
    passedThreshold = false;
    startScreen = null;
    dragging.value = false;
    if (silent || !wasDown) return;

    void petDragEndApi();
    if (wasDrag) {
      dispatch('dragEnd');
      return;
    }
    // 位移没过阈值 = 单击。**只播「点击后」那个动画，不弹菜单**——菜单归右键
    // （review 改的：左键单击弹菜单会和「拖之前先点一下」抢，而且点击本身是需求 3
    // 的一个动画态，它得有自己的手感）
    dispatch('click');
  }

  /**
   * 拖拽中。
   *
   * 位移用 **`screenX/screenY`**（真 Electron 探针量过：它与主进程 `getBounds()` 逐字
   * 相等），不是 `clientX`——窗口自己在跟着动，`clientX` 会一边动一边变，算出来的位移
   * 是错的。
   * @param event 指针事件。
   */
  function onPointerMove(event: PointerEvent): void {
    if (!startScreen) return;
    const dx = event.screenX - startScreen.x;
    const dy = event.screenY - startScreen.y;
    if (!passedThreshold) {
      if (Math.abs(dx) < PET_DRAG_THRESHOLD && Math.abs(dy) < PET_DRAG_THRESHOLD) return;
      passedThreshold = true;
      dragging.value = true;
      void setMenu(false);
      dispatch('dragStart');
    }
    pendingDelta = { dx, dy };
    if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove);
  }

  /** 松手 / 指针被取消。 */
  function onPointerUp(): void {
    finishPointer();
  }

  /**
   * 按在精灵上。
   *
   * **右键 = 弹 / 收菜单**（review 改的：原来是左键单击弹菜单）；**左键 = 拖拽或单击**，
   * 此时还不进 `drag` 态——超过阈值才算拖拽，否则是单击（只播「点击后」的动画）。
   * 中键之类一概不理。
   * @param event 指针事件。
   */
  function onPointerDown(event: PointerEvent): void {
    if (event.button === 2) {
      event.preventDefault();
      void setMenu(!menuOpen.value);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    // 菜单开着也能直接拖。收菜单这件事**交给主进程的 beginPetDrag 一并做掉**，这边只把
    // 自己的标志同步过去（不再发一条 setMenuOpen）：两条 IPC 收同一个菜单，第二条会
    // 撞上「setBounds 刚下发、getBounds 还是旧值」的时序，拖拽基准就会比真实窗口高
    // 一截，第一帧把精灵甩上去 24px。
    menuOpen.value = false;
    startScreen = { x: event.screenX, y: event.screenY };
    passedThreshold = false;

    const el = event.currentTarget;
    if (el instanceof Element && 'setPointerCapture' in el) {
      try {
        el.setPointerCapture(event.pointerId);
        captureTarget = { el, pointerId: event.pointerId };
      } catch {
        // 捕获不到就退回全局监听，拖拽照样能用（只是拖出窗口时可能丢事件）
      }
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    void petDragStartApi();
  }

  onMounted(() => {
    // 主窗口改完设置后，这个窗口的内存快照已经过期：先刷磁盘快照再重灌 store
    offConfigChanged = window.api.pet.onConfigChanged(() => {
      void refreshAppState().then(() => {
        store.hydrate();
        const signature = visualSignature();
        // 只有图片路径真的换了才清缓存（同一路径换了文件内容也算这一档，因为路径串没变——
        // 但那种情况配置本身没变，压根不会有这条广播）
        if (signature !== lastSignature) {
          lastSignature = signature;
          cache.value = new Map();
        }
        void syncSrc();
      });
    });
    void syncSrc();
    // 开局就排上「静置到点进轮播」那条倒计时
    dispatch('timeout');
  });

  onUnmounted(() => {
    clearHold();
    finishPointer(true);
    offConfigChanged?.();
    offConfigChanged = null;
  });

  return { state, src, menuOpen, dragging, size, onPointerDown, closeMenu };
}
