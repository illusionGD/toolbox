import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  AiSkill,
  AiSkillDetail,
  AiSkillLibrary,
  AiSkillPreview,
} from '../../../shared/skills';
import { dataPath, getSoftwareDir, setWriteSuspender } from '../../storage/paths';
import {
  assertSkillPath,
  MAX_SKILL_TEXT,
  parseSkill,
  readLocalSkills,
  readOnlineSkills,
  skillCandidates,
} from './package';

const folderSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((folder) => {
    try {
      assertSkillPath(folder);
      return !folder.includes('/') && !folder.startsWith('.');
    } catch {
      return false;
    }
  }, 'Skill 文件夹名称无效');
const recordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(2000),
  enabled: z.boolean(),
  source: z.string().max(4096),
  installedAt: z.number(),
  fileCount: z.number().int().min(1).max(2000),
  folder: folderSchema.optional(),
});
interface StagedSkills {
  owner: number;
  expires: number;
  files: Map<string, Buffer>;
  preview: AiSkillPreview;
}
const staged = new Map<string, StagedSkills>();
let queue: Promise<unknown> = Promise.resolve();
let migration: Promise<void> | undefined;
let finishMigration: (() => void) | undefined;

/** 文件操作共用事务队列，启用状态跟随数据目录迁移；Skill 文件固定在软件目录。 */
function transaction<T>(operation: () => Promise<T>): Promise<T> {
  if (migration) return migration.then(() => transaction(operation));
  const pending = queue.then(operation);
  queue = pending.catch(() => {});
  return pending;
}
setWriteSuspender({
  suspend() {
    migration = new Promise((resolve) => {
      finishMigration = resolve;
    });
    return queue.then(() => {});
  },
  resume() {
    migration = undefined;
    finishMigration?.();
    finishMigration = undefined;
  },
});

/** 下载、导入及用户手动放入的 Skill 共用这个固定目录。 */
export function skillsDirectory(): string {
  return path.join(getSoftwareDir(), 'skills');
}
async function ensureSkillsDirectory(): Promise<string> {
  const directory = skillsDirectory();
  await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('skills 文件夹不能是链接或普通文件');
  return directory;
}
export function ensureSkillLibraryDirectory(): Promise<string> {
  return transaction(ensureSkillsDirectory);
}
function recordRoot(id: string): string {
  return dataPath('ai', 'skills', z.string().uuid().parse(id));
}
function folderPath(folder: string): string {
  return path.join(skillsDirectory(), folderSchema.parse(folder));
}
async function persistRecord(skill: AiSkill): Promise<void> {
  const root = recordRoot(skill.id);
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Skill 状态目录不能是链接');
  const file = path.join(root, 'record.json');
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(skill), { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await rm(temp, { force: true });
  }
}

async function storedRecords(): Promise<AiSkill[]> {
  const root = dataPath('ai', 'skills');
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  const records: AiSkill[] = [];
  for (const entry of entries) {
    if (!z.string().uuid().safeParse(entry.name).success) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Skill 状态目录包含链接或异常文件');
    const file = path.join(root, entry.name, 'record.json');
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024)
      throw new Error('Skill 安装记录无效');
    const skill = recordSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    if (skill.id !== entry.name) throw new Error('Skill 安装记录与目录不一致');
    records.push(skill);
  }
  return records;
}

