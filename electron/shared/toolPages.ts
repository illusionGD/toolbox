/** 工具页面对应的 AI 调用。新增页面时在这里登记可执行操作。 */
export const TOOL_PAGE_AI_ACTIONS = {
  'image-compress': ['compress_images'],
  'image-qrcode': ['generate_qr_codes', 'decode_qr_code'],
  'file-rename': ['rename_files'],
  'media-video': ['convert_video'],
  'media-audio': ['convert_audio'],
  'dev-webtest': ['webtest_status', 'webtest_record', 'webtest_replay'],
} satisfies Record<string, [string, ...string[]]>;

/** 已上线且仍缺少 AI 操作入口的页面。新增页面使用 TOOL_PAGE_AI_ACTIONS。 */
type LegacyToolPageKey =
  | 'plugins'
  | 'image-crop'
  | 'image-stylize'
  | 'image-sprite'
  | 'file-stats'
  | 'file-diff'
  | 'file-excel-i18n'
  | 'font-subset'
  | 'font-split'
  | 'font-convert'
  | 'font-bitmap'
  | 'media-spine';

export type ToolPageKey = keyof typeof TOOL_PAGE_AI_ACTIONS | LegacyToolPageKey;
