/** 插件接口版本 1：只允许 JSON 数据经过宿主边界。 */
export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** 支持的 JSON Schema 子集；拒绝未知关键词，避免声明与执行语义不一致。 */
export interface PluginSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  title?: string;
  description?: string;
  properties?: Record<string, PluginSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: PluginSchema;
  enum?: JsonValue[];
  default?: JsonValue;
}

/** 按能力或精确网络来源授权，不接受任意文件路径。 */
export type PluginPermission =
  | 'files.readSelected'
  | 'files.save'
  | 'storage'
  | 'tools.image'
  | 'tools.media'
  | 'tools.diff'
  | 'tools.webtest'
  | `network:${string}`;

/** UI 与 AI 共用的命令声明。 */
export interface PluginCommand {
  id: string;
  title: string;
  description: string;
  ai?: boolean;
  inputSchema: PluginSchema;
  outputSchema: PluginSchema;
}

/** command 生成表单；entry 打开隔离的静态 HTML 页面。 */
export interface PluginPage {
  id: string;
  title: string;
  category: 'file' | 'dev' | 'image' | 'font' | 'media' | 'network' | 'more';
  command?: string;
  entry?: string;
}

/** 插件包 manifest.json 的稳定公开契约。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  description: string;
  entry: string;
  permissions: PluginPermission[];
  contributes: { commands: PluginCommand[]; pages: PluginPage[] };
}

/** 安装记录仅保存相对包路径；迁移后继续从 dataPath 解析。 */
export interface PluginRecord {
  manifest: PluginManifest;
  revision: string;
  previous?: { manifest: PluginManifest; revision: string };
  enabled: boolean;
  aiEnabled: boolean;
  grants: PluginPermission[];
  installedAt: string;
}

/** 导入后先审阅，commit 前不执行插件代码。 */
export interface PluginCandidate {
  token: string;
  manifest: PluginManifest;
  currentVersion?: string;
  addedPermissions: PluginPermission[];
  files: string[];
  changedFiles: string[];
}

/** 有界诊断，不落入聊天或系统设置。 */
export interface PluginLog {
  time: string;
  level: 'info' | 'error';
  message: string;
}

/** 宿主表单发起的命令；requestId 同时用于取消所有权。 */
export interface PluginRunRequest {
  pluginId: string;
  command: string;
  input: JsonValue;
  requestId: string;
}

/** 文件句柄只在当前运行实例有效，不携带绝对路径。 */
export interface PluginFile {
  handle: string;
  name: string;
  size: number;
}

/** 预览主题快照，插件不能访问宿主 store。 */
export interface PluginTheme {
  primaryColor: string;
  mode: 'dark' | 'light';
}

/** 本次应用会话内的开发目录监听，不随插件包导出。 */
export interface PluginDevelopment {
  id: string;
  directory: string;
  token: string;
  updatedAt: string;
  error: string;
}

/** 已安装或已卸载插件保留的数据。 */
export interface PluginStorageInfo {
  id: string;
  name: string;
  installed: boolean;
  bytes: number;
}
