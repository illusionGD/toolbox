import { basename, dirname, extname, join } from 'path';
import { mkdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import sharp, { type Matrix3x3, type Sharp } from 'sharp';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
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
  QrDecodeResult,
  QrGenerateOptions,
  QrGenerateResult,
  QrPreviewOptions,
  RegionEffect,
  SpriteCell,
  SpriteDataFormat,
  SpriteFrame,
  SpriteGridSpec,
  SpriteMergeOptions,
  SpriteMergePreview,
  SpriteMergeResult,
  SpriteSheetPreview,
  SpriteSliceOptions,
  SpriteSliceProbe,
  SpriteSliceProbeOptions,
  SpriteSliceResult,
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

/* ── 精灵图：合并 ─────────────────────────────────────────────────── */

/** 合并前读入的单张图（buffer + 尺寸）。 */
interface SpriteInput {
  sourcePath: string;
  name: string;
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * 读入所有待合并图片的 buffer 与尺寸。
 * 一律 Buffer 输入（同 compressOne 的句柄铁律）。名字取文件名去扩展名，
 * 重名时追加序号，保证坐标数据的 key 唯一。可选按内容裁掉四周透明边。
 * @param sources 图片路径数组。
 * @param trim 是否裁掉每张图四周的透明边。
 * @returns 读入结果（跳过无法解码的图）。
 */
async function readSpriteInputs(sources: string[], trim: boolean): Promise<SpriteInput[]> {
  const seen = new Map<string, number>();
  const inputs: SpriteInput[] = [];
  for (const sourcePath of sources) {
    try {
      let buffer = await readFile(sourcePath);
      // 裁透明边：trim 会去掉与四角同色/透明的边，此处只对透明底有意义，
      // 失败（全透明/纯色无边可裁）时保持原图，不阻断
      if (trim) {
        try {
          buffer = await sharp(buffer).trim().png().toBuffer();
        } catch {
          buffer = await sharp(await readFile(sourcePath)).png().toBuffer();
        }
      }
      const meta = await sharp(buffer).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      if (width < 1 || height < 1) continue;
      let name = basename(sourcePath, extname(sourcePath));
      const count = seen.get(name) ?? 0;
      seen.set(name, count + 1);
      if (count > 0) name = `${name}_${count}`;
      inputs.push({ sourcePath, name, buffer, width, height });
    } catch {
      // 无法解码的图（损坏/不支持）直接跳过，不阻断整批合并
    }
  }
  return inputs;
}

/** 一张图集的布局：参与的输入 + 各帧位置 + 画布尺寸。 */
interface SheetLayout {
  inputs: SpriteInput[];
  frames: SpriteFrame[];
  width: number;
  height: number;
}

/**
 * 把输入分组布局成一张或多张图集。
 *
 * `maxSize<=0` 时全部排进一张（列数由 options.columns 或开方决定）。
 * `maxSize>0` 时走**货架装箱**（shelf/next-fit）：逐张往当前行放，超出宽度就换行，
 * 超出高度就开新图集。保证每张图集不超过 maxSize×maxSize。单张图超过 maxSize
 * 也独占一张（不缩放，如实放，宽高就是它自己）。
 * @param inputs 已读入（可能已裁边）的图片。
 * @param options 合并选项。
 * @returns 图集布局数组。
 */
function layoutSheets(inputs: SpriteInput[], options: SpriteMergeOptions): SheetLayout[] {
  const { spacing, padding, maxSize } = options;
  if (!inputs.length) return [];

  // 不限尺寸：沿用原「每列最宽/每行最高」网格，单张
  if (maxSize <= 0) return [layoutSingleGrid(inputs, options)];

  const limit = maxSize;
  const sheets: SheetLayout[] = [];
  let cur: SpriteInput[] = [];
  let frames: SpriteFrame[] = [];
  let penX = padding; // 当前行光标 x
  let penY = padding; // 当前行光标 y
  let rowH = 0; // 当前行已用最大高
  let sheetW = 0; // 当前图集实际用到的最大右边界

  const flush = (): void => {
    if (!cur.length) return;
    sheets.push({
      inputs: cur,
      frames,
      width: Math.max(1, sheetW + padding),
      height: Math.max(1, penY + rowH + padding),
    });
    cur = [];
    frames = [];
    penX = padding;
    penY = padding;
    rowH = 0;
    sheetW = 0;
  };

  for (const img of inputs) {
    // 放不下当前行 → 换行
    if (penX > padding && penX + img.width + padding > limit) {
      penY += rowH + spacing;
      penX = padding;
      rowH = 0;
    }
    // 换行后仍超出高度 → 开新图集
    if (penY > padding && penY + img.height + padding > limit) {
      flush();
    }
    frames.push({
      name: img.name,
      sourcePath: img.sourcePath,
      left: penX,
      top: penY,
      width: img.width,
      height: img.height,
    });
    cur.push(img);
    penX += img.width + spacing;
    if (penX - spacing > sheetW) sheetW = penX - spacing;
    if (img.height > rowH) rowH = img.height;
  }
  flush();
  return sheets;
}

/**
 * 单张网格布局：每列最宽、每行最高（maxSize 不限时用）。
 * @param inputs 已读入的图片。
 * @param options 合并选项（列数/间距/边距/对齐）。
 * @returns 单张图集布局。
 */
function layoutSingleGrid(inputs: SpriteInput[], options: SpriteMergeOptions): SheetLayout {
  const { spacing, padding, align } = options;
  const count = inputs.length;
  // 列数 <=0 时按图片数开方取近似正方形
  const columns = options.columns > 0 ? options.columns : Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);

  // 每列最宽、每行最高
  const colWidths = new Array<number>(columns).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  inputs.forEach((img, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    if (img.width > colWidths[col]) colWidths[col] = img.width;
    if (img.height > rowHeights[row]) rowHeights[row] = img.height;
  });

  // 列/行的起始偏移（前缀和 + 间距 + 外边距）
  const colX = new Array<number>(columns).fill(0);
  for (let c = 1; c < columns; c++) colX[c] = colX[c - 1] + colWidths[c - 1] + spacing;
  const rowY = new Array<number>(rows).fill(0);
  for (let r = 1; r < rows; r++) rowY[r] = rowY[r - 1] + rowHeights[r - 1] + spacing;

  const frames: SpriteFrame[] = inputs.map((img, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    let left = padding + colX[col];
    let top = padding + rowY[row];
    // 格子比图大时按对齐方式摆放
    if (align === 'center') {
      left += Math.floor((colWidths[col] - img.width) / 2);
      top += Math.floor((rowHeights[row] - img.height) / 2);
    }
    return { name: img.name, sourcePath: img.sourcePath, left, top, width: img.width, height: img.height };
  });

  const totalW =
    padding * 2 + colWidths.reduce((s, w) => s + w, 0) + spacing * Math.max(0, columns - 1);
  const totalH =
    padding * 2 + rowHeights.reduce((s, h) => s + h, 0) + spacing * Math.max(0, rows - 1);
  return { inputs, frames, width: totalW, height: totalH };
}

/** XML/plist 文本转义。 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 把帧位置序列化成坐标数据文本。
 * @param frames 帧位置。
 * @param format 数据格式。
 * @param sheetFile 精灵表文件名（含扩展名），供 JSON/plist 的 meta 引用。
 * @param sheetSize 精灵表总尺寸。
 * @returns 文本内容；none 时为空串。
 */
function serializeSpriteData(
  frames: SpriteFrame[],
  format: SpriteDataFormat,
  sheetFile: string,
  sheetSize: { width: number; height: number },
): string {
  if (format === 'none') return '';

  if (format === 'json') {
    // TexturePacker / PixiJS 的 hash 结构
    const framesObj: Record<string, unknown> = {};
    for (const f of frames) {
      framesObj[`${f.name}.png`] = {
        frame: { x: f.left, y: f.top, w: f.width, h: f.height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: f.width, h: f.height },
        sourceSize: { w: f.width, h: f.height },
      };
    }
    const doc = {
      frames: framesObj,
      meta: { app: 'toolbox', image: sheetFile, size: sheetSize, scale: '1' },
    };
    return JSON.stringify(doc, null, 2);
  }

  if (format === 'css') {
    // 每帧一个 class，background-position 为负偏移
    const lines = frames.map(
      (f) =>
        `.sprite-${f.name} {\n` +
        `  width: ${f.width}px;\n  height: ${f.height}px;\n` +
        `  background: url('${sheetFile}') -${f.left}px -${f.top}px;\n}`,
    );
    return lines.join('\n\n') + '\n';
  }

  // plist（Cocos2d-x SpriteFrames 格式）
  const entries = frames
    .map(
      (f) =>
        `    <key>${escapeXml(f.name)}.png</key>\n` +
        `    <dict>\n` +
        `      <key>frame</key>\n` +
        `      <string>{{${f.left},${f.top}},{${f.width},${f.height}}}</string>\n` +
        `      <key>offset</key>\n      <string>{0,0}</string>\n` +
        `      <key>rotated</key>\n      <false/>\n` +
        `      <key>sourceSize</key>\n      <string>{${f.width},${f.height}}</string>\n` +
        `    </dict>`,
    )
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">\n<dict>\n` +
    `  <key>frames</key>\n  <dict>\n${entries}\n  </dict>\n` +
    `  <key>metadata</key>\n  <dict>\n` +
    `    <key>format</key>\n    <integer>2</integer>\n` +
    `    <key>realTextureFileName</key>\n    <string>${escapeXml(sheetFile)}</string>\n` +
    `    <key>size</key>\n    <string>{${sheetSize.width},${sheetSize.height}}</string>\n` +
    `    <key>textureFileName</key>\n    <string>${escapeXml(sheetFile)}</string>\n` +
    `  </dict>\n</dict>\n</plist>\n`
  );
}

