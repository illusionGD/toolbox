/**
 * markdown → **纯对象节点树**（`MdNode`），给 `AiMarkdown.vue` 用 `h()` 渲染。
 *
 * 取代原来的 `markdownLite.ts`（只切围栏代码块）。选型与安全边界见 skill ai-markdown：
 *
 * - **只用 `marked.lexer()` 拿 token，绝不调 `marked.parse()`** —— 后者出 HTML 串，
 *   要塞进界面就只能 `v-html`，那等于把模型输出接到 `innerHTML` 上。
 * - 中间这层纯对象节点树**存在的理由就是为了能断言安全性**：不碰 Vue、不碰 DOM，
 *   于是「XSS 有没有防住」是一条桩测断言得了的纯函数性质，而不是一段要靠眼睛看的模板。
 * - 三条渲染硬规则，全部落在这个文件里：
 *   ① `html` token（块级与行内）一律按**字面文本**输出 `raw`；
 *   ② 只有 `http:` / `https:` / `mailto:` 三种 scheme 能进 `a`，其余渲染成纯文本；
 *   ③ **永不产出 `img`**，图片退化成一行 `md-image`。
 *   `index.html` 的 CSP（`script-src 'self'` / `img-src 'self' data: blob:`）只是第二道防线。
 * - 节点是**纯对象**（`structuredClone` 得过），且**只活在组件里**：不进 `AiMessage`、
 *   不进 `persist()`、不进 `history`、不跨 IPC。落盘与下一轮上下文永远只走原文 markdown。
 */

import { marked } from 'marked';
import type { Token, Tokens } from 'marked';

/** 节点标签。`md-*` 三个是我们自己的语义标签，由组件特殊渲染。 */
export type MdTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'ul'
  | 'ol'
  | 'li'
  | 'a'
  | 'code'
  | 'em'
  | 'strong'
  | 'del'
  | 'br'
  | 'hr'
  | 'blockquote'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  /** 叶子纯文本。 */
  | 'text'
  /** 围栏代码块（工具条 + 复制 + 高亮由组件给）。 */
  | 'md-code'
  /** 图片退化成的那一行。 */
  | 'md-image';

/** 渲染节点：**纯对象**，不含函数、不含 Vue 引用。 */
export interface MdNode {
  /** 标签。 */
  tag: MdTag;
  /** `text` / `md-code` / `md-image` 的文本内容。 */
  text?: string;
  /** 子节点。 */
  children?: MdNode[];
  /** 白名单属性，只可能出现 href / start / align / lang / open / checked。 */
  attrs?: Record<string, string | number | boolean>;
}

/** 允许进 `a` 标签的 scheme。 */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** 围栏行：三个以上反引号或波浪号 + 可选 info string。 */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/;

/** 列表项行首（`-` `*` `+` 或 `1.` `1)`）。 */
const LIST_ITEM_LINE = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;

/** 空行（用作块级切点）。 */
const BLANK_LINE = /\n[ \t]*\n/g;

/** 增量状态里用来核对「文本是追加的」的指纹长度。 */
const SIG_LEN = 16;

/** 需要还原的 HTML 实体（marked 的 token 不做实体解码，见文件末注）。 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * 这个链接能不能进 `a` 标签。
 *
 * 用 `new URL()` 判 scheme 而**不是**字符串前缀匹配：`java\nscript:alert(1)`、
 * `JaVaScRiPt:`、`%6a%61...` 这类变形骗得过前缀匹配，骗不过 URL 解析。相对地址
 * （解析直接抛错）也一并落到「渲染成纯文本」——聊天记录里没有相对地址可去的地方。
 * @param href 原始地址。
 * @returns 是否安全。
 */
