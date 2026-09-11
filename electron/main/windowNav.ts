/**
 * 主窗口的「把它拉到前面」这件事，两个独立窗口共用一份。
 *
 * 原本只有 AI 窗口需要它（点 ⚙ 跳设置页），#26 的桌宠又要了同一件事、而且多两种去向
 * （「打开 app 界面」不跳路由、「设置」跳设置页），于是从 `ai/panelWindow.ts` 抽出来。
 *
 * **主窗口的引用也存在这里**：桌宠会把主窗口 `hide()` 掉，两个子窗口都得摸到同一个
 * 实例，各存一份迟早会出现「一个已经置 null、另一个还拿着废引用」。
 */
import { app, type BrowserWindow } from 'electron';
import { AI_CHANNELS } from '../shared/channels';
import type { PetHostTarget } from '../shared/types';
import { ensureTray } from './tray';

/** 主窗口；已销毁时为 null。 */
let host: BrowserWindow | null = null;

/**
 * 登记主窗口。在 `createWindow()` 里、各子窗口的 init 之前调一次。
 * @param window 主窗口。
 */
export function initWindowNav(window: BrowserWindow): void {
  host = window;
  window.on('closed', () => {
    host = null;
  });
}

/**
 * 取主窗口。
 * @returns 主窗口；没建或已销毁时是 null。
 */
export function getHostWindow(): BrowserWindow | null {
  return host && !host.isDestroyed() ? host : null;
}

/**
 * 把主窗口拉到前面（必要时先从最小化 / 隐藏里恢复）。
 *
 * `show()` 不能省：桌宠模式下主窗口是被 `hide()` 掉的，只 `focus()` 一个隐藏窗口
 * 在 Windows 上什么都不会发生——用户会以为按钮坏了。
 * @param target `'settings'` 时顺带让它跳到设置页。
 * @returns 是否真推给了主窗口。
 */
export function showHostWindow(target: PetHostTarget = 'app'): boolean {
  const window = getHostWindow();
  if (!window) return false;
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
  // 主窗口自己没有「跳设置页」的 IPC，复用 AI 窗口那条现成的（渲染进程一处订阅两处触发）
  if (target === 'settings') window.webContents.send(AI_CHANNELS.navigateSettings);
  return true;
}

/**
 * 反向那一半：把主窗口收进系统托盘。
 *
 * 两个调用方，**都指着「此刻屏幕上一个窗口都不剩」这件事**：
 * - 关闭行为设成「最小化到托盘」时点 ✕（见 `appClose.ts`）；
 * - 桌宠菜单的「退出桌宠」——桌宠消失，app 不弹出来（用户 2026-09-11 定的
 *   「退出桌宠不需要重新打开 app」）。
 *
 * 放在这里而不是 `appClose.ts`：`pet/petWindow.ts` 要用它，而 `appClose.ts` 反过来要用
 * `isPetWindowOpen()`——两边互相 import 会成环。本模块本来就是「主窗口露不露面」的那一层。
 *
 * **先确认托盘建起来了再 `hide()`**，顺序不能反：反过来的话窗口已经没了、托盘又没建出来，
 * 用户手里就只剩任务管理器。返回 false 时调用方**必须回落到显示窗口或别的出口**。
 * @returns 是否真藏起来了；托盘不可用时返回 false，**窗口原样留着**。
 */
export function hideHostToTray(): boolean {
  const window = getHostWindow();
  if (!window) return false;
  if (
    !ensureTray({
      owner: 'host',
      tooltip: 'Toolbox 已最小化到托盘 —— 点一下打开',
      // **不放「打开桌宠」**：全进程只有一个 Tray 实例，「两个托盘永不共存」这个结论的前提
      // 就是这里没有通往桌宠模式的入口（见 tray.ts 文件头）
      items: [{ label: '打开 app 界面', click: () => void showHostWindow('app') }],
      onClick: () => void showHostWindow('app'),
      onQuit: () => app.quit(),
    })
  ) {
    return false;
  }
  window.hide();
  return true;
}