/** 坐标数据格式 → 文件扩展名。 */
const SPRITE_DATA_EXT: Record<Exclude<SpriteDataFormat, 'none'>, string> = {
  json: 'json',
  css: 'css',
  plist: 'plist',
};

/** 把一张图集布局 composite 成图片 buffer（透明底 + 各帧叠加）。 */
async function renderSheet(layout: SheetLayout, format: ResolvedFormat, quality: number): Promise<Buffer> {
  const composites = layout.frames.map((f, i) => ({
    input: layout.inputs[i].buffer,
    left: f.left,
    top: f.top,
  }));
  const sheet = sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites);
  return applyFormat(sheet, format, quality).toBuffer();
}

/**
 * 合并多图为精灵表 + 坐标数据。
 *
 * composite 用 buffer 输入（同全仓库的 libvips 句柄铁律）；底图用 create 造一张
 * 透明画布，各帧按布局坐标叠加。坐标数据由布局结果直接生成，与像素位置一致。
 * maxSize>0 时放不下会拆成多张图集，文件名带序号，坐标数据每张各一份。
 * @param options 合并选项。
 * @returns 合并结果（可能多张）。
 */
async function mergeSprites(options: SpriteMergeOptions): Promise<SpriteMergeResult> {
  const inputs = await readSpriteInputs(options.sources, options.trim);
  if (!inputs.length) throw new Error('没有可合并的有效图片');

  const layouts = layoutSheets(inputs, options);
  const multi = layouts.length > 1;
  const sheetPaths: string[] = [];
  const dataPaths: string[] = [];
  let frameCount = 0;

  for (let s = 0; s < layouts.length; s++) {
    const layout = layouts[s];
    frameCount += layout.frames.length;
    // 多张时文件名加 _0/_1 序号，单张保持原名
    const base = multi ? `${options.baseName}_${s}` : options.baseName;
    const sheetFile = `${base}.${FORMAT_EXT[options.format]}`;
    const sheetPath = join(options.outputDir, sheetFile);
    await writeFile(sheetPath, await renderSheet(layout, options.format, options.quality));
    sheetPaths.push(sheetPath);

    if (options.dataFormat !== 'none') {
      const text = serializeSpriteData(layout.frames, options.dataFormat, sheetFile, {
        width: layout.width,
        height: layout.height,
      });
      const dataPath = join(options.outputDir, `${base}.${SPRITE_DATA_EXT[options.dataFormat]}`);
      await writeFile(dataPath, text, 'utf8');
      dataPaths.push(dataPath);
    }
  }

  return { sheetPaths, dataPaths, frameCount, sheetCount: layouts.length };
}

