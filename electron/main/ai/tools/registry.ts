/**
 * 挂给 AI 的工具清单。
 *
 * **两条硬规则，加新工具前先读：**
 *
 * 1. **没有删除、没有 shell、没有网络抓取。** 破坏性最强的是 `rename_files`，而它是原地
 *    改名 + 整批 preflight（有冲突就一个文件都不碰）。工具集的上限是「模型最坏情况下能
 *    干出什么」，不是「模型多半会干什么」——提示注入是从被处理的文件内容里进来的。
 * 2. **工具返回值就是 token。** 每个 `run` 只回**精简且封顶**的结构：`list_files` 最多
 *    200 条（`scanDirectory` 单次能出 20 万条）、`read_text_file` 最多 64 KB。不封顶的
 *    话一次调用就能把上下文窗口吃光，而失败形式是「模型突然答得莫名其妙」，很难查。
 *
 * **底层能力一律直接调 `ipc/*.ts` 里的那些函数，不复制实现、不绕回 IPC**：那些函数里是
 * 实测换来的守卫（同路径覆盖检测、临时文件 + rename、Windows 非法名与保留设备名、
 * MAX_PATH、两趟改名、libvips 句柄），复制一份必然漏掉几条。进度参数一律传 `null`——
 * AI 窗口没有监听 `video:transcodeProgress` 那些通道，进度体现在卡片的状态上。
 *
 * **重的选项对象不给模型看。** `TranscodeOptions` 有 18 个必填字段、`AudioConvertOptions`
 * 15 个，原样喂给模型只会换来一堆瞎猜的值。schema 里只暴露几个真正常用的，其余由下面的
 * 适配层按界面上已经在用的那份默认值补齐。
 */
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import type {
  AudioCodec,
  AudioConvertOptions,
  AudioFormat,
  ImageOutputFormat,
  RenamePair,
  ScanResult,
  TranscodeOptions,
  VideoCodec,
  VideoOutputFormat,
} from '../../../shared/types';
import { probeAudio, probeVideo } from '../../ffmpeg/probe';
import { dirUsage } from '../../storage/dirs';
import { getPathsInfo } from '../../storage/paths';
import { renameBatch, scanDirectory, writeTextFile } from '../../ipc/file';
import { compressOne, probeImage } from '../../ipc/image';
import { transcodeOne } from '../../ipc/video';
import { convertOne } from '../../ipc/audio';
import { probeFont } from '../../ipc/font';
import { probeExcel } from '../../ipc/excel';
import { defineTool, type AnyToolDef } from './types';
import { untrackTask } from './tasks';

/** `list_files` 回给模型的条目上限。 */
const MAX_LIST_ENTRIES = 200;

/** `read_text_file` 回给模型的字节上限。 */
const MAX_TEXT_BYTES = 64 * 1024;

/** 默认跳过的目录名（与文件统计工具界面上那份一致）。 */
const IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  'out',
  '.cache',
  '.idea',
  '.vscode',
];

/** 视频容器 → 默认视频编码。 */
const VIDEO_CODEC: Record<Exclude<VideoOutputFormat, 'original'>, VideoCodec> = {
  mp4: 'libx264',
  mkv: 'libx264',
  webm: 'libvpx-vp9',
  // gif 不走视频编码器，给个合法值占位
  gif: 'libx264',
};

/** 音频容器 → 默认音频编码。 */
const AUDIO_CODEC: Record<Exclude<AudioFormat, 'original'>, AudioCodec> = {
  mp3: 'libmp3lame',
  m4a: 'aac',
  aac: 'aac',
  wav: 'pcm_s16le',
  flac: 'flac',
  ogg: 'libvorbis',
  opus: 'libopus',
};

/**
 * 把字节数说成人话。
 * @param bytes 字节数。
 * @returns 如 `1.2 MB`。
 */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

/**
 * 校验并算出写盘工具的输出目录。
 *
 * 不覆盖时**必须**给 `outputDir`：底层函数在 `overwrite:false` 且 outputDir 为空时会把
 * 文件写到进程当前工作目录去（打包后是个用户根本找不到的地方），这里先拦住。
 * @param outputDir 模型给的输出目录。
 * @param overwrite 是否覆盖原文件。
 * @returns 传给底层函数的 outputDir。
 */