/** 使用人能识别的名称，不覆盖用户已放入的文件夹。 */
async function unusedFolder(name: string, id: string): Promise<string> {
  let base = name
    .replace(/[\\/:\x00-\x1f<>"|?*]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 70);
  if (!folderSchema.safeParse(base).success) base = 'skill';
  for (let attempt = 0; attempt < 100; attempt++) {
    const folder = attempt ? `${base}-${id.slice(0, 8)}${attempt > 1 ? '-' + attempt : ''}` : base;
    const exists = await lstat(folderPath(folder))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    if (!exists) return folder;
  }
  throw new Error('无法分配 Skill 文件夹名称');
}

async function writeSkillFiles(folder: string, files: Map<string, Buffer>): Promise<void> {
  const destination = folderPath(folder);
  const temp = path.join(skillsDirectory(), `.installing-${randomUUID()}`);
  try {
    for (const [name, buffer] of files) {
      const relative = name.toLowerCase() === 'skill.md' ? 'SKILL.md' : name;
      assertSkillPath(relative);
      const target = path.join(temp, ...relative.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer, { flag: 'wx' });
    }
    const exists = await lstat(destination)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false;
        throw error;
      });
    if (exists) throw new Error(`Skill 文件夹已存在：${folder}`);
    await rename(temp, destination);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

/** 兼容上一版的数据目录包：校验后复制，状态保存成功后才清除原包。 */
async function migrateLegacy(skill: AiSkill): Promise<AiSkill> {
  if (skill.folder) return skill;
  const legacy = path.join(recordRoot(skill.id), 'package');
  const files = await readLocalSkills(legacy);
  parseSkill(files.get('SKILL.md') ?? Buffer.alloc(0));
  const folder = await unusedFolder(skill.name, skill.id);
  await writeSkillFiles(folder, files);
  const updated = { ...skill, folder };
  try {
    await persistRecord(updated);
  } catch (error) {
    await rm(folderPath(folder), { recursive: true, force: true });
    throw error;
  }
  await rm(legacy, { recursive: true, force: true }).catch(() => {});
  return updated;
}

/** 不读取大资源文件，只校验大小和路径；说明及资源内容在使用时读取。 */
async function directoryDetail(skill: AiSkill): Promise<AiSkillDetail> {
  const root = folderPath(skill.folder!);
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Skill 文件夹不能是链接');
  const entries = await readdir(root, { withFileTypes: true });
  const instructions = entries.find((entry) => entry.name.toLowerCase() === 'skill.md');
  if (!instructions) throw new Error('Skill 文件夹缺少 SKILL.md');
  const instructionFile = path.join(root, instructions.name);
  const info = await lstat(instructionFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SKILL_TEXT)
    throw new Error('SKILL.md 无效或超过 64 KB');
  const metadata = parseSkill(await readFile(instructionFile));
  const files: string[] = [];
  let visited = 0;
  let bytes = 0;
  const walk = async (directory: string, prefix = '', depth = 0): Promise<void> => {
    if (depth > 20) throw new Error('Skill 目录层级过深');
    const children = await readdir(directory, { withFileTypes: true });
    if (children.length > 2000) throw new Error('Skill 目录条目过多');
    for (const entry of children) {
      if (['.git', 'node_modules', '__MACOSX', '.venv', 'venv', '__pycache__'].includes(entry.name))
        continue;
      if (++visited > 2000) throw new Error('Skill 条目超过 2000');
      const name = prefix + entry.name;
      assertSkillPath(name);
      const file = path.join(directory, entry.name);
      const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error(`Skill 包含链接：${name}`);
      if (stat.isDirectory()) await walk(file, name + '/', depth + 1);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (stat.size > 4 * 1024 * 1024 || bytes > 20 * 1024 * 1024)
          throw new Error('Skill 文件超过单文件 4 MB / 总计 20 MB');
        files.push(name);
      } else throw new Error('Skill 包含特殊文件');
    }
  };
  await walk(root);
  return {
    skill: {
      ...skill,
      name: metadata.name,
      description: metadata.description,
      fileCount: files.length,
    },
    content: metadata.content,
    files: files.sort(),
  };
}

/** 每次刷新和发送对话时扫描固定目录；新增、修改、移除即时反映在列表中。 */
async function scanLibrary(): Promise<{
  directory: string;
  details: AiSkillDetail[];
  warnings: string[];
}> {
  const directory = await ensureSkillsDirectory();
  const stored = await storedRecords();
  const records: AiSkill[] = [];
  const warnings: string[] = [];
  for (const record of stored) {
    try {
      if (record.folder) {
        const exists = await lstat(folderPath(record.folder))
          .then(() => true)
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          });
        if (!exists) {
          await rm(recordRoot(record.id), { recursive: true, force: true });
          continue;
        }
      }
      records.push(await migrateLegacy(record));
    } catch (error) {
      warnings.push(`Skill「${record.name}」迁移失败：${describe(error)}`);
    }
  }
  const details: AiSkillDetail[] = [];
  const names = new Set<string>();
  const folders = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of folders) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) {
      warnings.push(`Skill 文件夹不能是链接：${entry.name}`);
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!folderSchema.safeParse(entry.name).success) {
      warnings.push(`Skill 文件夹名称无效：${entry.name}`);
      continue;
    }
    const previous = records.find((s) => s.folder?.toLowerCase() === entry.name.toLowerCase());
    const skill: AiSkill = previous ?? {
      id: randomUUID(),
      folder: entry.name,
      name: entry.name,
      description: '',
      enabled: false,
      source: folderPath(entry.name),
      installedAt: Date.now(),
      fileCount: 0,
    };
    try {
      const item = await directoryDetail(skill);
      if (names.has(item.skill.name.toLowerCase()))
        throw new Error(`已存在同名 Skill「${item.skill.name}」`);
      if (details.length >= 100) throw new Error('最多加载 100 个 Skill');
      if (!previous || JSON.stringify(previous) !== JSON.stringify(item.skill))
        await persistRecord(item.skill);
      names.add(item.skill.name.toLowerCase());
      details.push(item);
    } catch (error) {
      warnings.push(`Skill「${entry.name}」读取失败：${describe(error)}`);
    }
  }
  return { directory, details, warnings };
}
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
async function records(): Promise<AiSkill[]> {
  return (await scanLibrary()).details
    .map((item) => item.skill)
    .sort((a, b) => b.installedAt - a.installedAt);
}
export function listSkills(): Promise<AiSkill[]> {
  return transaction(records);
}
export function skillLibrary(): Promise<AiSkillLibrary> {
  return transaction(async () => {
    const result = await scanLibrary();
    return {
      directory: result.directory,
      skills: result.details
        .map((item) => item.skill)
        .sort((a, b) => b.installedAt - a.installedAt),
      warnings: result.warnings,
    };
  });
}