/** 预览的长边上限：过大图集缩到这个尺寸内回传，省内存也够看清排布。 */
const SPRITE_PREVIEW_MAX = 1200;

/**
 * 合并预览（只算不写盘）：按当前布局合出每张图集，缩到上限内回传 data URL。
 * 复用 `readSpriteInputs` + `layoutSheets` + composite，与实际合并同一套布局，所见即所得。
 * @param options 合并选项。
 * @returns 各图集预览与总帧数。
 */
async function spriteMergePreview(options: SpriteMergeOptions): Promise<SpriteMergePreview> {
  const inputs = await readSpriteInputs(options.sources, options.trim);
  if (!inputs.length) throw new Error('没有可合并的有效图片');

  const layouts = layoutSheets(inputs, options);
  const sheets: SpriteSheetPreview[] = [];
  let frameCount = 0;

  for (const layout of layouts) {
    frameCount += layout.frames.length;
    let sheet = sharp({
      create: {
        width: layout.width,
        height: layout.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite(
      layout.frames.map((f, i) => ({ input: layout.inputs[i].buffer, left: f.left, top: f.top })),
    );

    // 大图集缩到长边 SPRITE_PREVIEW_MAX 内（仅缩小），预览用 webp 省体积
    const longEdge = Math.max(layout.width, layout.height);
    if (longEdge > SPRITE_PREVIEW_MAX) {
      // composite 后需先出 buffer 再缩，链上直接 resize 会对 create 的空画布生效而非合成结果
      const merged = await sheet.png().toBuffer();
      sheet = sharp(merged).resize({
        width: Math.round((layout.width / longEdge) * SPRITE_PREVIEW_MAX),
        withoutEnlargement: true,
      });
    }

    const buffer = await sheet.webp({ quality: 80 }).toBuffer();
    sheets.push({
      dataUrl: `data:image/webp;base64,${buffer.toString('base64')}`,
      width: layout.width,
      height: layout.height,
      frameCount: layout.frames.length,
    });
  }

  return { sheets, frameCount };
}

/* ── 精灵图：切割 ─────────────────────────────────────────────────── */

/**
 * 固定网格切割：按行列数或单元尺寸等分。
 * @param spec 网格参数。
 * @param width 表宽。
 * @param height 表高。
 * @returns 切割单元。
 */
function cellsFromGrid(spec: SpriteGridSpec, width: number, height: number): SpriteCell[] {
  const { spacing, margin } = spec;
  const usableW = width - margin * 2;
  const usableH = height - margin * 2;
  const cells: SpriteCell[] = [];

  // 按数量分：整图等分成 cols×rows，每格尺寸由此反算（能整除时无余量）
  if (spec.columns > 0 && spec.rows > 0) {
    const cols = spec.columns;
    const rows = spec.rows;
    const cellW = Math.floor((usableW - spacing * (cols - 1)) / cols);
    const cellH = Math.floor((usableH - spacing * (rows - 1)) / rows);
    if (cols < 1 || rows < 1 || cellW < 1 || cellH < 1) return cells;
    let n = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({
          rect: {
            left: margin + c * (cellW + spacing),
            top: margin + r * (cellH + spacing),
            width: cellW,
            height: cellH,
          },
          name: `sprite_${String(n).padStart(3, '0')}`,
        });
        n++;
      }
    }
    return cells;
  }

  // 按单元固定宽高：从 margin 起以「宽/高 + 间距」为步长铺满，
  // **最后一格若不足一个单元，也保留并裁到图片边缘**（不丢余量），
  // 这样宽高不是单元尺寸整数倍时，边角剩余区域仍能切出来。
  const cellW = spec.cellWidth;
  const cellH = spec.cellHeight;
  if (cellW < 1 || cellH < 1) return cells;
  let n = 0;
  for (let top = margin; top < height - margin; top += cellH + spacing) {
    const h = Math.min(cellH, height - margin - top);
    if (h < 1) break;
    for (let left = margin; left < width - margin; left += cellW + spacing) {
      const w = Math.min(cellW, width - margin - left);
      if (w < 1) break;
      cells.push({
        rect: { left, top, width: w, height: h },
        name: `sprite_${String(n).padStart(3, '0')}`,
      });
      n++;
    }
  }
  return cells;
}

/**
 * 按切割线位置切成不等分网格。
 * @param columnsAt 纵向切割线 x 坐标。
 * @param rowsAt 横向切割线 y 坐标。
 * @param width 表宽。
 * @param height 表高。
 * @returns 切割单元。
 */
function cellsFromLines(
  columnsAt: number[],
  rowsAt: number[],
  width: number,
  height: number,
): SpriteCell[] {
  // 切割线两端补上 0 与边界，排序去重后相邻两条构成一段
  const xs = [...new Set([0, ...columnsAt, width])].sort((a, b) => a - b);
  const ys = [...new Set([0, ...rowsAt, height])].sort((a, b) => a - b);
  const cells: SpriteCell[] = [];
  let n = 0;
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      const left = xs[c];
      const top = ys[r];
      const w = xs[c + 1] - left;
      const h = ys[r + 1] - top;
      if (w < 1 || h < 1) continue;
      cells.push({
        rect: { left, top, width: w, height: h },
        name: `sprite_${String(n).padStart(3, '0')}`,
      });
      n++;
    }
  }
  return cells;
}

