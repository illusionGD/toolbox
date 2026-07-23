import type { FeatureTier } from '@/types/navigation';

/** 用户套餐层级，与功能的 FeatureTier 对应。 */
export type PlanTier = FeatureTier;

/** 登录用户信息。 */
export interface User {
  /** 用户 id。 */
  id: string;
  /** 昵称。 */
  name: string;
  /** 头像 URL，可空。 */
  avatar?: string;
  /** 邮箱，可空。 */
  email?: string;
}

/** 用户当前套餐。 */
export interface Plan {
  /** 套餐层级。 */
  tier: PlanTier;
  /** 到期时间戳（毫秒），null 表示无到期（如免费/永久）。 */
  expiresAt: number | null;
}

/** 登录凭证。 */
export interface AuthTokens {
  /** 访问令牌。 */
  accessToken: string;
  /** 刷新令牌。 */
  refreshToken: string;
}

/** 登录请求参数。 */
export interface LoginPayload {
  /** 账号（邮箱/用户名）。 */
  account: string;
  /** 密码。 */
  password: string;
}

/** 登录结果。 */
export interface LoginResult {
  /** 用户信息。 */
  user: User;
  /** 令牌。 */
  tokens: AuthTokens;
  /** 套餐。 */
  plan: Plan;
}
