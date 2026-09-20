import { setImmediate } from 'node:timers/promises';
import type { FileDiffDetail, FileDiffLine } from '../../shared/fileDiff';

interface TextFile {
  text: string;
  encoding: string;
}

/** @param bytes 文件字节。 @returns 支持的文本或 null（不把乱码冒充文本）。 */
export function decodeText(bytes: Buffer): TextFile | null {
  let encoding = 'UTF-8';
  let codec = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    codec = 'utf-16le';
    encoding = 'UTF-16 LE';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    codec = 'utf-16be';
    encoding = 'UTF-16 BE';
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'UTF-8 BOM';
  try {
    const text = new TextDecoder(codec, { fatal: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) return null;
    return { text, encoding };
  } catch {
    return null;
  }
}

/** 保留换行符，CRLF/LF 变化与末尾换行缺失都应产生差异。 */
function splitLines(text: string): string[] {
  return text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) ?? [];
}

type Edit = { kind: 'context' | 'added' | 'removed'; raw: string };

/** 有界 Myers 搜索，极端差异降级为整段替换，并周期让出主进程。 */
async function middleDiff(
  left: string[],
  right: string[],
): Promise<{ edits: Edit[]; simplified: boolean }> {
  const frontier = new Map<number, number>([[1, 0]]);
  const trace: Map<number, number>[] = [];
  let work = 0;
  for (let depth = 0; depth <= Math.min(left.length + right.length, 256); depth++) {
    trace.push(new Map(frontier));
    if (depth % 16 === 0) await setImmediate();
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const down = frontier.get(diagonal + 1) ?? -Infinity;
      const across = frontier.get(diagonal - 1) ?? -Infinity;
      let x = diagonal === -depth || (diagonal !== depth && across < down) ? down : across + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) {
        x++;
        y++;
        work++;
      }
      frontier.set(diagonal, x);
      if (++work > 1_000_000) break;
      if (x >= left.length && y >= right.length) {
        const edits: Edit[] = [];
        for (let d = depth; d >= 0; d--) {
          const previous = trace[d];
          const k = x - y;
          const previousK =
            k === -d ||
            (k !== d && (previous.get(k - 1) ?? -Infinity) < (previous.get(k + 1) ?? -Infinity))
              ? k + 1
              : k - 1;
          const previousX = previous.get(previousK) ?? 0;
          const previousY = previousX - previousK;
          while (x > previousX && y > previousY) {
            edits.push({ kind: 'context', raw: left[--x] });
            y--;
          }
          if (d === 0) break;
          if (x === previousX) edits.push({ kind: 'added', raw: right[--y] });
          else edits.push({ kind: 'removed', raw: left[--x] });
        }
        return { edits: edits.reverse(), simplified: false };
      }
    }
    if (work > 1_000_000) break;
  }
  return {
    edits: [
      ...left.map((raw): Edit => ({ kind: 'removed', raw })),
      ...right.map((raw): Edit => ({ kind: 'added', raw })),
    ],
    simplified: true,
  };
}

/**
 * 生成最多 3000 行的上下文差异；算法和输出都封顶。
 * @param left 左侧文本。
 * @param right 右侧文本。
 * @returns 带行号、换行信息及截断标记的差异。
 */
export async function diffText(left: TextFile, right: TextFile): Promise<FileDiffDetail> {
  const a = splitLines(left.text);
  const b = splitLines(right.text);
  const result: FileDiffDetail = {
    kind: 'text',
    message: '',
    lines: [],
    leftEncoding: left.encoding,
    rightEncoding: right.encoding,
    simplified: false,
    truncated: false,
  };
  if (a.length > 20000 || b.length > 20000)
    return { ...result, kind: 'large', message: '文本超过 20000 行，仅显示文件比较结果。' };
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const middle = await middleDiff(
    a.slice(prefix, a.length - suffix),
    b.slice(prefix, b.length - suffix),
  );
  const edits: Edit[] = [
    ...a.slice(0, prefix).map((raw): Edit => ({ kind: 'context', raw })),
    ...middle.edits,
    ...a.slice(a.length - suffix).map((raw): Edit => ({ kind: 'context', raw })),
  ];
  result.simplified = middle.simplified;
  const visible = new Set<number>();
  for (let i = 0; i < edits.length; i++)
    if (edits[i].kind !== 'context')
      for (let j = Math.max(0, i - 3); j <= Math.min(edits.length - 1, i + 3); j++) visible.add(j);
  if (!visible.size) for (let i = 0; i < Math.min(edits.length, 100); i++) visible.add(i);
  let leftLine = 0;
  let rightLine = 0;
  let hidden = 0;
  for (const [i, edit] of edits.entries()) {
    if (edit.kind !== 'added') leftLine++;
    if (edit.kind !== 'removed') rightLine++;
    if (!visible.has(i)) {
      hidden++;
      continue;
    }
    if (result.lines.length >= 3000) {
      result.truncated = true;
      break;
    }
    if (hidden) {
      result.lines.push({
        kind: 'gap',
        leftLine: null,
        rightLine: null,
        text: `省略 ${hidden} 行相同内容`,
      });
      hidden = 0;
    }
    const ending: FileDiffLine['ending'] = edit.raw.endsWith('\r\n')
      ? 'CRLF'
      : edit.raw.endsWith('\n')
        ? 'LF'
        : edit.raw.endsWith('\r')
          ? 'CR'
          : 'none';
    const text = edit.raw.replace(/(?:\r\n|\r|\n)$/, '');
    if (text.length > 4000) result.truncated = true;
    result.lines.push({
      kind: edit.kind,
      leftLine: edit.kind === 'added' ? null : leftLine,
      rightLine: edit.kind === 'removed' ? null : rightLine,
      text: text.length > 4000 ? `${text.slice(0, 4000)}…（行内容已截断）` : text,
      ending,
    });
  }
  if (hidden)
    result.lines.push({
      kind: 'gap',
      leftLine: null,
      rightLine: null,
      text: `省略 ${hidden} 行相同内容`,
    });
  if (left.text === right.text)
    result.message =
      left.encoding === right.encoding ? '文本内容相同。' : '文本内容相同，但编码或 BOM 不同。';
  else result.message = '− 为左侧删除，+ 为右侧新增；保留差异前后各 3 行。换行符差异也计入比较。';
  return result;
}
