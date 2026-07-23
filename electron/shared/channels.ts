/**
 * 主进程与预加载共享的 IPC 通道名。
 * 单一来源，避免字符串在两侧不一致。
 */

/** 窗口控制通道。 */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggleMaximize',
  close: 'window:close',
  isMaximized: 'window:isMaximized',
  onMaximizeChange: 'window:maximizeChange',
} as const;

/** 应用级通道。 */
export const APP_CHANNELS = {
  ping: 'app:ping',
} as const;

/** 文件对话框与文件系统通道。 */
export const DIALOG_CHANNELS = {
  openFiles: 'dialog:openFiles',
  openDirectory: 'dialog:openDirectory',
} as const;

/** 图片处理通道。 */
export const IMAGE_CHANNELS = {
  thumbnail: 'image:thumbnail',
  dataUrl: 'image:dataUrl',
  compress: 'image:compress',
} as const;
