import { basename, dirname, extname, join } from 'path';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import type { BrowserWindow } from 'electron';
import subsetFont from 'subset-font';
import * as fontkit from 'fontkit';
import { convert as fontConvert, detectFormat } from 'fontverter';
import { FONT_CHANNELS } from '../../shared/channels';
import type {
  FontConvertFile,
  FontConvertFormat,
  FontConvertOptions,
  FontConvertResult,
  FontMeta,
  FontOutputFormat,
  FontSplitOptions,
  FontSplitResult,
  FontSubsetOptions,
  FontSubsetResult,
} from '../../shared/types';
import { handle } from './helper';

/** 已解析的输出格式（不含 original）。 */
type ResolvedFontFormat = Exclude<FontOutputFormat, 'original'>;

/** 输出格式 → 文件扩展名。 */
const FORMAT_EXT: Record<ResolvedFontFormat, string> = {
  ttf: 'ttf',
  otf: 'otf',
  woff: 'woff',
  woff2: 'woff2',
};

/**
 * 我方格式 → subset-font 的 targetFormat。
 * subset-font 只认 truetype / sfnt / woff / woff2：ttf→truetype、otf→sfnt。
 */
const TARGET_FORMAT: Record<ResolvedFontFormat, 'truetype' | 'sfnt' | 'woff' | 'woff2'> = {
  ttf: 'truetype',
  otf: 'sfnt',
  woff: 'woff',
  woff2: 'woff2',
};

/** 源扩展名 → 输出格式（保持原格式时用）。 */
const EXT_TO_FORMAT: Record<string, ResolvedFontFormat> = {
  ttf: 'ttf',
  otf: 'otf',
  woff: 'woff',
  woff2: 'woff2',
};

/**
 * 解析实际输出格式：original 时按源扩展名映射，未知源扩展名回退 ttf。
 * @param format 用户选择的输出格式。
 * @param sourcePath 源文件路径。
 * @returns 已解析格式。
 */
function resolveFormat(format: FontOutputFormat, sourcePath: string): ResolvedFontFormat {
  if (format !== 'original') return format;
  const ext = extname(sourcePath).replace(/^\./, '').toLowerCase();
  return EXT_TO_FORMAT[ext] ?? 'ttf';
}

/**
 * fontkit 可能返回单字体或字体集合（TTC），统一取第一个字体。
 * @param data 字体数据。
 * @returns 单个字体对象。
 */
function firstFont(data: Buffer): fontkit.Font {
  const parsed = fontkit.create(data);
  // 字体集合有 fonts 数组，取第一个；单字体直接就是 Font
  if ('fonts' in parsed && Array.isArray(parsed.fonts) && parsed.fonts.length) {
    return parsed.fonts[0];
  }
  return parsed as fontkit.Font;
}

/**
 * 读字体元信息（字体名 / 字形数 / 大小）。
 * @param filePath 字体路径。
 * @returns 元信息。
 */
export async function probeFont(filePath: string): Promise<FontMeta> {
  const data = await readFile(filePath);
  const font = firstFont(data);
  return {
    familyName: font.familyName ?? basename(filePath),
    glyphCount: font.numGlyphs ?? 0,
    size: data.length,
  };
}

/**
 * 裁剪单个字体并落盘。
 *
 * 一律 Buffer 输入（`readFile` 后交给 subset-font）；输出文件名沿用源基名 + 目标扩展名，
 * 覆盖模式写回源目录、格式变了则删旧扩展名文件（同 image 的 writeOutput 语义）。
 * @param sourcePath 源字体路径。
 * @param options 裁剪选项。
 * @returns 裁剪结果。
 */
async function subsetOne(
  sourcePath: string,
  options: FontSubsetOptions,
): Promise<FontSubsetResult> {
  const { chars, format, outputDir, overwrite } = options;
  if (!chars) throw new Error('未指定要保留的字符');

  const originalStat = await stat(sourcePath);
  const resolvedFormat = resolveFormat(format, sourcePath);
  const input = await readFile(sourcePath);
  const subset = await subsetFont(input, chars, { targetFormat: TARGET_FORMAT[resolvedFormat] });

  const outExt = FORMAT_EXT[resolvedFormat];
  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const dir = overwrite ? dirname(sourcePath) : outputDir;
  const outputPath = join(dir, `${nameNoExt}.${outExt}`);

  await writeFile(outputPath, subset);
  // 覆盖模式下扩展名变了，源文件已无用，删掉免留旧格式副本
  if (overwrite && outputPath !== sourcePath) await unlink(sourcePath).catch(() => {});

  const originalSize = originalStat.size;
  const subsetSize = subset.length;
  return {
    sourcePath,
    outputPath,
    originalSize,
    subsetSize,
    ratio: originalSize > 0 ? Math.round((1 - subsetSize / originalSize) * 100) : 0,
    outputFormat: resolvedFormat,
  };
}

