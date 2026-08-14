import type { ScanFileEntry, ScanResult } from '@shared/types';
import { formatBytes, formatDateTime } from './format';
import { joinPath } from './path';

/**
 * 文件统计聚合工具：把扫描结果按后缀归类，并生成导出文本。
 * 纯函数，不依赖 Vue，便于复用与测试。
 */

/** 无扩展名分组的展示名。 */
export const NO_EXT_LABEL = '(无扩展名)';

/** 明细行（在扫描条目基础上补全绝对路径）。 */
export interface StatFileRow extends ScanFileEntry {
  /** 文件绝对路径。 */
  path: string;
}

/** 按后缀归类的一组文件。 */
export interface ExtGroup {
  /** 扩展名（小写不含点）；无扩展名为空串。 */
  ext: string;
  /** 展示名（无扩展名时为 NO_EXT_LABEL，否则为 `.ext`）。 */
  label: string;
  /** 文件数量。 */
  count: number;
  /** 总大小（字节）。 */
  size: number;
  /** 该组的文件明细。 */
  files: StatFileRow[];
}

/** 汇总数据。 */
export interface StatTotals {
  /** 文件总数。 */
  count: number;
  /** 总大小（字节）。 */
  size: number;
  /** 后缀种类数。 */
  extCount: number;
}

/** 后缀过滤条件。 */
export interface ExtFilter {
  /** 仅统计这些后缀；为空表示不限制。 */
  include: string[];
  /** 排除这些后缀；优先级高于 include。 */
  exclude: string[];
}

/**
 * 将扫描结果按后缀聚合。
 * @param result 扫描结果；为 null 返回空数组。
 * @param filter 后缀过滤条件。
 * @returns 按总大小降序排列的分组。
 */
export function aggregateByExt(result: ScanResult | null, filter: ExtFilter): ExtGroup[] {
  if (!result) return [];
  const include = new Set(filter.include);
  const exclude = new Set(filter.exclude);
  const map = new Map<string, ExtGroup>();

  for (const file of result.files) {
    if (exclude.has(file.ext)) continue;
    if (include.size > 0 && !include.has(file.ext)) continue;

    let group = map.get(file.ext);
    if (!group) {
      group = {
        ext: file.ext,
        label: file.ext ? `.${file.ext}` : NO_EXT_LABEL,
        count: 0,
        size: 0,
        files: [],
      };
      map.set(file.ext, group);
    }
    group.count += 1;
    group.size += file.size;
    group.files.push({ ...file, path: joinPath(result.dirs[file.dirIndex] ?? '', file.name) });
  }

  return [...map.values()].sort((a, b) => b.size - a.size);
}

/**
 * 汇总各分组的数量与大小。
 * @param groups 分组数组。
 * @returns 总数、总大小与后缀种类数。
 */
export function buildTotals(groups: ExtGroup[]): StatTotals {
  return groups.reduce<StatTotals>(
    (acc, g) => ({
      count: acc.count + g.count,
      size: acc.size + g.size,
      extCount: acc.extCount + 1,
    }),
    { count: 0, size: 0, extCount: 0 },
  );
}

/**
 * 生成扫描结果中出现过的全部后缀（供过滤下拉使用）。
 * @param result 扫描结果。
 * @returns 后缀及其文件数，按数量降序。
 */
export function collectExtOptions(
  result: ScanResult | null,
): Array<{ ext: string; label: string; count: number }> {
  if (!result) return [];
  const counter = new Map<string, number>();
  for (const file of result.files) {
    counter.set(file.ext, (counter.get(file.ext) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([ext, count]) => ({ ext, label: ext ? `.${ext}` : NO_EXT_LABEL, count }))
    .sort((a, b) => b.count - a.count);
}

/** 导出范围：仅汇总 or 含每个文件明细。 */
export type ExportScope = 'summary' | 'detail';

/**
 * 转义 CSV 字段（含逗号/引号/换行时加引号）。
 * @param value 原始值。
 * @returns 转义后的字段。
 */
function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * 生成 CSV 报告文本。
 * @param groups 分组数据。
 * @param scope 导出范围。
 * @returns CSV 文本（不含 BOM，由主进程按需添加）。
 */
export function toCsv(groups: ExtGroup[], scope: ExportScope): string {
  const lines: string[] = [];
  if (scope === 'summary') {
    lines.push('后缀,数量,总大小(字节),总大小');
    for (const g of groups) {
      lines.push([g.label, g.count, g.size, formatBytes(g.size)].map(csvCell).join(','));
    }
  } else {
    lines.push('后缀,文件名,大小(字节),大小,修改时间,路径');
    for (const g of groups) {
      for (const f of g.files) {
        lines.push(
          [g.label, f.name, f.size, formatBytes(f.size), formatDateTime(f.mtime), f.path]
            .map(csvCell)
            .join(','),
        );
      }
    }
  }
  return lines.join('\r\n');
}

/**
 * 生成 JSON 报告文本。
 * @param groups 分组数据。
 * @param scope 导出范围。
 * @param meta 附加信息（根目录、耗时等）。
 * @returns 格式化的 JSON 文本。
 */
export function toJson(
  groups: ExtGroup[],
  scope: ExportScope,
  meta: { root: string; scannedAt: number },
): string {
  const totals = buildTotals(groups);
  return JSON.stringify(
    {
      root: meta.root,
      scannedAt: formatDateTime(meta.scannedAt),
      totals,
      groups: groups.map((g) => ({
        ext: g.label,
        count: g.count,
        size: g.size,
        sizeText: formatBytes(g.size),
        files:
          scope === 'detail'
            ? g.files.map((f) => ({
                name: f.name,
                size: f.size,
                mtime: formatDateTime(f.mtime),
                path: f.path,
              }))
            : undefined,
      })),
    },
    null,
    2,
  );
}