/**
 * 解析已有坐标文件（JSON / plist）为切割单元。
 * @param dataPath 坐标文件路径。
 * @returns 切割单元。
 */
async function cellsFromImport(dataPath: string): Promise<SpriteCell[]> {
  const text = await readFile(dataPath, 'utf8');
  const ext = extname(dataPath).toLowerCase();
  const cells: SpriteCell[] = [];

  if (ext === '.json') {
    const doc = JSON.parse(text) as { frames?: Record<string, { frame?: CropRect | { x: number; y: number; w: number; h: number } }> };
    const framesObj = doc.frames ?? {};
    for (const [key, value] of Object.entries(framesObj)) {
      const frame = value.frame as { x: number; y: number; w: number; h: number } | undefined;
      if (!frame) continue;
      cells.push({
        rect: { left: frame.x, top: frame.y, width: frame.w, height: frame.h },
        name: basename(key, extname(key)),
      });
    }
    return cells;
  }

  // plist：<key>name.png</key>...<key>frame</key><string>{{x,y},{w,h}}</string>
  // 帧名一律带扩展名（hero.png），要求捕获含点，才不会把外层容器 <key>frames</key>
  // / <key>metadata</key> 误当成帧名
  const blockRe =
    /<key>([^<]+\.[A-Za-z0-9]+)<\/key>\s*<dict>[\s\S]*?<key>frame<\/key>\s*<string>\{\{(-?\d+),(-?\d+)\},\{(\d+),(\d+)\}\}<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    cells.push({
      rect: { left: Number(m[2]), top: Number(m[3]), width: Number(m[4]), height: Number(m[5]) },
      name: basename(m[1], extname(m[1])),
    });
  }
  return cells;
}

