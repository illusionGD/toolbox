/**
 * 时间轴相关的纯计算。
 */

/**
 * 把总时长均分成 `count` 格，返回每格**中点**的时间。
 *
 * 取中点而不是左边界：取左边界时第一格必然是 0 s，而相当多的片子第一帧是纯黑或
 * 片头版权页，胶片条第一格就成了一块黑；取中点则每格都落在它所代表的那段时间的
 * 正中，与下方刻度也对得上。
 * @param duration 总时长秒。
 * @param count 格子数。
 * @returns 每格中点的时间秒；参数非法时为空数组。
 */
export function filmstripTimes(duration: number, count: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, index) => ((index + 0.5) / count) * duration);
}
