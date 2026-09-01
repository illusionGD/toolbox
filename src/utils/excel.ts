/**
 * Excel 多语言页的纯函数工具（渲染侧，不走 IPC）。
 * 列号与 A/B/C 标签的双向转换、从表头文字里认语言码。
 */

/** Windows 文件名非法字符。 */
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * 把用户填的列引用解析成 1-based 列号。
 * 同时接受 `C` 这样的字母列标与 `3` 这样的数字，两种写法用户都会用。
 * @param input 列引用（字母列标或数字）。
 * @returns 列号；非法返回 null。
 */
export function parseColumnRef(input: string): number | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    return n >= 1 && n <= 16384 ? n : null;
  }
  if (!/^[A-Za-z]{1,3}$/.test(text)) return null;
  // 26 进制但无 0：A=1..Z=26、AA=27
  let n = 0;
  for (const ch of text.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n <= 16384 ? n : null;
}

/**
 * 1-based 列号转字母列标（3 → C、27 → AA）。
 * @param column 列号。
 * @returns 列标；非法列号返回空串。
 */
export function columnLabel(column: number): string {
  if (!Number.isInteger(column) || column < 1) return '';
  let n = column;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/**
 * 从表头文字里认语言码。
 *
 * 表头形如「西班牙语-es」「中文原文-zh-hants」：按 `-`/`_` 切段后，**取第一个纯 ASCII
 * 段起、直到结尾的所有 ASCII 段拼回**。不能只取最后一段——`中文原文-zh-hants` 会得到
 * `hants` 而不是 `zh-hants`。认不出就回退表头原文（调用方再过一遍文件名清洗）。
 * @param header 表头原文。
 * @returns 语言码；认不出返回空串。
 */
export function localeFromHeader(header: string): string {
  const parts = header
    .trim()
    .split(/[-_\s]+/)
    .filter((p) => p !== '');
  if (!parts.length) return '';
  const first = parts.findIndex((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p));
  if (first < 0) return '';
  return parts
    .slice(first)
    .filter((p) => /^[A-Za-z][A-Za-z0-9]*$/.test(p))
    .join('-')
    .toLowerCase();
}

/**
 * 清掉文件名里的非法字符，供表头兜底当文件名时用。
 * @param name 原始名。
 * @returns 可用作文件名的字符串。
 */
export function sanitizeFileName(name: string): string {
  return name
    .replace(INVALID_NAME_CHARS, '_')
    .replace(/[.\s]+$/, '')
    .trim();
}
