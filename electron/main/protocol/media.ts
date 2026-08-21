import { protocol } from 'electron';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { Readable } from 'stream';
import { extname } from 'path';

/**
 * `tb-media:` 自定义协议——让渲染进程能播放本地视频/音频文件。
 *
 * 为什么不能直接用 `file://`：
 * - 开发环境 renderer 跑在 `http://localhost`，Chromium 会拦掉所有 file:// 子资源；
 * - 打包后虽是 `file://`，仍受 CSP 与本地文件访问策略限制。
 *
 * 这个协议本质上是把本地文件读取能力重新暴露给渲染进程，所以**必须走白名单**：
 * 只有 video:probe 成功登记过的路径才服务，否则等于开了一个任意文件读取口子。
 */

/** 协议名。 */
const SCHEME = 'tb-media';

/** 允许播放的绝对路径白名单（规范化为小写以适配 Windows 大小写不敏感）。 */
const allowedPaths = new Set<string>();

/** 扩展名 → MIME，Chromium 靠它决定用哪个解封装器。 */
const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
};

/**
 * 规范化路径用于白名单比对。
 * @param filePath 绝对路径。
 * @returns 规范化后的键。
 */
function normalizeKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

/**
 * 把路径加入播放白名单。
 * @param filePath 绝对路径。
 */
export function allowMediaPath(filePath: string): void {
  allowedPaths.add(normalizeKey(filePath));
}

/**
 * 生成渲染进程可用的播放 URL。
 * @param filePath 绝对路径。
 * @returns tb-media URL。
 */
export function toMediaUrl(filePath: string): string {
  return `${SCHEME}://local/?path=${encodeURIComponent(filePath)}`;
}

/**
 * 注册特权协议。**必须在 `app.whenReady()` 之前调用**，ready 之后再注册无效。
 *
 * `stream: true` 是能返回流式响应（进而支持 Range）的前提；
 * `supportFetchAPI` 让 Chromium 走标准请求路径，Range 头才会带上来。
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/**
 * 解析 `Range: bytes=start-end` 头。
 *
 * 只处理单区间形式——`<video>` 只会发这一种。多区间（`bytes=0-9,20-29`）
 * 直接当作无 Range 处理，浏览器不会对媒体用它。
 * @param header Range 头原文。
 * @param size 文件总字节数。
 * @returns 起止字节（含端点）；无效或不需要时为 null。
 */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const matched = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!matched) return null;

  const [, rawStart, rawEnd] = matched;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-500` = 最后 500 字节
    const suffix = Number(rawEnd);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

/**
 * 注册协议处理器。在 `app.whenReady()` 之后调用。
 */
export function registerMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const filePath = url.searchParams.get('path');
    if (!filePath) return new Response('缺少 path 参数', { status: 400 });

    // 白名单是这个协议唯一的安全边界，别绕过它
    if (!allowedPaths.has(normalizeKey(filePath))) {
      return new Response('该文件未授权播放', { status: 403 });
    }

    let size = 0;
    try {
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) return new Response('不是文件', { status: 404 });
      size = fileStat.size;
    } catch {
      return new Response('文件不存在', { status: 404 });
    }

    const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    const range = parseRange(request.headers.get('Range'), size);

    // 不支持 Range 的话 Chromium 只能从头顺序播、**进度条拖不动**——
    // 而下一轮的时间剪切页全靠拖进度条选区间，所以这段现在就得做对。
    // 同时这也是大文件不被整个读进内存的原因：始终走流，不 readFile。
    if (!range) {
      const stream = createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
        },
      });
    }

    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  });
}
