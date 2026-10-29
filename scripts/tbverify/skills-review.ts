import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import type { AiChatRequest, AiConfig, AiStreamEvent } from '../../electron/shared/types';
import {
  dataPath,
  changeDataDir,
  getDataDir,
  getSoftwareDir,
  initStoragePaths,
} from '../../electron/main/storage/paths';
import {
  assertSkillPath,
  parseSkill,
  readLocalSkills,
  readOnlineSkills,
  readSkillZip,
  skillCandidates,
  skillDownloadTarget,
} from '../../electron/main/ai/skills/package';
import {
  discardSkillPreview,
  installSkills,
  listSkills,
  previewLocalSkills,
  readSkillResource,
  removeSkill,
  setSkillEnabled,
  skillDetail,
  stageSkills,
  skillLibrary,
  skillsDirectory,
} from '../../electron/main/ai/skills/registry';
import { buildSkillContext } from '../../electron/main/ai/skills/context';
import { runChat } from '../../electron/main/ai/chat';
import { app } from './stub-electron';

let groups = 0;
function passed(name: string): void {
  console.log(`OK ${++groups}. ${name}`);
}
function markdown(
  name: string,
  body = 'Read references/guide.md, then return the result.',
): Buffer {
  return Buffer.from(
    `---\nname: ${name}\ndescription: >\n  A writing skill\n  for technical documents.\n---\n\n${body}\n`,
  );
}
const root = await mkdtemp(path.join(tmpdir(), 'tbverify-skills-'));
Object.assign(app, { getAppPath: () => root });
await initStoragePaths();
assert.equal(getDataDir(), path.join(root, 'data'));
try {
  assert.equal(
    parseSkill(markdown('writing')).description,
    'A writing skill for technical documents.',
  );
  assert.throws(() => parseSkill(Buffer.from('<html>not a skill</html>')), /元数据/);
  assert.throws(() => parseSkill(Buffer.from('---\nname: sample\n---\nBody')), /description/);
  assert.throws(
    () => parseSkill(Buffer.concat([markdown('sample'), Buffer.alloc(65536)])),
    /64 KB/,
  );
  assert.throws(() => parseSkill(Buffer.from([0xff, 0xfe])), /UTF-8/);
  for (const name of [
    '../secret',
    'C:/secret',
    '/absolute',
    'a\\b',
    'folder/CON.txt',
    'a/..',
    'a/name.',
  ])
    assert.throws(() => assertSkillPath(name));
  passed('解析标准 Skill 和多行描述，拒绝非法编码、路径及元数据');

  const local = path.join(root, 'source');
  await mkdir(path.join(local, 'writing', 'references'), { recursive: true });
  await mkdir(path.join(local, 'other'), { recursive: true });
  await writeFile(path.join(local, 'writing', 'SKILL.md'), markdown('writing'));
  await writeFile(path.join(local, 'writing', 'references', 'guide.md'), 'Use short paragraphs.');
  await writeFile(path.join(local, 'other', 'SKILL.md'), markdown('other', 'Summarize files.'));
  const preview = await previewLocalSkills(11, local);
  assert.equal(preview.candidates.length, 2);
  const writingPath = preview.candidates.find((s) => s.name === 'writing')!.path;
  await assert.rejects(installSkills(12, preview.token, [writingPath]), /过期/);
  await assert.rejects(installSkills(11, preview.token, ['not-selected/SKILL.md']), /预览/);
  const [installed] = await installSkills(11, preview.token, [writingPath]);
  assert.equal(installed.enabled, false);
  assert.equal(installed.folder, 'writing');
  assert.match(
    await readFile(path.join(root, 'skills', 'writing', 'SKILL.md'), 'utf8'),
    /Read references/,
  );
  assert.equal((await listSkills()).length, 1);
  assert.equal((await buildSkillContext(true)).tools.length, 0);
  assert.deepEqual((await skillDetail(installed.id)).files, ['SKILL.md', 'references/guide.md']);
  await assert.rejects(readSkillResource(installed.id, 'references/guide.md'), /停用/);
  await rm(local, { recursive: true, force: true });
  assert.match((await skillDetail(installed.id)).content, /Read references/);
  passed('本地集合选装、跨窗口预览隔离、默认停用、附带资料和独立副本');

  await setSkillEnabled(installed.id, true);
  const enabled = await buildSkillContext(true);
  assert.deepEqual(
    enabled.tools.map((tool) => tool.name),
    ['read_skill', 'read_skill_file', 'run_skill_python'],
  );
  assert.match(enabled.prompt, /writing/);
  assert.doesNotMatch(enabled.prompt, /Read references/);
  const inline = await buildSkillContext(false);
  assert.equal(inline.tools.length, 0);
  assert.match(inline.prompt, /Read references/);
  assert.equal(
    (await readSkillResource(installed.id, 'references/guide.md')).content,
    'Use short paragraphs.',
  );
  await assert.rejects(readSkillResource(installed.id, '../record.json'), /非法路径/);
  passed('启用后按需载入，关闭工具时内联说明，资料读取限制在 Skill 包内');

  const duplicate = stageSkills(11, 'duplicate', new Map([['SKILL.md', markdown('writing')]]));
  await assert.rejects(installSkills(11, duplicate.token, ['SKILL.md']), /同名/);
  assert.equal((await listSkills()).length, 1);
  discardSkillPreview(11, duplicate.token);
  await assert.rejects(installSkills(11, duplicate.token, ['SKILL.md']), /过期/);
  const two = stageSkills(
    11,
    'collection',
    new Map([
      ['a/SKILL.md', markdown('same')],
      ['b/SKILL.md', markdown('same')],
    ]),
  );
  await assert.rejects(
    installSkills(
      11,
      two.token,
      two.candidates.map((s) => s.path),
    ),
    /同名/,
  );
  assert.equal((await listSkills()).length, 1);
  discardSkillPreview(11);
  passed('同名及批量重复安装不产生部分数据，取消预览后不可安装');

  const zip = new JSZip();
  zip.file('repo-commit/skills/writing/SKILL.md', markdown('remote-writing'));
  zip.file('repo-commit/skills/writing/references/guide.md', 'Remote reference');
  zip.file('repo-commit/skills/other/SKILL.md', markdown('remote-other'));
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const target = skillDownloadTarget('https://github.com/example/skills/tree/main/skills/writing');
  assert.equal(target.url.href, 'https://api.github.com/repos/example/skills/zipball/main');
  assert.equal(target.prefix, 'skills/writing');
  assert.equal(
    skillDownloadTarget('https://github.com/example/skills/blob/main/skills/writing/SKILL.md')
      .prefix,
    'skills/writing',
  );
  const requested: string[] = [];
  const download = (async (url: URL) => {
    requested.push(String(url));
    return requested.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: 'https://codeload.github.com/example/skills/zip/main' },
        })
      : new Response(zipBuffer);
  }) as typeof fetch;
  const remote = await readOnlineSkills(
    'https://github.com/example/skills/tree/main/skills/writing',
    download,
  );
  assert.deepEqual([...remote.keys()], ['SKILL.md', 'references/guide.md']);
  assert.equal(requested.length, 2);
  const remotePreview = stageSkills(11, 'https://github.com/example/skills', remote);
  const [remoteSkill] = await installSkills(11, remotePreview.token, ['SKILL.md']);
  assert.equal(remoteSkill.name, 'remote-writing');
  assert.equal(remoteSkill.folder, 'remote-writing');
  assert.match(
    await readFile(path.join(root, 'skills', 'remote-writing', 'SKILL.md'), 'utf8'),
    /remote-writing/,
  );
  assert.equal((await skillDetail(remoteSkill.id)).files.length, 2);
  assert.equal(skillCandidates(await readSkillZip(zipBuffer)).length, 2);
  const raw = await readOnlineSkills(
    'https://example.org/SKILL.md',
    (async () => new Response(markdown('raw'))) as typeof fetch,
  );
  assert.equal(skillCandidates(raw)[0].name, 'raw');
  await writeFile(path.join(root, 'skills.zip'), zipBuffer);
  assert.equal(skillCandidates(await readLocalSkills(path.join(root, 'skills.zip'))).length, 2);
  passed('GitHub 目录及 blob 解析、HTTPS 重定向、在线 ZIP 选装、Markdown 和本地 ZIP');

  await assert.rejects(readOnlineSkills('http://example.org/SKILL.md'), /HTTPS/);
  await assert.rejects(readOnlineSkills('https://name:secret@example.org/SKILL.md'), /密码/);
  await assert.rejects(
    readOnlineSkills(
      'https://example.org/SKILL.md',
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://example.org/unsafe' },
        })) as typeof fetch,
    ),
    /重定向/,
  );
  await assert.rejects(
    readOnlineSkills(
      'https://example.org/missing',
      (async () => new Response('missing', { status: 404 })) as typeof fetch,
    ),
    /404/,
  );
  await assert.rejects(
    readOnlineSkills(
      'https://example.org/page',
      (async () => new Response('<html>page</html>')) as typeof fetch,
    ),
    /元数据/,
  );
  const conflict = new JSZip();
  conflict.file('SKILL.md', markdown('test'));
  conflict.file('skill.md', markdown('test'));
  await assert.rejects(readSkillZip(await conflict.generateAsync({ type: 'nodebuffer' })), /重复/);
  const escape = new JSZip();
  escape.file('../outside.txt', 'outside');
  await assert.rejects(readSkillZip(await escape.generateAsync({ type: 'nodebuffer' })));
  const link = new JSZip();
  link.file('linked.md', 'outside', { unixPermissions: 0o120777 });
  await assert.rejects(
    readSkillZip(await link.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })),
    /链接/,
  );
  const large = new JSZip();
  large.file('too-large.txt', Buffer.alloc(4 * 1024 * 1024 + 1));
  await assert.rejects(
    readSkillZip(await large.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })),
    /4 MB/,
  );
  passed('下载错误与不安全重定向、重复路径、ZIP 穿越、符号链接和解压大小');

  const config: AiConfig = {
    id: 'skills-test',
    name: 'Skills test',
    provider: 'openai-compat',
    model: 'test',
    baseUrl: 'https://example.org/v1',
    systemPrompt: 'Custom instruction.',
    temperature: 0.7,
    maxOutputTokens: 512,
    createdAt: Date.now(),
  };
  const bodies: Record<string, unknown>[] = [];
  const sse = (delta: unknown, reason: string): Response =>
    new Response(
      `data: ${JSON.stringify({ id: 'chat-1', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  const events: AiStreamEvent[] = [];
  const mockChat = (async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    if (bodies.length === 1)
      return sse(
        {
          tool_calls: [
            {
              index: 0,
              id: 'call-skill',
              type: 'function',
              function: {
                name: 'read_skill',
                arguments: JSON.stringify({ skillId: installed.id }),
              },
            },
          ],
        },
        'tool_calls',
      );
    if (bodies.length === 2)
      return sse(
        {
          tool_calls: [
            {
              index: 0,
              id: 'call-reference',
              type: 'function',
              function: {
                name: 'read_skill_file',
                arguments: JSON.stringify({ skillId: installed.id, file: 'references/guide.md' }),
              },
            },
          ],
        },
        'tool_calls',
      );
    return sse({ content: 'Completed with skill.' }, 'stop');
  }) as typeof fetch;
  const request: AiChatRequest = {
    requestId: randomUUID(),
    config,
    toolMode: 'ask',
    messages: [{ role: 'user', text: 'Help me write.' }],
  };
  const chat = await runChat(request, 'test-key', (event) => events.push(event), mockChat);
  assert.equal(chat.text, 'Completed with skill.');
  assert.equal(chat.error, undefined);
  assert.equal(bodies.length, 3);
  assert.match(JSON.stringify(bodies[0].messages), /Custom instruction/);
  assert.match(JSON.stringify(bodies[0].messages), /writing/);
  assert.match(JSON.stringify(bodies[1].messages), /Read references/);
  assert.match(JSON.stringify(bodies[2].messages), /Use short paragraphs/);
  assert.equal(events.filter((event) => event.toolCall?.status === 'done').length, 2);
  assert.equal(events.filter((event) => event.toolCall?.status === 'pending').length, 0);
  passed('真实 runChat + AI SDK 连续读取 Skill 与附带资料，返回工具事件并保留自定义提示');

  const offBodies: Record<string, unknown>[] = [];
  const offFetch = (async (_url: unknown, init: RequestInit) => {
    offBodies.push(JSON.parse(String(init.body)));
    return sse({ content: 'Inline skill.' }, 'stop');
  }) as typeof fetch;
  await runChat(
    { ...request, requestId: randomUUID(), toolMode: 'off' },
    'test-key',
    () => {},
    offFetch,
  );
  assert.equal(offBodies[0].tools, undefined);
  assert.match(JSON.stringify(offBodies[0].messages), /Read references/);
  await setSkillEnabled(installed.id, false);
  assert.equal((await buildSkillContext(true)).tools.length, 0);
  await assert.rejects(readSkillResource(installed.id, 'SKILL.md'), /停用/);
  passed('对话关闭工具时不发送 tools，Skill 停用后下一次请求立即移除');

  await setSkillEnabled(installed.id, true);
  const beforeMigration = readSkillResource(installed.id, 'references/guide.md');
  const migrating = changeDataDir(path.join(root, 'migrated'));
  const afterMigration = listSkills();
  await Promise.all([beforeMigration, migrating, afterMigration]);
  assert.equal(getDataDir(), path.join(root, 'migrated'));
  assert.equal(
    (await readSkillResource(installed.id, 'references/guide.md')).content,
    'Use short paragraphs.',
  );
  assert.equal((await listSkills()).find((s) => s.id === installed.id)?.enabled, true);
  await removeSkill(remoteSkill.id);
  await assert.rejects(skillDetail(remoteSkill.id), /不存在/);
  passed('在途读取与数据目录迁移正确协调，迁移后保留启用状态及资料，删除副本');

  const instructionPath = path.join(skillsDirectory(), installed.folder!, 'SKILL.md');
  const original = await readFile(instructionPath);
  await writeFile(instructionPath, 'broken');
  const broken = await buildSkillContext(true);
  assert.equal(broken.tools.length, 0);
  assert.match(broken.warnings.join(' '), /读取失败/);
  await writeFile(instructionPath, original);
  const recordPath = dataPath('ai', 'skills', installed.id, 'record.json');
  const record = await readFile(recordPath);
  await writeFile(recordPath, '{broken');
  const corrupted = await buildSkillContext(true);
  assert.equal(corrupted.tools.length, 0);
  assert.match(corrupted.warnings.join(' '), /目录读取失败/);
  await writeFile(recordPath, record);
  passed('损坏的 Skill 或安装记录显示告警，不阻断 AI 对话');

  assert.equal(skillsDirectory(), path.join(root, 'skills'));
  const manual = path.join(skillsDirectory(), 'manual-skill');
  await mkdir(path.join(manual, 'references'), { recursive: true });
  await writeFile(path.join(manual, 'SKILL.md'), markdown('manual', 'Manual first revision.'));
  await writeFile(path.join(manual, 'references', 'notes.md'), 'Manual notes');
  const discovered = (await skillLibrary()).skills.find((s) => s.name === 'manual')!;
  assert.equal(discovered.folder, 'manual-skill');
  assert.equal(discovered.enabled, false);
  await setSkillEnabled(discovered.id, true);
  assert.match((await buildSkillContext(false)).prompt, /Manual first revision/);
  await writeFile(path.join(manual, 'SKILL.md'), markdown('manual', 'Manual updated revision.'));
  assert.match((await buildSkillContext(false)).prompt, /Manual updated revision/);
  assert.equal((await listSkills()).find((s) => s.name === 'manual')?.id, discovered.id);
  await rename(manual, path.join(root, 'manual-removed'));
  assert.equal(
    (await listSkills()).some((s) => s.id === discovered.id),
    false,
  );
  assert.doesNotMatch((await buildSkillContext(false)).prompt, /Manual updated revision/);
  await assert.rejects(readFile(dataPath('ai', 'skills', discovered.id, 'record.json')), /ENOENT/);
  const replacementPreview = stageSkills(
    11,
    'replacement',
    new Map([['SKILL.md', markdown('manual')]]),
  );
  const [replacement] = await installSkills(11, replacementPreview.token, ['SKILL.md']);
  assert.notEqual(replacement.id, discovered.id);
  assert.equal((await listSkills()).find((s) => s.name === 'manual')?.id, replacement.id);
  assert.equal((await listSkills()).find((s) => s.name === 'manual')?.enabled, false);
  await removeSkill(replacement.id);
  passed('手动放入 Skill 自动发现，启用后实时读取修改；移出文件夹后立即停用');

  const legacyId = randomUUID();
  const legacyRoot = dataPath('ai', 'skills', legacyId);
  await mkdir(path.join(legacyRoot, 'package', 'references'), { recursive: true });
  await writeFile(path.join(legacyRoot, 'package', 'SKILL.md'), markdown('legacy-skill'));
  await writeFile(path.join(legacyRoot, 'package', 'references', 'guide.md'), 'Legacy reference');
  await writeFile(
    path.join(legacyRoot, 'record.json'),
    JSON.stringify({
      id: legacyId,
      name: 'legacy-skill',
      description: 'Legacy skill',
      enabled: true,
      source: 'https://example.org/legacy.zip',
      installedAt: 1,
      fileCount: 2,
    }),
  );
  const migratedSkill = (await listSkills()).find((s) => s.id === legacyId)!;
  assert.equal(migratedSkill.folder, 'legacy-skill');
  assert.equal(migratedSkill.enabled, true);
  assert.equal(
    (await readSkillResource(legacyId, 'references/guide.md')).content,
    'Legacy reference',
  );
  await assert.rejects(readdir(path.join(legacyRoot, 'package')), /ENOENT/);
  assert.match(
    await readFile(path.join(root, 'skills', 'legacy-skill', 'SKILL.md'), 'utf8'),
    /legacy-skill/,
  );
  passed('旧版下载及导入包迁到软件 skills 目录，保留 ID、来源、启用状态和资料');

  const invalid = path.join(skillsDirectory(), 'invalid');
  await mkdir(invalid);
  await writeFile(path.join(invalid, 'SKILL.md'), 'invalid instructions');
  const unsafe = path.join(skillsDirectory(), 'unsafe');
  await symlink(path.join(root, 'manual-removed'), unsafe, 'junction');
  const library = await skillLibrary();
  assert.equal(
    library.skills.some((s) => s.folder === 'invalid' || s.folder === 'unsafe'),
    false,
  );
  assert.match(library.warnings.join(' '), /invalid/);
  assert.match(library.warnings.join(' '), /unsafe/);
  await rm(unsafe, { force: true });
  await rm(invalid, { recursive: true, force: true });
  await removeSkill(legacyId);
  await assert.rejects(readFile(path.join(root, 'skills', 'legacy-skill', 'SKILL.md')), /ENOENT/);
  assert.match(
    await readFile(path.join(root, 'manual-removed', 'SKILL.md'), 'utf8'),
    /Manual updated/,
  );
  passed('扫描隔离无效 Skill 和目录链接，删除只作用于软件 skills 中的目标文件夹');

  const getPath = app.getPath;
  const originalPortable = process.env.PORTABLE_EXECUTABLE_DIR;
  try {
    app.isPackaged = true;
    app.getPath = (name: string) =>
      name === 'exe' ? path.join(root, 'installed', 'Toolbox.exe') : getPath(name);
    delete process.env.PORTABLE_EXECUTABLE_DIR;
    assert.equal(getSoftwareDir(), path.join(root, 'installed'));
    assert.equal(skillsDirectory(), path.join(root, 'installed', 'skills'));
    process.env.PORTABLE_EXECUTABLE_DIR = path.join(root, 'portable');
    assert.equal(skillsDirectory(), path.join(root, 'portable', 'skills'));
  } finally {
    app.isPackaged = false;
    app.getPath = getPath;
    if (originalPortable === undefined) delete process.env.PORTABLE_EXECUTABLE_DIR;
    else process.env.PORTABLE_EXECUTABLE_DIR = originalPortable;
  }
  passed('安装版使用 exe 同级目录，便携版使用原始 exe 目录，开发时使用项目根目录');
  console.log(`Skills verification passed: ${groups} groups.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