function reapPreviews(): void {
  for (const [token, value] of staged) if (value.expires < Date.now()) staged.delete(token);
}
export function stageSkills(
  owner: number,
  source: string,
  files: Map<string, Buffer>,
): AiSkillPreview {
  reapPreviews();
  if (staged.size >= 3) throw new Error('请先关闭其他 Skill 安装预览');
  const preview: AiSkillPreview = {
    token: randomUUID(),
    source,
    candidates: skillCandidates(files),
  };
  staged.set(preview.token, { owner, files, preview, expires: Date.now() + 10 * 60 * 1000 });
  return preview;
}
export async function previewLocalSkills(owner: number, source: string): Promise<AiSkillPreview> {
  return stageSkills(owner, source, await readLocalSkills(source));
}
export async function previewOnlineSkills(owner: number, source: string): Promise<AiSkillPreview> {
  const url = z.string().trim().min(1).max(4096).parse(source);
  return stageSkills(owner, url, await readOnlineSkills(url));
}
export function discardSkillPreview(owner: number, token?: string): void {
  for (const [key, value] of staged)
    if (value.owner === owner && (!token || key === token)) staged.delete(key);
}

/** 下载和本地导入均写入软件 skills/<名称>，失败回滚本次新增目录。 */
export function installSkills(
  owner: number,
  token: string,
  selected: string[],
): Promise<AiSkill[]> {
  return transaction(async () => {
    reapPreviews();
    const candidate = staged.get(z.string().uuid().parse(token));
    if (!candidate || candidate.owner !== owner)
      throw new Error('Skill 预览已过期，请重新选择来源');
    const paths = z.array(z.string()).min(1).max(100).parse(selected);
    if (new Set(paths).size !== paths.length) throw new Error('安装选择存在重复项');
    const chosen = paths.map((item) => {
      const value = candidate.preview.candidates.find((c) => c.path === item);
      if (!value) throw new Error('安装项不属于当前 Skill 预览');
      return value;
    });
    const installed = await records();
    if (installed.length + chosen.length > 100) throw new Error('最多安装 100 个 Skill');
    const names = new Set(installed.map((s) => s.name.toLowerCase()));
    for (const item of chosen) {
      if (names.has(item.name.toLowerCase()))
        throw new Error(`已存在同名 Skill「${item.name}」，请先删除旧版本`);
      names.add(item.name.toLowerCase());
    }
    const created: string[] = [];
    const result: AiSkill[] = [];
    try {
      for (const item of chosen) {
        const id = randomUUID();
        const folder = await unusedFolder(item.name, id);
        const prefix = item.path.slice(0, -path.posix.basename(item.path).length);
        const files = new Map(
          [...candidate.files]
            .filter(([name]) => name.startsWith(prefix))
            .map(([name, buffer]) => [name.slice(prefix.length), buffer]),
        );
        await writeSkillFiles(folder, files);
        created.push(folderPath(folder), recordRoot(id));
        const skill: AiSkill = {
          id,
          folder,
          name: item.name,
          description: item.description,
          enabled: false,
          source: candidate.preview.source,
          installedAt: Date.now(),
          fileCount: files.size,
        };
        await persistRecord(skill);
        result.push(skill);
      }
      staged.delete(token);
      return result;
    } catch (error) {
      for (const directory of created) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  });
}

async function requireSkill(id: string): Promise<AiSkill> {
  z.string().uuid().parse(id);
  const skill = (await records()).find((s) => s.id === id);
  if (!skill) throw new Error('Skill 不存在或文件无效');
  return skill;
}
export function skillDetail(id: string): Promise<AiSkillDetail> {
  return transaction(async () => directoryDetail(await requireSkill(id)));
}
export function setSkillEnabled(id: string, enabled: boolean): Promise<AiSkill> {
  return transaction(async () => {
    const skill = await requireSkill(id);
    z.boolean().parse(enabled);
    if (enabled && (await records()).filter((s) => s.enabled && s.id !== id).length >= 32)
      throw new Error('同时最多启用 32 个 Skill');
    const updated = { ...skill, enabled };
    await persistRecord(updated);
    return updated;
  });
}
export function removeSkill(id: string): Promise<void> {
  return transaction(async () => {
    const skill = await requireSkill(id);
    // folderPath 只接受单级合法文件夹名；不会删除 skills 根目录或目录外的文件。
    await rm(folderPath(skill.folder!), { recursive: true, force: true });
    await rm(recordRoot(id), { recursive: true, force: true });
  });
}
export function enabledSkillDetails(): Promise<{ skills: AiSkillDetail[]; warnings: string[] }> {
  return transaction(async () => {
    const result = await scanLibrary();
    return {
      skills: result.details.filter((item) => item.skill.enabled).slice(0, 32),
      warnings: result.warnings,
    };
  });
}

/** 执行前验证入口文件，Python 工作目录始终为该 Skill 目录。 */
export function resolveSkillScript(
  id: string,
  script: string,
): Promise<{ cwd: string; script: string }> {
  return transaction(async () => {
    const skill = await requireSkill(id);
    if (!skill.enabled) throw new Error('Skill 已停用');
    assertSkillPath(script);
    if (path.posix.extname(script).toLowerCase() !== '.py')
      throw new Error('只支持运行 Skill 内的 .py 脚本');
    const detail = await directoryDetail(skill);
    if (!detail.files.includes(script)) throw new Error('脚本不在该 Skill 的文件清单中');
    let target = skillsDirectory();
    for (const part of ['', skill.folder!, ...script.split('/')]) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Skill 脚本路径不能是链接');
    }
    return { cwd: folderPath(skill.folder!), script: target };
  });
}
export function readSkillResource(
  id: string,
  file: string,
): Promise<{ content: string; truncated: boolean }> {
  return transaction(async () => {
    const skill = await requireSkill(id);
    if (!skill.enabled) throw new Error('Skill 已停用');
    assertSkillPath(file);
    const root = folderPath(skill.folder!);
    // SKILL.md 大小写兼容；附带资料仍使用清单中的原路径。
    if (file.toLowerCase() === 'skill.md')
      file = (await readdir(root)).find((name) => name.toLowerCase() === 'skill.md') ?? file;
    let target = skillsDirectory();
    for (const part of ['', skill.folder!, ...file.split('/')]) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Skill 路径不能是链接');
    }
    const info = await lstat(target);
    if (!info.isFile() || info.size > 4 * 1024 * 1024)
      throw new Error('Skill 资料不是文件或超过 4 MB');
    const buffer = await readFile(target);
    if (buffer.includes(0)) throw new Error('该 Skill 资料为二进制文件，请选择文本资料');
    return {
      content: buffer.subarray(0, MAX_SKILL_TEXT).toString('utf8'),
      truncated: buffer.length > MAX_SKILL_TEXT,
    };
  });
}
