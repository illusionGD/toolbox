import { formatBytes } from './format';
import { joinName, joinPath, parentName, splitName } from './path';

/**
 * 批量重命名的规则引擎（纯函数，不依赖 Vue）。
 *
 * 重命名的全部计算都是字符串运算，因此**整个预览在渲染进程完成、不走 IPC**：
 * 改一个字符即可整表重算，无需 debounce 与并发防串。
 * 主进程只负责渲染进程看不到的部分——盘上是否已存在同名文件，以及真正落盘。
 */

/** 规则种类。 */
export type RenameRuleKind = 'name' | 'insert' | 'replace' | 'case' | 'trim' | 'extension';

/** 插入位置。'index' 表示「第 N 个字符后」。 */
export type InsertPosition = 'start' | 'end' | 'index';

/** 大小写变换方式。 */
export type CaseMode = 'upper' | 'lower' | 'sentence' | 'title';

/** 删除字符方式。 */
export type TrimMode = 'head' | 'tail' | 'range' | 'spaces';

/** 扩展名处理方式。 */
export type ExtensionMode = 'set' | 'lower' | 'upper' | 'remove';

/**
 * 整名替换：直接给出新名字，丢掉原来的。
 * 没有这条规则时，「全部改成 照片_01」只能靠「删除字符」清空原名再插入，绕得莫名其妙。
 */
export interface NameRule {
  /** 新名字模板，支持 {n}/{name}/{ext}/{parent}/{date}/{size}。 */
  text: string;
}

/** 插入文本（文本内可用变量）。 */
export interface InsertRule {
  /** 插入位置。 */
  position: InsertPosition;
  /** position 为 'index' 时的字符下标（1 = 第 1 个字符后），超出长度则接在末尾。 */
  index: number;
  /** 待插入文本，支持 {n}/{name}/{ext}/{parent}/{date}/{size}。 */
  text: string;
}

/** 查找替换。 */
export interface ReplaceRule {
  /** 查找内容（regex 为 true 时按正则解析）。 */
  find: string;
  /** 替换为（支持变量；regex 模式下 $1 等捕获组可用）。 */
  replaceWith: string;
  /** 按正则匹配。 */
  regex: boolean;
  /** 区分大小写。 */
  caseSensitive: boolean;
  /** 替换全部匹配（关闭则只替换第一处）。 */
  all: boolean;
}

/** 大小写变换。 */
export interface CaseRule {
  mode: CaseMode;
}

/** 删除字符。 */
export interface TrimRule {
  mode: TrimMode;
  /** 'head'/'tail' 时删除的字符数。 */
  count: number;
  /** 'range' 时的起始位置（1 起，含）。 */
  from: number;
  /** 'range' 时的结束位置（1 起，含）。 */
  to: number;
}

/** 扩展名处理。 */
export interface ExtensionRule {
  mode: ExtensionMode;
  /** mode 为 'set' 时的目标扩展名（不含点）。 */
  value: string;
}

/**
 * 规则链上的一条。
 * 各 kind 的参数**全部常驻**（而非联合类型），这样在面板上切换 kind 时
 * 已填的参数不会丢，用户来回比较两种规则不必重填。
 */
export interface RenameRule {
  /** 唯一 id，v-for key 与拖拽排序用。 */
  id: string;
  /** 规则种类。 */
  kind: RenameRuleKind;
  /** 是否启用（关闭时保留在链上但不参与计算）。 */
  enabled: boolean;
  name: NameRule;
  insert: InsertRule;
  replace: ReplaceRule;
  case: CaseRule;
  trim: TrimRule;
  extension: ExtensionRule;
}

/** 参与计算的一行（RenameItem 的子集，便于脚本直接测）。 */
export interface RenameRowInput {
  /** 文件绝对路径。 */
  path: string;
  /** 当前文件名（含扩展名）。 */
  name: string;
  /** 文件大小（字节），{size} 变量用。 */
  size: number;
  /** 修改时间戳（毫秒），{date} 变量用。 */
  mtime: number;
}

/** 序号（{n}）的取值设置。 */
export interface NumberingOptions {
  /** 起始值。 */
  start: number;
  /** 步长。 */
  step: number;
  /** 补零位数（1 = 不补）。 */
  padding: number;
}

