import type {
  ExcelI18nOptions,
  ExcelI18nPreviewResult,
  ExcelI18nWriteResult,
  ExcelProbeResult,
} from '@shared/types';
import { unwrap } from './ipc';

/**
 * Excel 多语言服务：封装 window.api.excel，供渲染进程业务调用。
 */

/**
 * 探测工作簿结构（sheet 名 / 表头行各列文字 / 行列数）。
 * @param filePath 表格路径。
 * @param headerRow 表头行行号（1-based）。
 * @returns 结构信息。
 */
export function probeExcelApi(filePath: string, headerRow: number): Promise<ExcelProbeResult> {
  // 选文件与改表头行都会触发，失败在页面就地提示、不弹窗刷屏
  return unwrap(window.api.excel.probe(filePath, headerRow), { silent: true });
}

/**
 * 转换预览（只算不写盘）。
 * @param filePath 表格路径。
 * @param options 转换选项。
 * @param previewColumn 要预览的列号（1-based）。
 * @returns 各列统计 + 指定列的 JSON 文本。
 */
export function previewExcelI18nApi(
  filePath: string,
  options: ExcelI18nOptions,
  previewColumn: number,
): Promise<ExcelI18nPreviewResult> {
  // 预览由用户点刷新触发，错误显示在预览区，不弹窗
  return unwrap(window.api.excel.preview(filePath, options, previewColumn), { silent: true });
}

/**
 * 转换并落盘：一种语言一个 JSON。
 * @param filePath 表格路径。
 * @param options 转换选项。
 * @returns 产物摘要。
 */
export function excelI18nToJsonApi(
  filePath: string,
  options: ExcelI18nOptions,
): Promise<ExcelI18nWriteResult> {
  // 单次动作、非批量，失败直接弹提示
  return unwrap(window.api.excel.toJson(filePath, options), { errorPrefix: '转换失败' });
}
