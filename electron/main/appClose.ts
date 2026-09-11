/**
 * 主窗口的关闭行为：**退出 app** / **最小化到托盘** / **每次询问**（用户 2026-09-11 提的
 * 优化，原话「关闭 app 可以选择退出 app 或者最小化托盘，可以用户设置」）。
 *
 * 为什么要有这个模块，而不是在 `ipc/window.ts` 里改一行 `win.close()`：**自绘的 ✕ 只是
 * 两条路里的一条**，`Alt+F4` 直接走窗口的 `close` 事件，压根不经 IPC。拦 `close` 这一个
 * 事件才同时管住两条路。
 *
 * 三件事决定了这个文件的形状，每件都有非它不可的理由：
 *
 * 1. **`close` 处理器是同步的。** `event.preventDefault()` 不能等一次
 *    `await readAppState()`（等回来窗口早关了），所以生效的动作在这里有一份**模块级缓存**
 *    {@link closeAction}：启动时异步载入，之后只由 {@link setCloseAction} 刷新。
 * 2. **`app.quit()` 会被我们自己的拦截器吃掉。** `app.quit()` 给每个窗口发 `close`，而
 *    拦截器一 `preventDefault()`，用户点的「退出 app」就什么都没发生——`pet/petWindow.ts`
 *    的 `quitAppFromPet` 早踩过这个坑。这里靠 `app.on('before-quit')` 置 {@link quitting}
 *    放行，**真 Electron 探针量过顺序：`before-quit` 先于窗口的 `close`**，所以标志一定
 *    赶得上。它守着三个入口：托盘「退出 app」、桌宠菜单「退出 app」、弹窗里的「退出」。
 * 3. **托盘建不起来就拒绝隐藏。** 主窗口一藏、桌宠又没开，托盘图标是唯一的出口；而这时候
 *    **不许改成静默退出**——那会把正在跑的 ffmpeg 转码一起杀掉，比不藏糟得多。所以
 *    `windowNav.hideHostToTray()` 看 `ensureTray` 的返回值，false 就把窗口原样留下、转而弹窗
 *    （弹窗里那个「最小化到托盘」会置灰）。收进托盘这件事本身放在 `windowNav.ts`：桌宠的
 *    「退出桌宠」也要用它，而本模块反过来要用 `isPetWindowOpen()`，放一起会成环。
 *
 * 顺带一条探针结论（写进 skill 的）：**`hide()` 不会触发 `window-all-closed`**
 * （隐藏窗口仍计入 `getAllWindows()`），所以收进托盘不会误退进程；隐藏期间**子进程一个
 * tick 都没少**（转码继续跑），但**渲染进程的计时器会被 Chromium 节流到约 1 次/秒**——
 * 进度条在托盘期间只是刷得慢，不是停了。
 */
import { app, type BrowserWindow } from 'electron';
import { WINDOW_CHANNELS } from '../shared/channels';
import {
  APP_CLOSE_ACTION_DEFAULT,
  normalizeCloseAction,
  type AppCloseAction,
  type AppCloseChoice,
} from '../shared/appWindow';
import type { AppWindowState } from '../shared/types';
import { isPetWindowOpen } from './pet/petWindow';
import { hideHostToTray } from './windowNav';
import { releaseTray } from './tray';
import { readAppState, writeAppState } from './storage/appState';

/** 关闭行为所在的命名空间（**主进程写**，渲染进程只读，见 types.ts 的 AppWindowState）。 */
const APP_WINDOW_NS = 'appWindow';

/** 主窗口。 */
let host: BrowserWindow | null = null;
/** 当前生效的关闭动作。**同步缓存**，理由见文件头第 1 条。 */
let closeAction: AppCloseAction = APP_CLOSE_ACTION_DEFAULT;
/** 正在退出整个 app（放行那一次 `close`，见文件头第 2 条）。 */
let quitting = false;

/**
 * 读出存下来的关闭动作。
 * @returns 合法动作；读不出来时是默认值（「每次询问」，最保守的那个）。
 */
async function loadCloseAction(): Promise<void> {
  try {
    const blob = await readAppState();
    const state = blob.entries[APP_WINDOW_NS] as AppWindowState | undefined;
    closeAction = normalizeCloseAction(state?.closeAction);
  } catch {
    // 读不出来就留着默认值：这条路上任何异常都不该让窗口关不掉
  }
}

/**
 * 记住主窗口，并把关闭行为挂上去。
 *
 * 在 `createWindow()` 里调，**排在 `initPetWindow()` 之后**：两个 `close` 监听器各管自己
 * 那一支（桌宠开着时这里直接早退，让桌宠那条 `hide()` 规则赢），但顺序写死了好读。
 * @param window 主窗口。
 */
export function initAppClose(window: BrowserWindow): void {
  host = window;

  // 文件头第 2 条：任何 app.quit() 都会先过这里，标志一置上，下面那个拦截器就放行
  app.on('before-quit', () => {
    quitting = true;
  });

  window.on('close', (event) => {
    // **必须是第一句。** 挪到 preventDefault 后面，「退出 app」就会被自己拦成最小化
    if (quitting) return;
    // 桌宠模式那条规则优先：那边会把这次 close 拦成 hide()（两个窗口寿命独立）
    if (isPetWindowOpen()) return;
    // 真关：照旧走 window-all-closed 退进程
    if (closeAction === 'quit') return;

    event.preventDefault();
    if (closeAction === 'tray' && hideHostToTray()) return;
    // 'ask'，或者「最小化到托盘」但托盘建不起来（文件头第 3 条）
    promptClose();
  });

  // 主窗口重新露面就撤托盘。**听 `show` 而不是只在托盘菜单里撤**：把它从托盘里拉回来的
  // 路不止一条——AI 窗口的 ⚙（showHostWindow）也算一条，那条路不经过托盘菜单
  window.on('show', () => releaseTray('host'));

  void loadCloseAction();
}

/** 让主窗口弹「关闭确认」弹窗。 */
function promptClose(): void {
  host?.webContents.send(WINDOW_CHANNELS.closePrompt);
}

/**
 * 当前生效的关闭动作。
 * @returns 关闭动作。
 */
export function getCloseAction(): AppCloseAction {
  return closeAction;
}

/**
 * 改关闭动作：刷新缓存 + 落盘。
 *
 * 缓存**先改**再落盘：落盘可能失败（数据目录不可写），但那不该让这次设置在本次会话里
 * 也不生效。
 * @param action 新动作（脏值会被归一化）。
 */
export async function setCloseAction(action: unknown): Promise<AppCloseAction> {
  closeAction = normalizeCloseAction(action);
  try {
    await writeAppState({ [APP_WINDOW_NS]: { closeAction } satisfies AppWindowState });
  } catch {
    // 记不住不影响本次生效，静默
  }
  return closeAction;
}

/**
 * 执行用户在确认弹窗里点的那一下。
 * @param choice 取消 / 退出 / 最小化到托盘。
 * @param remember 是否把这次的选择记成设置（`cancel` 不记，理由见 AppCloseChoice 的注释）。
 * @returns 是否真做到了。只有「最小化到托盘」会因为托盘不可用而回 false——渲染进程据此
 *   把弹窗留在屏幕上并置灰那个按钮。
 */
export async function resolveClose(choice: AppCloseChoice, remember: boolean): Promise<boolean> {
  if (choice === 'cancel') return true;
  if (choice === 'tray' && !hideHostToTray()) return false;
  // **记在动作之后**：托盘那条路可能失败，失败了就不该把「最小化到托盘」记成偏好
  if (remember) await setCloseAction(choice);
  if (choice === 'quit') app.quit();
  return true;
}
