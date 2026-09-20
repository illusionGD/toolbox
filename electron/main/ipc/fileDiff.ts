import type { BrowserWindow } from 'electron';
import { z } from 'zod';
import { FILE_DIFF_CHANNELS } from '../../shared/channels';
import type { FileDiffResult } from '../../shared/fileDiff';
import { compareFiles, fileDiffOptionsSchema, readDiffDetail } from '../fileDiff/compare';
import { handle } from './helper';

/** @param win 主工具窗口；关闭后取消读取并释放结果。 */
export function registerFileDiffIpc(win: BrowserWindow): void {
  let running: { id: string; controller: AbortController } | null = null;
  let result: FileDiffResult | null = null;
  let readingDetail = false;
  const checkOwner = (senderId: number): void => {
    if (win.isDestroyed() || senderId !== win.webContents.id)
      throw new Error('文件对比只能在主工具窗口使用');
  };
  handle(FILE_DIFF_CHANNELS.compare, async (event, input: unknown) => {
    checkOwner(event.sender.id);
    const options = fileDiffOptionsSchema.parse(input);
    if (running) throw new Error('请先取消当前对比');
    const controller = new AbortController();
    running = { id: options.jobId, controller };
    result = null;
    try {
      const value = await compareFiles(options, controller.signal, (progress) => {
        if (!win.isDestroyed()) win.webContents.send(FILE_DIFF_CHANNELS.progress, progress);
      });
      if (!win.isDestroyed()) result = value;
      return value;
    } finally {
      running = null;
    }
  });
  handle(FILE_DIFF_CHANNELS.cancel, (event, jobId: unknown) => {
    checkOwner(event.sender.id);
    if (running?.id !== z.string().parse(jobId)) return false;
    running.controller.abort();
    return true;
  });
  handle(FILE_DIFF_CHANNELS.detail, async (event, input: unknown) => {
    checkOwner(event.sender.id);
    const { jobId, entryId } = z
      .object({ jobId: z.string(), entryId: z.string() })
      .strict()
      .parse(input);
    const entry = result?.jobId === jobId ? result.entries.find((row) => row.id === entryId) : null;
    if (!entry) throw new Error('对比结果已过期，请重新对比');
    if (readingDetail) throw new Error('正在读取上一份文件详情，请稍候');
    readingDetail = true;
    try {
      return await readDiffDetail(entry);
    } finally {
      readingDetail = false;
    }
  });
  win.webContents.once('destroyed', () => {
    running?.controller.abort();
    result = null;
  });
}
