/**
 * 应用运行时配置（读取自 env）。
 * 集中读取，避免散落的 import.meta.env 访问。
 */

/** 是否启用账号/计费能力。关闭时全部功能免费放行、不接后端。 */
export const ACCOUNT_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNT === 'true';

/** 后端 API 基址；空串表示走本地 mock。 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? '';