export function isSafeHref(href: string): boolean {
  if (!href) return false;
  try {
    return SAFE_SCHEMES.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

/**
 * 文本末尾是否还有没闭合的围栏。
 *
 * 流式输出时这是**常态**（后半截还没到）。marked **不会**把未闭合围栏标出来
 * （实测：它照样出一个 `code` token），所以这件事只能我们自己数。围栏的闭合规则按
 * CommonMark：只能由**同种字符、且不短于**开围栏的那行来关。
 * @param text 文本。
 * @returns 有未闭合围栏则为 true。
 */
export function hasOpenFence(text: string): boolean {
  let openMark = '';
  for (const line of text.split('\n')) {
    const fence = FENCE_LINE.exec(line);
    if (!fence) continue;
    const mark = fence[1] ?? '';
    const info = fence[2] ?? '';
    if (!openMark) {
      openMark = mark;
      continue;
    }
    // 闭围栏不许带 info string，且必须同种字符、不短于开围栏
    if (mark[0] === openMark[0] && mark.length >= openMark.length && !info.trim()) openMark = '';
  }
  return openMark !== '';
}

/**
 * 把一段 markdown 解析成节点树。**任何输入都不抛错**。
 * @param text 原始 markdown。
 * @returns 节点数组；空文本给空数组。
 */
export function renderMarkdown(text: string): MdNode[] {
  if (!text || !text.trim()) return [];
  let nodes: MdNode[];
  try {
    nodes = blockTokens(marked.lexer(text, { gfm: true, breaks: false }));
  } catch {
    // 宁可显示成纯文本，也不能让一条消息变成空白
    return [{ tag: 'p', children: [textNode(text)] }];
  }
  // 未闭合围栏只可能是最后一个代码块（后面的字还没到）
  if (hasOpenFence(text)) markLastCodeOpen(nodes);
  return nodes;
}

// #region 块级

/**
 * 一串块级 token 转节点。
 * @param tokens token 数组。
 * @returns 节点数组。
 */
function blockTokens(tokens: Token[]): MdNode[] {
  const out: MdNode[] = [];
  for (const token of tokens) {
    const node = blockToken(token);
    if (Array.isArray(node)) out.push(...node);
    else if (node) out.push(node);
  }
  return out;
}

/**
 * 单个块级 token 转节点。
 * @param token token。
 * @returns 节点、节点数组，或 null（该 token 不产出内容）。
 */
function blockToken(token: Token): MdNode | MdNode[] | null {
  switch (token.type) {
    case 'space':
      return null;

    // 引用式链接的定义行（`[1]: https://…`）本身不显示——CommonMark 就是这样，
    // 少了它反而对（正文里那个 `[文档][1]` 已经拿到 href 了）。
    //
    // **但脚注定义要例外**：探针量到 marked 把 `[^1]: 脚注内容` 也认成 def（`tag === '^1'`,
    // `href === '脚注内容'`），我们不支持脚注，照上面那条丢掉就是**把模型写的一段话凭空吞了**
    // ——正文里只剩一个 `[^1]` 角标，说明文字没了。所以标签以 `^` 开头的一律回落成原文。
    case 'def':
      return (token as Tokens.Def).tag?.startsWith('^') ? textNode(token.raw) : null;

    // 任务列表的复选框在 list_item 里单独处理，这里跳过免得多出一个 `[x] `
    case 'checkbox':
      return null;

    case 'paragraph':
      return { tag: 'p', children: inlineTokens(childTokens(token)) };

    // 松散列表 / 兜底位置上的块级 text：不包 `<p>`，直接铺行内节点
    case 'text':
      return childTokens(token).length
        ? inlineTokens(childTokens(token))
        : [textNode(asText(token))];

    case 'heading': {
      const depth = Math.min(6, Math.max(1, (token as Tokens.Heading).depth || 1));
      return { tag: `h${depth}` as MdTag, children: inlineTokens(childTokens(token)) };
    }

    case 'code': {
      const code = token as Tokens.Code;
      // ```ts title=x 这种 info string 只取第一个词当语言
      const lang = (code.lang ?? '').trim().split(/\s+/)[0] ?? '';
      return { tag: 'md-code', text: code.text ?? '', attrs: { lang, open: false } };
    }

    case 'blockquote':
      return { tag: 'blockquote', children: blockTokens(childTokens(token)) };

    case 'hr':
      return { tag: 'hr' };

    case 'list':
      return listNode(token as Tokens.List);

    case 'table':
      return tableNode(token as Tokens.Table);

    // 硬规则 ①：裸 HTML 只能作为字符出现
    case 'html':
      return textNode(token.raw);

    // 没做的语法**绝不静默丢内容**，至少还看得见原文。
    //
    // 探针量过：marked 18 的 lexer 一共只吐 space / code / heading / table / hr / blockquote /
    // list / list_item / html / def / paragraph / text 这些块级类型，上面全枚举了
    // ——**所以这一支今天走不到，桩测也钉不住它**（红证第 ⑤ 条拆掉它，一条都不红）。
    // 它是留给「marked 升级后多出新 token 类型」的：那时宁可显示成原文，也别凭空少一段。
    // 真正在守「内容不丢」这条的是上面 `def` 里那个 `^` 分支。
    default:
      return textNode(token.raw);
  }
}

/**
 * 列表转节点。
 * @param list list token。
 * @returns `ul` / `ol` 节点。
 */
function listNode(list: Tokens.List): MdNode {
  const attrs: Record<string, string | number | boolean> = {};
  // start 在 marked 里是 number | ''（无序列表给空串）
  if (list.ordered && typeof list.start === 'number' && list.start !== 1) attrs.start = list.start;

  const children = list.items.map((item) => {
    const li: MdNode = { tag: 'li', children: blockTokens(childTokens(item)) };
    if (item.task) {
      // 不用真的 `<input type=checkbox>`：聊天记录里不该出现可聚焦、点了又没语义的控件
      li.attrs = { checked: item.checked === true };
      li.children = [textNode(item.checked ? '✅ ' : '⬜ '), ...(li.children ?? [])];
    }
    return li;
  });

  return {
    tag: list.ordered ? 'ol' : 'ul',
    children,
    ...(Object.keys(attrs).length ? { attrs } : {}),
  };
}

/**
 * 表格转节点。
 * @param table table token。
 * @returns `table` 节点（`thead` + `tbody`）。
 */
function tableNode(table: Tokens.Table): MdNode {
  /**
   * 一个单元格转节点。
   * @param cell 单元格 token。
   * @param index 列号，用来取对齐方式。
   * @param tag `th` 或 `td`。
   * @returns 单元格节点。
   */
  const cellNode = (cell: Tokens.TableCell, index: number, tag: 'th' | 'td'): MdNode => {
    const align = table.align?.[index];
    return {
      tag,
      children: inlineTokens(cell.tokens ?? []),
      ...(align ? { attrs: { align } } : {}),
    };
  };

  const head: MdNode = {
    tag: 'thead',
    children: [{ tag: 'tr', children: table.header.map((c, i) => cellNode(c, i, 'th')) }],
  };
  const body: MdNode = {
    tag: 'tbody',
    children: table.rows.map((row) => ({
      tag: 'tr' as MdTag,
      children: row.map((c, i) => cellNode(c, i, 'td')),
    })),
  };
  return { tag: 'table', children: [head, body] };
}

// #endregion

// #region 行内

/**
 * 一串行内 token 转节点。
 * @param tokens token 数组。
 * @returns 节点数组。
 */
function inlineTokens(tokens: Token[]): MdNode[] {
  const out: MdNode[] = [];
  for (const token of tokens) {
    const node = inlineToken(token);
    if (node) out.push(node);
  }
  return out;
}

/**
 * 单个行内 token 转节点。
 * @param token token。
 * @returns 节点，或 null。
 */
function inlineToken(token: Token): MdNode | null {
  switch (token.type) {
    case 'text':
      return textNode(decodeEntities(asText(token)));

    // 反斜杠转义，marked 已经把 `\*` 解成 `*`
    case 'escape':
      return textNode(asText(token));

    case 'codespan':
      // 代码里不解实体（CommonMark 也不解），`&amp;` 就该显示成 `&amp;`
      return { tag: 'code', children: [textNode(asText(token))] };

    case 'strong':
      return { tag: 'strong', children: inlineTokens(childTokens(token)) };

    case 'em':
      return { tag: 'em', children: inlineTokens(childTokens(token)) };

    case 'del':
      return { tag: 'del', children: inlineTokens(childTokens(token)) };

    case 'br':
      return { tag: 'br' };

    case 'link': {
      const link = token as Tokens.Link;
      // 硬规则 ②：scheme 不在白名单就整段按原文显示（`[x](javascript:…)` 点不动）
      if (!isSafeHref(link.href)) return textNode(link.raw);
      const children = inlineTokens(link.tokens ?? []);
      return {
        tag: 'a',
        // target=_blank 才会命中主进程的 setWindowOpenHandler → 交给系统浏览器
        attrs: { href: link.href, target: '_blank', rel: 'noopener noreferrer' },
        children: children.length ? children : [textNode(link.href)],
      };
    }

    case 'image': {
      // 硬规则 ③：永不产出 img。CSP 的 img-src 本来也拦远端图，但那是第二道防线
      const image = token as Tokens.Image;
      const label = (image.text || '').trim() || image.href;
      const node: MdNode = { tag: 'md-image', text: label };
      if (isSafeHref(image.href)) node.attrs = { href: image.href };
      return node;
    }

    // 任务列表的复选框由 listNode 出前缀
    case 'checkbox':
      return null;

    // 硬规则 ①
    case 'html':
      return textNode(token.raw);

    // 同块级那条：行内类型也全枚举了（escape / html / link / image / strong / em /
    // codespan / br / del / text / checkbox），这一支同样是留给 marked 升级的兜底
    default:
      return textNode(token.raw);
  }
}

// #endregion

// #region 小工具

/**
 * 造一个文本叶子。
 * @param text 文本。
 * @returns 文本节点。
 */
function textNode(text: string): MdNode {
  return { tag: 'text', text };
}

/**
 * 取 token 的 `tokens` 子数组（marked 的类型里这个字段是可选的）。
 * @param token token。
 * @returns 子 token 数组，没有则空数组。
 */
function childTokens(token: Token): Token[] {
  return (token as { tokens?: Token[] }).tokens ?? [];
}

/**
 * 取 token 的 `text` 字段。
 * @param token token。
 * @returns 文本，没有则退回 `raw`。
 */
function asText(token: Token): string {
  return (token as { text?: string }).text ?? token.raw ?? '';
}

/**
 * 还原 HTML 实体。
 *
 * marked 的 token 里 `text` 是**没有**做实体解码的（实测：`&amp;` 原样留着，
 * `escaped: false`），解码本来发生在它的 HTML 渲染器里——那一层我们不用。所以这里补上，
 * 否则模型写的 `&lt;div&gt;` 会在界面上显示成 `&lt;div&gt;`。落在文本节点里，不构成注入面。
 * @param text 文本。
 * @returns 解码后的文本。
 */
function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (raw, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // 排掉代理区与越界码位，String.fromCodePoint 会对它们抛错
      if (
        !Number.isFinite(code) ||
        code <= 0 ||
        code > 0x10ffff ||
        (code >= 0xd800 && code <= 0xdfff)
      ) {
        return raw;
      }
      return String.fromCodePoint(code);
    }
    return ENTITIES[body.toLowerCase()] ?? raw;
  });
}

