import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  PET_CONFIG_DEFAULT,
  normalizePetConfig,
  type PetConfig,
  type PetResourceKind,
  type PetStateMap,
} from '@shared/pet';
import { clampPetSize } from '@shared/petWindow';
import { flushAppState, readState, writeState } from '@/services/appState';
import { petApplyConfigApi } from '@/services/pet';

/** 桌宠配置在应用状态里的命名空间（**渲染进程整块写**）。 */
const PET_NS = 'pet';

/**
 * 拖大小的落盘防抖（ms）。
 *
 * 滑块一路拖会一路发值，每一步都「落盘 + 广播 + 让另一个窗口重读」就是刷爆写盘。
 * 窗口尺寸本身**不等这个防抖**（见 {@link usePetStore} 的 `setSize`），所以拖起来
 * 仍然是实时的。
 */
const SIZE_COMMIT_MS = 120;

/**
 * 桌宠配置 store。
 *
 * 只管**配置**：资源类型、五个状态的动画映射、大小、三个时长。窗口位置与「上次是不是
 * 停在桌宠模式」在**另一个命名空间** `petWindow` 里，由主进程写——两边都整块覆盖写，
 * 混在一起必然互相抹掉（`ai` / `aiWindow` 那对已经踩过这个坑）。
 *
 * 两个窗口都会用它：主窗口的设置页写，桌宠窗口读。所以有 {@link hydrate}。
 */
