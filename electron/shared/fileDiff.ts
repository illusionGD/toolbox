/** 文件差异状态；左右方向与输入框一致。 */
export type FileDiffStatus =
  'same' | 'modified' | 'left-only' | 'right-only' | 'type-conflict' | 'error';

/** 默认跳过的媒体扩展名，用户可编辑或清空。 */
export const FILE_DIFF_MEDIA_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'ico',
  'tif',
  'tiff',
  'svg',
  'heic',
  'heif',
  'raw',
  'psd',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wmv',
  'flv',
  'mpeg',
  'mpg',
  '3gp',
  'mp3',
  'wav',
  'flac',
  'aac',
  'ogg',
  'oga',
  'opus',
  'm4a',
  'wma',
  'aiff',
  'mid',
  'midi',
] as const;

/** 两个根路径必须同时为文件或同时为目录。 */
export interface FileDiffOptions {
  jobId: string;
  leftPath: string;
  rightPath: string;
  /** 逗号、分号或空白分隔，支持 ts、.ts、*.ts 和 (无扩展名)。 */
  include: string;
  exclude: string;
}

/** 扫描时捕获的文件身份，详情读取需确认文件没有变化。 */
export interface FileDiffFile {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
}

/** 文件夹比较按相对路径配对；单文件比较不要求同名。 */
export interface FileDiffEntry {
  id: string;
  relativePath: string;
  status: FileDiffStatus;
  left: FileDiffFile | null;
  right: FileDiffFile | null;
  error?: string;
}

/** 进度按任务 ID 过滤，避免上一任务的推送污染新任务。 */
export interface FileDiffProgress {
  jobId: string;
  phase: 'scanning' | 'comparing';
  scanned: number;
  compared: number;
  total: number;
  currentPath: string;
}

/** 取消、截断或读取失败时，不得把部分结果宣称为整体一致。 */
export interface FileDiffResult {
  jobId: string;
  leftPath: string;
  rightPath: string;
  entries: FileDiffEntry[];
  canceled: boolean;
  truncated: boolean;
  errors: string[];
  errorCount: number;
  skippedLinks: number;
  filtered: number;
  elapsed: number;
}

/** 逐行差异，gap 表示省略的相同行。 */
export interface FileDiffLine {
  kind: 'context' | 'added' | 'removed' | 'gap';
  leftLine: number | null;
  rightLine: number | null;
  text: string;
  ending?: 'LF' | 'CRLF' | 'CR' | 'none';
}

/** 二进制和大文件仍进行完整字节比较，但不生成文本预览。 */
export interface FileDiffDetail {
  kind: 'text' | 'binary' | 'large' | 'unavailable';
  message: string;
  lines: FileDiffLine[];
  leftEncoding: string;
  rightEncoding: string;
  simplified: boolean;
  truncated: boolean;
}