/**
 * 按透明像素连通域自动圈出每个精灵的包围盒。
 *
 * 读 raw 像素（ensureAlpha 保证 4 通道），alpha 大于阈值视为不透明，
 * 对不透明像素做 4 邻接连通域（并查集），每个连通块取包围盒。
 * 用行缓冲的两趟并查集，避免为百万像素递归 flood-fill 爆栈。
 * @param input 精灵表 buffer。
 * @param alphaThreshold alpha 阈值 0-255。
 * @param minArea 最小连通块面积（滤噪点）。
 * @returns 切割单元（按从上到下、从左到右排序）。
 */
async function cellsFromAuto(
  input: Buffer,
  alphaThreshold: number,
  minArea: number,
): Promise<SpriteCell[]> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // 并查集：label[i] 指向父节点；-1 表示透明（背景）
  const label = new Int32Array(width * height).fill(-1);
  const parent: number[] = [];
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  const opaque = (px: number, py: number): boolean => {
    const idx = (py * width + px) * channels + (channels - 1);
    return data[idx] > alphaThreshold;
  };

  // 第一趟：给不透明像素分配标签，与左/上邻居合并
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      const i = y * width + x;
      const left = x > 0 && opaque(x - 1, y) ? label[i - 1] : -1;
      const up = y > 0 && opaque(x, y - 1) ? label[i - width] : -1;
      if (left === -1 && up === -1) {
        const id = parent.length;
        parent.push(id);
        label[i] = id;
      } else if (left !== -1 && up !== -1) {
        label[i] = left;
        union(left, up);
      } else {
        label[i] = left !== -1 ? left : up;
      }
    }
  }

  // 第二趟：按根标签聚包围盒
  const boxes = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; area: number }>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (label[i] === -1) continue;
      const root = find(label[i]);
      const box = boxes.get(root);
      if (!box) {
        boxes.set(root, { minX: x, minY: y, maxX: x, maxY: y, area: 1 });
      } else {
        if (x < box.minX) box.minX = x;
        if (y < box.minY) box.minY = y;
        if (x > box.maxX) box.maxX = x;
        if (y > box.maxY) box.maxY = y;
        box.area++;
      }
    }
  }

  const cells = [...boxes.values()]
    .filter((b) => b.area >= minArea)
    .map((b) => ({
      rect: { left: b.minX, top: b.minY, width: b.maxX - b.minX + 1, height: b.maxY - b.minY + 1 },
    }))
    // 从上到下、从左到右排序，命名才稳定
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .map((c, n) => ({ rect: c.rect, name: `sprite_${String(n).padStart(3, '0')}` }));
  return cells;
}