export const usePetStore = defineStore('pet', () => {
  // #region state
  /** 全部桌宠配置。脏数据由 `normalizePetConfig` 兜住，它任何输入都不抛。 */
  const config = ref<PetConfig>(normalizePetConfig(readState<unknown>(PET_NS)));
  /** 拖大小的落盘防抖计时器（见 {@link SIZE_COMMIT_MS}）。 */
  let sizeTimer: ReturnType<typeof setTimeout> | null = null;
  // #endregion

  // #region actions
  /**
   * 持久化并让主进程跟着调整窗口。
   *
   * 两件事必须一起做：大小是配置里的字段，但**窗口尺寸只有主进程改得了**；而且桌宠窗口
   * 是另一个 BrowserWindow，它的应用状态快照在这次写盘后就过期了，得由主进程通知它重读。
   *
   * **顺序是这个函数的全部要点：先 `flushAppState()` 落盘，再让主进程广播。**
   * `writeState` 是 300ms 防抖的，不 flush 的话主进程手里还是上一版配置，而桌宠 /
   * AI 窗口收到「配置变了」后会 `refreshAppState()` 去读主进程那一份——读回来的正是
   * 旧值。表现就是 review 报的那个 bug：**「桌宠图片每次都停留在上一次改的那张」**
   * （改第二次才看到第一次选的图）。这个 bug 没有任何报错，只能靠这条顺序防住。
   */
  function persist(): void {
    // 必须转成纯对象：reactive 代理跨 IPC 会在运行期抛 "could not be cloned"，
    // typecheck 与 build 都拦不住（本仓库已踩过多次）
    const plain: PetConfig = {
      ...config.value,
      states: { ...config.value.states, idleLoop: [...(config.value.states.idleLoop ?? [])] },
    };
    if (plain.states.idleLoop?.length === 0) delete plain.states.idleLoop;
    writeState(PET_NS, plain);
    void flushAppState()
      .then(() => petApplyConfigApi(plain.size))
      .catch(() => {
        // 桌宠没开着时这条本来就没什么可做的，静默
      });
  }

  /**
   * 按磁盘上的最新状态重新灌一遍。
   *
   * **多窗口才需要**：桌宠是独立窗口，用户在主窗口设置页改完配置后，这边的 store 还停在
   * 打开时读到的那份。配合 `refreshAppState()` 用（先刷内存快照，再 hydrate）。
   */
  function hydrate(): void {
    const next = normalizePetConfig(readState<unknown>(PET_NS));
    // 正在拖大小时磁盘上那份必然落后于手上这份（落盘是防抖的，见 setSize），
    // 照原样灌回去会把用户刚拖到的值抹掉，滑块会一跳一跳地往回弹
    if (sizeTimer) next.size = config.value.size;
    config.value = next;
  }

  /**
   * 换资源类型。
   * @param kind 图片 / spine / live2d（后两者分别是 #26b / #26c 的事）。
   */
  function setKind(kind: PetResourceKind): void {
    config.value.kind = kind;
    persist();
  }

  /**
   * 设默认资源。**留空 = 用应用 logo**（需求 4）。
   * @param ref 图片模式下是文件绝对路径，spine/live2d 下是默认动画名。
   */
  function setDefaultRef(ref: string): void {
    config.value.defaultRef = ref.trim();
    persist();
  }

  /**
   * 设某个状态的映射。**留空 = 回落到默认资源**（需求 3）。
   * @param state 五个状态之一（`idleLoop` 走 {@link setIdleLoop}）。
   * @param ref 映射到的资源；空串表示清掉这条映射。
   */
  function setStateRef(state: Exclude<keyof PetStateMap, 'idleLoop'>, ref: string): void {
    const value = ref.trim();
    if (value) config.value.states[state] = value;
    else delete config.value.states[state];
    persist();
  }

  /**
   * 设待机轮播的 N 条。
   * @param refs 轮播条目；空串会被剔掉（空 `<img src>` 会去请求当前页面）。
   */
  function setIdleLoop(refs: string[]): void {
    const list = refs.map((r) => r.trim()).filter((r) => r !== '');
    if (list.length > 0) config.value.states.idleLoop = list;
    else delete config.value.states.idleLoop;
    persist();
  }

  /**
   * 设 AI 对话里助手的头像。**留空 = 用应用 logo**。
   *
   * 存在桌宠配置里而不是 AI 配置里：头像属于「这只小精灵长什么样」，不属于「连哪个模型」，
   * 所以换桌宠就换一套形象，AI 那边的多份厂商配置一个字都不用动。
   * @param ref 图片文件绝对路径；空串表示回落到 logo。
   */
  function setAiAvatarRef(ref: string): void {
    config.value.aiAvatarRef = ref.trim();
    persist();
  }

  /**
   * 设桌宠大小。**滑块会一路拖，所以这条与别的 setter 不一样**：
   *
   * - **窗口尺寸立刻跟上**（`petApplyConfigApi` 的参数就是这个数，主进程不读盘），
   *   所以桌宠菜单里那个滑块拖起来是实时缩放的；
   * - **落盘 + 广播防抖 {@link SIZE_COMMIT_MS} ms**，否则拖一次滑块就是几十次写盘、
   *   几十次「让另一个窗口重读配置」。
   * @param size 边长（会被夹进合法区间）。
   */
  function setSize(size: number): void {
    const next = clampPetSize(size);
    if (config.value.size === next) return;
    config.value.size = next;
    void petApplyConfigApi(next).catch(() => {
      // 桌宠没开着时没什么可做的，静默
    });
    if (sizeTimer) clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      sizeTimer = null;
      // 这里会再 apply 一次（幂等的 setBounds），要的是它顺带发出的那条「配置变了」广播
      persist();
    }, SIZE_COMMIT_MS);
  }

  /**
   * 设三个时长中的一个。
   * @param key 静置进轮播 / 瞬时态 / 轮播每张停留。
   * @param ms 毫秒（会被夹进合法区间）。
   */
  function setTiming(key: 'idleAfterMs' | 'transientMs' | 'idleLoopMs', ms: number): void {
    config.value = normalizePetConfig({ ...config.value, [key]: ms });
    persist();
  }

  /** 恢复默认配置（把五个状态的映射也一起清掉）。 */
  function reset(): void {
    config.value = { ...PET_CONFIG_DEFAULT, states: {} };
    persist();
  }
  // #endregion

  return {
    config,
    hydrate,
    setKind,
    setDefaultRef,
    setStateRef,
    setIdleLoop,
    setAiAvatarRef,
    setSize,
    setTiming,
    reset,
  };
});
