import { extname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import ExcelJS from 'exceljs';
import { EXCEL_CHANNELS } from '../../shared/channels';
import type {
  ExcelI18nColumnStat,
  ExcelI18nFile,
  ExcelI18nOptions,
  ExcelI18nPreviewResult,
  ExcelI18nWriteResult,
  ExcelProbeResult,
  ExcelSheetInfo,
} from '../../shared/types';
import { handle } from './helper';

/** 嵌套后的多语言数据节点：叶子是译文字符串，中间层是对象。 */
type LocaleNode = { [key: string]: string | LocaleNode };

/**
 * exceljs 的 cell.value 归一化成纯文本。
 *
 * 它可能是 string / number / boolean / Date / {richText} / {formula,result} /
 * {hyperlink,text} / {sharedFormula,result} / null。直接 String() 会把富文本和
 * 公式单元格变成 `[object Object]`，所以这里逐种形态取文本。
 * @param value 单元格原始值。
 * @returns 去首尾空白的文本；无内容返回空串。
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // 富文本：多段带样式的文字，拼接各段 text
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText
        .map((run) => run.text ?? '')
        .join('')
        .trim();
    }
    // 公式（含共享公式）：取缓存的计算结果，递归归一
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    // 超链接：取显示文字而非 URL
    if ('text' in value) return cellText(value.text as ExcelJS.CellValue);
    // 错误值（#REF! 等）当空处理
    if ('error' in value) return '';
  }
  return String(value).trim();
}

/**
 * 读工作簿。xlsx/xlsm 走 xlsx 解析器，csv 走 csv 解析器。
 * @param filePath 表格路径。
 * @returns 工作簿。
 */
async function loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if (extname(filePath).toLowerCase() === '.csv') {
    await wb.csv.readFile(filePath);
  } else {
    await wb.xlsx.readFile(filePath);
  }
  return wb;
}

/**
 * 探测工作簿结构：各 sheet 的名字、行列数、表头行各列文字。
 * @param filePath 表格路径。
 * @param headerRow 表头行行号（1-based）。
 * @returns 结构信息。
 */
export async function probeExcel(filePath: string, headerRow: number): Promise<ExcelProbeResult> {
  const wb = await loadWorkbook(filePath);
  const sheets: ExcelSheetInfo[] = [];
  wb.eachSheet((ws) => {
    const columnCount = ws.columnCount;
    const row = ws.getRow(headerRow);
    // 下标即列号：headers[0] 是 A 列，让渲染进程能直接按列号取表头
    const headers: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) {
      headers.push(cellText(row.getCell(col).value));
    }
    sheets.push({ name: ws.name, rowCount: ws.rowCount, columnCount, headers });
  });
  return { sheets };
}

/**
 * 按点号把值写进嵌套对象；关闭 nested 时整串 key 平铺。
 *
 * 冲突（先有 `a` 是字符串、又来 `a.b`，或反之）不覆盖已有数据，返回 false 让调用方
 * 记 warning——静默覆盖会让用户丢翻译且毫无察觉。
 * @param target 目标对象。
 * @param key 原始 key（可能含点号）。
 * @param value 译文。
 * @param nested 是否按点号嵌套。
 * @returns 是否写入成功。
 */
function setDeep(target: LocaleNode, key: string, value: string, nested: boolean): boolean {
  if (!nested || !key.includes('.')) {
    if (typeof target[key] === 'object') return false;
    target[key] = value;
    return true;
  }
  const parts = key.split('.').filter((p) => p !== '');
  if (!parts.length) return false;
  let node = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    const next = node[part];
    if (next === undefined) {
      const created: LocaleNode = {};
      node[part] = created;
      node = created;
    } else if (typeof next === 'object') {
      node = next;
    } else {
      // 该层已被字符串占用，不能再往下建对象
      return false;
    }
  }
  const last = parts[parts.length - 1];
  if (typeof node[last] === 'object') return false;
  node[last] = value;
  return true;
}

/** buildLocales 的内部产物。 */
interface BuiltLocales {
  /** 列号 → 该语言的数据树。 */
  data: Map<number, LocaleNode>;
  /** 各列统计。 */
  stats: ExcelI18nColumnStat[];
  /** key 为空被整行跳过的行数。 */
  skippedRows: number;
  /** 聚合后的告警。 */
  warnings: string[];
}

/**
 * 解析核心：读表 → 按行取 key 与各语言译文 → 建各语言的数据树。
 *
 * 预览与落盘共用这一份，保证「看到的」就是「写下的」。
 * @param filePath 表格路径。
 * @param options 转换选项。
 * @returns 各语言数据与统计。
 */
