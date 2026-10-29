import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import type { AiSkillCandidate } from '../../../shared/skills';

const MAX_FILES = 2000;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_DOWNLOAD = 30 * 1024 * 1024;
const IGNORED = new Set(['.git', 'node_modules', '__MACOSX', '.venv', 'venv', '__pycache__']);
export const MAX_SKILL_TEXT = 64 * 1024;

/** 拒绝跨平台路径穿越、Windows 特殊文件名和链接。 */
export function assertSkillPath(name: string): void {
  if (
    !name ||
    name.length > 240 ||
    name
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /[\\:\x00-\x1f<>"|?*]/.test(part) ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw new Error(`Skill 包含非法路径：${name}`);
}

/** 支持常见的 YAML 字符串和折行描述，其余元数据原样保留在 SKILL.md。 */
export function parseSkill(content: Buffer): {
  name: string;
  description: string;
  content: string;
} {
  if (content.length > MAX_SKILL_TEXT) throw new Error('SKILL.md 不能超过 64 KB');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(content).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('SKILL.md 必须使用 UTF-8 编码');
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) throw new Error('SKILL.md 需要以 YAML 元数据开头，包含 name 和 description');
  const lines = front[1].split(/\r?\n/);
  const field = (key: string): string => {
    const index = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (index < 0) return '';
    const raw = lines[index].slice(key.length + 1).trim();
    if (/^[>|][+-]?$/.test(raw)) {
      const block: string[] = [];
      for (const line of lines.slice(index + 1)) {
        if (line && !/^\s/.test(line)) break;
        block.push(line.trim());
      }
      return block.join(raw.startsWith('>') ? ' ' : '\n').trim();
    }
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        return JSON.parse(raw) as string;
      } catch {
        throw new Error(`${key} 的引号格式无效`);
      }
    }
    if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replace(/''/g, "'");
    return raw.replace(/\s+#.*$/, '').trim();
  };
  const name = field('name');
  const description = field('description');
  if (!name || name.length > 100 || /[\r\n\x00]/.test(name))
    throw new Error('Skill name 必须是 1–100 个字符的单行名称');
  if (!description || description.length > 2000)
    throw new Error('Skill description 必须是 1–2000 个字符');
  if (!text.slice(front[0].length).trim()) throw new Error('SKILL.md 缺少正文说明');
  return { name, description, content: text };
}

function collector(): { files: Map<string, Buffer>; add: (name: string, buffer: Buffer) => void } {
  const files = new Map<string, Buffer>();
  const folded = new Set<string>();
  let total = 0;
  return {
    files,
    add(name, buffer) {
      assertSkillPath(name);
      if (folded.has(name.toLowerCase())) throw new Error(`Skill 存在重复路径：${name}`);
      total += buffer.length;
      if (files.size >= MAX_FILES || buffer.length > MAX_FILE || total > MAX_TOTAL)
        throw new Error('Skill 包超过 2000 个文件、单文件 4 MB 或总计 20 MB 限制');
      folded.add(name.toLowerCase());
      files.set(name, buffer);
    },
  };
}

/** 本地导入使用文件快照；安装后不依赖原目录。 */
export async function readLocalSkills(source: string): Promise<Map<string, Buffer>> {
  const result = collector();
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Skill 源不能是符号链接');
  if (info.isFile()) {
    if (info.size > MAX_DOWNLOAD) throw new Error('Skill 文件超过 30 MB');
    if (/\.zip$/i.test(source)) return readSkillZip(await readFile(source));
    if (path.basename(source).toLowerCase() !== 'skill.md')
      throw new Error('请选择 SKILL.md、ZIP 文件或 Skill 目录');
    if (info.size > MAX_SKILL_TEXT) throw new Error('SKILL.md 不能超过 64 KB');
    result.add('SKILL.md', await readFile(source));
  } else if (info.isDirectory()) {
    let visited = 0;
    const walk = async (dir: string, prefix = '', depth = 0): Promise<void> => {
      if (depth > 20) throw new Error('Skill 目录层级超过 20');
      const entries = await readdir(dir, { withFileTypes: true });
      if (entries.length > MAX_FILES) throw new Error('Skill 目录条目过多');
      for (const entry of entries) {
        if (IGNORED.has(entry.name)) continue;
        if (++visited > MAX_FILES) throw new Error('Skill 目录条目超过 2000');
        const name = prefix + entry.name;
        assertSkillPath(name);
        const file = path.join(dir, entry.name);
        const stat = await lstat(file);
        if (stat.isSymbolicLink()) throw new Error(`Skill 不接受链接：${name}`);
        if (stat.isDirectory()) await walk(file, name + '/', depth + 1);
        else if (stat.isFile()) {
          if (stat.size > MAX_FILE) throw new Error(`Skill 文件超过 4 MB：${name}`);
          result.add(name, await readFile(file));
        } else throw new Error(`Skill 不支持特殊文件：${name}`);
      }
    };
    await walk(source);
  } else throw new Error('请选择文件或目录');
  return result.files;
}

