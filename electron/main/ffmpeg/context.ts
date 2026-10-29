import { AsyncLocalStorage } from 'node:async_hooks';

/** 插件媒体处理的调用上下文，不改变其他工具的默认行为。 */
const context = new AsyncLocalStorage<{ signal: AbortSignal }>();

/** @param signal 插件生命周期信号。 @param action 复用的处理逻辑。 @returns 处理结果。 */
export function withPluginMedia<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  return context.run({ signal }, action);
}

/** @returns 仅当前异步处理链的取消信号。 */
export function pluginMediaSignal(): AbortSignal | undefined {
  return context.getStore()?.signal;
}

/** @returns 插件媒体输入只允许本地自包含容器，拒绝 HLS、concat 及外部协议。 */
export function pluginMediaInputFlags(): string[] {
  return context.getStore()
    ? [
        '-protocol_whitelist',
        'file,pipe',
        '-format_whitelist',
        'mov,matroska,webm,wav,avi,flac,ogg,mp3,aac,image2,png_pipe',
      ]
    : [];
}

/** @param args 既有 ffmpeg 参数。 @returns 为每个输入补充插件协议/容器约束。 */
export function pluginMediaArgs(args: string[]): string[] {
  return args.flatMap((arg) => (arg === '-i' ? [...pluginMediaInputFlags(), arg] : [arg]));
}
