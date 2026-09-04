/**
 * AI 厂商与模型清单（主/渲染共享）。
 *
 * 放 shared 而不是各存一份，理由同 `shared/audio.ts`：**两端都要用同一份**——
 * 主进程按 protocol 造 SDK provider、按 `vision` 拦非视觉模型的图片；渲染进程拿
 * 同一份渲染厂商/模型下拉与「该模型不支持图片」的禁用态。各存一份必然漂移。
 *
 * 模型清单是**用户给定的写死清单**（需求第 6 条），不做联网拉取：各家 /models
 * 接口的形状、鉴权、可见范围都不同，且很多兼容端点根本没这个接口。清单里的 id
 * 直接作为请求里的 model 值下发（AI SDK 的 model id 是宽松字符串，不校验白名单）。
 */

/**
 * 请求协议。九个厂商只有四种协议：
 * 除 anthropic / openai / google 三家自有协议外，其余全是 OpenAI 兼容端点。
 */
export type AiProtocol = 'anthropic' | 'openai' | 'google' | 'openai-compat';

/** 厂商元信息。 */
export interface AiProviderInfo {
  /** 厂商 id（模型清单里的 provider 字段与它对应）。 */
  id: string;
  /** 界面显示名。 */
  label: string;
  /** 走哪套协议。 */
  protocol: AiProtocol;
  /**
   * 默认 base URL **种子值**，不是实测结论——没有各家真 key 量不出来，
   * 每个配置都可改，真正的验证手段是配置卡上的「测试连接」。
   *
   * 注意末尾的版本段（`/v1`、`/v1beta`、`/v4`）**必须带上**：实测 SDK 是在
   * baseURL 后直接拼 `/messages`、`/chat/completions`、`/models/x:streamGenerateContent`，
   * 少一段就是 404。
   */
  defaultBaseUrl: string;
  /** 去哪申请 key 的提示。 */
  keyHint: string;
}

/** 模型元信息。 */
export interface AiModelInfo {
  /** 下发给接口的 model 值。 */
  id: string;
  /** 界面显示名。 */
  label: string;
  /** 所属厂商 id。 */
  provider: string;
  /** 是否支持图片输入。false 时上传入口禁用。 */
  vision: boolean;
}

/** 厂商清单。顺序即下拉顺序。 */
export const AI_PROVIDERS: readonly AiProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    keyHint: 'console.anthropic.com 申请，形如 sk-ant-…',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHint: 'platform.openai.com 申请，形如 sk-…',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    protocol: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    keyHint: 'aistudio.google.com 申请 API key',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'platform.deepseek.com 申请',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    keyHint: 'open.bigmodel.cn 申请',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    protocol: 'openai-compat',
    // 留空要求用户自己填：MiniMax 国内/海外站点域名不同，猜一个填进去只会让
    // 报错更难查
    defaultBaseUrl: '',
    keyHint: '在 MiniMax 开放平台取 key，并把它的 OpenAI 兼容地址填进上面',
  },
  {
    id: 'kimi',
    label: 'Kimi 月之暗面',
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    keyHint: 'platform.moonshot.cn 申请',
  },
  {
    id: 'qwen',
    label: '通义千问',
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    keyHint: 'dashscope 控制台申请（用兼容模式地址）',
  },
  {
    id: 'openai-compat',
    label: '其他 OpenAI 兼容',
    protocol: 'openai-compat',
    defaultBaseUrl: '',
    keyHint: 'xAI / 混元 / 豆包等：填各自的 OpenAI 兼容地址与 key',
  },
];

/**
 * 模型清单（用户给定，逐条照抄，未增删）。
 * `vision` 决定图片上传入口是否可用。
 */
