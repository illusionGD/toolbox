/**
 * 工具使用记录相关类型。
 */

/** 单个工具的使用记录。 */
export interface UsageRecord {
  /** 工具 key（对应 NavItem.key，如 image-compress）。 */
  key: string;
  /** 累计使用次数。 */
  count: number;
  /** 最近一次使用时间戳（毫秒）。 */
  lastUsedAt: number;
}

/** 分类使用占比项。 */
export interface CategoryUsage {
  /** 分类 key（顶级，如 image）。 */
  category: string;
  /** 分类展示名。 */
  label: string;
  /** 该分类累计使用次数。 */
  count: number;
  /** 占总次数的百分比 0-100。 */
  percentage: number;
}