/** applyRules 的上下文设置。 */
export interface ApplyRulesOptions {
  /** 序号设置。 */
  numbering: NumberingOptions;
  /**
   * 规则是否连扩展名一起处理。
   * 默认关：否则「把 a 替换成 b」会把 `.avi` 一起改掉，是本类工具最常见的踩坑。
   * `extension` 规则不受此开关影响，它本来就只管扩展名。
   */
  includeExt: boolean;
}

/** applyRules 的结果。 */
export interface RenameComputation {
  /** 与入参 rows 等长、同序的新文件名。 */
  names: string[];
  /**
   * 出错的规则：id → 原因（目前只有非法正则）。
   * 出错的规则会被**跳过**而非抛错——用户正则打到一半时整表报错没法用。
   */
  ruleErrors: Record<string, string>;
}

/** 排序依据。 */
export type RenameSortBy = 'name' | 'mtime' | 'size' | 'added';

/** 自然排序器：`img2` 排在 `img10` 前面，而不是字典序的反过来。 */
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Windows 文件名中的非法字符（含控制字符）。与主进程 pre-flight 同一套。 */
const INVALID_NAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;

/** Windows 保留设备名（连同任意扩展名一起保留，`CON.txt` 同样非法）。 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

/** 目标全路径长度上限。 */
const MAX_PATH_LENGTH = 259;

/**
 * 生成一条默认规则。
 * @param kind 规则种类。
 * @param id 规则 id。
 * @returns 参数取默认值的规则。
 */
export function createRule(kind: RenameRuleKind, id: string): RenameRule {
  return {
    id,
    kind,
    enabled: true,
    name: { text: '{name}' },
    insert: { position: 'end', index: 1, text: '' },
    replace: { find: '', replaceWith: '', regex: false, caseSensitive: false, all: true },
    case: { mode: 'lower' },
    trim: { mode: 'spaces', count: 1, from: 1, to: 1 },
    extension: { mode: 'lower', value: '' },
  };
}

/**
 * 补齐从 localStorage 读回的规则缺失的字段。
 *
 * `useToolConfig` 的浅合并只兜到 config 顶层，够不到数组里的每条规则；
 * 后续再加规则种类时，老用户存着的链会缺新字段，模板里直接访问就炸。
 * @param rules 存储中读回的规则链（可能是任意历史版本）。
 * @returns 补齐后的规则链。
 */
export function normalizeRules(rules: RenameRule[]): RenameRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule, index) => {
    const defaults = createRule(rule?.kind ?? 'insert', rule?.id ?? `rule-restored-${index}`);
    return {
      ...defaults,
      ...rule,
      name: { ...defaults.name, ...rule?.name },
      insert: { ...defaults.insert, ...rule?.insert },
      replace: { ...defaults.replace, ...rule?.replace },
      case: { ...defaults.case, ...rule?.case },
      trim: { ...defaults.trim, ...rule?.trim },
      extension: { ...defaults.extension, ...rule?.extension },
    };
  });
}

/**
 * 转义正则元字符，供「普通文本」查找替换复用 RegExp 的 g/i 标志。
 * @param text 原文。
 * @returns 转义后的文本。
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把时间戳格式化为 `yyyy-MM-dd`（{date} 变量用，不含时分，避免文件名带冒号）。
 * @param timestamp 毫秒时间戳。
 * @returns 日期字符串。
 */
function formatDateOnly(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const d = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 单行的变量取值。 */
interface VariableContext {
  /** {n} 展开后的序号文本（已补零）。 */
  n: string;
  /** {name} 原基名。 */
  name: string;
  /** {ext} 原扩展名。 */
  ext: string;
  /** {parent} 父目录名。 */
  parent: string;
  /** {date} 修改日期。 */
  date: string;
  /** {size} 可读大小。 */
  size: string;
}

/**
 * 展开文本中的变量。
 * 取值一律来自**原文件名**而非链上的中间结果，否则同一个 {name} 在链的不同位置含义不同。
 * @param text 含变量的文本。
 * @param ctx 变量取值。
 * @returns 展开后的文本。
 */
function expandVariables(text: string, ctx: VariableContext): string {
  return text.replace(/\{(n|name|ext|parent|date|size)\}/g, (_match, key: keyof VariableContext) =>
    String(ctx[key] ?? ''),
  );
}

/**
 * 施加大小写变换。
 * @param text 原文。
 * @param mode 变换方式。
 * @returns 变换后的文本。
 */
function applyCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'sentence':
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    case 'title':
      // 词边界取「非字母数字」，中文整体视为一个词、首字符不受影响
      return text
        .toLowerCase()
        .replace(
          /(^|[^\p{L}\p{N}])(\p{L})/gu,
          (_m, sep: string, ch: string) => sep + ch.toUpperCase(),
        );
    default:
      return text;
  }
}

