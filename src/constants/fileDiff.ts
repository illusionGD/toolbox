import type { FileDiffStatus } from '@shared/fileDiff';

/** 表格和详情共用的状态文案。 */
export const FILE_DIFF_STATUS_LABELS: Record<FileDiffStatus, string> = {
  same: '相同',
  modified: '内容不同',
  'left-only': '仅左侧',
  'right-only': '仅右侧',
  'type-conflict': '类型冲突',
  error: '无法比较',
};

/** 结果查询可选择单个状态，或查看全部/所有差异。 */
export type FileDiffStatusFilter = FileDiffStatus | 'all' | 'differences';

/** 状态筛选选项；与列表、详情共用状态名称。 */
export const FILE_DIFF_STATUS_OPTIONS: { label: string; value: FileDiffStatusFilter }[] = [
  { label: '全部状态', value: 'all' },
  { label: '仅显示差异', value: 'differences' },
  ...Object.entries(FILE_DIFF_STATUS_LABELS).map(([value, label]) => ({
    label,
    value: value as FileDiffStatus,
  })),
];
