import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 应用级基础 store（占位）。
 * 用于 P0-2 验证 Pinia 接入，后续会被具体业务 store 取代/补充。
 */
export const useAppStore = defineStore('app', () => {
  // #region state
  const ready = ref(true);
  // #endregion

  return { ready };
});