async function buildLocales(filePath: string, options: ExcelI18nOptions): Promise<BuiltLocales> {
  const { sheets, startRow, keyColumn, columns, nested } = options;
  if (!columns.length) throw new Error('未选择要导出的语言列');

  const wb = await loadWorkbook(filePath);
  const data = new Map<number, LocaleNode>();
  const emptyCounts = new Map<number, number>();
  for (const col of columns) {
    data.set(col.column, {});
    emptyCounts.set(col.column, 0);
  }

  let skippedRows = 0;
  let conflictCount = 0;
  let overrideCount = 0;
  const seenKeys = new Set<string>();
  const missingSheets: string[] = [];

  for (const sheetName of sheets) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) {
      missingSheets.push(sheetName);
      continue;
    }
    for (let rowNo = startRow; rowNo <= ws.rowCount; rowNo += 1) {
      const row = ws.getRow(rowNo);
      const key = cellText(row.getCell(keyColumn).value);
      // key 为空的行多是分组标题或空行，整行跳过
      if (!key) {
        skippedRows += 1;
        continue;
      }
      if (seenKeys.has(key)) overrideCount += 1;
      else seenKeys.add(key);

      for (const col of columns) {
        const text = cellText(row.getCell(col.column).value);
        // 空译文不落 key，让前端回退到默认语言，比留空串更实用
        if (!text) {
          emptyCounts.set(col.column, (emptyCounts.get(col.column) ?? 0) + 1);
          continue;
        }
        const node = data.get(col.column);
        if (node && !setDeep(node, key, text, nested)) conflictCount += 1;
      }
    }
  }

  const warnings: string[] = [];
  if (missingSheets.length) warnings.push(`找不到工作表：${missingSheets.join('、')}`);
  if (overrideCount) warnings.push(`${overrideCount} 个重复 key 被后出现的行覆盖`);
  if (conflictCount) {
    warnings.push(`${conflictCount} 处 key 与已有嵌套结构冲突已跳过（如同时存在 a 与 a.b）`);
  }

  const stats: ExcelI18nColumnStat[] = columns.map((col) => ({
    column: col.column,
    fileName: col.fileName,
    keyCount: countLeaves(data.get(col.column) ?? {}),
    emptyCount: emptyCounts.get(col.column) ?? 0,
  }));

  return { data, stats, skippedRows, warnings };
}

/**
 * 递归数叶子（译文）数量——嵌套后顶层 key 数不等于真实翻译条数。
 * @param node 数据树。
 * @returns 叶子数。
 */
function countLeaves(node: LocaleNode): number {
  let n = 0;
  for (const value of Object.values(node)) {
    n += typeof value === 'object' ? countLeaves(value) : 1;
  }
  return n;
}

/**
 * 序列化一份数据树。indent 为 0 时压缩成单行。
 * @param node 数据树。
 * @param indent 缩进空格数。
 * @returns JSON 文本。
 */
function serialize(node: LocaleNode, indent: number): string {
  return indent > 0 ? JSON.stringify(node, null, indent) : JSON.stringify(node);
}

/**
 * 转换预览（只算不写盘）：回全部列的统计，但只序列化被请求的那一列。
 *
 * 几十个语言的全量 JSON 一起过 IPC 会又大又慢，而页面一次只看一列。
 * @param filePath 表格路径。
 * @param options 转换选项。
 * @param previewColumn 要预览的列号；不在 columns 里则 previewJson 为空串。
 * @returns 统计 + 单列 JSON。
 */
async function previewExcelI18n(
  filePath: string,
  options: ExcelI18nOptions,
  previewColumn: number,
): Promise<ExcelI18nPreviewResult> {
  const built = await buildLocales(filePath, options);
  const node = built.data.get(previewColumn);
  return {
    columns: built.stats,
    previewJson: node ? serialize(node, options.indent) : '',
    skippedRows: built.skippedRows,
    warnings: built.warnings,
  };
}

/**
 * 转换并落盘：一种语言一个 JSON。
 * @param filePath 表格路径。
 * @param options 转换选项。
 * @returns 产物摘要。
 */
async function excelI18nToJson(
  filePath: string,
  options: ExcelI18nOptions,
): Promise<ExcelI18nWriteResult> {
  if (!options.outputDir) throw new Error('未指定输出目录');
  const built = await buildLocales(filePath, options);

  // 直接写输出目录（用户要求不建子文件夹，便于覆盖项目的 locales 目录）
  const outDir = options.outputDir;
  await mkdir(outDir, { recursive: true });

  const files: ExcelI18nFile[] = [];
  for (const col of options.columns) {
    const node = built.data.get(col.column);
    if (!node) continue;
    const name = col.fileName.toLowerCase().endsWith('.json')
      ? col.fileName
      : `${col.fileName}.json`;
    const text = serialize(node, options.indent);
    const full = join(outDir, name);
    await writeFile(full, text, 'utf-8');
    files.push({
      name,
      path: full,
      keyCount: countLeaves(node),
      size: Buffer.byteLength(text, 'utf-8'),
    });
  }

  return { outDir, files, skippedRows: built.skippedRows, warnings: built.warnings };
}

/** 注册 Excel 多语言转 JSON 相关 IPC。 */
export function registerExcelIpc(): void {
  handle(EXCEL_CHANNELS.probe, (_e, filePath: string, headerRow: number) =>
    probeExcel(filePath, headerRow),
  );
  handle(
    EXCEL_CHANNELS.preview,
    (_e, filePath: string, options: ExcelI18nOptions, previewColumn: number) =>
      previewExcelI18n(filePath, options, previewColumn),
  );
  handle(EXCEL_CHANNELS.toJson, (_e, filePath: string, options: ExcelI18nOptions) =>
    excelI18nToJson(filePath, options),
  );
}
