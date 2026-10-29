import { unwrap } from './ipc';
/** @param source 插件或草稿。 @returns 导出路径或取消。 */
export const exportPluginApi = (source: { id?: string; token?: string }) =>
  unwrap(window.api.plugins.export(source));
/** @returns 开发监听列表。 */
export const pluginDevelopmentApi = () => unwrap(window.api.plugins.development());
/** @returns 用户选择的开发目录监听。 */
export const startPluginDevelopmentApi = () => unwrap(window.api.plugins.startDevelopment());
/** @param id 监听标识。 @returns 停止完成。 */
export const stopPluginDevelopmentApi = (id: string) =>
  unwrap(window.api.plugins.stopDevelopment(id));
/** @returns 插件存储列表。 */
export const pluginStorageInfoApi = () => unwrap(window.api.plugins.storageInfo());
/** @param id 用户确认的数据归属。 @returns 清理完成。 */
export const clearPluginStorageApi = (id: string) => unwrap(window.api.plugins.clearStorage(id));
/** @param theme 当前主题。 @returns 同步完成。 */
export const updatePluginThemeApi = (theme: PluginTheme) => unwrap(window.api.plugins.theme(theme));
/** @param token 用户确认丢弃的草稿。 @returns 完成。 */
export const discardCandidateApi = (token: string) => unwrap(window.api.plugins.discard(token));
/** @param token 候选。 @param name 包内文件。 @returns 前后文本。 */
export const candidateFileApi = (token: string, name: string) =>
  unwrap(window.api.plugins.candidateFile(token, name));
import type {
  JsonValue,
  PluginPermission,
  PluginRunRequest,
  PluginTheme,
} from '@shared/plugins/types';

/** @returns 安装列表。 */
export const listPluginsApi = () => unwrap(window.api.plugins.list(), { silent: true });
/** @returns 本次会话候选。 */
export const pluginCandidatesApi = () => unwrap(window.api.plugins.candidates(), { silent: true });
/** @param directory 是否选择目录。 @returns 候选或取消。 */
export const stagePluginApi = (directory: boolean) => unwrap(window.api.plugins.stage(directory));
/** @param token 候选标识。 @returns 安装记录。 */
export const installPluginApi = (token: string) => unwrap(window.api.plugins.install(token));
/** @param id 插件。 @param enabled 启用。 @param ai AI 授权。 @param grants 能力。 @returns 保存完成。 */
export const configurePluginApi = (
  id: string,
  enabled: boolean,
  ai: boolean,
  grants: PluginPermission[],
) => unwrap(window.api.plugins.configure(id, enabled, ai, grants));
/** @param id 插件。 @param action 操作。 @returns 操作完成。 */
export const changePluginApi = (id: string, action: 'uninstall' | 'rollback') =>
  unwrap(window.api.plugins.change(id, action));
/** @param request 命令输入。 @returns JSON 输出。 */
export const runPluginApi = (request: PluginRunRequest) =>
  unwrap(window.api.plugins.run(request), { silent: true });
/** @param requestId 任务。 @returns 取消完成。 */
export const cancelPluginApi = (requestId: string) =>
  unwrap(window.api.plugins.cancel(requestId), { silent: true });
/** @param token 候选。 @param command 命令。 @param input 输入。 @param requestId 任务。 @returns 输出。 */
export const previewPluginApi = (
  token: string,
  command: string,
  input: JsonValue,
  requestId: string,
) => unwrap(window.api.plugins.preview(token, command, input, requestId), { silent: true });
/** @param id 插件。 @returns 诊断。 */
export const pluginLogsApi = (id: string) => unwrap(window.api.plugins.logs(id));
/** @param id 插件。 @param page 页面。 @param theme 主题。 @returns 窗口打开完成。 */
export const openPluginPageApi = (id: string, page: string, theme: PluginTheme) =>
  unwrap(window.api.plugins.openPage(id, page, theme));
/** @returns 关闭当前页面的隔离窗口。 */
export const closePluginPageApi = () => unwrap(window.api.plugins.closePage(), { silent: true });
/** @param callback 列表更新回调。 @returns 退订函数。 */
export const onPluginsChangedApi = (callback: () => void) => window.api.plugins.onChanged(callback);
