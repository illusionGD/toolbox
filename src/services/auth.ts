import type { LoginPayload, LoginResult } from '@/types/account';
import { API_BASE } from '@/constants/config';

/**
 * 认证服务：接口签名先定，当前走本地 mock。
 * 后端就绪后把各方法内部替换为对 API_BASE 的真实请求即可，调用方不变。
 */

/**
 * 登录。
 * @param payload 账号与密码。
 * @returns 用户信息、令牌与套餐。
 */
export async function loginApi(payload: LoginPayload): Promise<LoginResult> {
  if (!API_BASE) {
    // mock：任意账号登录为免费用户
    return {
      user: { id: 'mock-user', name: payload.account || '体验用户' },
      tokens: { accessToken: 'mock-access', refreshToken: 'mock-refresh' },
      plan: { tier: 'free', expiresAt: null },
    };
  }
  // TODO: 接后端 — POST `${API_BASE}/auth/login`
  throw new Error('真实登录接口尚未接入');
}

/**
 * 登出。
 * @returns 完成即 resolve。
 */
export async function logoutApi(): Promise<void> {
  if (!API_BASE) return;
  // TODO: 接后端 — POST `${API_BASE}/auth/logout`
}

/**
 * 用 refreshToken 刷新访问令牌。
 * @param refreshToken 刷新令牌。
 * @returns 新的访问令牌。
 */
export async function refreshApi(refreshToken: string): Promise<string> {
  if (!API_BASE) return 'mock-access';
  // TODO: 接后端 — POST `${API_BASE}/auth/refresh`
  void refreshToken;
  throw new Error('真实刷新接口尚未接入');
}
