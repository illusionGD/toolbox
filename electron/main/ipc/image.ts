import { basename, dirname, extname, join } from 'path';
import { readFile, stat, unlink, writeFile } from 'fs/promises';
import sharp, { type Matrix3x3, type Sharp } from 'sharp';
import { IMAGE_CHANNELS } from '../../shared/channels';
import type {
  AutoCropOptions,
  CompressOptions,
  CompressResult,
  CropOptions,
  CropProbe,
  CropRect,
  CropResult,
  FormatAdvanced,
  ImageOutputFormat,
  RegionEffect,
  StylizeEffect,
  StylizeEffects,
  StylizeOptions,
  StylizePreviewOptions,
  StylizeResult,
} from '../../shared/types';
import { handle } from './helper';

/** 已解析的输出格式（不含 original）。 */
type ResolvedFormat = Exclude<ImageOutputFormat, 'original'>;

/** 输出格式对应的文件扩展名。 */
const FORMAT_EXT: Record<ResolvedFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tiff: 'tif',
};

/**
 * 源扩展名 → 输出格式（保持原格式时用）。
 * svg / heic 等只能读不能写的格式不在表内，会回退到 PNG。
 */
const EXT_TO_FORMAT: Record<string, ResolvedFormat> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  png: 'png',
  webp: 'webp',
  avif: 'avif',
  gif: 'gif',
  tif: 'tiff',
  tiff: 'tiff',
};

/**
 * 支持多帧动画的输出格式。
 * avif 虽然容器支持，但当前 libvips 编码后只剩 1 帧，故不列入。
 */
const ANIMATED_FORMATS = new Set<ResolvedFormat>(['gif', 'webp']);

/**
 * 按输出格式对 sharp 实例应用编码参数（含高级选项）。
 * @param instance sharp 实例。
 * @param format 目标格式（已解析，非 original）。
 * @param quality 质量 1-100。
 * @param advanced 各格式高级选项（可选，缺省用 sharp 默认）。
 * @returns 配置后的 sharp 实例。
 */
function applyFormat(
  instance: Sharp,
  format: ResolvedFormat,
  quality: number,
  advanced?: Partial<FormatAdvanced>,
): Sharp {
  switch (format) {
    case 'jpeg': {
      const a = advanced?.jpeg;
      return instance.jpeg({
        quality,
        progressive: a?.progressive,
        mozjpeg: a?.mozjpeg,
        chromaSubsampling: a?.chromaSubsampling,
      });
    }
    case 'png': {
      const a = advanced?.png;
      // png 无 quality；高级里可显式给 compressionLevel，否则由 quality 近似映射
      return instance.png({
        compressionLevel: a?.compressionLevel ?? Math.round(((100 - quality) / 100) * 9),
        progressive: a?.progressive,
        palette: a?.palette,
        quality: a?.palette ? quality : undefined,
      });
    }
    case 'webp': {
      const a = advanced?.webp;
      return instance.webp({ quality, lossless: a?.lossless, effort: a?.effort });
    }
    case 'avif': {
      const a = advanced?.avif;
      return instance.avif({ quality, lossless: a?.lossless, effort: a?.effort });
    }
    case 'gif': {
      // gif 是调色板格式，没有质量参数，体积由颜色数决定
      const a = advanced?.gif;
      return instance.gif({ colours: a?.colours, dither: a?.dither });
    }
    case 'tiff': {
      const a = advanced?.tiff;
      // compression 为 jpeg 时 quality 才生效，其余为无损算法
      return instance.tiff({ compression: a?.compression, quality });
    }
  }
}

/**
 * 生成缩略图 data URL（用于列表预览，避免把原图全量塞进渲染进程）。
 * 动图只取首帧。
 *
 * 必须 Buffer 输入：从路径读时 libvips 会长期持有文件句柄，Windows 上导致
 * 之后对同一文件的写入报 UNKNOWN、删除报 EBUSY。列表里每张图都会先生成缩略图，
 * 之后再「覆盖原文件」就必崩（实测 jpg/webp/gif 复现，png/tif/avif 不复现）。
 * @param filePath 图片路径。
 * @param size 缩略图最大边长，默认 64。
 * @returns webp 格式的 data URL。
 */
