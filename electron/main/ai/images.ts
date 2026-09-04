/**
 * 对话图片的暂存：落到 `<dataDir>/ai/images/<hash>.jpg` 并降采样。
 *
 * 放**数据目录**不放缓存目录：图片是对话记录的一部分，放缓存会被设置页的「清空缓存」
 * 连聊天历史一起打断。
 *
 * 降采样参数（长边 1568 / JPEG q80）是**选定值不是实测值**——各家的尺寸与体积上限
 * 没有真 key 量不出来。原图直传会让 token 成本与失败率都不可控，所以宁可先压。
 * 统一转 JPEG 也是选择：JPEG 是各家都接受的格式，webp/avif 的支持面参差。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AiImageRef } from '../../shared/types';
import { dataPath } from '../storage/paths';

/** 降采样后的长边上限。 */
const MAX_EDGE = 1568;
/** JPEG 质量。 */
const QUALITY = 80;
/** 缩略图边长。 */
const THUMB_SIZE = 64;

/**
 * 图片存放目录。
 * @returns 绝对路径。
 */
export function imagesDir(): string {
  return dataPath('ai', 'images');
}

/**
 * 把来源读成 Buffer。
 *
 * **从路径时先整体读进内存再交给 sharp**：实测直接让 libvips 从路径读会长期持有文件
 * 句柄，Windows 上导致之后对同一文件的写入报 UNKNOWN、删除报 EBUSY（见 [[image-tools]]）。
 * @param source 文件绝对路径，或 `data:` URL（粘贴走这条）。
 * @returns 原始字节。
 */
async function readSource(source: string): Promise<Buffer> {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(source);
  if (match) {
    const [, , base64, payload] = match;
    return base64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
  }
  return readFile(source);
}

/**
 * 暂存一张图片：降采样 → 按内容哈希落盘 → 出缩略图。
 *
 * 同一张图片重复上传会命中同一个哈希文件名，天然去重。
 * @param source 文件绝对路径，或 `data:` URL。
 * @returns 图片引用。
 * @throws 不是图片 / 读不出尺寸时抛中文错误。
 */
export async function stageImage(source: string): Promise<AiImageRef> {
  const input = await readSource(source);

  let normalized: Buffer;
  let width = 0;
  let height = 0;
  try {
    const result = await sharp(input)
      // withoutEnlargement：小图不放大，放大只会白涨体积
      .rotate() // 按 EXIF 摆正，否则手机照片会躺着发给模型
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      // 透明区压到白底：JPEG 没有 alpha，不铺底会变成黑块
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: QUALITY })
      .toBuffer({ resolveWithObject: true });
    normalized = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`不是可识别的图片：${reason}`);
  }

  const id = createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  const dir = imagesDir();
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jpg`);
  await writeFile(filePath, normalized);

  const thumbnail = await sharp(normalized)
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
    .webp({ quality: 60 })
    .toBuffer();

  return {
    id,
    path: filePath,
    mediaType: 'image/jpeg',
    width,
    height,
    bytes: normalized.byteLength,
    thumbnailDataUrl: `data:image/webp;base64,${thumbnail.toString('base64')}`,
  };
}

/**
 * 删掉没有任何会话引用的图片文件。
 *
 * 用「保留集之外全删」而不是「删会话时逐个删」：会话可以被删、消息可以被清空、图片
 * 又是按内容去重共享的，逐个删极易漏，漏掉的就永远躺在数据目录里只涨不减。
 * @param keepIds 仍被引用的图片 id 集合。
 * @returns 删掉的文件数。
 */
export async function pruneImages(keepIds: Set<string>): Promise<number> {
  const dir = imagesDir();
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // 目录还不存在就没什么可清的
    return 0;
  }
  for (const entry of entries) {
    const id = path.basename(entry, path.extname(entry));
    if (keepIds.has(id)) continue;
    // 删不掉（比如正被别的进程占着）就跳过，下次保存时还会再试
    await unlink(path.join(dir, entry)).then(
      () => {
        removed += 1;
      },
      () => {},
    );
  }
  return removed;
}
