import { html } from 'diff2html';
import { ColorSchemeType, LineType, type DiffBlock, type DiffFile } from 'diff2html/lib/types';
import type { FileDiffLine } from '@shared/fileDiff';

/**
 * 将有界预览转为 diff2html 数据，保留原始行号和省略块，不重建或重新比较截断的文件。
 * @param lines 主进程返回的差异预览。
 * @returns 左右并排 HTML；文件内容由 diff2html 转义，不能混入手写的用户 HTML。
 */
export function renderFileDiff(lines: FileDiffLine[]): string {
  const file: DiffFile = {
    oldName: 'comparison',
    newName: 'comparison',
    addedLines: 0,
    deletedLines: 0,
    isCombined: false,
    isGitDiff: false,
    language: 'text',
    blocks: [],
  };
  let block: DiffBlock | null = null;
  for (const line of lines) {
    if (!block || line.kind === 'gap') {
      block = {
        oldStartLine: line.leftLine ?? 0,
        newStartLine: line.rightLine ?? 0,
        header: line.kind === 'gap' ? line.text : '差异上下文',
        lines: [],
      };
      file.blocks.push(block);
    }
    if (line.kind === 'gap') continue;
    if (line.kind === 'removed') {
      file.deletedLines++;
      block.lines.push({
        type: LineType.DELETE,
        oldNumber: line.leftLine!,
        newNumber: undefined,
        content: `-${line.text}`,
      });
    } else if (line.kind === 'added') {
      file.addedLines++;
      block.lines.push({
        type: LineType.INSERT,
        oldNumber: undefined,
        newNumber: line.rightLine!,
        content: `+${line.text}`,
      });
    } else {
      block.lines.push({
        type: LineType.CONTEXT,
        oldNumber: line.leftLine!,
        newNumber: line.rightLine!,
        content: ` ${line.text}`,
      });
    }
  }
  return html([file], {
    outputFormat: 'side-by-side',
    drawFileList: false,
    colorScheme: ColorSchemeType.DARK,
    matching: 'lines',
    diffStyle: 'char',
    matchingMaxComparisons: 1000,
    maxLineSizeInBlockForComparison: 200,
    maxLineLengthHighlight: 500,
  });
}
