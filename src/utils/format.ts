/**
 * 格式化工具函数。
 */

/**
 * 将字节数格式化为可读字符串（B/KB/MB/GB）。
 * @param bytes 字节数，非法值按 0 处理。
 * @param fractionDigits 保留小数位，默认 2。
 * @returns 形如 `1.25 MB` 的字符串。
 */
export function formatBytes(bytes: number, fractionDigits = 2): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(safe) / Math.log(1024)), units.length - 1);
  const value = safe / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${units[exponent]}`;
}

/**
 * 将时间戳格式化为相对当前的中文描述（刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期）。
 * @param timestamp 目标时间戳（毫秒）。
 * @param now 当前时间戳（毫秒），默认取 Date.now()。
 * @returns 相对时间字符串。
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = now - timestamp;
  if (!Number.isFinite(diff) || diff < 0) return '刚刚';

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;

  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