function resolveOutputDir(outputDir: string | undefined, overwrite: boolean): string {
  if (overwrite) return '';
  const dir = outputDir?.trim();
  if (!dir) throw new Error('不覆盖原文件时必须给出 outputDir（绝对路径）');
  return dir;
}

/**
 * 把扫描结果压成能回给模型的形状。
 * @param scan 扫描结果。
 * @returns 封顶后的条目与汇总。
 */
function compactScan(scan: ScanResult): {
  root: string;
  total: number;
  dirCount: number;
  listed: number;
  truncated: boolean;
  entries: { path: string; size: number; ext: string }[];
} {
  const entries = scan.files.slice(0, MAX_LIST_ENTRIES).map((file) => ({
    path: join(scan.dirs[file.dirIndex] ?? scan.root, file.name),
    size: file.size,
    ext: file.ext,
  }));
  return {
    root: scan.root,
    total: scan.files.length,
    dirCount: scan.dirCount,
    listed: entries.length,
    // 两种截断都算：扫描自己撞上 20 万上限，或我们这里只回了前 200 条
    truncated: scan.truncated || entries.length < scan.files.length,
    entries,
  };
}

/** 只读工具：直接跑，不确认。 */
const READ_TOOLS: AnyToolDef[] = [
  defineTool({
    name: 'list_files',
    kind: 'read',
    description:
      '列出一个目录里的文件（递归）。可按扩展名过滤。默认跳过 node_modules/.git/dist 等目录。' +
      `最多返回 ${MAX_LIST_ENTRIES} 条，超出时 truncated 为 true、total 是真实总数。`,
    inputSchema: z.object({
      dir: z.string().describe('目录的绝对路径'),
      extensions: z
        .array(z.string())
        .optional()
        .describe('只要这些扩展名，不带点，如 ["png","jpg"]'),
      maxDepth: z.number().int().optional().describe('最大递归深度，0 表示只看当前目录'),
      includeHidden: z.boolean().optional().describe('是否包含隐藏文件，默认 true'),
    }),
    summarize: (input) =>
      `列出 ${input.dir}${input.extensions?.length ? `（${input.extensions.join('/')}）` : ''}`,
    run: async (input, ctx) => {
      const scan = await scanDirectory(null, {
        // 前缀避免与界面上的扫描撞 id（那边取消扫描是按 scanId 找的）
        scanId: `ai-tool-${ctx.requestId}`,
        root: input.dir,
        includeHidden: input.includeHidden ?? true,
        skipIgnoredDirs: true,
        ignoreDirs: IGNORE_DIRS,
        maxDepth: input.maxDepth,
        extensions: input.extensions,
      });
      const data = compactScan(scan);
      return {
        note: `${data.total} 个文件${data.truncated ? `（只回了前 ${data.listed} 条）` : ''}`,
        data,
      };
    },
  }),

  defineTool({
    name: 'probe_image',
    kind: 'read',
    description: '读一张图片的尺寸、格式、帧数与字节数。',
    inputSchema: z.object({ path: z.string().describe('图片的绝对路径') }),
    summarize: (input) => `读图片信息 ${basename(input.path)}`,
    run: async (input) => {
      const data = await probeImage(input.path);
      return {
        note: `${data.width}×${data.height} ${data.format} ${humanSize(data.bytes)}`,
        data,
      };
    },
  }),

  defineTool({
    name: 'probe_video',
    kind: 'read',
    description: '读一个视频的时长、容器、码率、分辨率、帧率与音轨信息。',
    inputSchema: z.object({ path: z.string().describe('视频的绝对路径') }),
    summarize: (input) => `读视频信息 ${basename(input.path)}`,
    run: async (input) => {
      const data = await probeVideo(input.path);
      const size = data.video ? `${data.video.width}×${data.video.height} ` : '';
      return { note: `${size}${data.duration.toFixed(1)}s ${humanSize(data.size)}`, data };
    },
  }),

  defineTool({
    name: 'probe_audio',
    kind: 'read',
    description: '读一个音频的时长、容器、编码、声道、采样率与码率。',
    inputSchema: z.object({ path: z.string().describe('音频的绝对路径') }),
    summarize: (input) => `读音频信息 ${basename(input.path)}`,
    run: async (input) => {
      const data = await probeAudio(input.path);
      return {
        note: `${data.codec} ${data.duration.toFixed(1)}s ${humanSize(data.size)}`,
        data,
      };
    },
  }),

  defineTool({
    name: 'probe_font',
    kind: 'read',
    description: '读一个字体文件的字体名、字形数与大小。',
    inputSchema: z.object({ path: z.string().describe('字体的绝对路径') }),
    summarize: (input) => `读字体信息 ${basename(input.path)}`,
    run: async (input) => {
      const data = await probeFont(input.path);
      return { note: `${data.familyName} ${data.glyphCount} 个字形`, data };
    },
  }),

  defineTool({
    name: 'probe_excel',
    kind: 'read',
    description: '读一个 Excel/CSV 的工作表结构：每个 sheet 的名字、行列数与表头文字。',
    inputSchema: z.object({
      path: z.string().describe('表格的绝对路径'),
      headerRow: z.number().int().optional().describe('表头在第几行，1 起，默认 1'),
    }),
    summarize: (input) => `读表格结构 ${basename(input.path)}`,
    run: async (input) => {
      const data = await probeExcel(input.path, input.headerRow ?? 1);
      const names = data.sheets.map((sheet) => sheet.name).join('、');
      return { note: `${data.sheets.length} 个工作表：${names}`, data };
    },
  }),

  defineTool({
    name: 'read_text_file',
    kind: 'read',
    description:
      '读一个文本文件的内容（UTF-8）。' +
      `最多 ${MAX_TEXT_BYTES / 1024} KB，超出会截断并把 truncated 置为 true。`,
    inputSchema: z.object({ path: z.string().describe('文件的绝对路径') }),
    summarize: (input) => `读文本 ${basename(input.path)}`,
    run: async (input) => {
      const buffer = await readFile(input.path);
      const truncated = buffer.length > MAX_TEXT_BYTES;
      // 按字节截断可能切断一个多字节字符，末尾的乱码不值得为它多绕一圈，如实标注即可
      const content = buffer.subarray(0, MAX_TEXT_BYTES).toString('utf-8');
      return {
        note: truncated
          ? `读了前 ${MAX_TEXT_BYTES / 1024} KB（共 ${humanSize(buffer.length)}）`
          : humanSize(buffer.length),
        data: { path: input.path, bytes: buffer.length, truncated, content },
      };
    },
  }),

  defineTool({
    name: 'storage_info',
    kind: 'read',
    description: '查工具箱自己的数据目录与缓存目录在哪、各占多少空间。',
    inputSchema: z.object({}),
    summarize: () => '查数据目录与缓存占用',
    run: async () => {
      const info = getPathsInfo();
      const [data, cache] = await Promise.all([
        dirUsage(info.dataDir).catch(() => ({ bytes: 0, files: 0 })),
        dirUsage(info.cacheDir).catch(() => ({ bytes: 0, files: 0 })),
      ]);
      return {
        note: `数据 ${humanSize(data.bytes)} / 缓存 ${humanSize(cache.bytes)}`,
        data: {
          dataDir: info.dataDir,
          cacheDir: info.cacheDir,
          portable: info.portable,
          dataUsage: data,
          cacheUsage: cache,
        },
      };
    },
  }),
];

