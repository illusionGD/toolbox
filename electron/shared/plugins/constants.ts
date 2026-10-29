/** 白名单权限，也是管理页的授权文案来源。 */
export const PLUGIN_PERMISSIONS = {
  'files.readSelected': '读取每次运行中由用户选择的文件',
  'files.save': '通过保存对话框导出文件',
  storage: '读写该插件的独立数据（最多 1 MB）',
  'tools.image': '处理所选图片（探测、压缩与转换）',
  'tools.media': '处理所选音视频（探测与转码）',
  'tools.diff': '比较文本差异',
  'tools.webtest': '访问当前网页测试会话（读取、检查、修复与回放）',
} as const;

/** @param permission 能力声明。 @returns 管理页的授权说明。 */
export function pluginPermissionLabel(permission: string): string {
  if (permission.startsWith('network:')) return `访问网络：${permission.slice(8)}`;
  return PLUGIN_PERMISSIONS[permission as keyof typeof PLUGIN_PERMISSIONS] ?? permission;
}

/** @param value 网络来源。 @returns 是否为完整、精确的 HTTP(S) origin。 */
export function isPluginOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password &&
      !value.includes('*')
    );
  } catch {
    return false;
  }
}
