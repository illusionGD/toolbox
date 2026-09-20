import { resolve } from 'node:path';
/** 只替换存储目录，浏览器与 ffmpeg 均使用真实生产实现。 */
export const cachePath = (...segments: string[]): string =>
  resolve('out-tbverify/webtest-runtime/cache', ...segments);