export const AI_MODELS: readonly AiModelInfo[] = [
  // ---- anthropic ----
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'anthropic', vision: true },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'anthropic', vision: true },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'anthropic', vision: true },
  { id: 'claude-opus-4-1', label: 'Claude Opus 4.1', provider: 'anthropic', vision: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', vision: true },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', vision: true },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 (20251001)',
    provider: 'anthropic',
    vision: true,
  },
  { id: 'claude-haiku-4.5', label: 'Claude Haiku 4.5', provider: 'anthropic', vision: true },
  {
    id: 'claude-3-5-haiku-20241022',
    label: 'Claude 3.5 Haiku (20241022)',
    provider: 'anthropic',
    vision: true,
  },
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'anthropic', vision: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'anthropic', vision: true },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'anthropic', vision: true },

  // ---- openai ----
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', vision: true },
  { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', vision: true },
  { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', provider: 'openai', vision: true },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'openai', vision: true },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', provider: 'openai', vision: false },
  { id: 'gpt-5.3-chat', label: 'GPT-5.3 chat', provider: 'openai', vision: true },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 codex', provider: 'openai', vision: false },
  { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai', vision: true },
  { id: 'gpt-5.2-codex', label: 'GPT-5.2 codex', provider: 'openai', vision: false },
  { id: 'gpt-5-nano', label: 'GPT-5 nano', provider: 'openai', vision: false },
  { id: 'gpt-4.5-preview', label: 'GPT-4.5 preview', provider: 'openai', vision: true },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai', vision: true },
  { id: 'gpt-4', label: 'GPT-4', provider: 'openai', vision: true },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', vision: true },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', provider: 'openai', vision: true },
  { id: 'o1', label: 'o1', provider: 'openai', vision: false },
  { id: 'o1-mini', label: 'o1-mini', provider: 'openai', vision: false },
  { id: 'o3-mini', label: 'o3-mini', provider: 'openai', vision: false },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'openai', vision: true },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'openai', vision: true },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai', vision: true },

  // ---- google ----
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google', vision: true },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    provider: 'google',
    vision: true,
  },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', provider: 'google', vision: true },
  {
    id: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    vision: true,
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    label: 'Gemini 3.1 Flash Lite Preview',
    provider: 'google',
    vision: true,
  },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google', vision: true },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google', vision: true },
  {
    id: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    provider: 'google',
    vision: true,
  },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', provider: 'google', vision: true },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', provider: 'google', vision: true },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', provider: 'google', vision: true },

  // ---- deepseek ----
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', vision: false },
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', vision: false },
  { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', vision: false },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', vision: false },

  // ---- glm ----
  { id: 'glm-5.1', label: 'GLM-5.1', provider: 'glm', vision: false },
  { id: 'glm-5.2', label: 'GLM-5.2', provider: 'glm', vision: false },
  { id: 'glm-5.3', label: 'GLM-5.3', provider: 'glm', vision: false },
  { id: 'glm-5.3-flash', label: 'GLM-5.3 Flash', provider: 'glm', vision: false },
  { id: 'glm-4.7', label: 'GLM-4.7', provider: 'glm', vision: false },
  { id: 'glm-4.6', label: 'GLM-4.6', provider: 'glm', vision: false },
  { id: 'glm-4-plus', label: 'GLM-4-Plus', provider: 'glm', vision: false },
  { id: 'glm-4', label: 'GLM-4', provider: 'glm', vision: false },
  { id: 'glm-4-flash', label: 'GLM-4-Flash', provider: 'glm', vision: false },
  { id: 'glm-4-vision', label: 'GLM-4V 视觉', provider: 'glm', vision: true },
  { id: 'glm-3-turbo', label: 'GLM-3-Turbo', provider: 'glm', vision: false },

  // ---- minimax ----
  { id: 'minimax-m2.7', label: 'MiniMax M2.7', provider: 'minimax', vision: false },
  { id: 'minimax-m2.5', label: 'MiniMax M2.5', provider: 'minimax', vision: false },
  { id: 'minimax-m2.1', label: 'MiniMax M2.1', provider: 'minimax', vision: false },
  { id: 'MiniMax-M3', label: 'MiniMax M3', provider: 'minimax', vision: false },

  // ---- kimi ----
  { id: 'kimi-k2.6', label: 'Kimi K2.6', provider: 'kimi', vision: true },
  { id: 'kimi-k2.5', label: 'Kimi K2.5', provider: 'kimi', vision: true },
  { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking', provider: 'kimi', vision: true },
  { id: 'kimi-k3', label: 'Kimi K3', provider: 'kimi', vision: true },

  // ---- qwen ----
  { id: 'qwen3.6-plus', label: 'Qwen 3.6 Plus', provider: 'qwen', vision: true },
  { id: 'qwen3.6-flash', label: 'Qwen 3.6 Flash', provider: 'qwen', vision: true },
  { id: 'qwen3.7-max', label: 'Qwen 3.7 Max', provider: 'qwen', vision: true },
  { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', provider: 'qwen', vision: true },
  { id: 'qwen3.8-27b', label: 'Qwen 3.8 27B', provider: 'qwen', vision: true },
  { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash', provider: 'qwen', vision: true },
  { id: 'qwen3.8-max', label: 'Qwen 3.8 Max', provider: 'qwen', vision: true },

  // ---- 其他 OpenAI 兼容 ----
  { id: 'grok-4.6', label: 'Grok 4.6', provider: 'openai-compat', vision: true },
  { id: 'Hy3', label: 'Hunyuan Hy3', provider: 'openai-compat', vision: true },
  {
    id: 'doubao-seed-2.1-pro',
    label: 'Doubao Seed 2.1 Pro',
    provider: 'openai-compat',
    vision: false,
  },
  {
    id: 'doubao-seed-2.1-turbo',
    label: 'Doubao Seed 2.1 Turbo',
    provider: 'openai-compat',
    vision: false,
  },
  {
    id: 'doubao-seed-evolving',
    label: 'Doubao Seed Evolving',
    provider: 'openai-compat',
    vision: false,
  },
];

/**
 * 某厂商下的模型清单。
 * @param providerId 厂商 id。
 * @returns 模型数组（可能为空）。
 */
export function modelsForProvider(providerId: string): AiModelInfo[] {
  return AI_MODELS.filter((m) => m.provider === providerId);
}

/**
 * 查厂商元信息。
 * @param providerId 厂商 id。
 * @returns 厂商信息；未登记返回 undefined。
 */
export function findProvider(providerId: string): AiProviderInfo | undefined {
  return AI_PROVIDERS.find((p) => p.id === providerId);
}

/**
 * 查模型元信息。
 *
 * 按 `provider + id` 查而不是只按 id：同一个 id 完全可能出现在不同厂商下
 * （自建兼容端点转发别家模型是常态）。
 * @param providerId 厂商 id。
 * @param modelId 模型 id。
 * @returns 模型信息；未登记返回 undefined。
 */
export function findModel(providerId: string, modelId: string): AiModelInfo | undefined {
  return AI_MODELS.find((m) => m.provider === providerId && m.id === modelId);
}

/**
 * 该配置能不能发图片。
 *
 * 清单里查不到的 model（用户手填了清单外的 id）按**不支持**处理：把图片发给不认识
 * 图片的模型，各家的表现从 400 到静默忽略都有，宁可禁用入口并说明。
 * @param providerId 厂商 id。
 * @param modelId 模型 id。
 * @returns 是否支持图片输入。
 */
export function supportsVision(providerId: string, modelId: string): boolean {
  return findModel(providerId, modelId)?.vision ?? false;
}
