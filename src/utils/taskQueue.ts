/**
 * 限并发的任务队列（渲染进程用）。
 *
 * 存在的理由：图片各页在「加入列表」时会为每一项发一次主进程调用（缩略图、裁剪包围盒探测）。
 * 手工挑十几个文件时无所谓，但从文件夹导入动辄上千项，一次性 `void fn()` 全部发出去
 * 会让主进程同时开上千个 sharp 解码，界面连滚动都卡住。
 * 队列不改变「最终每项都会跑」的语义，只是把它们排成 limit 条并发。
 */

/** 限并发队列。 */
export interface TaskQueue {
  /**
   * 入队一个任务。任务自身的异常会被吞掉——调用方若关心结果应在任务内部处理。
   * @param task 待执行的任务。
   */
  push(task: () => Promise<unknown>): void;
  /** 丢弃尚未开始的任务（已在执行的无法撤回）。清空列表时用。 */
  clear(): void;
}

/**
 * 创建一个限并发队列。
 * @param limit 最大并发数，至少 1。
 * @returns 队列实例。
 */
export function createTaskQueue(limit: number): TaskQueue {
  const max = Math.max(1, Math.floor(limit));
  const queue: Array<() => Promise<unknown>> = [];
  let running = 0;

  /** 有空位就取下一个任务开跑。 */
  function pump(): void {
    while (running < max && queue.length) {
      const task = queue.shift();
      if (!task) break;
      running += 1;
      // 任务失败不能拖垮队列，否则一张坏图会让后面的全部不再执行
      void Promise.resolve()
        .then(task)
        .catch(() => {})
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }

  return {
    push(task) {
      queue.push(task);
      pump();
    },
    clear() {
      queue.length = 0;
    },
  };
}