/**
 * 给文档里**最后一个** `md-code` 打上 `open`（深度优先倒着找，代码块可能嵌在引用/列表里）。
 * @param nodes 节点数组。
 * @returns 找到并打上了则为 true。
 */
function markLastCodeOpen(nodes: MdNode[]): boolean {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node) continue;
    if (node.tag === 'md-code') {
      node.attrs = { ...(node.attrs ?? {}), open: true };
      return true;
    }
    if (node.children && markLastCodeOpen(node.children)) return true;
  }
  return false;
}

// #endregion

// #region 流式增量

/**
 * 流式增量状态。**纯对象**，可 `structuredClone`。
 *
 * 只活在组件里（随组件卸载而消失），**不落盘、不进 history、不跨 IPC**。
 */
export interface MdStream {
  /** 每个定稿块一份节点数组；**已有的数组引用永不替换**（`MdBlock` memo 的判据）。 */
  blocks: MdNode[][];
  /** 已并入 `blocks` 的字符数（= 上一个切点）。只增不减。 */
  consumed: number;
  /** 已消费前缀的最后 16 个字符，用来发现「文本不是追加而是被换掉了」。 */
  sig: string;
  /** 尾块原文。 */
  tailText: string;
  /** 尾块节点（每帧重解析）。 */
  tail: MdNode[];
}

