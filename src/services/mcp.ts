import { unwrap } from './ipc';
import type { McpServerConfig } from '@shared/plugins/mcp';

/** @returns 本地 stdio 与 HTTP 连接列表。 */
export const listMcpApi = () => unwrap(window.api.plugins.mcpList());
/** @param config 已由用户确认的 MCP 连接配置。 @returns 保存完成。 */
export const saveMcpApi = (config: McpServerConfig) => unwrap(window.api.plugins.mcpSave(config));
/** @param id 移除连接。 @returns 完成。 */
export const removeMcpApi = (id: string) => unwrap(window.api.plugins.mcpRemove(id));
/** @returns 用户选择的程序路径。 */
export const pickMcpApi = () => unwrap(window.api.plugins.mcpPick());
/** @param request 发现或执行请求。 @returns MCP 响应。 */
export const runMcpApi = (request: {
  id: string;
  requestId: string;
  tool?: string;
  input?: unknown;
}) => unwrap(window.api.plugins.mcpRun(request), { silent: true });
/** @param id 请求 ID。 @returns 取消完成。 */
export const cancelMcpApi = (id: string) => unwrap(window.api.plugins.mcpCancel(id));