async function makeThumbnail(filePath: string, size = 64): Promise<string> {
  const input = await readFile(filePath);
  const buffer = await sharp(input)
    .resize(size, size, { fit: 'cover' })
    .webp({ quality: 60 })
    .toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

/**
 * 读取图片为可在 <img> 中显示的 data URL（用于点击对比大图预览）。
 * 浏览器不认的格式（tiff/heic 等）转成 png 再回传。
 * @param filePath 图片路径。
 * @returns 图片 data URL。
 */
async function readDataUrl(filePath: string): Promise<string> {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  // Chromium 可直接渲染的格式原样回传，保留动图动画
  const nativeMime: Record<string, string> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    webp: 'webp',
    avif: 'avif',
    gif: 'gif',
    svg: 'svg+xml',
  };
  const mime = nativeMime[ext];
  if (mime) {
    const buffer = await readFile(filePath);
    return `data:image/${mime};base64,${buffer.toString('base64')}`;
  }
  const converted = await sharp(await readFile(filePath))
    .png()
    .toBuffer();
  return `data:image/png;base64,${converted.toString('base64')}`;
}

/**
 * 解析实际输出格式。
 * original 时按源扩展名映射；源格式不可编码（svg/heic 等）时回退到 PNG。
 * @param format 用户选择的输出格式。
 * @param sourceExt 源文件扩展名（小写，不含点）。
 * @returns 已解析的输出格式。
 */
function resolveFormat(format: ImageOutputFormat, sourceExt: string): ResolvedFormat {
  if (format !== 'original') return format;
  return EXT_TO_FORMAT[sourceExt] ?? 'png';
}

/**
 * 把处理结果写盘并处理覆盖语义。
 *
 * 直接写 buffer 而非 `sharp().toFile()`：后者会用默认参数重新编码，
 * 丢掉调用方设的质量/effort，且写出的文件与统计的大小对不上。
 *
 * 覆盖模式下也按输出格式定扩展名：否则 a.png 转成 JPEG 后仍叫 .png，
 * 成了「扩展名骗人」的文件。格式没变时路径与源一致，就是真正的原地覆盖。
 * @param sourcePath 源文件路径。
 * @param buffer 已编码的输出数据。
 * @param resolvedFormat 已解析的输出格式（决定扩展名）。
 * @param options 输出目录与覆盖开关。
 * @returns 实际写入的路径。
 */
async function writeOutput(
  sourcePath: string,
  buffer: Buffer,
  resolvedFormat: ResolvedFormat,
  options: { outputDir: string; overwrite: boolean },
): Promise<string> {
  const outExt = FORMAT_EXT[resolvedFormat];
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const dir = options.overwrite ? dirname(sourcePath) : options.outputDir;
  const outputPath = join(dir, `${nameNoExt}.${outExt}`);

  await writeFile(outputPath, buffer);
  // 覆盖模式下若扩展名变了，源文件已无用，删掉避免留下一份旧格式副本
  if (options.overwrite && outputPath !== sourcePath) await unlink(sourcePath);

  return outputPath;
}

/**
 * 压缩 / 转换单张图片。
 * @param sourcePath 源文件路径。
 * @param options 处理选项。
 * @returns 处理结果（含前后大小、体积变化与实际输出格式）。
 */