/**
 * 造一个空的增量状态。
 * @returns 空状态。
 */
export function createMdStream(): MdStream {
  return { blocks: [], consumed: 0, sig: '', tailText: '', tail: [] };
}

/**
 * 找一个安全的切点：不在未闭合围栏内、也不会把一个列表劈开的**最后一个**空行。
 *
 * 两条约束都是踩过的：
 * - **围栏**：代码块内部的空行很常见，切下去会把一个围栏劈成两半，两边各自解析成一堆
 *   段落。所以候选切点的前缀必须没有未闭合围栏。
 * - **列表**：模型爱写「项之间空一行」的松散列表，切在那儿会变成两个 `<ul>`（有序列表
 *   靠 `start` 还能接上号，但间距会跳一下）。所以前后都像列表内容时不切，等列表整段结束。
 *
 * @param text 当前全文。
 * @param from 已消费到的位置。**调用方须保证 `[0, from)` 里没有未闭合围栏**（`pushMdStream`
 *   只在满足这一条的位置推进），于是围栏检查只需扫 `[from, pos)` 而不是整个前缀。
 * @returns 新的切点；找不到合格位置就原样返回 `from`。
 */
export function findStableCut(text: string, from: number): number {
  const candidates: number[] = [];
  BLANK_LINE.lastIndex = 0;
  let match = BLANK_LINE.exec(text);
  while (match) {
    const pos = match.index + match[0].length;
    if (pos > from) candidates.push(pos);
    // 连续空行时下一次从这个空行的末尾继续找
    BLANK_LINE.lastIndex = pos;
    match = BLANK_LINE.exec(text);
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const pos = candidates[i] ?? 0;
    if (hasOpenFence(text.slice(from, pos))) continue;
    if (splitsList(text, pos)) continue;
    return pos;
  }
  return from;
}

