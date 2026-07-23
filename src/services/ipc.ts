import { IPC_CODE, type IpcResponse } from '@shared/types';
import { showError } from '@/utils/feedback';

/** unwrap 的选项。 */
export interface UnwrapOptions {
  /** 失败时是否静默（不弹提示），默认 false（显示）。 */
  silent?: boolean;
  /** 自定义错误前缀，如「压缩失败」。 */
  errorPrefix?: string;
}

/**
 * 统一解包 IPC 返回的 {code,data,message}。
 * 成功返回 data；失败默认弹出错误提示并抛出异常，可通过 silent 关闭提示。
 * @param promise 返回 IpcResponse 的调用。
 * @param options 提示控制。
 * @returns 成功时的 data。
 */
export async function unwrap<T>(
  promise: Promise<IpcResponse<T>>,
  options: UnwrapOptions = {},
): Promise<T> {
  const res = await promise;
  if (res.code === IPC_CODE.ok) {
    return res.data as T;
  }
  const msg = options.errorPrefix ? `${options.errorPrefix}：${res.message}` : res.message;
  if (!options.silent) showError(msg || '操作失败');
  throw new Error(msg || 'IPC error');
}