async function compressOne(sourcePath: string, options: CompressOptions): Promise<CompressResult> {
  const { format, quality, maxWidth, outputDir, overwrite, keepAnimation, advanced } = options;

  const originalStat = await stat(sourcePath);
  const sourceExt = extname(sourcePath).replace(/^\./, '').toLowerCase();
  const resolvedFormat = resolveFormat(format, sourceExt);

  // 一律先整个读进内存再交给 sharp：从路径读时 libvips 会长期持有文件句柄，
  // Windows 上对同一路径写回报 UNKNOWN、删除报 EBUSY（jpg/webp/gif 复现，
  // png/tif/avif 不复现，极易漏测）。句柄不随本次调用结束释放，所以即便这次
  // 不覆盖，也会挡住之后对同一文件的覆盖处理，不能只在覆盖模式下规避。
  const input = await readFile(sourcePath);

  // 只有目标格式支持多帧、且用户要求保留时才开 animated。
  // 对静态格式误开会把各帧竖排拼成一张长图（sharp 的多帧内存布局），必须先判断。
  const wantAnimation = keepAnimation !== false && ANIMATED_FORMATS.has(resolvedFormat);
  const probe = await sharp(input).metadata();
  const animated = wantAnimation && (probe.pages ?? 1) > 1;

  let instance = sharp(input, animated ? { animated: true } : undefined);
  // 动图各帧已按 pageHeight 竖排，EXIF 方向修正对其无意义且会打乱布局
  if (!animated) instance = instance.rotate();
  if (maxWidth && maxWidth > 0) {
    // 仅缩小、不放大
    instance = instance.resize({ width: maxWidth, withoutEnlargement: true });
  }
  instance = applyFormat(instance, resolvedFormat, quality, advanced);

  const buffer = await instance.toBuffer();
  const outputPath = await writeOutput(sourcePath, buffer, resolvedFormat, {
    outputDir,
    overwrite,
  });

  const compressedSize = buffer.length;
  const originalSize = originalStat.size;
  // 转格式时体积可能变大，保留负数如实反馈，不再截断到 0
  const ratio = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0;

  return {
    sourcePath,
    outputPath,
    originalSize,
    compressedSize,
    ratio,
    outputFormat: resolvedFormat,
    animated,
  };
}

/**
 * 计算自动裁剪的包围盒。
 *
 * sharp 的 `trim()` 不返回矩形，只在 OutputInfo 里给 `trimOffsetLeft/Top`——
 * 且这两个值是**负数**（表示内容相对原图左上角的偏移量取负），需取反才是坐标。
 * @param input 图片数据。
 * @param auto 自动裁剪参数。
 * @returns 包围盒；无法判定时为 null。
 */
async function computeTrimRect(input: Buffer, auto: AutoCropOptions): Promise<CropRect | null> {
  try {
    const { info } = await sharp(input)
      .trim({
        threshold: auto.threshold,
        lineArt: auto.lineArt,
        margin: auto.margin,
        ...(auto.background ? { background: auto.background } : {}),
      })
      .toBuffer({ resolveWithObject: true });
    return {
      left: -(info.trimOffsetLeft ?? 0),
      top: -(info.trimOffsetTop ?? 0),
      width: info.width,
      height: info.height,
    };
  } catch {
    // 全透明/纯色等无内容可留的图，trim 可能失败；当作「没有可裁的边」而不是错误
    return null;
  }
}

/**
 * 探测自动裁剪的包围盒（只算不写盘），供列表在处理前预览裁剪范围。
 * @param filePath 图片路径。
 * @param auto 自动裁剪参数。
 * @returns 原图尺寸与包围盒。
 */
async function probeCrop(filePath: string, auto: AutoCropOptions): Promise<CropProbe> {
  const input = await readFile(filePath);
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  return { width, height, rect: await computeTrimRect(input, auto) };
}

/**
 * 把裁剪矩形钳制进图片边界，并取整。
 *
 * sharp 的 `extract()` 对越界直接抛 `extract_area: bad extract area`，
 * 对小数/负数抛 `Expected integer between 0 and ...`；而拉框来的坐标
 * 既可能是小数也可能差一两个像素越界，必须先规整。
 * @param rect 原始矩形。
 * @param imgWidth 图片宽度。
 * @param imgHeight 图片高度。
 * @returns 合法矩形；无有效区域时为 null。
 */