/** ZIP 先在内存校验路径和解压大小，通过校验后才允许安装写盘。 */
export async function readSkillZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(buffer, { lazyEntries: true, strictFileNames: true }, (error, value) =>
      error || !value ? reject(error ?? new Error('ZIP 打开失败')) : resolve(value),
    ),
  );
  const result = collector();
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    let count = 0;
    const fail = (error: unknown): void => {
      zip.close();
      reject(error);
    };
    zip.on('error', fail);
    zip.on('end', resolve);
    zip.on('entry', (entry: Entry) => {
      void (async () => {
        if (++count > MAX_FILES) throw new Error('ZIP 条目超过 2000');
        const name = entry.fileName.replace(/\/$/, '');
        assertSkillPath(name);
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (mode && mode !== 0x8000 && mode !== 0x4000)
          throw new Error('Skill ZIP 不接受链接或特殊文件');
        if (entry.generalPurposeBitFlag & 1) throw new Error('Skill ZIP 不能加密');
        if (!entry.fileName.endsWith('/') && !name.split('/').some((part) => IGNORED.has(part))) {
          total += entry.uncompressedSize;
          if (entry.uncompressedSize > MAX_FILE || total > MAX_TOTAL)
            throw new Error('Skill ZIP 解压后超过单文件 4 MB / 总计 20 MB');
          const stream = await new Promise<NodeJS.ReadableStream>((yes, no) =>
            zip.openReadStream(entry, (error, value) =>
              error || !value ? no(error ?? new Error('ZIP 读取失败')) : yes(value),
            ),
          );
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of stream) {
            const data = Buffer.from(chunk);
            bytes += data.length;
            if (bytes > MAX_FILE || bytes > entry.uncompressedSize)
              throw new Error('Skill ZIP 文件大小与声明不符');
            chunks.push(data);
          }
          result.add(name, Buffer.concat(chunks));
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
  return result.files;
}

/** GitHub 仓库、tree/blob 链接下载整个目录的资源；普通链接接受 SKILL.md 或 ZIP。 */
export function skillDownloadTarget(source: string): { url: URL; prefix?: string } {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    throw new Error('请输入有效的 HTTPS 地址');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Skill 下载只支持不含用户名和密码的 HTTPS 地址');
  if (url.hostname === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [owner, repository, kind, ref, ...rest] = parts;
    if (!owner || !repository || (kind && !['tree', 'blob'].includes(kind)) || (kind && !ref))
      throw new Error('请输入 GitHub 仓库或 tree / blob 链接');
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repository))
      throw new Error('GitHub 仓库地址无效');
    let prefix = rest.join('/');
    if (kind === 'blob') {
      if (rest.at(-1)?.toLowerCase() !== 'skill.md')
        throw new Error('GitHub 文件链接必须指向 SKILL.md');
      prefix = rest.slice(0, -1).join('/');
    }
    if (prefix) assertSkillPath(prefix);
    url = new URL(
      `https://api.github.com/repos/${owner}/${repository.replace(/\.git$/, '')}/zipball${ref ? '/' + encodeURIComponent(ref) : ''}`,
    );
    return { url, prefix };
  }
  return { url };
}

export async function readOnlineSkills(
  source: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<Map<string, Buffer>> {
  const target = skillDownloadTarget(source);
  let url = target.url;
  const signal = AbortSignal.timeout(30000);
  for (let hop = 0; hop <= 5; hop++) {
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('Skill 下载重定向到了不支持的地址');
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': 'Toolbox-Skills', Accept: 'application/octet-stream' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('Skill 下载重定向缺少目标地址');
      url = new URL(next, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Skill 下载失败（HTTP ${response.status}）`);
    }
    if (!response.body) throw new Error('Skill 下载内容为空');
    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > MAX_DOWNLOAD) throw new Error('Skill 下载超过 30 MB');
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.subarray(0, 2).toString() !== 'PK') {
      parseSkill(buffer);
      return new Map([['SKILL.md', buffer]]);
    }
    const files = await readSkillZip(buffer);
    if (target.prefix !== undefined) {
      // GitHub zipball 给所有路径添加一个 owner-repo-commit 根目录。
      const selected = new Map<string, Buffer>();
      for (const [name, content] of files) {
        const relative = name.slice(name.indexOf('/') + 1);
        const prefix = target.prefix ? target.prefix + '/' : '';
        if (relative.startsWith(prefix)) selected.set(relative.slice(prefix.length), content);
      }
      return selected;
    }
    return files;
  }
  throw new Error('Skill 下载重定向超过 5 次');
}

/** 每个 SKILL.md 是一个可选安装项；允许导入整个 Skill 集合。 */
export function skillCandidates(files: Map<string, Buffer>): AiSkillCandidate[] {
  const candidates: AiSkillCandidate[] = [];
  for (const [name, buffer] of files) {
    if (path.posix.basename(name).toLowerCase() !== 'skill.md') continue;
    const prefix = name.slice(0, -path.posix.basename(name).length);
    const metadata = parseSkill(buffer);
    const fileCount = [...files.keys()].filter((file) => file.startsWith(prefix)).length;
    candidates.push({ path: name, ...metadata, fileCount });
  }
  if (!candidates.length) throw new Error('未找到 SKILL.md，请选择 Skill 目录或检查下载地址');
  if (candidates.length > 100) throw new Error('单次导入最多 100 个 Skill');
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}
