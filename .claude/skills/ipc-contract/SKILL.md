---
name: ipc-contract
description: Toolbox IPC 统一返回契约 {code,data,message}——主进程 handle wrapper、渲染 unwrap 解包、全局 feedback 提示
---

# IPC 统一返回契约（P1 优化）

业务型 IPC 统一返回 `{code, data, message}`，渲染进程统一解包并按需提示。基于 [[common-capabilities]]。

## 契约

- `electron/shared/types.ts`：`IpcResponse<T> = { code: IpcCode; data: T | null; message: string }`；`IPC_CODE`（ok=0 / error=1 / invalidParam=2）。
- **成功** code=0、data 有值；**失败** code≠0、data=null、message 为错误描述。

## 主进程

- `electron/main/ipc/helper.ts` 的 **`handle(channel, fn)`**：替代 `ipcMain.handle`。fn 正常返回值自动包成 code=0；抛异常自动 catch 成 code=1 + message，并 `console.error` 留痕。
- 业务 handler（dialog/image）只写正常逻辑、正常 return / throw，**不手写 try-catch 拼返回结构**。
- **窗口控制/ping 不走此契约**（非业务接口，无需提示），仍用 `ipcMain.handle`。

## 渲染进程

- `src/utils/feedback.ts`：全局 message 持有器。`setMessageApi()` 在 `AppLayout`（MessageProvider 内）用 `useMessage()` 注册一次；`showError/showSuccess/showInfo` 供**非组件上下文**（services）调用。未注册时 showError 降级 console。
- `src/services/ipc.ts` 的 **`unwrap(promise, options?)`**：解包。成功返回 data；失败默认弹错误提示（`showError`）并抛异常。
  - `options.silent`：true 则不弹提示（默认 false=显示）。
  - `options.errorPrefix`：错误前缀，如「压缩失败」。
- services 各方法用 unwrap 包 `window.api.*`：
  - fs：pickFiles/pickDirectory → 默认提示（errorPrefix）。
  - image：thumbnail/compress → `silent:true`（缩略图静默、压缩由行状态体现）；dataUrl → 提示。

## 关键约定

- 新增业务 IPC：主进程用 `handle`，preload 返回类型标 `Promise<IpcResponse<T>>`，renderer service 用 `unwrap` 包裹。
- **services 导出的 API 函数一律加 `Api` 后缀**（`pickFilesApi`/`compressImageApi`/`loginApi` 等）；内部工具（unwrap）不加。
- **提示是否显示由 service 层通过 unwrap 的 silent 控制**（默认显示）；组件内不要再对同一错误重复 message，避免双弹。
- 批量/逐条处理场景用 `silent:true`，错误落到每行 status/error 上更合适。

## 验证

`format/lint/typecheck/build/dev` 全绿。失败路径：主进程 handler 抛错 → 渲染 unwrap 收到 code≠0 → 默认弹 message（silent 时不弹）。
