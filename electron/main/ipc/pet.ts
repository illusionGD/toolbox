/**
 * 桌宠的 IPC 层。
 *
 * 这一组几乎全是**窗口动作**（建窗、隐藏主窗口、按位移摆位置、临时放大），所以清一色
 * 薄封装：真正的逻辑在 `pet/petWindow.ts`（窗口生命周期）与 `shared/petWindow.ts`
 * （纯几何，桩测断言的那份）里，这里只负责过一遍统一的 `{code,data,message}` 契约。
 */
import { PET_CHANNELS } from '../../shared/channels';
import type { PetHostTarget } from '../../shared/types';
import type { PetRect } from '../../shared/petWindow';
import { openPanelWindow } from '../ai/panelWindow';
import {
  applyPetConfig,
  beginPetDrag,
  closePetWindow,
  dragPetMove,
  endPetDrag,
  hidePetWindow,
  isPetWindowOpen,
  openPetWindow,
  quitAppFromPet,
  setPetMenuOpen,
  showHostFromPet,
} from '../pet/petWindow';
import { handle } from './helper';

/** 注册桌宠相关 IPC。 */
export function registerPetIpc(): void {
  handle<boolean>(PET_CHANNELS.open, async () => openPetWindow());
  handle<boolean>(PET_CHANNELS.close, async () => closePetWindow());
  handle<boolean>(PET_CHANNELS.isOpen, async () => isPetWindowOpen());

  // 菜单里的「隐藏桌宠」：收进系统托盘，**桌宠模式不退**。返回 false 表示托盘没建起来、
  // 窗口原样留在桌面上——那是故意的，藏进一个没有出口的地方比不藏更糟
  handle<boolean>(PET_CHANNELS.hide, async () => hidePetWindow());

  handle<boolean>(PET_CHANNELS.dragStart, async () => beginPetDrag());
  handle<boolean>(PET_CHANNELS.dragMove, async (_e, dx: number, dy: number) => dragPetMove(dx, dy));
  handle<boolean>(PET_CHANNELS.dragEnd, async () => endPetDrag());

  handle<PetRect | null>(PET_CHANNELS.setMenuOpen, async (_e, open: boolean) =>
    setPetMenuOpen(open),
  );

  // 菜单里的「AI 对话」：直接开现成的 AI 窗口，**主窗口保持隐藏**——用户要的是和小精灵
  // 说话，不是把整个工具箱翻出来
  handle<boolean>(PET_CHANNELS.openAiWindow, async () => {
    await openPanelWindow();
    return true;
  });

  handle<boolean>(PET_CHANNELS.showHost, async (_e, target: PetHostTarget) =>
    showHostFromPet(target),
  );

  // 菜单里的「退出 app」。注意它**不是** `app.quit()` 一句话就完的事：桌宠的 close
  // 拦截器会把退出请求拦掉，得先销毁桌宠——理由写在 pet/petWindow.ts 的 quitAppFromPet 上
  handle<boolean>(PET_CHANNELS.quitApp, async () => quitAppFromPet());

  // 设置页保存后调一次：主进程重设窗口尺寸，并让桌宠窗口去重读 `pet` 命名空间
  handle<PetRect | null>(PET_CHANNELS.configChanged, async (_e, size: number) =>
    applyPetConfig(size),
  );
}
