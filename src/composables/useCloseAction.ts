/**
 * 「关闭主窗口时」这个设置的渲染进程侧状态。
 *
 * 模块级 `ref` 而不是 Pinia store（照 [useWindowControls.ts](./useWindowControls.ts) 的先例）：
 * 只有一个枚举值，两处要读它（设置页的 radio、确认弹窗的初始勾选态），开一个 store 是纯开销。
 *
 * **这里永远不 `writeState`。** `appWindow` 命名空间的唯一写方是主进程——`close` 处理器是
 * 同步的，生效的动作必须在主进程有一份缓存，两边都整块写就会互相抹掉（同 `PetWindowState`
 * 的注释）。所以本文件只做两件事：`readState` 读初值，改动走 IPC。
 */
import { readonly, ref } from 'vue';
import {
  APP_CLOSE_ACTION_DEFAULT,
  normalizeCloseAction,
  type AppCloseAction,
} from '@shared/appWindow';
import type { AppWindowState } from '@shared/types';
import { readState } from '@/services/appState';
import { setCloseActionApi } from '@/services/appWindow';

/** 关闭主窗口时的动作，全局共享。 */
const action = ref<AppCloseAction>(APP_CLOSE_ACTION_DEFAULT);
/** 是否已经从应用状态里读过初值（读一次就够，之后由本模块自己维护）。 */
let loaded = false;

/**
 * 关闭行为的读写。
 * @returns 当前动作（只读）与两个改法。
 */
export function useCloseAction() {
  if (!loaded) {
    loaded = true;
    // 同步读内存快照（`initAppState()` 在 main.ts 里已经 await 过了）
    action.value = normalizeCloseAction(readState<AppWindowState>('appWindow')?.closeAction);
  }

  /**
   * 改设置：先乐观改本地（radio 立刻跟手），再推给主进程，最后用它归一化后的结果回填。
   * @param next 新动作。
   */
  async function setAction(next: AppCloseAction): Promise<void> {
    const previous = action.value;
    action.value = next;
    try {
      action.value = await setCloseActionApi(next);
    } catch {
      // 主进程没收下就退回去，别让界面显示一个其实没生效的值
      action.value = previous;
    }
  }

  /**
   * 弹窗里勾了「记住我的选择」之后同步本地。
   *
   * **只改本地**：主进程在 `resolveClose(choice, true)` 里已经存过了，再发一趟 IPC 是重复写。
   * 少了这个函数的表现是——「勾记住 + 最小化到托盘」，从托盘回来打开设置页，radio 还停在
   * 「每次询问」（盘上是对的，界面是旧的）。
   * @param next 记下来的那个动作。
   */
  function markRemembered(next: AppCloseAction): void {
    action.value = normalizeCloseAction(next);
  }

  return { action: readonly(action), setAction, markRemembered };
}
