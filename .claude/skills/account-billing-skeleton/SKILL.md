---
name: account-billing-skeleton
description: Toolbox 账号/计费横切骨架——权限门面、user store、auth/billing 服务层(mock)、ProGuard、env 开关、账号入口
---

# 账号与计费骨架（P0 预留）

横切能力的"接缝"预留：现在零成本搭好结构，后端就绪后只填实现、不改各工具页。基于 [[common-capabilities]]。见 docs/PLAN.md 第 4 节。

## 三条原则

1. **调用方无感**：页面只问"我能用吗"（`can(featureKey)` / `<ProGuard>`），不关心免费/付费/登录。
2. **默认全放行**：`VITE_ENABLE_ACCOUNT=false` 时 `can()` 恒真、账号入口不渲染，不影响任何现有功能。
3. **可开关**：所有账号/计费能力受 env 开关控制。

## 文件与职责

- `.env` — `VITE_ENABLE_ACCOUNT`（默认 false）、`VITE_API_BASE`（空=mock）。类型在 `src/env.d.ts` 的 `ImportMetaEnv`。
- `src/constants/config.ts` — `ACCOUNT_ENABLED`、`API_BASE`，集中读取 env（勿散落 import.meta.env）。
- `src/types/account.d.ts` — `User`/`Plan`/`AuthTokens`/`LoginPayload`/`LoginResult`；`PlanTier` 复用 `FeatureTier`(free|pro，定义在 types/navigation)。
- `src/services/auth.ts` — `login/logout/refresh`，签名已定；`API_BASE` 为空走 mock（任意账号=免费用户），非空处 TODO 留真实请求。
- `src/services/billing.ts` — `fetchPlan()`，同上 mock。
- `src/stores/user.ts` — `useUserStore`：state `user/tokens/plan/loading/error`，getter `isLoggedIn/isPro`，action `login/logout/refresh`（经 authService，含 loading/error）。
- `src/composables/useEntitlement.ts` — **权限门面（唯一入口）**：`can(featureKey)`。策略：账号关闭→放行；功能 free→放行；pro→需 isLoggedIn && isPro。featureKey→tier 表由 NAV_ITEMS 构建（当前全 free）。
- `src/components/common/ProGuard.vue` — 付费墙：`can` 为真透明渲染 slot；否则显示"升级 Pro"占位。用法 `<ProGuard feature-key="xxx"><工具内容/></ProGuard>`。
- `src/components/layout/AccountEntry.vue` — 顶部账号入口：账号关闭不渲染；未登录=登录按钮；已登录=头像下拉（个人中心/退出）。已挂到 TitleBar right 区。

## 后端就绪后（P7）要做

- services/auth、billing 内 TODO 处接真实 API（token 拦截器、401 刷新、Electron safeStorage 存 token）。
- NAV_ITEMS 里要收费的功能把 `tier` 改为 `'pro'`（**只改数据，页面逻辑不动**）。
- 用 `<ProGuard>` 包住付费工具的操作区；付费墙"升级"跳真实付费流程。
- `VITE_ENABLE_ACCOUNT=true` + 配 `VITE_API_BASE`。

## 关键约定

- 判断功能可用**只走 `useEntitlement().can()`**，不要在页面里散写 tier/登录判断。
- 收费与否是**数据**（NAV_ITEMS 的 tier），不是代码分支。
- 账号 UI 一律受 `accountEnabled` 门控。

## 验证

`format/lint/typecheck/build/dev` 全绿。默认 env 下：无账号入口、所有功能放行（与骨架前行为一致）。将 `VITE_ENABLE_ACCOUNT=true` 可见登录按钮（mock 登录为免费用户）。
