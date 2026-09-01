import { spawn, type ChildProcess } from 'child_process';
import { FFMPEG_PATH } from './binary';

/**
 * ffmpeg 子进程的统一执行入口。
 *
 * 与图片工具（sharp 是进程内库）根本不同的三点，都在这个文件里处理：
 * 1. 参数用 **argv 数组**而不是拼命令行字符串——中文路径、带空格、带 `&`
 *    的文件名在 Windows 上是最常见的一类崩因，数组传参彻底绕开引号问题。
 * 2. 失败信息只在 **stderr**，退出码只有 0/1。不留 stderr 就只能告诉用户
 *    「转码失败」，所以留最后若干行，交给 handle() 包成 message。
 * 3. 取消要能真的**杀进程**，且杀掉后输出文件必定是坏的（来不及写容器索引），
 *    所以调用方必须走「临时文件 + 成功才 rename」，取消时删掉临时文件。
 */

/** 出错时回传的 stderr 行数上限。 */
const STDERR_KEEP_LINES = 40;

/** 进度推送的最小间隔（毫秒），与 file:scanProgress 的节流一致。 */
const PROGRESS_INTERVAL = 300;

/** 进行中的任务：taskId → 子进程与取消标记。 */
const runningTasks = new Map<string, { child: ChildProcess; canceled: boolean }>();

/**
 * 已被取消但可能还有后续趟次的任务 id。
 *
 * gif 输出是 palettegen + paletteuse 两趟，两趟共用一个 taskId。若用户正好在
 * 两趟之间点取消，此刻 runningTasks 里没有进程、cancelFfmpeg 什么也杀不到，
 * 第二趟照样跑完。记在这里，让后续趟次开跑前先自我了断。
 */
const canceledTasks = new Set<string>();

/**
 * 清除某任务的取消标记。
 *
 * 由调用方在**整个任务真正结束后**调用（而非每趟结束），否则同一 taskId 的
 * 下一趟会读到过期的标记。
 * @param taskId 任务 id。
 */
export function clearCanceled(taskId: string): void {
  canceledTasks.delete(taskId);
}

/** 一次 ffmpeg 执行的进度快照。 */
export interface FfmpegProgress {
  /** 已处理到的时间点（秒）。 */
  outTime: number;
  /** 完成百分比 0-100；总时长未知时为 -1。 */
  percent: number;
  /** 速度倍率；未知为 0。 */
  speed: number;
}

/** runFfmpeg 的选项。 */
export interface RunOptions {
  /** 任务 id，用于取消。省略则不可取消（短命调用如抽帧）。 */
  taskId?: string;
  /** 源时长秒，用于算百分比；0 或缺省表示未知。 */
  duration?: number;
  /** 进度回调（已节流）。 */
  onProgress?: (progress: FfmpegProgress) => void;
}

/** runFfmpeg 的结果。 */
export interface RunResult {
  /** 是否被 cancelFfmpeg 取消。 */
  canceled: boolean;
}

/**
 * 解析 `out_time=00:00:12.345678` 形式的时间戳。
 *
 * 优先用 out_time 而不是 out_time_ms：后者在部分 ffmpeg 版本里实际是
 * 微秒（历史遗留的命名错误），跨版本不可靠。
 * @param value 时间戳文本。
 * @returns 秒数；无法解析时为 NaN。
 */
function parseOutTime(value: string): number {
  const matched = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value.trim());
  if (!matched) return Number.NaN;
  return Number(matched[1]) * 3600 + Number(matched[2]) * 60 + Number(matched[3]);
}

/**
 * 执行一次 ffmpeg。
 *
 * 固定前置 `-nostdin`：ffmpeg 默认从 stdin 读交互命令，作为管道子进程时
 * 会一直挂着不退出。`-y` 直接覆盖输出（调用方写的是自己造的临时文件名）。
 * @param args 除固定前置参数外的 ffmpeg 参数。
 * @param options 任务 id、时长与进度回调。
 * @returns 是否被取消。
 * @throws 非 0 退出且非取消时抛出，message 为 stderr 尾部。
 */