/**
 * 施加删除字符。
 * @param text 原文。
 * @param rule 删除规则。
 * @returns 处理后的文本。
 */
function applyTrim(text: string, rule: TrimRule): string {
  switch (rule.mode) {
    case 'head':
      return text.slice(Math.max(0, rule.count));
    case 'tail': {
      const count = Math.max(0, rule.count);
      return count >= text.length ? '' : text.slice(0, text.length - count);
    }
    case 'range': {
      // from/to 是 1 起、闭区间；顺序填反也能用，取小的那个当起点
      const from = Math.max(1, Math.min(rule.from, rule.to));
      const to = Math.max(rule.from, rule.to);
      return text.slice(0, from - 1) + text.slice(to);
    }
    case 'spaces':
      return text.trim();
    default:
      return text;
  }
}

/**
 * 施加插入文本。
 * @param text 原文。
 * @param insertion 已展开变量的待插入文本。
 * @param rule 插入规则。
 * @returns 处理后的文本。
 */
function applyInsert(text: string, insertion: string, rule: InsertRule): string {
  if (rule.position === 'start') return insertion + text;
  if (rule.position === 'end') return text + insertion;
  const at = Math.max(0, Math.min(rule.index, text.length));
  return text.slice(0, at) + insertion + text.slice(at);
}

/**
 * 施加扩展名规则。
 * @param ext 当前扩展名（不含点）。
 * @param rule 扩展名规则。
 * @param ctx 变量取值（'set' 的目标值支持变量）。
 * @returns 新扩展名。
 */
function applyExtension(ext: string, rule: ExtensionRule, ctx: VariableContext): string {
  switch (rule.mode) {
    case 'set':
      return expandVariables(rule.value, ctx).replace(/^\.+/, '');
    case 'lower':
      return ext.toLowerCase();
    case 'upper':
      return ext.toUpperCase();
    case 'remove':
      return '';
    default:
      return ext;
  }
}

/** 预编译好的替换规则。 */
interface CompiledReplace {
  pattern: RegExp | null;
  /** 非正则模式下要把替换文本里的 `$` 转义掉，避免 `$&` 被当成特殊记号。 */
  escapeDollar: boolean;
}

/**
 * 预编译规则链上的正则，非法正则记入 ruleErrors 并标记为跳过。
 * @param rules 规则链。
 * @param ruleErrors 出参：id → 错误原因。
 * @returns id → 编译结果。
 */
function compileReplaces(
  rules: RenameRule[],
  ruleErrors: Record<string, string>,
): Map<string, CompiledReplace> {
  const compiled = new Map<string, CompiledReplace>();
  for (const rule of rules) {
    if (rule.kind !== 'replace') continue;
    const { find, regex, caseSensitive, all } = rule.replace;
    if (!find) {
      compiled.set(rule.id, { pattern: null, escapeDollar: !regex });
      continue;
    }
    const flags = `${all ? 'g' : ''}${caseSensitive ? '' : 'i'}`;
    try {
      compiled.set(rule.id, {
        pattern: new RegExp(regex ? find : escapeRegExp(find), flags),
        escapeDollar: !regex,
      });
    } catch (error) {
      ruleErrors[rule.id] = error instanceof Error ? error.message : '表达式无效';
      compiled.set(rule.id, { pattern: null, escapeDollar: !regex });
    }
  }
  return compiled;
}

/**
 * 按规则链算出每一行的新文件名。
 *
 * 序号 {n} 按 **rows 的当前顺序**取值，所以表格排序是功能的一部分而非装饰：
 * 调用方须先 sortRows 再传进来。
 * @param rows 待处理的行（顺序即序号顺序）。
 * @param rules 规则链（含未启用项，内部跳过）。
 * @param options 序号与扩展名开关。
 * @returns 新文件名数组与出错的规则。
 */
