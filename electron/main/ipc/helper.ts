import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CODE, type IpcResponse } from '../../shared/types';

/**
 * 注册一个返回统一 {code,data,message} 格式的 IPC handler。
 * handler 正常返回值包成 code=0；抛异常则捕获为 code=1 并带 message，
 * 渲染进程据此统一解包与提示，主进程业务代码只需关注正常逻辑。
 * @param channel IPC 通道名。
 * @param handler 业务处理函数，返回值即 data。
 */
export function handle<T>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: never[]) => T | Promise<T>,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<IpcResponse<T>> => {
    try {
      const data = await handler(event, ...(args as never[]));
      return { code: IPC_CODE.ok, data, message: '' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 主进程留痕，便于排查
      console.error(`[IPC] ${channel} failed:`, error);
      return { code: IPC_CODE.error, data: null, message };
    }
  });
}
