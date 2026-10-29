/** MCP 连接的授权与版本信息，独立于普通插件沙箱。 */
interface McpServerBase {
  id: string;
  name: string;
  enabled: boolean;
  aiEnabled: boolean;
  trusted: boolean;
  revision: string;
}

/** 通过独立本地程序的标准输入输出连接。 */
export interface McpStdioConfig extends McpServerBase {
  transport: 'stdio';
  executable: string;
  args: string[];
  cwd: string;
}

/** Streamable HTTP 连接；请求头只交给指定服务，不暴露给 AI。 */
export interface McpHttpConfig extends McpServerBase {
  transport: 'http';
  url: string;
  headers: Record<string, string>;
}

/** 已校验的 MCP 连接配置；旧配置载入时补充 stdio 类型。 */
export type McpServerConfig = McpStdioConfig | McpHttpConfig;

/** MCP 工具的原始 JSON Schema，仅作为数据展示；参数由 MCP 服务校验。 */
export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
