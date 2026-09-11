/**
 * 桌宠相关的 IPC 封装。
 *
 * 拖拽那三个一律 `{ silent: true }`：`dragMove` 每帧一次，失败弹 toast 会刷屏——
 * 而且桌宠窗口上压根没挂 message provider（它不该弹任何东西），提示也无处可弹。
 */
import type { PetHostTarget } from '@shared/types';
import type { PetRect } from '@shared/petWindow';
import { unwrap } from './ipc';

/**
 * 打开桌宠：建窗 + 隐藏主窗口。
 * @returns 是否处在桌宠模式。
 */
export function openPetApi(): Promise<boolean> {
  return unwrap(window.api.pet.open(), { errorPrefix: '打开桌宠失败' });
}

/**
 * 退出桌宠模式：显示主窗口 + 销毁桌宠窗口。
 * @returns 是否还在桌宠模式（正常路径是 false）。
 */
export function closePetApi(): Promise<boolean> {
  return unwrap(window.api.pet.close(), { errorPrefix: '关闭桌宠失败' });
}

/**
 * 查桌宠模式当前开着没有。
 * @returns 开着为 true。
 */
export function isPetOpenApi(): Promise<boolean> {
  return unwrap(window.api.pet.isOpen(), { silent: true });
}

/**
 * 菜单里的「隐藏桌宠」：收进系统托盘。**桌宠模式不退**，点托盘图标原样回来。
 *
 * `silent`：桌宠窗口没有 message provider，弹不了提示；托盘建不出来时主进程会**拒绝
 * 隐藏**（窗口原样留在桌面上），用户看到的就是「点了没反应」——总好过藏进一个叫不回来
 * 的地方。
 * @returns 是否真的藏起来了。
 */
export function hidePetApi(): Promise<boolean> {
  return unwrap(window.api.pet.hide(), { silent: true });
}

/**
 * 按下：让主进程记下拖拽基准。
 * @returns 是否记下了。
 */
export function petDragStartApi(): Promise<boolean> {
  return unwrap(window.api.pet.dragStart(), { silent: true });
}

/**
 * 拖拽中：送相对按下点的累计位移。
 * @param dx x 位移（屏幕坐标，DIP）。
 * @param dy y 位移。
 * @returns 是否移动了。
 */
export function petDragMoveApi(dx: number, dy: number): Promise<boolean> {
  return unwrap(window.api.pet.dragMove(dx, dy), { silent: true });
}

/**
 * 松手：落盘一次位置。
 * @returns 是否结束了一段拖拽。
 */
export function petDragEndApi(): Promise<boolean> {
  return unwrap(window.api.pet.dragEnd(), { silent: true });
}

/**
 * 展开 / 收起菜单（主进程把窗口临时放大 / 还原）。
 * @param open 是否展开。
 * @returns 新的窗口矩形。
 */
export function petSetMenuOpenApi(open: boolean): Promise<PetRect | null> {
  return unwrap(window.api.pet.setMenuOpen(open), { silent: true });
}

/**
 * 菜单里的「AI 对话」：开 AI 窗口，主窗口保持隐藏。
 * @returns 是否开成了。
 */
export function petOpenAiWindowApi(): Promise<boolean> {
  return unwrap(window.api.pet.openAiWindow(), { silent: true });
}

/**
 * 菜单里的「设置」/「打开 app 界面」：把主窗口拿回来。
 * @param target 主窗口要停在哪。
 * @returns 是否推给了主窗口。
 */
export function petShowHostApi(target: PetHostTarget): Promise<boolean> {
  return unwrap(window.api.pet.showHost(target), { silent: true });
}

/**
 * 菜单里的「退出 app」：整个进程退出。
 *
 * `silent`：这个调用成功的话进程就没了，失败也无处弹提示（桌宠窗口没有 message
 * provider）。
 * @returns 恒为 true（退出请求已发出）。
 */
export function petQuitAppApi(): Promise<boolean> {
  return unwrap(window.api.pet.quitApp(), { silent: true });
}

/**
 * 设置页保存后调：主进程重设窗口尺寸并通知桌宠窗口重读配置。
 * @param size 新的精灵边长。
 * @returns 新的窗口矩形（桌宠没开时为 null）。
 */
export function petApplyConfigApi(size: number): Promise<PetRect | null> {
  return unwrap(window.api.pet.applyConfig(size), { silent: true });
}
