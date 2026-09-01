import { basename, extname, join } from 'path';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import type { BrowserWindow } from 'electron';
import sharp from 'sharp';
import * as fontkit from 'fontkit';
import { BITMAP_FONT_CHANNELS } from '../../shared/channels';
import type {
  BitmapFontChar,
  BitmapFontDataFormat,
  BitmapFontKerning,
  BitmapFontOptions,
  BitmapFontPackOptions,
  BitmapFontPagePreview,
  BitmapFontPageSize,
  BitmapFontPreview,
  BitmapFontProgress,
  BitmapFontResult,
} from '../../shared/types';
import { handle } from './helper';

/**
 * 位图字体：把字体（或一组字符图片）烘成 PNG 图集 + BMFont 描述文件。
 *
 * 不并入 font.ts：那边三套逻辑（裁剪/分包/转换）都是「字体进、字体出」，这里产出的是
 * 图片 + 描述文件，依赖的是 sharp 而非 subset-font/fontverter，混在一起两边都难读。
 */

/* ── 通用 ─────────────────────────────────────────────────────────── */

/**
 * 被取消的任务 id 集合。
 *
 * 与格式转换同理：纯 JS 调用没有子进程可杀，取消只能置标记让循环在下一轮退出，
 * 所以正在栅格化的那一页会跑完（3500 字一页约 0.6s，可接受）。
 */
const canceledTasks = new Set<string>();

/**
 * fontkit 可能返回单字体或字体集合（TTC），统一取第一个。
 *
 * 与 font.ts 的同名函数重复，但故意不跨文件复用：那边 import 了 subset-font /
 * fontverter / cn-font-split，为了三行代码把它们拖进本模块的依赖图不划算。
 * @param data 字体数据。
 * @returns 单个字体对象。
 */
function firstFont(data: Buffer): fontkit.Font {
  const parsed = fontkit.create(data);
  if ('fonts' in parsed && Array.isArray(parsed.fonts) && parsed.fonts.length) {
    return parsed.fonts[0];
  }
  return parsed as fontkit.Font;
}

/**
 * XML 属性转义（颜色串等用户输入要过一遍）。
 * @param text 原文。
 * @returns 转义后的文本。
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 拆成码点数组并去重（保序）。
 *
 * 必须用 spread 迭代而不是 `split('')`：后者会把 emoji 这类代理对切成两个半字符。
 * 同时滤掉换行与回车（多来源字符集合并时一定带进来）。
 * @param text 字符串。
 * @returns 去重后的字符数组。
 */
function uniqueChars(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out.push(ch);
  }
  return out;
}

/**
 * 向渲染进程推一条进度。
 * @param win 目标窗口。
 * @param payload 进度数据。
 */
function sendProgress(win: BrowserWindow, payload: BitmapFontProgress): void {
  if (win.isDestroyed()) return;
  win.webContents.send(BITMAP_FONT_CHANNELS.progress, payload);
}

/**
 * 一批文件全成功才落盘：先写 `.tbtmp` 再逐个 rename，任一步失败就把已改名的也删掉。
 *
 * 图集与描述文件必须配套：缺一页 PNG 的 .fnt 是坏数据，引擎会渲出空白字，
 * 比什么都没产出更难排查。所以宁可整套不留。
 * @param files 目标路径与内容。
 */
async function writeAllAtomic(files: { path: string; data: Buffer | string }[]): Promise<void> {
  const tmps = files.map((f) => `${f.path}.tbtmp`);
  const renamed: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) await writeFile(tmps[i], files[i].data);
    for (let i = 0; i < files.length; i++) {
      await rename(tmps[i], files[i].path);
      renamed.push(files[i].path);
    }
  } catch (error) {
    for (const p of renamed) await unlink(p).catch(() => {});
    throw error;
  } finally {
    for (const t of tmps) await unlink(t).catch(() => {});
  }
}

/* ── 字形度量 ─────────────────────────────────────────────────────── */

/** 装箱前的单个字形：尺寸 + 度量 + 绘制所需的路径信息。 */
interface GlyphRecord {
  /** unicode 码点。 */
  cp: number;
  /** 位图宽（含描边）。 */
  width: number;
  /** 位图高（含描边）。 */
  height: number;
  /** 绘制偏移。 */
  xoffset: number;
  yoffset: number;
  xadvance: number;
  /** SVG path data（字体坐标系，Y 向上）；零面积字形为空串。 */
  pathData: string;
  /** 位图左边界在字体坐标系换算后的 px 位置，出图时反算 translate 用。 */
  x0: number;
  /** 位图上边界（同上，注意字体坐标系 Y 向上故这里是 maxY 侧）。 */
  y1: number;
}

/** 字体级度量。 */
interface FontMetrics {
  /** 字体族名。 */
  face: string;
  /** 缩放系数：px / unitsPerEm。 */
  scale: number;
  /** 行高 px。 */
  lineHeight: number;
  /** 基线到行顶 px。 */
  base: number;
}