/**
 * 探测精灵表将切出的单元（只算不写盘）。
 * @param filePath 精灵表路径。
 * @param options 探测选项。
 * @returns 表尺寸与切割单元。
 */
async function spriteSliceProbe(
  filePath: string,
  options: SpriteSliceProbeOptions,
): Promise<SpriteSliceProbe> {
  const input = await readFile(filePath);
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  let cells: SpriteCell[] = [];
  switch (options.method) {
    case 'grid':
      if (options.grid) cells = cellsFromGrid(options.grid, width, height);
      break;
    case 'lines':
      cells = cellsFromLines(options.columnsAt ?? [], options.rowsAt ?? [], width, height);
      break;
    case 'import':
      if (options.dataPath) cells = await cellsFromImport(options.dataPath);
      break;
    case 'auto':
      cells = await cellsFromAuto(input, options.alphaThreshold ?? 0, options.minArea ?? 1);
      break;
  }
  return { width, height, cells };
}

/**
 * 切割精灵表为多张小图。
 * 每个单元 clampRect 后 extract；非法单元（越界/零面积）跳过并计数。
 * @param filePath 精灵表路径。
 * @param options 切割选项。
 * @returns 输出路径与跳过数。
 */
async function spriteSlice(
  filePath: string,
  options: SpriteSliceOptions,
): Promise<SpriteSliceResult> {
  const input = await readFile(filePath);
  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const outputPaths: string[] = [];
  let skipped = 0;
  const usedNames = new Map<string, number>();

  for (const cell of options.cells) {
    const safe = clampRect(cell.rect, width, height);
    if (!safe) {
      skipped++;
      continue;
    }
    // extract 每次用新 sharp 实例，避免链式 extract 叠加坐标
    const buffer = await applyFormat(
      sharp(input).extract(safe),
      options.format,
      options.quality,
    ).toBuffer();

    // 名字去重：同名追加序号
    let name = cell.name || 'sprite';
    const count = usedNames.get(name) ?? 0;
    usedNames.set(name, count + 1);
    if (count > 0) name = `${name}_${count}`;

    const outputPath = join(options.outputDir, `${name}.${FORMAT_EXT[options.format]}`);
    await writeFile(outputPath, buffer);
    outputPaths.push(outputPath);
  }

  return { outputPaths, skipped };
}

/* ── 二维码：生成 / 预览 / 解析 ───────────────────────────────────── */

/** 容错级别透传给 qrcode（类型一致，单列一层便于校验）。 */
type QrLevel = 'L' | 'M' | 'Q' | 'H';

/**
 * 批量生成二维码。
 *
 * png/jpg 走 `QRCode.toBuffer`（jpg 再经 sharp 转码，qrcode 只出 png）；
 * svg 走 `QRCode.toString` 写文本。文件名由渲染进程定好（模板/序号/手改），
 * 这里只做重名去重与落盘。单条失败（内容超容量等）计入 failed，不中断整批。
 * @param options 生成选项。
 * @returns 成功路径与失败数。
 */
