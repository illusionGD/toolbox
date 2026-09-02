import type { CropRect } from './types';

/**
 * 视频画面裁剪的两端共用规则（**实测得出，不是照文档抄的**）。
 *
 * 放在 shared 而不是主进程里，理由同 {@link ./audio.ts}：**两端都要用同一份**。
 * 主进程用它算真正传给 ffmpeg 的 crop 矩形，渲染进程用同一个函数算面板上的读数。
 * 各存一份必然漂移，而这里漂移的表现格外难查——面板写着「1280 × 719」、产物却是
 * 1280 × 718，没人会想到是两处取整规则不一致。
 */

/**
 * 裁剪框的最小边长 px。
 *
 * 这是**产品下限而非 ffmpeg 的限制**（ffmpeg 连 2×2 也照裁）：比这更小的框在
 * 画面上根本拖不准，而且缩放/GIF 那几路滤镜接着处理几像素的画面毫无意义。
 * 拖框组件会把框限制在这个下限以上，pre-flight 再兜一道（选区可能来自
 * 持久化的旧配置）。
 */
export const MIN_CROP_SIZE = 16;

/**
 * 把裁剪矩形对齐到偶数（宽高向下取整、偏移向下取整）。
 *
 * **必须做，但不是为了避免报错**——实测 `crop=641:361:11:11` 在 libx264 /
 * libx265 / libvpx-vp9 / gif 四路上全部退出码 0，ffmpeg **静默**把它当成
 * `640:360:10:10`（奇数偏移同样被下调：`crop=320:180:501:301` 与
 * `crop=320:180:500:300` 出来的像素平均绝对差为 0）。也就是说不对齐不会失败，
 * 只会让面板上的读数与实际产物差 1 px。这个函数存在的意义就是让两者一致：
 * 渲染进程照它显示、主进程照它下发，用户看到的尺寸就是文件里的尺寸。
 *
 * （根因是 yuv420p 的色度二次采样要求偶数宽高，同 `buildScaleFilter` 里
 * `-2` 那条注释。）
 * @param rect 任意整数像素矩形。
 * @returns 偶数对齐后的矩形（新对象，不改入参）。
 */
export function snapCropEven(rect: CropRect): CropRect {
  /** 向下取到偶数，负数一律归零。 */
  const even = (n: number): number => Math.max(0, Math.floor(n / 2) * 2);
  return {
    left: even(rect.left),
    top: even(rect.top),
    width: even(rect.width),
    height: even(rect.height),
  };
}

/**
 * 判断裁剪矩形是否超出源画面。
 *
 * **越界也不会报错**（实测）：1280 宽的源上 `crop=200:100:1200:10` 退出码 0、
 * stderr 一句提示都没有，ffmpeg 把偏移悄悄钳到 1080，于是用户拿到的是**另一块
 * 区域**。既然 ffmpeg 不说，就只能我们说——pre-flight 拦下来报中文原因。
 * @param rect 裁剪矩形（应已偶数对齐）。
 * @param sourceWidth 源画面宽 px。
 * @param sourceHeight 源画面高 px。
 * @returns 越界则为 true；源尺寸未知（0）时一律为 false，无从判断。
 */
export function cropExceedsSource(
  rect: CropRect,
  sourceWidth: number,
  sourceHeight: number,
): boolean {
  if (sourceWidth <= 0 || sourceHeight <= 0) return false;
  return rect.left + rect.width > sourceWidth || rect.top + rect.height > sourceHeight;
}

/**
 * 判断裁剪矩形是否有效（有正的宽高）。
 *
 * 统一这个判断而不是各处写 `crop && crop.width > 0 && crop.height > 0`——
 * 主进程有三处（buildFilters / transcodeToGif / preflight）要判，写歪一处就
 * 会出现「pre-flight 放过了、滤镜却没带上 crop」这种静默不裁。
 * @param rect 裁剪矩形，可为空。
 * @returns 需要裁剪则为 true。
 */
export function hasCrop(rect: CropRect | undefined | null): rect is CropRect {
  return !!rect && rect.width > 0 && rect.height > 0;
}
