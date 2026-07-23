import { onMounted, onUnmounted, readonly, ref } from 'vue';

/** 全局共享的最大化状态，供标题栏与布局同时使用。 */
const isMaximized = ref(false);
let disposeListener: (() => void) | undefined;
let subscriberCount = 0;

/**
 * 无边框窗口的窗控能力与最大化状态。
 * 多处调用共享同一状态；首个订阅者建立监听，最后一个卸载时清理。
 * @returns 最大化状态（只读）与 minimize/toggleMaximize/close 方法。
 */
export function useWindowControls() {
  onMounted(async () => {
    subscriberCount += 1;
    if (subscriberCount === 1) {
      isMaximized.value = await window.api.window.isMaximized();
      disposeListener = window.api.window.onMaximizeChange((maximized) => {
        isMaximized.value = maximized;
      });
    }
  });

  onUnmounted(() => {
    subscriberCount -= 1;
    if (subscriberCount === 0) {
      disposeListener?.();
      disposeListener = undefined;
    }
  });

  /** 最小化窗口。 */
  function minimize(): void {
    void window.api.window.minimize();
  }

  /** 切换最大化/还原。 */
  function toggleMaximize(): void {
    void window.api.window.toggleMaximize();
  }

  /** 关闭窗口。 */
  function close(): void {
    void window.api.window.close();
  }

  return { isMaximized: readonly(isMaximized), minimize, toggleMaximize, close };
}