function clampRect(rect: CropRect, imgWidth: number, imgHeight: number): CropRect | null {
  const left = Math.min(Math.max(Math.round(rect.left), 0), Math.max(imgWidth - 1, 0));
  const top = Math.min(Math.max(Math.round(rect.top), 0), Math.max(imgHeight - 1, 0));
  const width = Math.min(Math.round(rect.width), imgWidth - left);
  const height = Math.min(Math.round(rect.height), imgHeight - top);
  // extract 不接受 0 宽高（报 parameter width not set）
  if (width < 1 || height < 1) return null;
  return { left, top, width, height };
}

/**
 * 把图片居中放入指定画布：小了补透明边，大了等比缩放后再补。
 * @param instance sharp 实例。
 * @param current 当前尺寸。
 * @param canvas 目标画布尺寸。
 * @returns 处理后的 sharp 实例。
 */
function fitCanvas(
  instance: Sharp,
  current: { width: number; height: number },
  canvas: { width: number; height: number },
): Sharp {
  const background = { r: 0, g: 0, b: 0, alpha: 0 };
  // 内容比画布大时 extend 的边距会变负数，sharp 直接报错；
  // 这种情况先等比缩到画布内（contain 自带居中补边），一步到位
  if (current.width > canvas.width || current.height > canvas.height) {
    return instance.resize({
      width: canvas.width,
      height: canvas.height,
      fit: 'contain',
      background,
    });
  }
  const dw = canvas.width - current.width;
  const dh = canvas.height - current.height;
  // 奇数差值分摊到两侧，floor/ceil 保证加起来正好等于目标尺寸
  return instance.extend({
    left: Math.floor(dw / 2),
    right: Math.ceil(dw / 2),
    top: Math.floor(dh / 2),
    bottom: Math.ceil(dh / 2),
    background,
  });
}

/**
 * 裁剪单张图片。
 * @param sourcePath 源文件路径。
 * @param options 裁剪选项。
 * @returns 裁剪结果（含前后尺寸与是否无边可裁）。
 */
async function cropOne(sourcePath: string, options: CropOptions): Promise<CropResult> {
  const { mode, auto, rect, canvas, format, quality, outputDir, overwrite } = options;

  const originalStat = await stat(sourcePath);
  const sourceExt = extname(sourcePath).replace(/^\./, '').toLowerCase();
  const resolvedFormat = resolveFormat(format, sourceExt);

  // 裁剪必须先探测尺寸做边界钳制，读两次同一路径会让 libvips 一直持有文件句柄，
  // Windows 上写回/删除源文件会 UNKNOWN / EBUSY。故一律先读进内存。
  // 同时不传 animated：多帧图在 sharp 里是各帧竖排的长图，extract 的坐标系会
  // 落到那张长图上，语义完全错。裁剪只处理首帧。
  const input = await readFile(sourcePath);
  const meta = await sharp(input).metadata();
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;

  let instance = sharp(input).rotate();
  let cropped = { width: originalWidth, height: originalHeight };

  if (mode === 'auto') {
    const bbox = await computeTrimRect(input, auto);
    if (bbox) {
      instance = instance.trim({
        threshold: auto.threshold,
        lineArt: auto.lineArt,
        margin: auto.margin,
        ...(auto.background ? { background: auto.background } : {}),
      });
      cropped = { width: bbox.width, height: bbox.height };
    }
  } else if (rect) {
    const safe = clampRect(rect, originalWidth, originalHeight);
    if (safe) {
      instance = instance.extract(safe);
      cropped = { width: safe.width, height: safe.height };
    }
  }

  if (canvas) {
    instance = fitCanvas(instance, cropped, canvas);
    cropped = { width: canvas.width, height: canvas.height };
  }

  instance = applyFormat(instance, resolvedFormat, quality);

  const { data, info } = await instance.toBuffer({ resolveWithObject: true });
  const outputPath = await writeOutput(sourcePath, data, resolvedFormat, { outputDir, overwrite });

  return {
    sourcePath,
    outputPath,
    originalSize: originalStat.size,
    croppedSize: data.length,
    originalWidth,
    originalHeight,
    width: info.width,
    height: info.height,
    outputFormat: resolvedFormat,
    // 尺寸没变说明本来就没有可裁的边，如实告诉用户而不是假装裁过
    skipped: info.width === originalWidth && info.height === originalHeight,
  };
}