export function applyRules(
  rows: RenameRowInput[],
  rules: RenameRule[],
  options: ApplyRulesOptions,
): RenameComputation {
  const ruleErrors: Record<string, string> = {};
  const active = rules.filter((rule) => rule.enabled);
  const compiled = compileReplaces(active, ruleErrors);
  const { start, step, padding } = options.numbering;

  const names = rows.map((row, index) => {
    const origin = splitName(row.name);
    const serial = start + index * step;
    const ctx: VariableContext = {
      n: String(serial).padStart(Math.max(1, padding), '0'),
      name: origin.base,
      ext: origin.ext,
      parent: parentName(row.path),
      date: formatDateOnly(row.mtime),
      size: formatBytes(row.size),
    };

    let base = origin.base;
    let ext = origin.ext;

    for (const rule of active) {
      if (rule.kind === 'extension') {
        ext = applyExtension(ext, rule.extension, ctx);
        continue;
      }

      // includeExt 时对「基名.扩展名」整体施加，之后再拆回来
      const target = options.includeExt ? joinName(base, ext) : base;
      let next = target;

      switch (rule.kind) {
        case 'name':
          next = expandVariables(rule.name.text, ctx);
          break;
        case 'insert':
          next = applyInsert(target, expandVariables(rule.insert.text, ctx), rule.insert);
          break;
        case 'replace': {
          const entry = compiled.get(rule.id);
          if (!entry?.pattern) break;
          const replacement = expandVariables(rule.replace.replaceWith, ctx);
          next = target.replace(
            entry.pattern,
            entry.escapeDollar ? replacement.replace(/\$/g, '$$$$') : replacement,
          );
          break;
        }
        case 'case':
          next = applyCase(target, rule.case.mode);
          break;
        case 'trim':
          next = applyTrim(target, rule.trim);
          break;
        default:
          break;
      }

      if (options.includeExt) {
        const split = splitName(next);
        base = split.base;
        ext = split.ext;
      } else {
        base = next;
      }
    }

    return joinName(base, ext);
  });

  return { names, ruleErrors };
}

/**
 * 校验新文件名。
 *
 * 与主进程 pre-flight 同一套判定，但只覆盖渲染进程知道的部分
 * （盘上是否已有同名文件归主进程）。目的是让用户点「开始」之前就看见红字。
 * @param rows 待处理的行。
 * @param newNames 与 rows 等长、同序的新文件名。
 * @returns 与 rows 等长、同序的问题描述；无问题为空串。
 */
export function validateNames(rows: RenameRowInput[], newNames: string[]): string[] {
  const issues = newNames.map((name, index) => {
    const row = rows[index];
    if (!row) return '';
    if (!name) return '新文件名为空';
    if (INVALID_NAME_CHARS.test(name)) return '含非法字符 < > : " / \\ | ? *';
    if (/[. ]$/.test(name)) return '不能以点或空格结尾';
    const { base } = splitName(name);
    if (RESERVED_NAMES.has(base.toLowerCase())) return `${base} 是系统保留名`;
    const full = joinPath(dirOf(row.path), name);
    if (full.length > MAX_PATH_LENGTH) return `目标路径过长（${full.length} 字符）`;
    return '';
  });

  // 批内重名：同目录下忽略大小写比较全路径
  const seen = new Map<string, number>();
  newNames.forEach((name, index) => {
    const row = rows[index];
    if (!row || issues[index]) return;
    const key = joinPath(dirOf(row.path), name).toLowerCase();
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return;
    }
    issues[index] = '与批内另一项重名';
    if (!issues[first]) issues[first] = '与批内另一项重名';
  });

  return issues;
}

/**
 * 取文件所在目录（内联一个薄封装，避免 validateNames 里反复 import 名称歧义）。
 * @param path 文件绝对路径。
 * @returns 目录路径。
 */
function dirOf(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index < 0 ? '' : path.slice(0, index);
}

/**
 * 排序（返回新数组，不改原数组）。
 * @param rows 待排序的行。
 * @param by 排序依据。
 * @param desc 是否降序。
 * @returns 排好序的新数组。
 */
export function sortRows<T extends RenameRowInput & { order: number }>(
  rows: T[],
  by: RenameSortBy,
  desc: boolean,
): T[] {
  const sorted = [...rows].sort((a, b) => {
    switch (by) {
      case 'name':
        return NATURAL_COLLATOR.compare(a.name, b.name);
      case 'mtime':
        return a.mtime - b.mtime;
      case 'size':
        return a.size - b.size;
      default:
        return a.order - b.order;
    }
  });
  return desc ? sorted.reverse() : sorted;
}