/** 写盘工具：`ask` 模式逐次确认，`auto` 模式只在 `forceConfirm` 时确认。 */
const WRITE_TOOLS: AnyToolDef[] = [
  defineTool({
    name: 'compress_images',
    kind: 'write',
    description:
      '压缩或转换图片格式（一批）。format 省略时保持原格式。overwrite 为 true 时写回原目录并删掉旧格式副本。',
    inputSchema: z.object({
      paths: z.array(z.string()).min(1).describe('图片绝对路径列表'),
      format: z
        .enum(['original', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])
        .optional()
        .describe('输出格式，默认 original（保持原格式）'),
      quality: z.number().int().min(1).max(100).optional().describe('质量 1-100，默认 80'),
      maxWidth: z.number().int().optional().describe('最大宽度，超出才等比缩小；0 或省略为不缩放'),
      outputDir: z.string().optional().describe('输出目录绝对路径；overwrite 为 true 时不用给'),
      overwrite: z.boolean().optional().describe('是否覆盖原文件，默认 false'),
    }),
    summarize: (input) => {
      const target = input.format && input.format !== 'original' ? ` → ${input.format}` : '';
      const where = input.overwrite ? '覆盖原文件' : `输出到 ${input.outputDir}`;
      return `压缩 ${input.paths.length} 张图片${target}（${where}）`;
    },
    forceConfirm: (input) => input.overwrite === true,
    run: async (input) => {
      const overwrite = input.overwrite === true;
      const outputDir = resolveOutputDir(input.outputDir, overwrite);
      const results: { path: string; before: number; after: number; ratio: number }[] = [];
      let saved = 0;
      // 串行：sharp 吃满 CPU，并发只会互相抢
      for (const path of input.paths) {
        const result = await compressOne(path, {
          format: (input.format ?? 'original') as ImageOutputFormat,
          quality: input.quality ?? 80,
          maxWidth: input.maxWidth,
          outputDir,
          overwrite,
        });
        saved += result.originalSize - result.compressedSize;
        results.push({
          path: result.outputPath,
          before: result.originalSize,
          after: result.compressedSize,
          ratio: result.ratio,
        });
      }
      return {
        note: `${results.length} 张，省下 ${humanSize(Math.max(saved, 0))}`,
        data: { count: results.length, savedBytes: saved, files: results },
      };
    },
  }),

  defineTool({
    name: 'convert_video',
    kind: 'write',
    description:
      '转码一个视频（格式 / 分辨率 / 质量）。crf 越小越清晰体积越大，23 是常用值。maxHeight 只缩小不放大。',
    inputSchema: z.object({
      path: z.string().describe('源视频绝对路径'),
      format: z
        .enum(['mp4', 'webm', 'mkv', 'gif'])
        .optional()
        .describe('输出容器，默认 mp4；gif 会转成动图'),
      maxHeight: z.number().int().optional().describe('最大高度（如 720），0 或省略为不缩放'),
      crf: z.number().int().min(0).max(51).optional().describe('质量 0-51，默认 23'),
      outputDir: z.string().optional().describe('输出目录绝对路径；overwrite 为 true 时不用给'),
      overwrite: z.boolean().optional().describe('是否覆盖原文件，默认 false'),
    }),
    summarize: (input) => {
      const size = input.maxHeight ? ` ${input.maxHeight}p` : '';
      const where = input.overwrite ? '覆盖原文件' : `输出到 ${input.outputDir}`;
      return `转码 ${basename(input.path)} → ${input.format ?? 'mp4'}${size}（${where}）`;
    },
    forceConfirm: (input) => input.overwrite === true,
    run: async (input, ctx) => {
      const overwrite = input.overwrite === true;
      const outputDir = resolveOutputDir(input.outputDir, overwrite);
      const format = input.format ?? 'mp4';
      const taskId = `ai-${ctx.requestId}-${Date.now()}`;
      ctx.trackTask(taskId);

      // 其余 14 个字段照抄界面上的默认值，不让模型猜
      const options: TranscodeOptions = {
        taskId,
        format,
        codec: VIDEO_CODEC[format],
        qualityMode: 'quality',
        crf: input.crf ?? 23,
        videoBitrate: 2000,
        targetSizeMb: 20,
        maxHeight: input.maxHeight ?? 0,
        maxFps: 0,
        audioMode: 'encode',
        audioBitrate: 128,
        gifFps: 12,
        gifWidth: 480,
        outputDir,
        overwrite,
      };
      try {
        const result = await transcodeOne(null, input.path, options);
        if (result.canceled) {
          return { note: '已取消', data: { canceled: true } };
        }
        return {
          note: `${basename(result.outputPath)} ${humanSize(result.outputSize)}（${result.ratio}%）`,
          data: {
            path: result.outputPath,
            before: result.originalSize,
            after: result.outputSize,
            ratio: result.ratio,
          },
        };
      } finally {
        untrackTask(ctx.requestId, taskId);
      }
    },
  }),

  defineTool({
    name: 'convert_audio',
    kind: 'write',
    description: '转码一个音频（格式 / 码率）。wav 与 flac 是无损，bitrate 对它们无意义。',
    inputSchema: z.object({
      path: z.string().describe('源音频绝对路径'),
      format: z
        .enum(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus'])
        .optional()
        .describe('输出格式，默认 mp3'),
      bitrate: z.number().int().optional().describe('码率 kbps，默认 192（仅有损格式有效）'),
      outputDir: z.string().optional().describe('输出目录绝对路径；overwrite 为 true 时不用给'),
      overwrite: z.boolean().optional().describe('是否覆盖原文件，默认 false'),
    }),
    summarize: (input) => {
      const where = input.overwrite ? '覆盖原文件' : `输出到 ${input.outputDir}`;
      return `转码 ${basename(input.path)} → ${input.format ?? 'mp3'}（${where}）`;
    },
    forceConfirm: (input) => input.overwrite === true,
    run: async (input, ctx) => {
      const overwrite = input.overwrite === true;
      const outputDir = resolveOutputDir(input.outputDir, overwrite);
      const format = input.format ?? 'mp3';
      const taskId = `ai-${ctx.requestId}-${Date.now()}`;
      ctx.trackTask(taskId);

      const options: AudioConvertOptions = {
        taskId,
        format,
        codec: AUDIO_CODEC[format],
        rateMode: format === 'wav' || format === 'flac' ? 'lossless' : 'cbr',
        bitrate: input.bitrate ?? 192,
        quality: 4,
        compressionLevel: 5,
        channels: 0,
        sampleRate: 0,
        volumeDb: 0,
        loudnessTarget: null,
        fadeIn: 0,
        fadeOut: 0,
        keepMetadata: true,
        outputDir,
        overwrite,
      };
      try {
        const result = await convertOne(null, input.path, options);
        if (result.canceled) {
          return { note: '已取消', data: { canceled: true } };
        }
        return {
          note: `${basename(result.outputPath)} ${humanSize(result.outputSize)}`,
          data: {
            path: result.outputPath,
            before: result.originalSize,
            after: result.outputSize,
            duration: result.duration,
          },
        };
      } finally {
        untrackTask(ctx.requestId, taskId);
      }
    },
  }),

  defineTool({
    name: 'rename_files',
    kind: 'write',
    description:
      '批量重命名（原地，不跨目录）。newName 只能是文件名不能带路径分隔符。' +
      '有任何一项冲突或非法时整批都不执行，并把原因回给你。',
    inputSchema: z.object({
      renames: z
        .array(
          z.object({
            path: z.string().describe('文件当前的绝对路径'),
            newName: z.string().describe('新文件名，含扩展名，不带目录'),
          }),
        )
        .min(1),
    }),
    summarize: (input) => {
      const first = input.renames[0];
      const rest = input.renames.length > 1 ? ` 等 ${input.renames.length} 个` : '';
      return `重命名 ${basename(first.path)} → ${first.newName}${rest}`;
    },
    // 改名是原地改动、没有输出副本可以对照，**任何模式下都问一次**
    forceConfirm: () => true,
    run: async (input) => {
      const result = await renameBatch(input.renames as RenamePair[]);
      if (result.conflicts.length > 0) {
        const reasons = result.conflicts
          .slice(0, 10)
          .map((item) => `${basename(item.path)}：${item.reason}`);
        return {
          note: `有 ${result.conflicts.length} 项冲突，整批未执行`,
          data: { done: 0, conflicts: reasons, executed: false },
        };
      }
      return {
        note: `改名 ${result.done.length} 个${result.failures.length ? `，失败 ${result.failures.length} 个` : ''}`,
        data: {
          done: result.done.length,
          failures: result.failures.slice(0, 10).map((item) => item.reason),
          executed: true,
        },
      };
    },
  }),

  defineTool({
    name: 'write_text_file',
    kind: 'write',
    description:
      '把文本写到一个文件（UTF-8），缺失的父目录会自动建。' +
      'overwrite 为 false 时目标已存在会直接报错，不会悄悄覆盖。',
    inputSchema: z.object({
      path: z.string().describe('目标文件绝对路径'),
      content: z.string().describe('文件内容'),
      overwrite: z.boolean().optional().describe('目标已存在时是否覆盖，默认 false'),
    }),
    summarize: (input) =>
      `写入 ${basename(input.path)}（${humanSize(Buffer.byteLength(input.content, 'utf-8'))}，${
        input.overwrite ? '允许覆盖' : '不覆盖'
      }）到 ${dirname(input.path)}`,
    forceConfirm: (input) => input.overwrite === true,
    run: async (input) => {
      const result = await writeTextFile(input.path, input.content, input.overwrite === true);
      return { note: `已写入 ${humanSize(result.bytes)}`, data: result };
    },
  }),
];

/** 全部工具。 */
export const TOOLS: AnyToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS];
