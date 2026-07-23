import type { Plan } from '@/types/account';
import { API_BASE } from '@/constants/config';

/**
 * 计费服务：接口签名先定，当前走本地 mock。
 * 后端就绪后替换内部实现，调用方不变。
 */

/**
 * 获取当前用户套餐。
 * @returns 套餐信息；未接后端时返回免费套餐。
 */
export async function fetchPlanApi(): Promise<Plan> {
  if (!API_BASE) return { tier: 'free', expiresAt: null };
  // TODO: 接后端 — GET `${API_BASE}/billing/plan`
  throw new Error('真实套餐接口尚未接入');
}