/**
 * 读字体级度量。
 * @param font 字体对象。
 * @param fallbackName 取不到族名时的兜底名。
 * @param fontSize 字号 px。
 * @returns 字体级度量。
 */
function readFontMetrics(font: fontkit.Font, fallbackName: string, fontSize: number): FontMetrics {
  const upm = font.unitsPerEm || 1000;
  const scale = fontSize / upm;
  const ascent = font.ascent ?? upm;
  // descent 一般是负值，行高要减它
  const descent = font.descent ?? 0;
  const lineGap = font.lineGap ?? 0;
  return {
    face: font.familyName ?? fallbackName,
    scale,
    lineHeight: Math.max(1, Math.round((ascent - descent + lineGap) * scale)),
    base: Math.round(ascent * scale),
  };
}

/**
 * 取单个字符的字形记录。
 *
 * 描边会让墨迹向外扩张 outlineWidth，所以位图四边各留这么多；实测
 * `stroke-linejoin="round"` + `paint-order="stroke"` 下 W/A/g/@/M/#/j 的 ink
 * 尺寸与这里声明的尺寸完全相等，既不溢出也不浪费。
 * @param font 字体对象。
 * @param metrics 字体级度量。
 * @param ch 字符。
 * @param outlineWidth 描边宽度 px。
 * @returns 字形记录。
 */
function glyphRecord(
  font: fontkit.Font,
  metrics: FontMetrics,
  ch: string,
  outlineWidth: number,
): GlyphRecord {
  const cp = ch.codePointAt(0) as number;
  const s = metrics.scale;
  const glyph = font.glyphForCodePoint(cp);
  const xadvance = Math.round((glyph.advanceWidth ?? 0) * s);

  const bbox = glyph.bbox;
  const pathData = glyph.path?.toSVG() ?? '';
  // 零面积字形：空格与各类控制字符的 bbox 四个值全是 null、path 也是空串，
  // 只有 advanceWidth 有意义。BMFont 规范允许 width=height=0，引擎照 advance 跳过。
  const empty =
    !pathData ||
    bbox == null ||
    bbox.minX == null ||
    bbox.maxX == null ||
    bbox.minY == null ||
    bbox.maxY == null ||
    bbox.maxX <= bbox.minX ||
    bbox.maxY <= bbox.minY;
  if (empty) {
    return {
      cp,
      width: 0,
      height: 0,
      xoffset: 0,
      yoffset: 0,
      xadvance,
      pathData: '',
      x0: 0,
      y1: 0,
    };
  }

  // 边界必须**分轴** floor/ceil，不能先算宽再取整：
  // `Math.ceil((maxX - minX) * s)` 会丢掉左右各半个像素，实测导致逐字形摆放与
  // 整串排版出现 518 个像素级偏差（max diff 226）。分轴后差异归零。
  const x0 = Math.floor(bbox.minX * s) - outlineWidth;
  const x1 = Math.ceil(bbox.maxX * s) + outlineWidth;
  const y0 = Math.floor(bbox.minY * s) - outlineWidth;
  const y1 = Math.ceil(bbox.maxY * s) + outlineWidth;

  return {
    cp,
    width: x1 - x0,
    height: y1 - y0,
    xoffset: x0,
    // 字体坐标系 Y 向上、BMFont 的 yoffset 从行顶向下量，故用 base 减去墨迹顶端
    yoffset: metrics.base - y1,
    xadvance,
    pathData,
    x0,
    y1,
  };
}

/**
 * 提取字距对：成对 layout 与单字 advance 求差。
 *
 * fontkit 没有公开的 kern/GPOS 读表 API，只能借排版结果反推：
 * `layout(a+b).positions[0].xAdvance` 含了 a→b 的 kerning，减去 a 自己的 advance 即为差值。
 *
 * **必须限规模**：这是 O(n²) 次 layout，67 个 ASCII（4489 对）86ms，
 * 200 字（4 万对）约 0.8s 还能忍，3500 汉字是 1225 万对，彻底不可行
 * ——况且 CJK 本来几乎没有 kerning，为它等几分钟毫无收益。
 * @param font 字体对象。
 * @param chars 参与的字符（都已确认字体里有）。
 * @param scale px / unitsPerEm。
 * @returns 非零的字距对。
 */
function extractKernings(font: fontkit.Font, chars: string[], scale: number): BitmapFontKerning[] {
  const out: BitmapFontKerning[] = [];
  for (const a of chars) {
    const first = a.codePointAt(0) as number;
    const baseAdvance = font.glyphForCodePoint(first).advanceWidth ?? 0;
    for (const b of chars) {
      const run = font.layout(a + b);
      const paired = run.positions?.[0]?.xAdvance ?? baseAdvance;
      const delta = paired - baseAdvance;
      if (delta === 0) continue;
      // BMFont 的 amount 是像素，换算后归零的对（字体单位很小的微调）就不写了
      const amount = Math.round(delta * scale);
      if (amount === 0) continue;
      out.push({ first, second: b.codePointAt(0) as number, amount });
    }
  }
  return out;
}

