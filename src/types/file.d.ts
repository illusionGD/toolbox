import type { PickedFile } from '@shared/types';

/** 处理任务的状态。 */
export type TaskStatus = 'pending' | 'processing' | 'done' | 'error';

/**
 * 文件列表中的一项：在选中文件基础上附加处理状态与结果信息。
 * 各工具页可通过泛型或交叉类型扩展自己的字段（如压缩后大小）。
 */
export interface FileItem extends PickedFile {
  /** 列表内唯一 id。 */
  id: string;
  /** 处理状态，默认 pending。 */
  status: TaskStatus;
  /** 进度 0-100。 */
  progress?: number;
  /** 错误信息（status 为 error 时）。 */
  error?: string;
}
