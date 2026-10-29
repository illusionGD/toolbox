import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { initStoragePaths } from '../../electron/main/storage/paths';
import { buildSkillContext } from '../../electron/main/ai/skills/context';
import { findPython, runSkillPython } from '../../electron/main/ai/skills/python';
import {
  listSkills,
  setSkillEnabled,
  skillsDirectory,
  skillDetail,
} from '../../electron/main/ai/skills/registry';
import { buildTools, replyConfirm } from '../../electron/main/ai/tools';
import { cancelChat, runChat } from '../../electron/main/ai/chat';
import type { AiConfig, AiStreamEvent, AiToolCall } from '../../electron/shared/types';
import { app } from './stub-electron';

const root = await mkdtemp(path.join(tmpdir(), 'tbverify-python-'));
Object.assign(app, { getAppPath: () => root });
await initStoragePaths();
let groups = 0;
const passed = (name: string): void => {
  console.log(`Python OK ${++groups}. ${name}`);
};
const exists = (file: string): Promise<boolean> =>
  lstat(file)
    .then(() => true)
    .catch(() => false);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const cwd = path.join(skillsDirectory(), 'python-test-中文');
  await mkdir(path.join(cwd, 'scripts'), { recursive: true });
  await writeFile(
    path.join(cwd, 'SKILL.md'),
    '---\nname: python-test\ndescription: Run Python fixtures.\n---\nUse bundled Python scripts.',
  );
  await writeFile(path.join(cwd, 'fixture.txt'), 'Skill file');
  await writeFile(
    path.join(cwd, 'scripts', 'echo.py'),
    'import json, os, sys\nfrom pathlib import Path\nprint(json.dumps({"args":sys.argv[1:],"cwd":os.getcwd(),"file":Path("fixture.txt").read_text(),"python":sys.executable},ensure_ascii=False))\nprint("stderr text",file=sys.stderr)\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'write.py'),
    'from pathlib import Path\nPath("executed.txt").write_text("executed")\nprint("script done")\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'fail.py'),
    'import sys\nprint("failure detail", file=sys.stderr)\nsys.exit(7)\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'missing.py'),
    'import toolbox_missing_fixture_dependency\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'large.py'),
    'import sys\nsys.stdout.write("x"*100000)\nsys.stderr.write("y"*100000)\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'worker.py'),
    'import sys, time\nfrom pathlib import Path\ntime.sleep(3)\nPath(sys.argv[1]).write_text("leaked")\n',
  );
  await writeFile(
    path.join(cwd, 'scripts', 'tree.py'),
    'import subprocess, sys, time\nfrom pathlib import Path\nsubprocess.Popen([sys.executable,str(Path(__file__).with_name("worker.py")),sys.argv[1]])\nPath(sys.argv[1]+".ready").write_text("ready")\ntime.sleep(60)\n',
  );
  const skill = (await listSkills())[0];
  await assert.rejects(runSkillPython({ skillId: skill.id, script: 'scripts/echo.py' }), /停用/);
  await setSkillEnabled(skill.id, true);
  const interpreter = await findPython(cwd);
  assert.match(interpreter.version, /^3\./);
  assert.equal(path.isAbsolute(interpreter.executable), true);
  passed('发现真实 Python 3，未启用的 Skill 不执行');

  const args = ['中文参数', 'send verify code', 'with space', '& exit', '$(echo text)', 'a"b'];
  const echo = await runSkillPython({ skillId: skill.id, script: 'scripts/echo.py', args });
  assert.equal(echo.exitCode, 0);
  assert.equal(echo.error, undefined);
  const payload = JSON.parse(echo.stdout);
  assert.deepEqual(payload.args, args);
  assert.equal(payload.cwd, cwd);
  assert.equal(payload.file, 'Skill file');
  assert.equal(echo.stderr.trim(), 'stderr text');
  passed('真实执行 Python，中文、空格、引号及 shell 字符按原样传参，正确工作目录与双通道输出');

  await assert.rejects(runSkillPython({ skillId: skill.id, script: '../outside.py' }), /非法路径/);
  await assert.rejects(runSkillPython({ skillId: skill.id, script: 'SKILL.md' }), /\.py/);
  await assert.rejects(runSkillPython({ skillId: skill.id, script: 'scripts/absent.py' }), /清单/);
  await assert.rejects(
    runSkillPython({ skillId: skill.id, script: 'scripts/echo.py', args: ['bad\0arg'] }),
  );
  await writeFile(path.join(root, 'outside.py'), 'print("outside")');
  await symlink(path.join(root, 'outside.py'), path.join(cwd, 'scripts', 'link.py'));
  await assert.rejects(runSkillPython({ skillId: skill.id, script: 'scripts/link.py' }));
  await rm(path.join(cwd, 'scripts', 'link.py'));
  passed('拒绝路径穿越、非 Python 文件、未知入口、空字节和脚本链接');

  const failed = await runSkillPython({ skillId: skill.id, script: 'scripts/fail.py' });
  assert.equal(failed.exitCode, 7);
  assert.match(failed.stderr, /failure detail/);
  assert.match(failed.error!, /7/);
  const missing = await runSkillPython({ skillId: skill.id, script: 'scripts/missing.py' });
  assert.match(missing.error!, /toolbox_missing_fixture_dependency/);
  const large = await runSkillPython({ skillId: skill.id, script: 'scripts/large.py' });
  assert.equal(large.exitCode, 0);
  assert.equal(large.truncated, true);
  assert.ok(Buffer.byteLength(large.stdout) + Buffer.byteLength(large.stderr) <= 65536);
  passed('非零退出和依赖缺失保留错误原因，过量输出受限且不会阻塞进程');

  const toolContext = await buildSkillContext(true);
  const calls: AiToolCall[] = [];
  const requestId = randomUUID();
  const tools = buildTools(
    { requestId, mode: 'ask', emit: (call) => calls.push(call), trackTask: () => {} },
    toolContext.tools,
  )!;
  const execute = tools.run_skill_python.execute!;
  const pending = Promise.resolve(
    execute(
      { skillId: skill.id, script: 'scripts/write.py', args: [], timeoutSeconds: 120 },
      { toolCallId: 'approved', messages: [] },
    ),
  );
  await delay(50);
  assert.equal(calls.at(-1)?.status, 'pending');
  assert.equal(await exists(path.join(cwd, 'executed.txt')), false);
  assert.equal(replyConfirm(`${requestId}:approved`, true), true);
  await pending;
  assert.equal(await readFile(path.join(cwd, 'executed.txt'), 'utf8'), 'executed');
  assert.equal(calls.at(-1)?.status, 'done');
  await rm(path.join(cwd, 'executed.txt'));
  const denied = Promise.resolve(
    execute(
      { skillId: skill.id, script: 'scripts/write.py', args: [], timeoutSeconds: 120 },
      { toolCallId: 'denied', messages: [] },
    ),
  );
  await delay(20);
  replyConfirm(`${requestId}:denied`, false);
  assert.equal(((await denied) as { denied: boolean }).denied, true);
  assert.equal(await exists(path.join(cwd, 'executed.txt')), false);
  const failedCall = Promise.resolve(
    execute(
      { skillId: skill.id, script: 'scripts/fail.py', args: [], timeoutSeconds: 120 },
      { toolCallId: 'failed', messages: [] },
    ),
  );
  await delay(20);
  replyConfirm(`${requestId}:failed`, true);
  assert.equal(((await failedCall) as { exitCode: number }).exitCode, 7);
  assert.equal(calls.at(-1)?.status, 'error');
  passed('询问模式确认后才执行，拒绝无副作用，脚本失败显示错误卡片并保留结构化输出');

  const timeoutMarker = 'timeout-child.txt';
  const timedOut = await runSkillPython({
    skillId: skill.id,
    script: 'scripts/tree.py',
    args: [timeoutMarker],
    timeoutSeconds: 1,
  });
  assert.equal(timedOut.timedOut, true, JSON.stringify(timedOut));
  assert.equal(timedOut.terminationIncomplete, false);
  assert.match(timedOut.error!, /超过/);
  const canceledMarker = 'canceled-child.txt';
  const controller = new AbortController();
  const active = runSkillPython(
    { skillId: skill.id, script: 'scripts/tree.py', args: [canceledMarker] },
    controller.signal,
  );
  for (
    let attempts = 0;
    attempts < 100 && !(await exists(path.join(cwd, canceledMarker + '.ready')));
    attempts++
  )
    await delay(30);
  assert.equal(await exists(path.join(cwd, canceledMarker + '.ready')), true);
  controller.abort();
  const canceled = await active;
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.terminationIncomplete, false);
  await delay(3300);
  assert.equal(await exists(path.join(cwd, timeoutMarker)), false);
  assert.equal(await exists(path.join(cwd, canceledMarker)), false);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    runSkillPython({ skillId: skill.id, script: 'scripts/write.py' }, aborted.signal),
    /取消/,
  );
  assert.equal(await exists(path.join(cwd, 'executed.txt')), false);
  passed('超时及停止取消本地进程树，子进程不再写入，已取消请求不启动脚本');

  const bodies: Record<string, unknown>[] = [];
  const events: AiStreamEvent[] = [];
  const config: AiConfig = {
    id: 'python',
    name: 'python',
    provider: 'openai-compat',
    model: 'test',
    baseUrl: 'https://example.org/v1',
    systemPrompt: '',
    temperature: 0.7,
    maxOutputTokens: 256,
    createdAt: 1,
  };
  const chatFetch = (async (_url: unknown, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const delta =
      bodies.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: 'python-call',
                type: 'function',
                function: {
                  name: 'run_skill_python',
                  arguments: JSON.stringify({
                    skillId: skill.id,
                    script: 'scripts/echo.py',
                    args: ['test arg'],
                  }),
                },
              },
            ],
          }
        : { content: 'Script completed.' };
    return new Response(
      'data: ' +
        JSON.stringify({
          id: 'c',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            { index: 0, delta, finish_reason: bodies.length === 1 ? 'tool_calls' : 'stop' },
          ],
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  }) as typeof fetch;
  const chat = await runChat(
    {
      requestId: randomUUID(),
      config,
      toolMode: 'auto',
      messages: [{ role: 'user', text: 'Run skill.' }],
    },
    'key',
    (event) => events.push(event),
    chatFetch,
  );
  assert.equal(chat.text, 'Script completed.');
  assert.equal(bodies.length, 2);
  assert.match(JSON.stringify(bodies[1].messages), /test arg/);
  assert.match(JSON.stringify(bodies[1].messages), /Skill file/);
  assert.equal(
    events.some((event) => event.toolCall?.status === 'pending'),
    false,
  );
  assert.equal(
    events.some((event) => event.toolCall?.status === 'done'),
    true,
  );
  assert.equal((await buildSkillContext(false)).tools.length, 0);
  passed('真实 AI SDK 调用脚本、返回 stdout 到模型、自动模式不等待确认，关闭工具不提供执行入口');

  const stoppedRequest = randomUUID();
  const stopEvents: AiStreamEvent[] = [];
  const cancelFetch = (async () =>
    new Response(
      'data: ' +
        JSON.stringify({
          id: 'c',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'cancel-python',
                    type: 'function',
                    function: {
                      name: 'run_skill_python',
                      arguments: JSON.stringify({
                        skillId: skill.id,
                        script: 'scripts/tree.py',
                        args: ['chat-child.txt'],
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    )) as typeof fetch;
  const chatActive = runChat(
    {
      requestId: stoppedRequest,
      config,
      toolMode: 'auto',
      messages: [{ role: 'user', text: 'Long task' }],
    },
    'key',
    (event) => stopEvents.push(event),
    cancelFetch,
  );
  for (
    let attempts = 0;
    attempts < 100 && !(await exists(path.join(cwd, 'chat-child.txt.ready')));
    attempts++
  )
    await delay(30);
  assert.equal(await exists(path.join(cwd, 'chat-child.txt.ready')), true);
  assert.equal(cancelChat(stoppedRequest), true);
  const stopped = await chatActive;
  assert.equal(stopped.canceled, true);
  assert.equal(cancelChat(stoppedRequest), false);
  await delay(3300);
  assert.equal(await exists(path.join(cwd, 'chat-child.txt')), false);
  passed('AI 对话停止沿用请求 AbortSignal，实际终止脚本和子进程');

  await promisify(execFile)(interpreter.executable, ['-m', 'venv', path.join(cwd, '.venv')], {
    timeout: 30000,
    windowsHide: true,
  });
  const virtual = await findPython(cwd);
  assert.equal(
    virtual.executable,
    path.join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
  );
  const usingVirtual = await runSkillPython({ skillId: skill.id, script: 'scripts/echo.py' });
  assert.equal(JSON.parse(usingVirtual.stdout).python, virtual.executable);
  assert.equal(
    (await listSkills()).some((s) => s.id === skill.id),
    true,
  );
  assert.equal(
    (await skillDetail(skill.id)).files.some(
      (file) => file.startsWith('.venv/') || file.includes('__pycache__'),
    ),
    false,
  );
  assert.equal((await buildSkillContext(true)).tools.length, 3);
  passed('Skill 优先使用自己的虚拟环境，环境目录不影响扫描与脚本载入');
  console.log(`Python verification passed: ${groups} groups.`);
} finally {
  await rm(root, { recursive: true, force: true });
}