/**
 * 裁剪预览（只裁不写盘）：固定 woff2 目标，返回 data URL 供 FontFace 加载。
 * @param filePath 字体路径。
 * @param chars 要保留的字符集。
 * @returns woff2 的 data URL。
 */
async function subsetPreview(filePath: string, chars: string): Promise<string> {
  const input = await readFile(filePath);
  // 空字符集时 subset-font 会报错，给个占位空格避免抛异常，预览显示为空也合理
  const subset = await subsetFont(input, chars || ' ', { targetFormat: 'woff2' });
  return `data:font/woff2;base64,${subset.toString('base64')}`;
}

/** 已知的分包字体扩展名（用于统计 chunk 数）。 */
const FONT_CHUNK_EXTS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);

/**
 * 递归统计目录下的文件数 / chunk 数 / 总大小，并记下第一个 css 路径。
 * @param dir 目录。
 * @param acc 累加器。
 */
async function statOutputDir(
  dir: string,
  acc: { fileCount: number; chunkCount: number; totalSize: number; cssPath: string },
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await statOutputDir(full, acc);
      continue;
    }
    const st = await stat(full).catch(() => null);
    if (!st) continue;
    acc.fileCount += 1;
    acc.totalSize += st.size;
    const ext = extname(entry.name).toLowerCase();
    if (FONT_CHUNK_EXTS.has(ext)) acc.chunkCount += 1;
    else if (ext === '.css' && !acc.cssPath) acc.cssPath = full;
  }
}

/**
 * 网页分包：一个字体切成多个 unicode-range 分包 + CSS。
 *
 * cn-font-split 负责分包（Rust FFI，dll 由 postinstall 下载），**只出 woff2**。
 * 需要 woff/ttf 时，用 subset-font 把每个 woff2 chunk 逐个转格式（传该 chunk 自己的
 * 完整字符集，不丢字），再重写 CSS 的 src 为多格式 url 回退（woff2→woff→ttf）。
 * 产物单目录、单 CSS。可关注释、自定义分包名、额外 less/scss。
 * @param sourcePath 源字体路径。
 * @param options 分包选项。
 * @returns 产物摘要。
 */