/**
 * raw 像素缓冲：风格化各趟之间的统一载体。
 *
 * 用 raw 而非 PNG 中转，是因为 PNG 每趟都要编解码（4000x3000 约 46ms/趟，多趟累积）；
 * raw 的代价只是内存（同尺寸约 45.8MB），可接受。
 */
interface RawImage {
  data: Buffer;
  width: number;
  height: number;
  channels: number;
}

/**
 * 风格化效果的固定执行顺序。
 *
 * sharp 的链式调用**不是**顺序管线：它只是往同一次 libvips 运算里填参数，
 * 真正的执行顺序由 libvips 自己定（实测写 `blur().threshold()` 与
 * `threshold().blur()` 输出逐字节相同），同一算子写两次也只生效一次。
 * 所以想让「面板上的顺序」真的是执行顺序，只能**每个效果各占一趟**，
 * 用本数组定序：几何/邻域类在前、调色在后、二值化最后。
 */
const EFFECT_ORDER: StylizeEffect[] = [
  'mosaic',
  'blur',
  'median',
  'sharpen',
  'grayscale',
  'sepia',
  'tint',
  'modulate',
  'contrast',
  'negate',
  'threshold',
];

/** 经典 sepia 色调矩阵（recomb 用）。 */
const SEPIA_MATRIX: Matrix3x3 = [
  [0.393, 0.769, 0.189],
  [0.349, 0.686, 0.168],
  [0.272, 0.534, 0.131],
];

/** 预览默认长边上限 px。 */
const PREVIEW_MAX_SIZE = 900;

/**
 * 解码成 raw 像素。
 *
 * 统一 `ensureAlpha()` 保证 4 通道（灰度 png / jpeg 也会补上，实测 ch=4），
 * 后续各趟就能按固定通道数安全串联。
 * @param input 图片数据。
 * @param maxSize 长边上限 px；给了就先等比缩小（预览用），不放大。
 * @returns raw 像素缓冲。
 */
