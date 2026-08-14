import type { FileItem } from '@/types/file';

/**
 * 文件工具页共用的列表项类型。
 */

/** 批量重命名列表项。 */
export interface RenameItem extends FileItem {
  /** 所在目录绝对路径（重命名不跨目录，先拆出来省得反复算）。 */
  dir: string;
  /** 修改时间戳（毫秒），{date} 变量与排序用。 */
  mtime: number;
  /** 添加顺序，「按添加顺序」排序用。 */
  order: number;
}