async function splitFont(sourcePath: string, options: FontSplitOptions): Promise<FontSplitResult> {
  // cn-font-split 是 ESM，动态 import（本文件被 electron-vite 外部化，运行时 require 解析）
  const { fontSplit } = await import('cn-font-split');

  const input = await readFile(sourcePath);
  const baseName = basename(sourcePath, extname(sourcePath));
  const outDir = join(options.outputDir, baseName);
  await mkdir(outDir, { recursive: true });

  // cssProps：关注释（commentUnicodes/commentBase/commentNameTable 全关）、自定义 family
  const cssProps: Record<string, unknown> = {
    commentUnicodes: options.cssComment,
    commentBase: options.cssComment,
    commentNameTable: options.cssComment,
  };
  if (options.cssFontFamily) cssProps.fontFamily = options.cssFontFamily;

  await fontSplit({
    input: new Uint8Array(input),
    outDir,
    chunkSize: options.chunkSize,
    testHtml: options.testHtml,
    fontFeature: options.fontFeature,
    languageAreas: options.languageArea,
    // 分包文件名模板必须以 .[ext] 结尾才有效（cn-font-split 实测：缺 [ext] 会不产出文件），
    // 用户没写就自动补上，让他们只需填 chunk-[index] 这样的前缀
    ...(options.chunkName
      ? {
          renameOutputFont: /\[ext\]/.test(options.chunkName)
            ? options.chunkName
            : `${options.chunkName}.[ext]`,
        }
      : {}),
    css: cssProps,
    silent: true,
  });

  // 解析目标格式集。formats 里可含 woff2/woff/ttf；keepOriginal 把源格式并入。
  // cn-font-split 分包本身产出 woff2，故 woff2 始终先存在；最后按需删。
  const wanted = new Set<'woff2' | 'woff' | 'ttf'>(options.formats);
  if (options.keepOriginal) {
    const srcExt = extname(sourcePath).replace(/^\./, '').toLowerCase();
    if (srcExt === 'ttf' || srcExt === 'otf') wanted.add('ttf');
    else if (srcExt === 'woff') wanted.add('woff');
    else wanted.add('woff2');
  }
  // 兜底：一个都没选时至少保留 woff2，避免产出空 CSS
  if (wanted.size === 0) wanted.add('woff2');

  // 要额外转出的非 woff2 格式
  const extra = new Set<'woff' | 'ttf'>();
  if (wanted.has('woff')) extra.add('woff');
  if (wanted.has('ttf')) extra.add('ttf');

  // 逐 chunk 转格式：读 woff2 chunk 的完整字符集喂 subset-font，避免二次裁剪丢字
  if (extra.size) {
    const woff2Files = (await readdir(outDir)).filter((f) => f.toLowerCase().endsWith('.woff2'));
    for (const file of woff2Files) {
      const full = join(outDir, file);
      const buf = await readFile(full);
      const chars = firstFont(buf)
        .characterSet.map((c) => String.fromCodePoint(c))
        .join('');
      const stem = basename(file, extname(file));
      for (const fmt of extra) {
        const targetFormat = fmt === 'ttf' ? 'truetype' : 'woff';
        try {
          const out = await subsetFont(buf, chars, { targetFormat });
          await writeFile(join(outDir, `${stem}.${fmt}`), out);
        } catch {
          // 单个 chunk 转失败不阻断（该格式该段缺失，CSS 重写时不追加它）
        }
      }
    }
  }

  // 重写 CSS：把单 woff2 url 换成用户所选格式的 url（按 woff2→woff→ttf），
  // 未选 woff2 时也从 src 里去掉它（稍后删 woff2 文件）。
  const cssFile = (await readdir(outDir)).find((f) => f.toLowerCase().endsWith('.css'));
  const needRewrite = !wanted.has('woff2') || extra.size > 0;
  if (cssFile && needRewrite) {
    const cssFull = join(outDir, cssFile);
    let cssText = await readFile(cssFull, 'utf-8');
    const dirFiles = new Set(await readdir(outDir));
    cssText = cssText.replace(
      /url\(["']?\.\/([^"')]+)\.woff2["']?\)\s*format\(["']?woff2["']?\)/g,
      (_m, stem) => {
        const parts: string[] = [];
        if (wanted.has('woff2')) parts.push(`url("./${stem}.woff2")format("woff2")`);
        if (wanted.has('woff') && dirFiles.has(`${stem}.woff`)) {
          parts.push(`url("./${stem}.woff")format("woff")`);
        }
        if (wanted.has('ttf') && dirFiles.has(`${stem}.ttf`)) {
          parts.push(`url("./${stem}.ttf")format("truetype")`);
        }
        // 万一某段一个格式都没转出来，兜底回原 woff2，避免 src 空掉
        if (!parts.length) parts.push(`url("./${stem}.woff2")format("woff2")`);
        return parts.join(',');
      },
    );
    await writeFile(cssFull, cssText, 'utf-8');
  }

  // 未选 woff2：删掉分包产生的 woff2 中间文件（CSS 已不引用它们）
  if (!wanted.has('woff2')) {
    for (const file of await readdir(outDir)) {
      if (file.toLowerCase().endsWith('.woff2')) await unlink(join(outDir, file)).catch(() => {});
    }
  }

  // 额外样式：less/scss 是 css 超集，复制（重写后的）css 内容即可
  if (options.extraStyles.length && cssFile) {
    const cssText = await readFile(join(outDir, cssFile), 'utf-8');
    const stem = basename(cssFile, extname(cssFile));
    for (const style of options.extraStyles) {
      await writeFile(join(outDir, `${stem}.${style}`), cssText, 'utf-8');
    }
  }

  const acc = { fileCount: 0, chunkCount: 0, totalSize: 0, cssPath: '' };
  await statOutputDir(outDir, acc);
  return { outDir, ...acc };
}

/* ── 格式转换（fontverter 纯容器转换） ────────────────────────────── */

/**
 * 被取消的转换任务 id 集合。
 *
 * 转换是纯 JS/WASM 调用、没有子进程可杀，取消只能置标记让格式循环下一轮退出，
 * 所以正在编码的那一个格式仍会跑完（woff2 大字体最长 ~12s）。
 */
const canceledConvert = new Set<string>();

/** 目标格式 → 输出扩展名。 */
const CONVERT_EXT: Record<FontConvertFormat, string> = {
  ttf: '.ttf',
  woff: '.woff',
  woff2: '.woff2',
};

/** 目标格式 → fontverter 的 format 名。fontverter 用 sfnt 统称 ttf/otf 这类裸 sfnt 容器。 */
const CONVERT_TARGET: Record<FontConvertFormat, 'sfnt' | 'woff' | 'woff2'> = {
  ttf: 'sfnt',
  woff: 'woff',
  woff2: 'woff2',
};

/**
 * 向渲染进程推一条转换进度。
 * @param win 目标窗口。
 * @param payload 进度数据。
 */
function sendConvertProgress(
  win: BrowserWindow,
  payload: { taskId: string; format: FontConvertFormat; done: number; total: number },
): void {
  if (win.isDestroyed()) return;
  win.webContents.send(FONT_CHANNELS.convertProgress, payload);
}

/**
 * 纯容器格式转换：一个字体转成一到多个目标格式，字形一个不丢。
 *
 * 用 fontverter 而非 subset-font：后者不做容器无关的转换，只能「裁剪并顺带换容器」，
 * 即便把 characterSet 的全部字符喂进去，仅经 GSUB 可达（连字 / 异体字）的字形也会
 * 丢失——arial.ttf 4503 个字形只剩 4161。格式转换不该丢用户没让丢的东西。
 *
 * 多格式串行处理：woff2 编码吃满单核（9.7MB 中文字体约 12s），并发只会互相抢 CPU。
 * @param win 用于推进度的窗口。
 * @param sourcePath 源字体路径。
 * @param options 转换选项。
 * @returns 转换结果。
 */
async function convertOne(
  win: BrowserWindow,
  sourcePath: string,
  options: FontConvertOptions,
): Promise<FontConvertResult> {
  const { taskId, formats, outputDir, overwrite } = options;
  if (!formats.length) throw new Error('未选择目标格式');

  const input = await readFile(sourcePath);
  // 字体集合（.ttc/.otc）里有多支字体，fontverter 只会抛英文的 Unrecognized font
  // signature，对用户没有意义，这里提前给可操作的中文提示
  if (input.subarray(0, 4).toString('latin1') === 'ttcf') {
    throw new Error('不支持字体集合（.ttc/.otc），请先拆成单个字体');
  }

  const sourceFormat: string = detectFormat(input);
  const glyphCount = firstFont(input).numGlyphs ?? 0;
  const dir = outputDir || dirname(sourcePath);
  await mkdir(dir, { recursive: true });

  const nameNoExt = basename(sourcePath, extname(sourcePath));
  const files: FontConvertFile[] = [];
  const skipped: FontConvertFormat[] = [];

  try {
    let done = 0;
    for (const format of formats) {
      if (canceledConvert.has(taskId)) {
        return {
          sourcePath,
          sourceFormat,
          sourceSize: input.length,
          glyphCount,
          files,
          skipped,
          canceled: true,
        };
      }
      sendConvertProgress(win, { taskId, format, done, total: formats.length });

      const outputPath = join(dir, `${nameNoExt}${CONVERT_EXT[format]}`);
      // 目标就是源文件本身（如 a.ttf 转 ttf 且输出到同目录）：原地重写毫无意义，
      // 且中途失败会毁掉用户的源文件，直接跳过
      if (outputPath === sourcePath) {
        skipped.push(format);
        done += 1;
        continue;
      }
      const exists = await stat(outputPath).catch(() => null);
      if (exists && !overwrite) {
        skipped.push(format);
        done += 1;
        continue;
      }

      // 源格式与目标相同时 fontverter 直通返回原 buffer，等价于一次拷贝；
      // 用户勾了就给文件，不做「聪明」的省略
      const out: Buffer = await fontConvert(input, CONVERT_TARGET[format], sourceFormat);
      // 先写临时文件再 rename：失败或取消不留半个坏字体（同视频转码与批量重命名的纪律）
      const tmpPath = `${outputPath}.tbtmp`;
      try {
        await writeFile(tmpPath, out);
        await rename(tmpPath, outputPath);
      } finally {
        await unlink(tmpPath).catch(() => {});
      }

      files.push({ format, path: outputPath, size: out.length });
      done += 1;
    }
  } finally {
    canceledConvert.delete(taskId);
  }

  return { sourcePath, sourceFormat, sourceSize: input.length, glyphCount, files, skipped };
}

/**
 * 注册字体处理相关 IPC。
 * @param win 主窗口，格式转换需要它推进度。
 */
export function registerFontIpc(win: BrowserWindow): void {
  handle(FONT_CHANNELS.probe, (_e, filePath: string) => probeFont(filePath));
  handle(FONT_CHANNELS.subsetPreview, (_e, filePath: string, chars: string) =>
    subsetPreview(filePath, chars),
  );
  handle(FONT_CHANNELS.subset, (_e, sourcePath: string, options: FontSubsetOptions) =>
    subsetOne(sourcePath, options),
  );
  handle(FONT_CHANNELS.split, (_e, sourcePath: string, options: FontSplitOptions) =>
    splitFont(sourcePath, options),
  );
  handle(FONT_CHANNELS.convert, (_e, sourcePath: string, options: FontConvertOptions) =>
    convertOne(win, sourcePath, options),
  );
  handle(FONT_CHANNELS.cancelConvert, (_e, taskId: string) => {
    canceledConvert.add(taskId);
    return true;
  });
}