async function generateQrCodes(options: QrGenerateOptions): Promise<QrGenerateResult> {
  const { items, size, margin, level, dark, light, format, outputDir } = options;
  const outputPaths: string[] = [];
  let failed = 0;
  const usedNames = new Map<string, number>();

  // 目录可能是用户手填的、尚不存在的路径，先建好（recursive 幂等），
  // 否则 writeFile 报一句 ENOENT 用户看不出是目录没建
  await mkdir(outputDir, { recursive: true });

  for (const item of items) {
    if (!item.text) {
      failed += 1;
      continue;
    }
    // 重名去重：同名追加序号
    let name = item.name || 'qr';
    const count = usedNames.get(name) ?? 0;
    usedNames.set(name, count + 1);
    if (count > 0) name = `${name}_${count}`;

    try {
      const common = {
        margin,
        errorCorrectionLevel: level as QrLevel,
        color: { dark, light },
      };
      if (format === 'svg') {
        const svg = await QRCode.toString(item.text, { type: 'svg', ...common });
        const outputPath = join(outputDir, `${name}.svg`);
        await writeFile(outputPath, svg, 'utf8');
        outputPaths.push(outputPath);
      } else {
        const png = await QRCode.toBuffer(item.text, { type: 'png', width: size, ...common });
        const outputPath = join(outputDir, `${name}.${format === 'jpg' ? 'jpg' : 'png'}`);
        // qrcode 只出 png，jpg 用 sharp 转码（flatten 到 light 底色，jpg 无透明）
        const buffer = format === 'jpg' ? await sharp(png).flatten({ background: light }).jpeg().toBuffer() : png;
        await writeFile(outputPath, buffer);
        outputPaths.push(outputPath);
      }
    } catch {
      // 内容超出二维码容量、颜色非法等：计失败，继续下一条
      failed += 1;
    }
  }

  return { outputPaths, failed };
}

/**
 * 生成二维码预览 data URL（只算不写盘）。
 * @param options 预览选项。
 * @returns png data URL。
 */
async function generateQrPreview(options: QrPreviewOptions): Promise<string> {
  const png = await QRCode.toBuffer(options.text || ' ', {
    type: 'png',
    width: options.size,
    margin: options.margin,
    errorCorrectionLevel: options.level as QrLevel,
    color: { dark: options.dark, light: options.light },
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * 解析单张图片的二维码。
 *
 * Buffer 输入铁律；`ensureAlpha().raw()` 出 RGBA 平面喂 jsQR。识别不到返回 ok:false
 * 而非抛错（列表里每张都要有结果行）。
 * @param filePath 图片路径。
 * @returns 解析结果。
 */
async function decodeQrCode(filePath: string): Promise<QrDecodeResult> {
  const name = basename(filePath);
  try {
    const input = await readFile(filePath);
    const { data, info } = await sharp(input)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
    return { path: filePath, name, text: result ? result.data : null, ok: !!result };
  } catch {
    // 解码失败（损坏/不支持）当作未识别，不抛
    return { path: filePath, name, text: null, ok: false };
  }
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
  handle(IMAGE_CHANNELS.spriteMerge, (_e, options: SpriteMergeOptions) => mergeSprites(options));
  handle(IMAGE_CHANNELS.spriteMergePreview, (_e, options: SpriteMergeOptions) =>
    spriteMergePreview(options),
  );
  handle(IMAGE_CHANNELS.spriteSliceProbe, (_e, filePath: string, options: SpriteSliceProbeOptions) =>
    spriteSliceProbe(filePath, options),
  );
  handle(IMAGE_CHANNELS.spriteSlice, (_e, filePath: string, options: SpriteSliceOptions) =>
    spriteSlice(filePath, options),
  );
  handle(IMAGE_CHANNELS.qrGenerate, (_e, options: QrGenerateOptions) => generateQrCodes(options));
  handle(IMAGE_CHANNELS.qrPreview, (_e, options: QrPreviewOptions) => generateQrPreview(options));
  handle(IMAGE_CHANNELS.qrDecode, (_e, filePath: string) => decodeQrCode(filePath));
}