/* ── 装箱 ─────────────────────────────────────────────────────────── */

/** 装箱输入：只需要尺寸与一个排序用的稳定键。 */
interface PackItem {
  width: number;
  height: number;
  /** 同高时的次级排序键，保证同参数必出同结果。 */
  sortKey: number;
}

/** 装箱结果：每项落在哪一页的哪个位置。 */
interface PackedSlot {
  page: number;
  x: number;
  y: number;
}

/** 整体装箱结果。 */
interface PackResult {
  /** 与输入等长，索引对齐；零面积项为 null。 */
  slots: (PackedSlot | null)[];
  /** 统一后的页尺寸（BMFont 的 scaleW/scaleH 是全局字段，各页必须同尺寸）。 */
  pageSize: BitmapFontPageSize;
  /** 页数。 */
  pageCount: number;
  /** 占用率百分比（字形面积 / 图集总面积）。 */
  occupancy: number;
}

/**
 * 高度降序货架装箱（shelf / next-fit）。
 *
 * 不复用 image.ts 的 `layoutSingleGrid`：那是「每列最宽、每行最高」的固定网格，
 * 字形尺寸差异极大时空间浪费惊人 —— 95 个 ASCII @48px 实测占用率只有 33.7%
 * （470×480），本函数是 88.8%（256×334）。图集尺寸直接决定显存占用，值得写新的。
 *
 * 排序键为 `(height desc, sortKey asc)`：同参数两次运行必出完全相同的字节，
 * 用户重跑不会得到一张「看起来不一样但其实等价」的图集。
 * @param items 待装箱项。
 * @param spacing 项之间的间距。
 * @param padding 图集四周外边距。
 * @param maxSize 单页最大边长。
 * @returns 装箱结果。
 */
function packShelf(
  items: PackItem[],
  spacing: number,
  padding: number,
  maxSize: number,
): PackResult {
  const order = items
    .map((it, index) => ({ it, index }))
    .filter((e) => e.it.width > 0 && e.it.height > 0)
    .sort((a, b) => b.it.height - a.it.height || a.it.sortKey - b.it.sortKey);

  const slots: (PackedSlot | null)[] = items.map(() => null);
  // 每页的实际内容右/下边界，最后统一成同尺寸
  const pageBounds: { right: number; bottom: number }[] = [];
  let page = 0;
  let penX = padding;
  let penY = padding;
  let rowH = 0;
  let right = 0;
  let bottom = 0;
  let inkArea = 0;

  const closePage = (): void => {
    pageBounds[page] = { right, bottom };
    page += 1;
    penX = padding;
    penY = padding;
    rowH = 0;
    right = 0;
    bottom = 0;
  };

  for (const { it, index } of order) {
    // 放不下当前货架 → 换行
    if (penX > padding && penX + it.width + padding > maxSize) {
      penY += rowH + spacing;
      penX = padding;
      rowH = 0;
    }
    // 换行后仍超高 → 开新页（页首那一项即便超高也硬放，不缩放不丢字）
    if (penY > padding && penY + it.height + padding > maxSize) closePage();

    slots[index] = { page, x: penX, y: penY };
    inkArea += it.width * it.height;
    penX += it.width + spacing;
    if (penX - spacing > right) right = penX - spacing;
    if (it.height > rowH) rowH = it.height;
    if (penY + rowH > bottom) bottom = penY + rowH;
  }
  if (order.length) pageBounds[page] = { right, bottom };

  const pageCount = Math.max(1, pageBounds.length);
  // BMFont 的 scaleW/scaleH 是 common 行上的全局字段、不是 per-page，
  // 各页尺寸不一会让按它算 UV 的引擎（Cocos 等）在非首页错位，故统一取最大值。
  // 多页时除末页外本来就接近满高，浪费很小；单页时完全无浪费。
  const width = Math.max(1, ...pageBounds.map((b) => b.right + padding));
  const height = Math.max(1, ...pageBounds.map((b) => b.bottom + padding));
  const total = width * height * pageCount;

  return {
    slots,
    pageSize: { width, height },
    pageCount,
    occupancy: total > 0 ? Math.round((inkArea / total) * 1000) / 10 : 0,
  };
}

/* ── 出图 ─────────────────────────────────────────────────────────── */

/** 一页里要画的字形：路径 + 落点。 */
interface PlacedGlyph extends GlyphRecord {
  x: number;
  y: number;
}

