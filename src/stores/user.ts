import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AuthTokens, LoginPayload, Plan, User } from '@/types/account';
import * as authService from '@/services/auth';

/**
 * 账号 store：管理登录态、用户信息与套餐。
 * 当前走 mock（见 services/auth），后端就绪后无需改动调用方。
 */
export const useUserStore = defineStore('user', () => {
  // #region state
  const user = ref<User | null>(null);
  const tokens = ref<AuthTokens | null>(null);
  const plan = ref<Plan>({ tier: 'free', expiresAt: null });
  const loading = ref(false);
  const error = ref<string | null>(null);
  // #endregion

  // #region getters
  const isLoggedIn = computed(() => user.value !== null);
  const isPro = computed(() => plan.value.tier === 'pro');
  // #endregion

  // #region actions
  /**
   * 登录。
   * @param payload 账号与密码。
   * @returns 登录是否成功。
   */
  async function login(payload: LoginPayload): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const result = await authService.loginApi(payload);
      user.value = result.user;
      tokens.value = result.tokens;
      plan.value = result.plan;
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '登录失败';
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** 登出并清空本地登录态。 */
  async function logout(): Promise<void> {
    try {
      await authService.logoutApi();
    } finally {
      user.value = null;
      tokens.value = null;
      plan.value = { tier: 'free', expiresAt: null };
    }
  }

  /**
   * 刷新访问令牌。
   * @returns 刷新是否成功。
   */
  async function refresh(): Promise<boolean> {
    if (!tokens.value) return false;
    try {
      const accessToken = await authService.refreshApi(tokens.value.refreshToken);
      tokens.value = { ...tokens.value, accessToken };
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '刷新登录失败';
      return false;
    }
  }
  // #endregion

  return { user, tokens, plan, loading, error, isLoggedIn, isPro, login, logout, refresh };
});