export function runFfmpeg(args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // 多趟任务（gif 的两趟调色板）里用户可能在趟间点取消，此时没有进程可杀，
    // 只能靠后续趟次自己检查标记，否则第二趟会照样跑完
    if (options.taskId && canceledTasks.has(options.taskId)) {
      resolve({ canceled: true });
      return;
    }

    const full = ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', ...args];
    const child = spawn(FFMPEG_PATH, full, { windowsHide: true });
    const task = { child, canceled: false };
    if (options.taskId) runningTasks.set(options.taskId, task);

    let stderrTail: string[] = [];
    let stdoutBuffer = '';
    let lastNotify = 0;
    let lastPercent = 0;

    /** 收到一批 -progress 输出，按行解析并节流推送。 */
    const handleProgressChunk = (chunk: string): void => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split('\n');
      // 最后一段可能是半行，留到下一批
      stdoutBuffer = lines.pop() ?? '';

      let outTime = Number.NaN;
      let speed = 0;
      let ended = false;
      for (const line of lines) {
        const index = line.indexOf('=');
        if (index < 0) continue;
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        if (key === 'out_time') outTime = parseOutTime(value);
        else if (key === 'speed') speed = Number.parseFloat(value) || 0;
        else if (key === 'progress' && value === 'end') ended = true;
      }
      if (Number.isNaN(outTime) || !options.onProgress) return;

      const now = Date.now();
      if (!ended && now - lastNotify < PROGRESS_INTERVAL) return;
      lastNotify = now;

      let percent = -1;
      if (options.duration && options.duration > 0) {
        // 百分比只许前进：ffmpeg 在两趟处理（如 gif 调色板）里会把 out_time 归零重走
        percent = Math.min(100, Math.round((outTime / options.duration) * 100));
        percent = Math.max(lastPercent, percent);
        lastPercent = percent;
      }
      options.onProgress({ outTime, percent: ended && percent >= 0 ? 100 : percent, speed });
    };

    child.stdout.on('data', (chunk: Buffer) => handleProgressChunk(chunk.toString()));

    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail.push(...chunk.toString().split('\n'));
      if (stderrTail.length > STDERR_KEEP_LINES) {
        stderrTail = stderrTail.slice(-STDERR_KEEP_LINES);
      }
    });

    child.on('error', (error) => {
      if (options.taskId) runningTasks.delete(options.taskId);
      reject(error);
    });

    child.on('close', (code) => {
      if (options.taskId) runningTasks.delete(options.taskId);
      // 取消不是错误：照 file:scan 的约定，正常返回并置位，由调用方清理临时文件
      if (task.canceled) {
        resolve({ canceled: true });
        return;
      }
      if (code === 0) {
        resolve({ canceled: false });
        return;
      }
      const detail = stderrTail
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-6)
        .join('；');
      reject(new Error(detail || `ffmpeg 退出码 ${code}`));
    });
  });
}

/**
 * 取消进行中的 ffmpeg 任务。
 *
 * Windows 上 kill 是 TerminateProcess，ffmpeg 来不及写完容器索引，
 * 输出文件必定损坏——调用方务必删掉临时文件，别让用户看到半成品。
 * @param taskId 任务 id。
 * @returns 是否找到并杀掉了对应进程。
 */
export function cancelFfmpeg(taskId: string): boolean {
  // 无论此刻有没有进程在跑都记上标记：多趟任务的趟间空档也要能拦住
  canceledTasks.add(taskId);
  const task = runningTasks.get(taskId);
  if (!task) return false;
  task.canceled = true;
  task.child.kill();
  runningTasks.delete(taskId);
  return true;
}

/**
 * 执行一次 ffmpeg 并把**完整 stderr** 收下（滤镜的分析结果用）。
 *
 * 与 runFfmpeg 分开是因为那里 stderr 只留最后 40 行（够拼一句错误原因就行）。
 * 但 `silencedetect` 之类的分析型滤镜把结果**全部打在 stderr 上**，一个十分钟
 * 的文件可能报几十段静音，留尾部就会把前面的检出结果全丢掉。
 * @param args ffmpeg 参数（通常输出到 `-f null -`，只要分析结果不要文件）。
 * @returns 完整 stderr 文本。
 * @throws 非 0 退出时抛出，message 为 stderr 尾部。
 */
export function runFfmpegCollectStderr(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-hide_banner', '-nostdin', '-y', ...args], {
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stderr);
        return;
      }
      const detail = stderr
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-4)
        .join('；');
      reject(new Error(detail || `ffmpeg 退出码 ${code}`));
    });
  });
}

/**
 * 执行一次 ffmpeg 并把 stdout 当二进制收下（抽帧用）。
 *
 * 与 runFfmpeg 分开是因为这里 stdout 是图片数据而非 -progress 文本，
 * 两者不能共用一条管道。
 * @param args ffmpeg 参数（输出须为 pipe:1）。
 * @returns stdout 的完整内容。
 * @throws 非 0 退出时抛出，message 为 stderr 尾部。
 */
export function runFfmpegToBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_PATH, ['-hide_banner', '-nostdin', '-y', ...args], {
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let stderrTail: string[] = [];

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      stderrTail.push(...chunk.toString().split('\n'));
      if (stderrTail.length > STDERR_KEEP_LINES) stderrTail = stderrTail.slice(-STDERR_KEEP_LINES);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && chunks.length) {
        resolve(Buffer.concat(chunks));
        return;
      }
      const detail = stderrTail
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-4)
        .join('；');
      reject(new Error(detail || `ffmpeg 退出码 ${code}，未产出数据`));
    });
  });
}