/**
 * 整页一个 SVG 交给 sharp 栅格化。
 *
 * **这是性能关键，也是唯一正确的做法**：3500 个 CJK 字形逐字形先出 tile 再
 * `composite` 要 13524ms，整页拼成一个 SVG 只要 600ms（22×），且实测两法输出
 * **像素完全一致**（alpha 差异 0）。谁要是改回 composite，验证脚本第 2 条会挂。
 *
 * 描边用 `paint-order="stroke"` 画在填充下面（否则描边会吃掉一半字面）；
 * `stroke-width` 处在字形坐标系里所以要除以 scale，又因为 stroke 以路径为中心
 * 向两侧各扩一半，要给 `outlineWidth * 2` 才能得到向外 outlineWidth 的效果。
 * @param glyphs 本页字形。
 * @param size 页尺寸。
 * @param scale px / unitsPerEm。
 * @param fill 填充色。
 * @param outlineWidth 描边宽度 px。
 * @param outlineColor 描边色。
 * @returns PNG buffer。
 */
async function renderGlyphPage(
  glyphs: PlacedGlyph[],
  size: BitmapFontPageSize,
  scale: number,
  fill: string,
  outlineWidth: number,
  outlineColor: string,
): Promise<Buffer> {
  let body = '';
  for (const g of glyphs) {
    // 字体坐标系 Y 向上，scale(s,-s) 翻正；平移量把墨迹左上角对到 (g.x, g.y)
    const tx = g.x - g.x0;
    const ty = g.y + g.y1;
    body += `<path d="${g.pathData}" transform="translate(${tx},${ty}) scale(${scale},${-scale})"/>`;
  }
  const paint =
    outlineWidth > 0
      ? `fill="${escapeXml(fill)}" stroke="${escapeXml(outlineColor)}" stroke-width="${
          (outlineWidth * 2) / scale
        }" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`
      : `fill="${escapeXml(fill)}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" ` +
    `viewBox="0 0 ${size.width} ${size.height}"><g ${paint}>${body}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** 预览长边上限（同精灵图，够看清排布又不至于把几 MB 的 base64 塞过 IPC）。 */
const PREVIEW_MAX = 1200;

/**
 * 把整页 PNG 缩成预览用的 webp data URL。
 * @param png 整页 PNG。
 * @param size 原始尺寸。
 * @returns data URL。
 */
async function toPreviewUrl(png: Buffer, size: BitmapFontPageSize): Promise<string> {
  const longEdge = Math.max(size.width, size.height);
  let img = sharp(png);
  if (longEdge > PREVIEW_MAX) {
    img = img.resize({
      width: Math.max(1, Math.round((size.width / longEdge) * PREVIEW_MAX)),
      withoutEnlargement: true,
    });
  }
  const buffer = await img.webp({ quality: 80 }).toBuffer();
  return `data:image/webp;base64,${buffer.toString('base64')}`;
}

/* ── 描述文件序列化 ───────────────────────────────────────────────── */

/** 序列化所需的头部信息。 */
interface BitmapFontMeta {
  face: string;
  size: number;
  lineHeight: number;
  base: number;
  pageSize: BitmapFontPageSize;
  /** 各页文件名（不含目录）。 */
  pageFiles: string[];
  spacing: number;
  outline: number;
}

/**
 * 一份数据三种编码。
 *
 * text .fnt / XML / JSON 是 AngelCode BMFont 的三种等价表示，字段名与含义完全相同，
 * 差别只在语法。共用同一个内存结构序列化，保证三个文件绝不互相漂移。
 * 消费方：.fnt 给 Cocos / Unity / LibGDX，.xml 给 Pixi（默认解析这个），
 * .json 给 Phaser 3 与自研引擎（可直接 import）。
 * @param meta 头部信息。
 * @param chars 字符条目。
 * @param kernings 字距对。
 * @param format 目标格式。
 * @returns 文件文本。
 */
function serializeBitmapFont(
  meta: BitmapFontMeta,
  chars: BitmapFontChar[],
  kernings: BitmapFontKerning[],
  format: BitmapFontDataFormat,
): string {
  const { face, size, lineHeight, base, pageSize, pageFiles, spacing, outline } = meta;
  // info 里的 padding 是**每个字形的内边距**、不是图集外边距（我们的 padding 选项是后者，
  // BMFont 没有对应字段），故恒为 0,0,0,0；spacing 才是字形间距。
  const info = {
    face,
    size,
    bold: 0,
    italic: 0,
    charset: '',
    unicode: 1,
    stretchH: 100,
    smooth: 1,
    aa: 1,
    padding: '0,0,0,0',
    spacing: `${spacing},${spacing}`,
    outline,
  };
  const common = {
    lineHeight,
    base,
    scaleW: pageSize.width,
    scaleH: pageSize.height,
    pages: pageFiles.length,
    packed: 0,
    // 字形画在 RGBA 全通道（chnl=15），没有做通道打包
    alphaChnl: 0,
    redChnl: 4,
    greenChnl: 4,
    blueChnl: 4,
  };

  if (format === 'json') {
    return `${JSON.stringify(
      {
        info,
        common,
        pages: pageFiles.map((file, id) => ({ id, file })),
        chars: chars.map((c) => ({ ...c, chnl: 15 })),
        kernings,
      },
      null,
      2,
    )}\n`;
  }

  if (format === 'xml') {
    const attrs = (obj: Record<string, string | number>): string =>
      Object.entries(obj)
        .map(([k, v]) => `${k}="${escapeXml(String(v))}"`)
        .join(' ');
    const lines: string[] = ['<?xml version="1.0"?>', '<font>'];
    lines.push(`  <info ${attrs(info)} />`);
    lines.push(`  <common ${attrs(common)} />`);
    lines.push(`  <pages>`);
    pageFiles.forEach((file, id) =>
      lines.push(`    <page id="${id}" file="${escapeXml(file)}" />`),
    );
    lines.push(`  </pages>`);
    lines.push(`  <chars count="${chars.length}">`);
    for (const c of chars) lines.push(`    <char ${attrs({ ...c, chnl: 15 })} />`);
    lines.push(`  </chars>`);
    lines.push(`  <kernings count="${kernings.length}">`);
    // 展开成匿名对象字面量：具名 interface 没有索引签名，直接传 attrs() 通不过类型检查
    for (const k of kernings) lines.push(`    <kerning ${attrs({ ...k })} />`);
    lines.push(`  </kernings>`);
    lines.push('</font>', '');
    return lines.join('\n');
  }

  // text .fnt：`key=value` 以空格分隔，字符串值带引号
  const pairs = (obj: Record<string, string | number>): string =>
    Object.entries(obj)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
      .join(' ');
  const lines: string[] = [];
  lines.push(`info ${pairs(info)}`);
  lines.push(`common ${pairs(common)}`);
  pageFiles.forEach((file, id) => lines.push(`page id=${id} file="${file}"`));
  lines.push(`chars count=${chars.length}`);
  for (const c of chars) lines.push(`char ${pairs({ ...c, chnl: 15 })}`);
  lines.push(`kernings count=${kernings.length}`);
  for (const k of kernings) lines.push(`kerning ${pairs({ ...k })}`);
  lines.push('');
  return lines.join('\n');
}

/** 描述格式 → 扩展名。 */
const DATA_EXT: Record<BitmapFontDataFormat, string> = {
  fnt: 'fnt',
  xml: 'xml',
  json: 'json',
};

/**
 * 按格式生成描述文件的落盘任务。
 * @param formats 要输出的格式。
 * @param outputDir 输出目录。
 * @param baseName 产物基名。
 * @param meta 头部信息。
 * @param chars 字符条目。
 * @param kernings 字距对。
 * @returns 路径与内容。
 */
function dataFiles(
  formats: BitmapFontDataFormat[],
  outputDir: string,
  baseName: string,
  meta: BitmapFontMeta,
  chars: BitmapFontChar[],
  kernings: BitmapFontKerning[],
): { path: string; data: string }[] {
  // 去重：前端多选理论上不会重复，但重复了就会写同一个文件两次
  return [...new Set(formats)].map((format) => ({
    path: join(outputDir, `${baseName}.${DATA_EXT[format]}`),
    data: serializeBitmapFont(meta, chars, kernings, format),
  }));
}

/* ── 字体 → 位图字体 ─────────────────────────────────────────────── */

/** 字符数超过这个数就不提 kerning（O(n²) 次 layout，再多要按分钟计）。 */
const KERNING_CHAR_LIMIT = 200;

/** 度量 + 装箱的中间结果，预览与落盘共用。 */
interface BuildResult {
  metrics: FontMetrics;
  /** 各页要画的字形。 */
  pages: PlacedGlyph[][];
  /** 描述文件的 char 条目。 */
  chars: BitmapFontChar[];
  pageSize: BitmapFontPageSize;
  occupancy: number;
  /** 字体里没有的字符，原样拼串。 */
  missingChars: string;
}

/**
 * 度量并装箱（不出图）。
 *
 * 缺字判断走 `hasGlyphForCodePoint`，**不能看 layout 出来的 glyph.id 或 glyph.codePoints**：
 * 实测 arial 上 `layout('中')` 返回 id 0（.notdef，符合预期），但该 glyph 对象的
 * `codePoints` 是**上一次调用残留的 [20013]**，照它判断会把缺字当成有字。
 * @param font 字体对象。
 * @param fallbackName 族名兜底。
 * @param options 生成选项。
 * @returns 度量与装箱结果。
 */
function buildFromFont(
  font: fontkit.Font,
  fallbackName: string,
  options: BitmapFontOptions,
): BuildResult {
  const { chars: rawChars, fontSize, spacing, padding, pageSize, outlineWidth } = options;
  const metrics = readFontMetrics(font, fallbackName, fontSize);

  const present: string[] = [];
  const missing: string[] = [];
  for (const ch of uniqueChars(rawChars)) {
    const cp = ch.codePointAt(0) as number;
    if (font.hasGlyphForCodePoint(cp)) present.push(ch);
    else missing.push(ch);
  }
  if (!present.length) throw new Error('这个字体里没有任何一个所选字符');

  const records = present.map((ch) => glyphRecord(font, metrics, ch, Math.max(0, outlineWidth)));
  const packed = packShelf(
    records.map((r) => ({ width: r.width, height: r.height, sortKey: r.cp })),
    spacing,
    padding,
    pageSize,
  );

  const pages: PlacedGlyph[][] = Array.from({ length: packed.pageCount }, () => []);
  const charEntries: BitmapFontChar[] = [];
  records.forEach((r, i) => {
    const slot = packed.slots[i];
    if (!slot) {
      // 零面积字形（空格等）：不占图集，只写 advance
      charEntries.push({
        id: r.cp,
        page: 0,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        xoffset: 0,
        yoffset: 0,
        xadvance: r.xadvance,
      });
      return;
    }
    pages[slot.page].push({ ...r, x: slot.x, y: slot.y });
    charEntries.push({
      id: r.cp,
      page: slot.page,
      x: slot.x,
      y: slot.y,
      width: r.width,
      height: r.height,
      xoffset: r.xoffset,
      yoffset: r.yoffset,
      xadvance: r.xadvance,
    });
  });
  // char 行按码点排序，便于人工比对与 diff（BMFont 自身也是升序输出）
  charEntries.sort((a, b) => a.id - b.id);

  return {
    metrics,
    pages,
    chars: charEntries,
    pageSize: packed.pageSize,
    occupancy: packed.occupancy,
    missingChars: missing.join(''),
  };
}

/**
 * 从字体生成图集 + 描述文件并落盘。
 * @param win 用于推进度的窗口。
 * @param options 生成选项。
 * @returns 生成结果。
 */
async function generateFromFont(
  win: BrowserWindow,
  options: BitmapFontOptions,
): Promise<BitmapFontResult> {
  const { taskId, sourcePath, outputDir, baseName, dataFormats } = options;
  if (!options.chars.trim()) throw new Error('未指定要生成的字符');
  if (!dataFormats.length) throw new Error('未选择描述文件格式');

  try {
    const input = await readFile(sourcePath);
    if (input.subarray(0, 4).toString('latin1') === 'ttcf') {
      throw new Error('不支持字体集合（.ttc/.otc），请先拆成单个字体');
    }
    const font = firstFont(input);

    // 阶段一：取路径与度量。3500 字约 190ms，一次推完即可（不逐字推，IPC 会被刷爆）
    sendProgress(win, { taskId, stage: 'render', done: 0, total: 1 });
    const built = buildFromFont(font, basename(sourcePath, extname(sourcePath)), options);
    sendProgress(win, { taskId, stage: 'render', done: 1, total: 1 });
    if (canceledTasks.has(taskId)) return canceledResult();

    // 阶段二：装箱已在 buildFromFont 里完成，这里只算 kerning（真正耗时的部分）
    sendProgress(win, { taskId, stage: 'pack', done: 0, total: 1 });
    const kernings =
      options.kerning && built.chars.length <= KERNING_CHAR_LIMIT
        ? extractKernings(
            font,
            built.chars.map((c) => String.fromCodePoint(c.id)),
            built.metrics.scale,
          )
        : [];
    sendProgress(win, { taskId, stage: 'pack', done: 1, total: 1 });
    if (canceledTasks.has(taskId)) return canceledResult();

    await mkdir(outputDir, { recursive: true });
    const multi = built.pages.length > 1;
    const pageFiles = built.pages.map((_p, i) =>
      multi ? `${baseName}_${i}.png` : `${baseName}.png`,
    );

    // 阶段三：逐页栅格化。整页一个 SVG，约 0.6s/页（3500 CJK）
    const files: { path: string; data: Buffer | string }[] = [];
    for (let i = 0; i < built.pages.length; i++) {
      if (canceledTasks.has(taskId)) return canceledResult();
      sendProgress(win, { taskId, stage: 'write', done: i, total: built.pages.length });
      const png = await renderGlyphPage(
        built.pages[i],
        built.pageSize,
        built.metrics.scale,
        options.fill,
        Math.max(0, options.outlineWidth),
        options.outlineColor,
      );
      files.push({ path: join(outputDir, pageFiles[i]), data: png });
    }
    sendProgress(win, {
      taskId,
      stage: 'write',
      done: built.pages.length,
      total: built.pages.length,
    });
    // 末页渲染期间收到的取消，循环里已经查不到了（下一轮不存在）。
    // 少了这一查，两页任务在第二页出图时点取消会照样落盘一整套。
    if (canceledTasks.has(taskId)) return canceledResult();

    const meta: BitmapFontMeta = {
      face: built.metrics.face,
      size: options.fontSize,
      lineHeight: built.metrics.lineHeight,
      base: built.metrics.base,
      pageSize: built.pageSize,
      pageFiles,
      spacing: options.spacing,
      outline: Math.max(0, options.outlineWidth),
    };
    const data = dataFiles(dataFormats, outputDir, baseName, meta, built.chars, kernings);
    files.push(...data);
    await writeAllAtomic(files);

    return {
      pagePaths: pageFiles.map((f) => join(outputDir, f)),
      dataPaths: data.map((f) => f.path),
      charCount: built.chars.length,
      missingChars: built.missingChars,
      kerningCount: kernings.length,
      pageSizes: built.pages.map(() => built.pageSize),
      skippedCount: 0,
    };
  } finally {
    canceledTasks.delete(taskId);
  }
}

/** 取消时的空结果。取消不是错误，页面据此把行退回 pending。 */
function canceledResult(): BitmapFontResult {
  return {
    pagePaths: [],
    dataPaths: [],
    charCount: 0,
    missingChars: '',
    kerningCount: 0,
    pageSizes: [],
    skippedCount: 0,
    canceled: true,
  };
}

/**
 * 生成预览（只算不写盘）。
 *
 * 与 `generateFromFont` 共用 `buildFromFont` + `renderGlyphPage`，保证所见即所得。
 * 不算 kerning（预览看不出来，白等）。
 * @param options 生成选项。
 * @returns 各页预览。
 */
async function previewFromFont(options: BitmapFontOptions): Promise<BitmapFontPreview> {
  if (!options.chars.trim()) throw new Error('未指定要生成的字符');
  const input = await readFile(options.sourcePath);
  if (input.subarray(0, 4).toString('latin1') === 'ttcf') {
    throw new Error('不支持字体集合（.ttc/.otc），请先拆成单个字体');
  }
  const font = firstFont(input);
  const built = buildFromFont(font, basename(options.sourcePath), options);

  const pages: BitmapFontPagePreview[] = [];
  for (const glyphs of built.pages) {
    const png = await renderGlyphPage(
      glyphs,
      built.pageSize,
      built.metrics.scale,
      options.fill,
      Math.max(0, options.outlineWidth),
      options.outlineColor,
    );
    pages.push({
      dataUrl: await toPreviewUrl(png, built.pageSize),
      width: built.pageSize.width,
      height: built.pageSize.height,
      charCount: glyphs.length,
    });
  }

  return {
    pages,
    charCount: built.chars.length,
    missingChars: built.missingChars,
    occupancy: built.occupancy,
  };
}

/* ── 图片 → 位图字体 ─────────────────────────────────────────────── */

/** 读入的字形图片。 */
interface GlyphImage {
  cp: number;
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * 把一组字符图片打包成位图字体。
 *
 * 与字体来源的差别只在度量来源：图片没有 ascent/descent，`lineHeight`/`base` 只能由
 * 用户给（面板上写清楚）；`xoffset`/`yoffset` 恒 0（图片就是最终摆放的样子），
 * `xadvance = 图片宽 + 补偿`。装箱与描述文件序列化完全复用同一套。
 * @param win 用于推进度的窗口。
 * @param options 打包选项。
 * @returns 生成结果。
 */
async function packImages(
  win: BrowserWindow,
  options: BitmapFontPackOptions,
): Promise<BitmapFontResult> {
  const { taskId, glyphs, outputDir, baseName, dataFormats } = options;
  if (!dataFormats.length) throw new Error('未选择描述文件格式');

  try {
    const images: GlyphImage[] = [];
    // 未指定字符的行：跳过并计数（用户可能只是还没填，不该整批失败）
    let skipped = glyphs.filter((g) => !g.char).length;
    const seen = new Set<number>();
    const total = glyphs.length;
    let done = 0;

    for (const g of glyphs) {
      if (canceledTasks.has(taskId)) return canceledResult();
      sendProgress(win, { taskId, stage: 'render', done, total });
      done += 1;
      if (!g.char) continue;
      const cp = g.char.codePointAt(0) as number;
      // 同一字符被指定给多张图：后来的丢弃，否则描述文件里会有重复 id
      if (seen.has(cp)) {
        skipped += 1;
        continue;
      }
      try {
        let buffer = await readFile(g.path);
        // trim 语义同精灵图：剔掉四周与四角同色（透明）的边。全透明/无边可裁时
        // sharp 会抛错，此时保持原图不阻断
        if (options.trim) {
          try {
            buffer = await sharp(buffer).trim().png().toBuffer();
          } catch {
            buffer = await sharp(await readFile(g.path))
              .png()
              .toBuffer();
          }
        }
        const meta = await sharp(buffer).metadata();
        const width = meta.width ?? 0;
        const height = meta.height ?? 0;
        if (width < 1 || height < 1) {
          skipped += 1;
          continue;
        }
        seen.add(cp);
        images.push({ cp, buffer, width, height });
      } catch {
        // 损坏或不支持的图直接跳过，不阻断整批
        skipped += 1;
      }
    }
    sendProgress(win, { taskId, stage: 'render', done: total, total });
    if (!images.length) throw new Error('没有可打包的字形图片（请为每张图指定字符）');
    if (canceledTasks.has(taskId)) return canceledResult();

    sendProgress(win, { taskId, stage: 'pack', done: 0, total: 1 });
    const packed = packShelf(
      images.map((im) => ({ width: im.width, height: im.height, sortKey: im.cp })),
      options.spacing,
      options.padding,
      options.pageSize,
    );
    sendProgress(win, { taskId, stage: 'pack', done: 1, total: 1 });

    const charEntries: BitmapFontChar[] = [];
    const pageComposites: { input: Buffer; left: number; top: number }[][] = Array.from(
      { length: packed.pageCount },
      () => [],
    );
    images.forEach((im, i) => {
      const slot = packed.slots[i];
      if (!slot) return;
      pageComposites[slot.page].push({ input: im.buffer, left: slot.x, top: slot.y });
      charEntries.push({
        id: im.cp,
        page: slot.page,
        x: slot.x,
        y: slot.y,
        width: im.width,
        height: im.height,
        xoffset: 0,
        yoffset: 0,
        xadvance: im.width + options.advanceAdjust,
      });
    });
    charEntries.sort((a, b) => a.id - b.id);

    await mkdir(outputDir, { recursive: true });
    const multi = pageComposites.length > 1;
    const pageFiles = pageComposites.map((_p, i) =>
      multi ? `${baseName}_${i}.png` : `${baseName}.png`,
    );

    const files: { path: string; data: Buffer | string }[] = [];
    for (let i = 0; i < pageComposites.length; i++) {
      if (canceledTasks.has(taskId)) return canceledResult();
      sendProgress(win, { taskId, stage: 'write', done: i, total: pageComposites.length });
      // 图片来源没有矢量路径，只能 composite（同精灵图合并；buffer 输入是 libvips 句柄铁律）
      const png = await sharp({
        create: {
          width: packed.pageSize.width,
          height: packed.pageSize.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(pageComposites[i])
        .png()
        .toBuffer();
      files.push({ path: join(outputDir, pageFiles[i]), data: png });
    }
    sendProgress(win, {
      taskId,
      stage: 'write',
      done: pageComposites.length,
      total: pageComposites.length,
    });
    // 同 generateFromFont：末页渲染期间的取消循环里查不到，这里补一次
    if (canceledTasks.has(taskId)) return canceledResult();

    const meta: BitmapFontMeta = {
      face: baseName,
      size: options.lineHeight,
      lineHeight: options.lineHeight,
      base: options.base,
      pageSize: packed.pageSize,
      pageFiles,
      spacing: options.spacing,
      outline: 0,
    };
    // 图片来源无字距信息
    const data = dataFiles(dataFormats, outputDir, baseName, meta, charEntries, []);
    files.push(...data);
    await writeAllAtomic(files);

    return {
      pagePaths: pageFiles.map((f) => join(outputDir, f)),
      dataPaths: data.map((f) => f.path),
      charCount: charEntries.length,
      // 图片来源不存在「字体缺字」这回事，跳过原因是没填字符/重复/解码失败，走 skippedCount
      missingChars: '',
      kerningCount: 0,
      pageSizes: pageFiles.map(() => packed.pageSize),
      skippedCount: skipped,
    };
  } finally {
    canceledTasks.delete(taskId);
  }
}

/* ── 注册 ─────────────────────────────────────────────────────────── */

/**
 * 注册位图字体相关 IPC。
 * @param win 主窗口，用于推生成进度。
 */
export function registerBitmapFontIpc(win: BrowserWindow): void {
  handle(BITMAP_FONT_CHANNELS.generate, (_e, options: BitmapFontOptions) =>
    generateFromFont(win, options),
  );
  handle(BITMAP_FONT_CHANNELS.preview, (_e, options: BitmapFontOptions) =>
    previewFromFont(options),
  );
  handle(BITMAP_FONT_CHANNELS.packImages, (_e, options: BitmapFontPackOptions) =>
    packImages(win, options),
  );
  handle(BITMAP_FONT_CHANNELS.cancel, (_e, taskId: string) => {
    canceledTasks.add(taskId);
    return true;
  });
}

/** 供验证脚本使用的内部导出（生产代码不引用）。 */
export const __test__ = {
  buildFromFont,
  extractKernings,
  firstFont,
  glyphRecord,
  packShelf,
  readFontMetrics,
  renderGlyphPage,
  serializeBitmapFont,
  uniqueChars,
  KERNING_CHAR_LIMIT,
};
