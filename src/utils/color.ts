/**
 * 颜色处理工具：hex 与 rgb 互转、明暗调整、派生 hover/pressed 色。
 * 纯函数，无副作用，供主题系统派生 naive-ui 主题色与 CSS 变量使用。
 */

/** RGB 三通道，取值 0-255。 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 将数值限制在 [min, max] 区间。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 将 hex 颜色解析为 RGB。
 * @param hex 形如 `#7c3aed` 或 `#abc` 的颜色字符串，非法输入回退为黑色。
 * @returns 对应的 RGB 分量。
 */
export function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 0, g: 0, b: 0 };
  }

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * 将 RGB 转为 hex 字符串。
 * @param rgb RGB 分量，超出 0-255 的值会被裁剪。
 * @returns 形如 `#7c3aed` 的小写 hex 字符串。
 */
export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * 按比例把颜色向白色混合，得到更亮的颜色。
 * @param hex 基准颜色。
 * @param amount 混合比例 0-1，0 返回原色，1 返回纯白。
 * @returns 提亮后的 hex 颜色。
 */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const t = clamp(amount, 0, 1);
  return rgbToHex({
    r: r + (255 - r) * t,
    g: g + (255 - g) * t,
    b: b + (255 - b) * t,
  });
}

/**
 * 按比例把颜色向黑色混合，得到更暗的颜色。
 * @param hex 基准颜色。
 * @param amount 混合比例 0-1，0 返回原色，1 返回纯黑。
 * @returns 加深后的 hex 颜色。
 */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const t = clamp(amount, 0, 1);
  return rgbToHex({
    r: r * (1 - t),
    g: g * (1 - t),
    b: b * (1 - t),
  });
}

/**
 * 生成带透明度的 rgba 字符串。
 * @param hex 基准颜色。
 * @param alpha 透明度 0-1。
 * @returns 形如 `rgba(124, 58, 237, 0.2)` 的字符串。
 */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

/**
 * 校验字符串是否为合法的 3/6 位 hex 颜色。
 * @param hex 待校验字符串。
 * @returns 合法返回 true。
 */
export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}