async function toRaw(input: Buffer, maxSize?: number): Promise<RawImage> {
  // 不开 animated：多帧图在 sharp 里是各帧竖排的长图，区域坐标会落到长图上，
  // 语义完全错。风格化只处理首帧。
  let instance = sharp(input).rotate();
  if (maxSize && maxSize > 0) {
    instance = instance.resize({
      width: maxSize,
      height: maxSize,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  const { data, info } = await instance.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * 把 raw 像素包回 sharp 实例。
 * @param img raw 像素缓冲。
 * @returns sharp 实例。
 */
function fromRaw(img: RawImage): Sharp {
  return sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: img.channels as 1 | 2 | 3 | 4 },
  });
}

/**
 * 跑一趟：施加单个算子后立刻落回 raw。
 *
 * 「一个效果一趟」是上面 EFFECT_ORDER 注释里那条 sharp 行为的直接后果，
 * 不能为了省时间把多个效果合并进一条链。
 * @param img 输入 raw。
 * @param fn 在 sharp 实例上施加算子。
 * @returns 输出 raw。
 */
async function runPass(img: RawImage, fn: (instance: Sharp) => Sharp): Promise<RawImage> {
  const { data, info } = await fn(fromRaw(img)).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

/**
 * 马赛克：降采样再放大回原尺寸。
 *
 * **必须分两趟**：`resize(小).resize(大)` 写在一条链上会被 libvips 折叠成
 * 一次「原尺寸 → 原尺寸」，输出与原图逐字节相同（实测），等于没打码。
 * @param img 输入 raw。
 * @param block 块大小 px。
 * @returns 输出 raw。
 */
async function applyMosaic(img: RawImage, block: number): Promise<RawImage> {
  const size = Math.max(2, Math.round(block));
  const smallW = Math.max(1, Math.round(img.width / size));
  const smallH = Math.max(1, Math.round(img.height / size));
  const small = await runPass(img, (i) => i.resize(smallW, smallH, { kernel: 'nearest' }));
  return runPass(small, (i) => i.resize(img.width, img.height, { kernel: 'nearest' }));
}

/**
 * 按固定顺序施加全局效果，每个效果各占一趟。
 * @param img 输入 raw。
 * @param effects 效果集合。
 * @param scale 像素级参数的缩放比（预览时 <1，保证预览与全尺寸观感一致）。
 * @returns 输出 raw 与实际施加的效果数。
 */
async function applyEffects(
  img: RawImage,
  effects: StylizeEffects,
  scale: number,
): Promise<{ img: RawImage; appliedCount: number }> {
  let current = img;
  let appliedCount = 0;

  for (const key of EFFECT_ORDER) {
    switch (key) {
      case 'mosaic': {
        const e = effects.mosaic;
        if (!e?.enabled) break;
        // 像素级参数要跟着预览一起缩：不缩的话 25% 预览里的块数只有全尺寸的 1/4，
        // 用户看到的码比实际大 4 倍，是假象
        current = await applyMosaic(current, Math.max(2, e.block * scale));
        appliedCount += 1;
        break;
      }
      case 'blur': {
        const e = effects.blur;
        if (!e?.enabled) break;
        current = await runPass(current, (i) => i.blur(Math.max(0.3, e.sigma * scale)));
        appliedCount += 1;
        break;
      }
      case 'median': {
        const e = effects.median;
        if (!e?.enabled) break;
        // median 窗口必须是正奇数
        const size = Math.max(1, Math.round((e.size * scale - 1) / 2) * 2 + 1);
        current = await runPass(current, (i) => i.median(size));
        appliedCount += 1;
        break;
      }
      case 'sharpen': {
        const e = effects.sharpen;
        if (!e?.enabled) break;
        current = await runPass(current, (i) => i.sharpen({ sigma: Math.max(0.3, e.sigma) }));
        appliedCount += 1;
        break;
      }
      case 'grayscale': {
        if (!effects.grayscale?.enabled) break;
        // 不能用 grayscale()：它输出的 raw 只有 1 通道，alpha 直接丢，
        // 下一趟按 4 通道读就花屏（ensureAlpha/toColourspace 都救不回来）。
        // modulate({saturation:0}) 像素值与 grayscale() 完全一致，且保住 4 通道。
        current = await runPass(current, (i) => i.modulate({ saturation: 0 }));
        appliedCount += 1;
        break;
      }
      case 'sepia': {
        if (!effects.sepia?.enabled) break;
        current = await runPass(current, (i) => i.recomb(SEPIA_MATRIX));
        appliedCount += 1;
        break;
      }
      case 'tint': {
        const e = effects.tint;
        if (!e?.enabled) break;
        current = await runPass(current, (i) => i.tint(e.color));
        appliedCount += 1;
        break;
      }
      case 'modulate': {
        const e = effects.modulate;
        if (!e?.enabled) break;
        current = await runPass(current, (i) =>
          i.modulate({ brightness: e.brightness, saturation: e.saturation, hue: e.hue }),
        );
        appliedCount += 1;
        break;
      }
      case 'contrast': {
        const e = effects.contrast;
        if (!e?.enabled) break;
        // 绕中灰旋转：只给乘数不给偏移的话，「调对比度」会连带整体变亮/变暗
        current = await runPass(current, (i) => i.linear(e.amount, 128 * (1 - e.amount)));
        appliedCount += 1;
        break;
      }
      case 'negate': {
        if (!effects.negate?.enabled) break;
        // 必须 alpha:false —— 默认会把 alpha 一起反转，整张图透明度颠倒（实测）
        current = await runPass(current, (i) => i.negate({ alpha: false }));
        appliedCount += 1;
        break;
      }
      case 'threshold': {
        const e = effects.threshold;
        if (!e?.enabled) break;
        // threshold 会把 alpha 通道也二值化（128 → 255，实测），半透明像素会变不透明。
        // 先存下 alpha，二值化后原样写回。
        const alpha = extractAlpha(current);
        current = await runPass(current, (i) => i.threshold(e.value, { grayscale: e.grayscale }));
        restoreAlpha(current, alpha);
        appliedCount += 1;
        break;
      }
    }
  }

  return { img: current, appliedCount };
}

/**
 * 取出 alpha 通道的副本。
 * @param img raw 像素缓冲。
 * @returns alpha 数组；无 alpha 通道时为 null。
 */
function extractAlpha(img: RawImage): Buffer | null {
  if (img.channels < 4) return null;
  const alpha = Buffer.alloc(img.width * img.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = img.data[i * img.channels + 3];
  return alpha;
}

/**
 * 把 alpha 通道写回（就地修改）。
 * @param img raw 像素缓冲。
 * @param alpha extractAlpha 的结果；为 null 时不做事。
 */
function restoreAlpha(img: RawImage, alpha: Buffer | null): void {
  if (!alpha || img.channels < 4) return;
  for (let i = 0; i < alpha.length; i += 1) img.data[i * img.channels + 3] = alpha[i];
}

/**
 * 按矩形把 src 的像素逐行拷进 dst（就地修改 dst）。
 * @param dst 目标 raw。
 * @param src 与 dst 同尺寸同通道的来源 raw。
 * @param rect 要拷贝的区域（已钳制过）。
 */
function copyRegion(dst: RawImage, src: RawImage, rect: CropRect): void {
  const rowBytes = rect.width * dst.channels;
  for (let y = 0; y < rect.height; y += 1) {
    const offset = ((rect.top + y) * dst.width + rect.left) * dst.channels;
    src.data.copy(dst.data, offset, offset, offset + rowBytes);
  }
}

/**
 * 施加局部区域效果。
 *
 * 不用 `composite()`：它是 alpha 混合，区域内**原本透明**的像素会把处理结果「透」掉
 * （实测贴不透明色上去，原透明处仍是全 0），对打码来说结果是错的；
 * 而 blend 又没有 `src` 之类的直接覆盖模式（实测报 Expected valid blend name）。
 * 所以在 raw buffer 上按行 `Buffer.copy` 精确替换。
 * @param img 输入 raw（不会被修改）。
 * @param regions 区域列表（图片原始像素坐标）。
 * @param region 区域效果参数。
 * @param scale 像素级参数与坐标的缩放比（预览时 <1）。
 * @returns 输出 raw；无有效区域时原样返回。
 */
async function applyRegions(
  img: RawImage,
  regions: CropRect[],
  region: RegionEffect,
  scale: number,
): Promise<RawImage> {
  const rects = regions
    .map((r) =>
      clampRect(
        {
          left: r.left * scale,
          top: r.top * scale,
          width: r.width * scale,
          height: r.height * scale,
        },
        img.width,
        img.height,
      ),
    )
    .filter((r): r is CropRect => r !== null);
  if (rects.length === 0) return img;

  const effects: StylizeEffects =
    region.kind === 'mosaic'
      ? { mosaic: { enabled: true, block: region.strength } }
      : { blur: { enabled: true, sigma: region.strength } };

  // 整图处理一份，再按区域把「该保留的那一份」拷回来。
  // 比逐块单独处理简单，且反选（作用于区域外）只是把两份图的角色对调。
  const processed = await applyEffects(img, effects, scale);
  // 反选时区域外生效 → 底图用处理后的，区域内拷回原像素；否则反过来
  const base = region.invert ? processed.img : img;
  const overlay = region.invert ? img : processed.img;

  const output: RawImage = { ...base, data: Buffer.from(base.data) };
  for (const rect of rects) copyRegion(output, overlay, rect);
  return output;
}

/**
 * 风格化单张图片并写盘。
 * @param sourcePath 源文件路径。
 * @param options 风格化选项。
 * @returns 处理结果。
 */
async function stylizeOne(sourcePath: string, options: StylizeOptions): Promise<StylizeResult> {
  const { effects, regions, region, format, quality, outputDir, overwrite } = options;

  const originalStat = await stat(sourcePath);
  const sourceExt = extname(sourcePath).replace(/^\./, '').toLowerCase();
  const resolvedFormat = resolveFormat(format, sourceExt);

  // 必须 Buffer 输入：路径输入会让 libvips 长期持有句柄，覆盖模式必崩
  const input = await readFile(sourcePath);
  const raw = await toRaw(input);

  const applied = await applyEffects(raw, effects, 1);
  const withRegions = await applyRegions(applied.img, regions, region, 1);

  const buffer = await applyFormat(fromRaw(withRegions), resolvedFormat, quality).toBuffer();
  const outputPath = await writeOutput(sourcePath, buffer, resolvedFormat, {
    outputDir,
    overwrite,
  });

  return {
    sourcePath,
    outputPath,
    originalSize: originalStat.size,
    stylizedSize: buffer.length,
    width: withRegions.width,
    height: withRegions.height,
    outputFormat: resolvedFormat,
    appliedCount: applied.appliedCount + (regions.length > 0 ? 1 : 0),
  };
}

/**
 * 生成风格化预览（缩放后处理，不写盘）。
 *
 * 缩放比会一并传给 applyEffects/applyRegions 去缩像素级参数，
 * 否则预览里的马赛克块数与全尺寸对不上，预览就是在骗人。
 * @param filePath 图片路径。
 * @param options 预览选项。
 * @returns webp 格式的 data URL。
 */
async function stylizePreview(filePath: string, options: StylizePreviewOptions): Promise<string> {
  const { effects, regions, region, maxSize } = options;

  const input = await readFile(filePath);
  const meta = await sharp(input).metadata();
  const originalWidth = meta.width ?? 0;

  const raw = await toRaw(input, maxSize > 0 ? maxSize : PREVIEW_MAX_SIZE);
  const scale = originalWidth > 0 ? raw.width / originalWidth : 1;

  const applied = await applyEffects(raw, effects, scale);
  const withRegions = await applyRegions(applied.img, regions, region, scale);

  const buffer = await fromRaw(withRegions).webp({ quality: 80 }).toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

/** 注册图片处理相关 IPC。 */
export function registerImageIpc(): void {
  handle(IMAGE_CHANNELS.thumbnail, (_e, filePath: string) => makeThumbnail(filePath));
  handle(IMAGE_CHANNELS.dataUrl, (_e, filePath: string) => readDataUrl(filePath));
  handle(IMAGE_CHANNELS.compress, (_e, sourcePath: string, options: CompressOptions) =>
    compressOne(sourcePath, options),
  );
  handle(IMAGE_CHANNELS.probeCrop, (_e, filePath: string, auto: AutoCropOptions) =>
    probeCrop(filePath, auto),
  );
  handle(IMAGE_CHANNELS.crop, (_e, sourcePath: string, options: CropOptions) =>
    cropOne(sourcePath, options),
  );
  handle(IMAGE_CHANNELS.stylizePreview, (_e, filePath: string, options: StylizePreviewOptions) =>
    stylizePreview(filePath, options),
  );
  handle(IMAGE_CHANNELS.stylize, (_e, sourcePath: string, options: StylizeOptions) =>
    stylizeOne(sourcePath, options),
  );
}
