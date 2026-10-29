import { spawn, type ChildProcess } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveSkillScript } from './registry';

const MAX_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT = 120;
const MAX_TIMEOUT = 600;

export const skillPythonInput = z
  .object({
    skillId: z.string().uuid(),
    script: z.string().min(1).max(240),
    args: z
      .array(
        z
          .string()
          .max(4096)
          .refine((value) => !value.includes('\0'), '参数不能包含空字符'),
      )
      .max(64)
      .default([]),
    timeoutSeconds: z.number().int().min(1).max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT),
  })
  .refine(
    (input) => input.args.reduce((sum, value) => sum + value.length, 0) <= 16000,
    '脚本参数总长度不能超过 16000',
  );

export interface PythonInterpreter {
  executable: string;
  args: string[];
  version: string;
}
export interface SkillPythonResult {
  interpreter: string;
  version: string;
  script: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  canceled: boolean;
  timedOut: boolean;
  terminationIncomplete: boolean;
  elapsedMs: number;
  error?: string;
}

/** 停止整个脚本进程树，避免停止对话后还有脚本在运行。 */
function terminate(child: ChildProcess, onFailure: () => void): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    const killer = spawn(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, shell: false, stdio: 'ignore' },
    );
    killer.on('error', () => {
      onFailure();
      child.kill('SIGKILL');
    });
    killer.on('exit', (code) => {
      if (code !== 0) {
        onFailure();
        child.kill('SIGKILL');
      }
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      onFailure();
      child.kill('SIGKILL');
    }
  }
}

interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  canceled: boolean;
  timedOut: boolean;
  terminationIncomplete: boolean;
  truncated: boolean;
  elapsedMs: number;
}
function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  if (signal?.aborted) return Promise.reject(new Error('对话已取消，未执行 Python 脚本'));
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let canceled = false;
    let timedOut = false;
    let terminationIncomplete = false;
    let finished = false;
    let forcedCompletion: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null, error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(forcedCompletion);
      signal?.removeEventListener('abort', abort);
      if (error) {
        reject(new Error(`无法启动 Python：${error.message}`));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code,
        canceled,
        timedOut,
        terminationIncomplete,
        truncated,
        elapsedMs: Date.now() - started,
      });
    };
    const stop = (): void => {
      terminate(child, () => {
        terminationIncomplete = true;
      });
      // 进程树停止异常时也结束工具等待；输出管道持续消费，不阻塞子进程。
      forcedCompletion = setTimeout(() => {
        terminationIncomplete = true;
        child.kill('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(null);
      }, 3000);
    };
    const abort = (): void => {
      if (canceled || timedOut || finished) return;
      canceled = true;
      stop();
    };
    const timer = setTimeout(() => {
      if (finished || canceled) return;
      timedOut = true;
      stop();
    }, timeoutMs);
    const collect = (target: Buffer[], chunk: Buffer): void => {
      const retained = Math.min(chunk.length, Math.max(0, MAX_OUTPUT_BYTES - bytes));
      if (retained) target.push(chunk.subarray(0, retained));
      bytes += retained;
      if (retained < chunk.length) truncated = true;
    };
    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => finish(null, error));
    child.on('close', (code) => finish(code));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** 探测真实解释器，跳过不能启动的 Windows 商店占位程序。 */
async function probePython(
  candidate: { executable: string; args: string[] },
  cwd: string,
  signal?: AbortSignal,
): Promise<PythonInterpreter | undefined> {
  try {
    const result = await runProcess(
      candidate.executable,
      [
        ...candidate.args,
        '-I',
        '-c',
        'import json,sys;print(json.dumps({"executable":sys.executable,"version":"%d.%d.%d" % sys.version_info[:3]},ensure_ascii=True))',
      ],
      cwd,
      3000,
      signal,
    );
    if (signal?.aborted) throw new Error('对话已取消');
    if (result.exitCode !== 0 || result.timedOut) return undefined;
    const { executable, version } = z
      .object({ executable: z.string(), version: z.string() })
      .parse(JSON.parse(result.stdout));
    if (!path.isAbsolute(executable) || !/^3\.\d+\.\d+$/.test(version)) return undefined;
    return { executable, args: [], version };
  } catch (error) {
    if (signal?.aborted) throw error;
    return undefined;
  }
}

/** 优先使用 Skill 自身的虚拟环境，其次查找系统 Python；不把机器路径写死。 */
export async function findPython(cwd: string, signal?: AbortSignal): Promise<PythonInterpreter> {
  const candidates: { executable: string; args: string[] }[] = [];
  for (const envFolder of ['.venv', 'venv']) {
    const executable = path.join(
      cwd,
      envFolder,
      process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
    );
    if (
      await lstat(executable)
        .then(() => true)
        .catch(() => false)
    ) {
      const result = await probePython({ executable, args: [] }, cwd, signal);
      if (!result) throw new Error(`Skill 虚拟环境无法启动：${envFolder}，请修复环境或删除该目录`);
      return result;
    }
  }
  if (process.platform === 'win32') {
    const locations = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
      process.env.ProgramFiles ?? '',
      process.env['ProgramFiles(x86)'] ?? '',
    ].filter(Boolean);
    for (const directory of locations) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries
        .filter((item) => item.isDirectory() && /^Python\d/i.test(item.name))
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))) {
        candidates.push({ executable: path.join(directory, entry.name, 'python.exe'), args: [] });
      }
    }
    candidates.push(
      { executable: 'py', args: ['-3'] },
      { executable: 'python', args: [] },
      { executable: 'python3', args: [] },
    );
  } else candidates.push({ executable: 'python3', args: [] }, { executable: 'python', args: [] });
  for (const candidate of candidates) {
    if (signal?.aborted) throw new Error('对话已取消');
    const result = await probePython(candidate, cwd, signal);
    if (result) return result;
  }
  throw new Error('未找到可用的 Python 3。请安装 Python，或在 Skill 文件夹中创建 .venv 虚拟环境');
}

export async function runSkillPython(
  input: unknown,
  signal?: AbortSignal,
): Promise<SkillPythonResult> {
  const options = skillPythonInput.parse(input);
  const prepared = await resolveSkillScript(options.skillId, options.script);
  const interpreter = await findPython(prepared.cwd, signal);
  if (signal?.aborted) throw new Error('对话已取消，未执行 Python 脚本');
  // 探测结束后重新检查 Skill 和入口，避免停用或移除的脚本继续启动。
  const target = await resolveSkillScript(options.skillId, options.script);
  const result = await runProcess(
    interpreter.executable,
    [...interpreter.args, '-u', target.script, ...options.args],
    target.cwd,
    options.timeoutSeconds * 1000,
    signal,
  );
  let error: string | undefined;
  if (result.canceled)
    error = result.terminationIncomplete
      ? 'Python 脚本取消等待，无法确认全部子进程已停止'
      : 'Python 脚本已取消';
  else if (result.timedOut)
    error = `Python 脚本超过 ${options.timeoutSeconds} 秒，${result.terminationIncomplete ? '已结束等待，无法确认全部子进程已停止' : '已停止'}`;
  else if (result.exitCode !== 0) {
    const missing = /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/.exec(result.stderr);
    error = missing
      ? `Python 缺少依赖 ${missing[1]}，请安装到该 Skill 使用的 Python 环境`
      : `Python 脚本退出码 ${result.exitCode ?? '未知'}`;
  }
  return {
    ...result,
    interpreter: interpreter.executable,
    version: interpreter.version,
    script: options.script,
    cwd: target.cwd,
    ...(error ? { error } : {}),
  };
}