/**
 * 在 `pos` 切一刀会不会把一个列表劈成两半。
 * @param text 全文。
 * @param pos 候选切点。
 * @returns 前后都像列表内容则为 true。
 */
function splitsList(text: string, pos: number): boolean {
  const after = firstNonBlankLine(text.slice(pos));
  if (!LIST_ITEM_LINE.test(after)) return false;
  const before = lastNonBlankLine(text.slice(0, pos));
  // 列表项行，或列表项的缩进续行
  return LIST_ITEM_LINE.test(before) || /^[ \t]+\S/.test(before);
}

/**
 * 取第一行非空白行。
 * @param text 文本。
 * @returns 行内容，没有则空串。
 */
function firstNonBlankLine(text: string): string {
  for (const line of text.split('\n')) if (line.trim()) return line;
  return '';
}

/**
 * 取最后一行非空白行。
 * @param text 文本。
 * @returns 行内容，没有则空串。
 */
function lastNonBlankLine(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    if (line.trim()) return line;
  }
  return '';
}

/**
 * 喂当前全文，返回新的增量状态。
 *
 * 定稿块只解析一次并原样带过来（引用不变），每次只重解析尾块——于是每帧的成本是
 * O(尾块) 而不是 O(全文)，一条长回复累计从 O(n²) 降到 O(n)。
 * @param prev 上一次的状态。
 * @param fullText 当前全文。
 * @returns 新状态（`blocks` 里已有的数组是同一批引用）。
 */
export function pushMdStream(prev: MdStream, fullText: string): MdStream {
  // 唯一一处「状态可能对不上文本」的入口：不是追加就整个重建。堵住这里比在别处小心省事
  const base = isAppendOf(prev, fullText) ? prev : createMdStream();

  const cut = findStableCut(fullText, base.consumed);
  let blocks = base.blocks;
  if (cut > base.consumed) {
    const nodes = renderMarkdown(fullText.slice(base.consumed, cut));
    // 纯空白的块解析出空数组，不占一个 block（否则会和全量结果差出一个空块）
    if (nodes.length) blocks = [...blocks, nodes];
  }

  const tailText = fullText.slice(cut);
  return {
    blocks,
    consumed: cut,
    sig: fullText.slice(Math.max(0, cut - SIG_LEN), cut),
    tailText,
    tail: renderMarkdown(tailText),
  };
}

/**
 * `fullText` 是不是在 `prev` 已消费前缀之后追加出来的。
 * @param prev 上一次的状态。
 * @param fullText 当前全文。
 * @returns 是追加则为 true。
 */
function isAppendOf(prev: MdStream, fullText: string): boolean {
  if (prev.consumed === 0) return true;
  if (fullText.length < prev.consumed) return false;
  return fullText.slice(Math.max(0, prev.consumed - SIG_LEN), prev.consumed) === prev.sig;
}

/**
 * 把增量状态拍平成一棵完整的节点树（给桩测的收敛性断言用，也可用于调试）。
 * @param stream 增量状态。
 * @returns 节点数组。
 */
export function flattenMdStream(stream: MdStream): MdNode[] {
  return [...stream.blocks.flat(), ...stream.tail];
}

// #endregion
