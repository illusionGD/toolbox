/**
 * 桌宠窗口（第二个独立的无边框透明 `BrowserWindow`）。
 *
 * 结构逐条照 `ai/panelWindow.ts`（那套已经跑通：模块级单例、防抖落盘、存的 bounds
 * 重新夹回当前显示器、host 关掉时销毁子窗口），差别只在三处，每处都有非做不可的理由：
 *
 * 1. **开桌宠会把主窗口 `hide()` 掉**（需求 1）。于是桌宠成了回到 app 的唯一入口，
 *    这条硬规则贯穿整个文件：桌宠窗口**关不掉**（`close` 一律拦成「退出桌宠模式」，
 *    也就是「桌宠退场 + app 收进托盘」——**退出桌宠不把主窗口弹出来**，用户 2026-09-11
 *    定的，见 {@link closePetWindow}），否则用户会把自己锁在一个没有任何界面的进程里。
 *    反过来，**主窗口关不掉桌宠**：桌宠开着时主窗口的 `close` 被拦成 `hide()`
 *    （见 {@link initPetWindow}），两个窗口的寿命是各自独立的。
 * 2. **拖拽是手写的**（见 `dragPetMove`），不是 `-webkit-app-region: drag`——那玩意
 *    分不清点击与拖拽（需求 5 要点击弹菜单），也拿不到「拖拽中 / 放下」两个动画态。
 * 3. **菜单靠临时放大窗口**（见 `setPetMenuOpen`），不常驻大透明窗口、不开第三个窗口。
 */
import { app, BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { registerExternalLinkGuards } from '../externalLinks';
import { getPanelWindow } from '../ai/panelWindow';
import { getHostWindow, hideHostToTray, showHostWindow } from '../windowNav';
import { PET_CHANNELS } from '../../shared/channels';
import type { PetHostTarget, PetWindowState } from '../../shared/types';
import { normalizePetConfig } from '../../shared/pet';
import {
  clampPetBounds,
  clampPetSize,
  defaultPetBounds,
  dragPetBounds,
  parsePetBounds,
  petMenuBounds,
  petWindowSize,
  PET_TOPMOST_REASSERT_MS,
  type PetRect,
} from '../../shared/petWindow';
import { ensureTray, releaseTray } from '../tray';
import { readAppState, writeAppState } from '../storage/appState';

/** 桌宠窗口状态所在的命名空间（**主进程写**）。 */
const PET_WINDOW_NS = 'petWindow';
/** 桌宠配置所在的命名空间（**渲染进程 store 整块写**，这里只读）。 */
const PET_CONFIG_NS = 'pet';
/** 位置落盘防抖毫秒数。拖动时每帧都在动，不防抖会刷爆写盘。 */
const SAVE_DEBOUNCE = 400;

/** 桌宠窗口；没开时为 null。 */
let pet: BrowserWindow | null = null;
/** 落盘防抖计时器。 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 按下那一刻的窗口矩形。拖拽全程以它为基准做**绝对**计算，绝不增量累加。 */
let dragOrigin: PetRect | null = null;
/** 菜单是否展开（窗口比精灵大的时候为 true）。 */
let menuOpen = false;
/** 当前生效的精灵边长。 */
let petSize = clampPetSize(undefined);
/** 正在退出桌宠模式（用来放行那一次 `close`，见 `closePetWindow`）。 */
let closing = false;
/** 周期性把桌宠抬回置顶的计时器（见 {@link startTopmostGuard}）。 */
let topmostTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 周期性把桌宠重新抬到最上面。
 *
 * **`alwaysOnTop: true` 只把窗口放进「置顶那一层」，层内还要再排一次队，而后来者在前。**
 * 真 Electron 探针量到的：桌宠先开着（z 序名次 1），随后新建一个同样 `alwaysOnTop` 的
 * 窗口，桌宠立刻掉到它下面（名次 2）——**会议软件共享屏幕时那条悬浮工具条就是这么把桌宠
 * 压下去的**（review 第四轮报的「一录屏桌宠就不见了，图层下去了」）。
 *
 * 为什么是轮询而不是听事件：悬浮条出现时桌宠**不会** blur（它本来就没有焦点），
 * 也没有任何「我被别人盖住了」的事件可听。
 *
 * 为什么用 `moveTop()` 而不是再调一次 `setAlwaysOnTop(true)`：同一批探针里两者都能抢回来
 * （名次分别是 0 和 1），但 `moveTop()` 更彻底、**不抢焦点**、100 次只要 3 ms，而且
 * **不动窗口尺寸**——`setPosition` 那个把 `160×160` 撑成 `296×256` 的坑就在隔壁，任何
 * 会碰几何的 API 在这里都要先量过再用。
 */
function startTopmostGuard(): void {
  if (topmostTimer) return;
  topmostTimer = setInterval(() => {
    // 隐藏（收进托盘）时不抬：那会儿窗口不在桌面上，抬了也没意义
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return;
    pet.moveTop();
  }, PET_TOPMOST_REASSERT_MS);
}

/** 停掉置顶守卫。**窗口销毁时必须调**，否则这个 interval 会把事件循环一直吊着。 */
function stopTopmostGuard(): void {
  if (!topmostTimer) return;
  clearInterval(topmostTimer);
  topmostTimer = null;
}

/**
 * 读出存下来的桌宠窗口状态。
 * @returns 窗口状态；读不出来时是空对象（回落到默认位置，而不是开不出来）。
 */
async function loadWindowState(): Promise<PetWindowState> {
  try {
    const blob = await readAppState();
    const value = blob.entries[PET_WINDOW_NS];
    return typeof value === 'object' && value !== null ? (value as PetWindowState) : {};
  } catch {
    return {};
  }
}

/**
 * 读出桌宠配置里的大小。
 *
 * 只取 `size` 一个字段：其余的（资源路径、动画映射）主进程一概不关心，那是渲染进程
 * 自己去读 `pet` 命名空间的事。
 * @returns 合法区间内的边长。
 */
async function loadPetSize(): Promise<number> {
  try {
    const blob = await readAppState();
    return clampPetSize(normalizePetConfig(blob.entries[PET_CONFIG_NS]).size);
  } catch {
    return clampPetSize(undefined);
  }
}

/**
 * 防抖把当前位置与开关状态写进 `petWindow` 命名空间。
 *
 * 存的是**收起态的矩形**：菜单展开时窗口比精灵大，照原样存下去，下次开窗就会开出一个
 * 带着菜单余量的怪尺寸。
 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const current = currentPetRect();
    if (!current) return;
    const bounds = petMenuBounds(current, petSize, false, currentWorkArea(current));
    void writeAppState({
      [PET_WINDOW_NS]: { bounds, enabled: true } satisfies PetWindowState,
    }).catch(() => {
      // 位置记不住不影响桌宠本身，静默
    });
  }, SAVE_DEBOUNCE);
}

/**
 * 立刻写一次开关状态（不防抖）。
 *
 * 开 / 关桌宠是低频动作，而且**关的时候窗口马上就没了**，等防抖到点就来不及读它的
 * bounds 了——所以这条独立于 `scheduleSave`。
 * @param enabled 是否处在桌宠模式。
 * @param bounds 要一起存的位置；省略时不动已存的位置。
 */
async function saveEnabled(enabled: boolean, bounds?: PetRect): Promise<void> {
  try {
    const state = await loadWindowState();
    await writeAppState({
      [PET_WINDOW_NS]: { bounds: bounds ?? state.bounds, enabled } satisfies PetWindowState,
    });
  } catch {
    // 同上，静默
  }
}

/**
 * 取某个矩形所在显示器的工作区。
 * @param rect 屏幕坐标下的矩形。
 * @returns 工作区矩形。
 */
function currentWorkArea(rect: PetRect): PetRect {
  return screen.getDisplayMatching(rect).workArea;
}

/**
 * 当前窗口矩形，但**尺寸按我们自己认定的值**，不用 `getBounds()` 回来的那两个数。
 *
 * 位置必须问窗口（用户可能刚拖过），尺寸不能问：非整数缩放（本机 1.25）下 `getBounds()`
 * 会回 161 这种数——探针量到过。而 `petMenuBounds` 是**按右下角锚点反推左上角**的，
 * 拿一个偏 1px 的宽高进去，每开合一次菜单精灵就挪一格，几次之后肉眼可见。
 * @returns 归一化后的窗口矩形；窗口没开时是 null。
 */
function currentPetRect(): PetRect | null {
  if (!pet || pet.isDestroyed()) return null;
  const { x, y } = pet.getBounds();
  return { x, y, ...petWindowSize(petSize, menuOpen) };
}

/**
 * 算出这次该开在哪。
 * @returns 屏幕坐标下的窗口矩形（收起态）。
 */
async function resolveBounds(): Promise<PetRect> {
  const state = await loadWindowState();
  const saved = parsePetBounds(state.bounds);
  if (saved) {
    // **必须重新夹一次**：上次存的位置可能来自一块已经拔掉的显示器
    return clampPetBounds({ ...saved, width: petSize, height: petSize }, currentWorkArea(saved));
  }
  const reference = getHostWindow()?.getBounds();
  const display = reference ? screen.getDisplayMatching(reference) : screen.getPrimaryDisplay();
  return defaultPetBounds(display.workArea, petSize);
}

/**
 * 记住主窗口与桌宠的关系。**桌宠的寿命独立于主窗口**（review 定的）。
 *
 * 两件事：
 *
 * 1. **桌宠开着的时候，主窗口的 `close` 转成 `hide()`。** 用户原话是「如果打开桌宠，
 *    那么关闭 app 的时候，不关闭桌宠，桌宠窗口的关闭是独立的」。关标题栏那个 ✕（以及
 *    `Alt+F4`）不该把小精灵一起带走——真要整个退出，桌宠菜单里有「退出 app」。
 *    拦成 `hide()` 而不是「真关掉再按需重建」，是因为重建主窗口要把 `createWindow()`
 *    拆成两半（那里面还顺带注册了十几组 `ipcMain.handle`，重复注册会直接抛）；而
 *    `hide()` 之后 `showHostWindow()` 一行都不用改，桌宠随时能把它拿回来。
 *    对用户来说两者看起来一样：主窗口没了、任务栏图标也没了（桌宠 `skipTaskbar`）。
 *    桌宠此刻正躺在托盘里（{@link hidePetWindow}）也照拦不误——那时托盘图标是出口，
 *    它的菜单里有「打开 app 界面」和「退出 app」。
 * 2. **主窗口真的被销毁时（走「退出 app」那条路），把桌宠一起销毁。** 否则进程里会剩
 *    一个 `skipTaskbar` 的窗口，任务栏上连个能点的图标都没有。
 * @param window 主窗口。
 */
export function initPetWindow(window: BrowserWindow): void {
  window.on('close', (event) => {
    // 桌宠没开着 = 普通的关窗，照旧走 window-all-closed 退出进程
    if (!isPetWindowOpen()) return;
    event.preventDefault();
    window.hide();
  });

  window.on('closed', () => {
    if (pet && !pet.isDestroyed()) {
      closing = true;
      pet.destroy();
    }
  });
}

/**
 * 启动时恢复上次的桌宠模式。
 *
 * 在 `createWindow()` 末尾调。上次退出时停在桌宠模式的话，这次也该直接进桌宠——
 * 否则「切到桌宠 → 关掉 app → 再开」会莫名其妙地回到工具箱窗口。
 */
export async function restorePetWindow(): Promise<void> {
  const state = await loadWindowState();
  if (state.enabled === true) await openPetWindow();
}

/** 把桌宠模式的开关状态推给主窗口（标题栏那个 logo 入口按它显示）。 */
function notifyHost(open: boolean): void {
  getHostWindow()?.webContents.send(PET_CHANNELS.stateChanged, open);
}

/**
 * 打开桌宠：建窗 + **隐藏主窗口**（需求 1）。
 * @returns 是否处在桌宠模式（已经开着时也回 true）。
 */
export async function openPetWindow(): Promise<boolean> {
  if (pet && !pet.isDestroyed()) {
    // 已经在托盘里躺着 = 用户点标题栏 logo 想把它叫回来（隐藏时 notifyHost(false) 过，
    // 所以那个入口这会儿显示的是「没开」）
    if (!pet.isVisible()) return showPetWindow();
    if (pet.isMinimized()) pet.restore();
    pet.focus();
    return true;
  }

  petSize = await loadPetSize();
  const bounds = await resolveBounds();
  menuOpen = false;

  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    // 尺寸由配置里的「桌宠大小」决定，不给用户拖边角。
    // 注意：**resizable:false 挡不住 setBounds**（真 Electron 探针量过），菜单展开
    // 那一下照样改得动尺寸——这正是 2.2 那个方案成立的前提
    resizable: false,
    // 桌宠不给置顶开关，它就是常驻的
    alwaysOnTop: true,
    // 任务栏里不该出现第二个图标；也正因为如此它不能是唯一出口（见文件头规则 1）
    skipTaskbar: true,
    // 透明窗口带阴影会在 Windows 上画出一圈矩形边
    hasShadow: false,
    // 菜单要能收到点击。但**不要**在 blur 时自动隐藏菜单——拖拽过程中窗口会 blur
    focusable: true,
    autoHideMenuBar: true,
    title: '桌宠',
    icon: join(__dirname, '../renderer/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });
  pet = window;

  window.on('ready-to-show', () => {
    window.show();
    startTopmostGuard();
  });
  // 只听 moved/resized：程序性的 setPosition/setBounds 只触发 move/resize（探针量过），
  // 所以拖拽每帧的 setPosition 不会排一次写盘，dragEnd 里显式存一次就够了
  window.on('moved', scheduleSave);
  window.on('resized', scheduleSave);

  /**
   * 关闭拦截 —— **文件头规则 1 的落地点**。
   *
   * 桌宠模式下主窗口是隐藏的，桌宠又 `skipTaskbar`。要是让 `Alt+F4` 真把它关掉，
   * 进程就变成一个没有任何界面、也没有任务栏图标的僵尸。所以一律转成「退出桌宠模式」。
   */
  window.on('close', (event) => {
    if (closing) return;
    event.preventDefault();
    void closePetWindow();
  });

  window.on('closed', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    stopTopmostGuard();
    // 托盘只在「隐藏」期间存在，但窗口有可能是在隐藏状态下被销毁的（退出 app）——
    // 不撤掉的话托盘区会留一个点了什么都不会发生的图标。用 releaseTray('pet') 而不是
    // destroyTray()：这一刻托盘也可能是主窗口占着的（关闭行为设成「最小化到托盘」），
    // 那不该被桌宠顺手撤掉
    releaseTray('pet');
    pet = null;
    dragOrigin = null;
    menuOpen = false;
  });

  registerExternalLinkGuards(window.webContents);

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?pet=1`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { pet: '1' } });
  }

  getHostWindow()?.hide();
  await saveEnabled(true, bounds);
  notifyHost(true);
  return true;
}

/**
 * 退出桌宠模式：桌宠消失，**app 收进系统托盘**（不把主窗口弹出来）。
 *
 * 用户 2026-09-11 定的：「退出桌宠不需要重新打开 app」。原先这里是 `showHostWindow('app')`
 * ——点一下「退出桌宠」，整个工具箱窗口就糊到脸上，而用户的本意往往只是「让小精灵下班」。
 *
 * **必须先把托盘建起来再销毁桌宠**，顺序不能反：这条路走完屏幕上一个窗口都不剩，托盘图标
 * 是唯一的出口（主窗口此刻是隐藏的，桌宠又 `skipTaskbar`）。反过来的话中间会出现一小段
 * 「既没有窗口也没有托盘」的时间，而万一托盘就是建不起来，那就是个彻底叫不回来的进程。
 * 所以托盘不可用时**回落到显示主窗口**——那是旧行为，不好看但绝对有出口。
 *
 * **主窗口此刻已经露着的话，一个字都不动它。** AI 窗口的 ⚙ 能在桌宠开着的时候把主窗口叫
 * 出来，那时用户正看着 app 点「退出桌宠」，把窗口收进托盘等于当着他的面把 app 关了。
 * @returns 是否还处在桌宠模式（正常路径恒为 false）。
 */
export async function closePetWindow(): Promise<boolean> {
  const current = currentPetRect();
  // 桌宠模式下主窗口是隐藏的，这一下真正要的是「把托盘图标立起来」（hide() 顺带是幂等的）
  if (getHostWindow()?.isVisible() !== true && !hideHostToTray()) showHostWindow('app');
  if (pet && !pet.isDestroyed()) {
    closing = true;
    pet.destroy();
    closing = false;
  }
  await saveEnabled(
    false,
    current ? petMenuBounds(current, petSize, false, currentWorkArea(current)) : undefined,
  );
  notifyHost(false);
  return false;
}

/**
 * 桌宠模式当前开着没有。
 * @returns 开着为 true。
 */
export function isPetWindowOpen(): boolean {
  return pet !== null && !pet.isDestroyed();
}

/**
 * 菜单里的「隐藏桌宠」：把窗口收进系统托盘（review 第四轮加的）。
 *
 * 和「退出桌宠」是两码事：这里**不销毁窗口、不把主窗口叫回来**，桌宠模式还在，位置、
 * 大小、正在播的动画一个都不动，点托盘图标原样回来。
 *
 * **必须先确认托盘建起来了再 `hide()`**，这是文件头硬规则 1 在隐藏这条路上的形态：
 * 隐藏之后主窗口多半也是隐藏的，桌宠又 `skipTaskbar`，托盘图标就是唯一能点的东西。
 * 而空图标的 `new Tray()` 在 Windows 上**照建不误也不抛**（探针量过），所以
 * `ensureTray` 是自己查过 `isEmpty()` 的——这里只要老实看它的返回值。
 *
 * 隐藏时**广播「桌宠模式关了」**：标题栏那个 logo 入口跟着变回「未开启」，于是用户点它
 * 就是「把桌宠叫回来」（`openPetWindow` 认得这个隐藏态）。让一个看不见的东西显示成
 * 「开着」、点一下还把它彻底退掉，才是真正会让人懵的那种。
 * @returns 是否真的藏起来了；托盘建不出来时返回 false，**窗口原样留在桌面上**。
 */
export function hidePetWindow(): boolean {
  if (!pet || pet.isDestroyed()) return false;
  if (
    !ensureTray({
      owner: 'pet',
      tooltip: '桌宠已隐藏 —— 点一下放回桌面',
      items: [
        { label: '显示桌宠', click: () => void showPetWindow() },
        // 从托盘打开主窗口时**桌宠继续躺在托盘里**：用户要的是 app 界面，不是把小精灵
        // 也一起翻出来（真要它回来，托盘第一项就是）
        { label: '打开 app 界面', click: () => void showHostWindow('app') },
      ],
      onClick: () => void showPetWindow(),
      onQuit: () => void quitAppFromPet(),
    })
  ) {
    return false;
  }
  // 菜单是展开着的（用户就是从菜单里点的这一项），收起来再藏：留着的话下次显示出来
  // 窗口还是放大状态，精灵旁边挂着一片透明区
  setPetMenuOpen(false);
  stopTopmostGuard();
  pet.hide();
  notifyHost(false);
  return true;
}

/**
 * 从托盘放回桌面。
 * @returns 是否放回来了（窗口已经销毁时是 false）。
 */
export function showPetWindow(): boolean {
  if (!pet || pet.isDestroyed()) return false;
  releaseTray('pet');
  if (pet.isMinimized()) pet.restore();
  pet.show();
  // 藏了一会儿再出来，置顶层里的队早排到别人前头去了，显式抬一次而不是等守卫下一拍
  pet.moveTop();
  startTopmostGuard();
  notifyHost(true);
  return true;
}

/**
 * 桌宠菜单里的「退出 app」：整个进程退出。
 *
 * **不能只写一句 `app.quit()`。** `app.quit()` 给每个窗口发 `close`，而本文件那个
 * `close` 拦截器（规则 1 的落地点）会无条件 `preventDefault()`——退出会被桌宠自己
 * 悄悄拦掉，用户点了「退出 app」却什么都没发生。所以这里**先带 `closing` 标志把桌宠
 * 销毁掉**，再 `app.quit()`：剩下那个隐藏着的主窗口没有拦截器，关掉后
 * `window-all-closed` 收尾（见 index.ts）。
 *
 * `enabled` 刻意**留成 true**：用户是在桌宠模式下退出的，下次启动就该还在桌宠模式
 * （`restorePetWindow` 读的就是它）。这跟「退出桌宠」不同——那条是明确要回工具箱。
 * @returns 恒为 true（退出请求已发出）。
 */
export async function quitAppFromPet(): Promise<boolean> {
  const current = currentPetRect();
  if (pet && !pet.isDestroyed()) {
    // 位置落盘是 400ms 防抖的，刚拖完就退出会把这一次的位置丢掉，所以这里同步补一次
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (current) {
      await saveEnabled(true, petMenuBounds(current, petSize, false, currentWorkArea(current)));
    }
    closing = true;
    pet.destroy();
    closing = false;
  }
  app.quit();
  return true;
}

/**
 * 桌宠菜单里的「设置」/「打开 app 界面」。
 *
 * **这两项不关桌宠**：用户原话是「桌宠算是整个工具的小精灵，拥有整个 app 的控制权」，
 * 它退场了控制权就没了，所以「显示主窗口」和「退出桌宠模式」是两码事。要退出的话，
 * 菜单里另有「退出桌宠」（`closePetWindow`）与「退出 app」（{@link quitAppFromPet}），
 * 主窗口标题栏那个 logo 入口也还在。
 * @param target 主窗口要停在哪。
 * @returns 是否真推给了主窗口。
 */
export function showHostFromPet(target: PetHostTarget): boolean {
  setPetMenuOpen(false);
  return showHostWindow(target);
}

/**
 * 记下按下那一刻的窗口矩形，作为整段拖拽的基准。
 * @returns 是否记下了（窗口没开时是 false）。
 */
export function beginPetDrag(): boolean {
  if (!pet || pet.isDestroyed()) return false;
  // 拖拽先把菜单收掉：菜单展开时窗口是大的，拿它当基准会让精灵在松手瞬间跳一下。
  // **基准取 setPetMenuOpen 返回的那个矩形，不要再 getBounds() 问一遍**：刚
  // setBounds 完立刻回读，Windows 上可能还是旧尺寸（缩放是异步落到窗口上的），
  // 于是基准比真实窗口高一截，第一帧就把精灵甩上去 24px。返回值是主进程自己算的，
  // 不受这个时序影响。
  const base = setPetMenuOpen(false) ?? pet.getBounds();
  // **尺寸一律按 petSize 现算，不信 getBounds() 回来的那两个数。** 非整数缩放下
  // `getBounds()` 会回 161 而不是 160（探针量到的，见 `dragPetMove`）；把它当基准
  // 带进整段拖拽，等于让这个误差在每一帧里复现一次。
  dragOrigin = { ...base, width: petSize, height: petSize };
  return true;
}

/**
 * 拖拽中：按**起始 bounds + 从按下点算起的累计位移**摆到新位置。
 *
 * 累计位移而不是「上一帧到这一帧的增量」，是因为每帧都会写一次位置，而写位置会回灌
 * 窗口自己的 `move` 事件；增量写法会把取整误差和回灌事件一起滚雪球，拖着拖着精灵就
 * 跑偏了。绝对计算天然幂等（桩测里断言了这条）。
 *
 * **写位置必须用 `setBounds` 并显式带上宽高，绝不能用 `setPosition`。** 真 Electron
 * 探针在本机（`scaleFactor = 1.25`）量到的：同一个透明无边框窗口，`setPosition` 连打
 * 120 次之后 `160×160` 变成了 **`296×256`**——位置是对的，**尺寸自己一路膨胀**，因为
 * 非整数缩放下每次都要做一遍 DIP ↔ 物理像素往返取整，而 `setPosition` 那条路会顺带把
 * 尺寸重算进去。改成每帧 `setBounds({...next, width, height})`（宽高恒定）跑同样 120
 * 次，尺寸逐字不变。
 *
 * 渲染进程那边是 `align-items: flex-end` 贴底的，窗口一路长高精灵就一路往下掉——review
 * 报的「拖拽中图片会下移」「宽高越来越大」是**同一个** bug 的两副面孔。改样式治不了它。
 *
 * 宽高取的是 {@link petSize} 而不是 `dragOrigin.width`：`getBounds()` 在 1.25 缩放下
 * 会回 161 这种数（探针也量到了），拿它写回去等于把误差固化。
 *
 * 工作区按**落点**取而不是按起点取，这样跨屏拖拽时夹紧的边界会跟着换屏。
 * @param dx 相对按下点的 x 位移（屏幕坐标，DIP）。
 * @param dy 相对按下点的 y 位移。
 * @returns 是否移动了。
 */
export function dragPetMove(dx: number, dy: number): boolean {
  if (!pet || pet.isDestroyed() || !dragOrigin) return false;
  const target = { x: dragOrigin.x + dx, y: dragOrigin.y + dy };
  const workArea = screen.getDisplayNearestPoint({
    x: Math.round(target.x + dragOrigin.width / 2),
    y: Math.round(target.y + dragOrigin.height / 2),
  }).workArea;
  const next = dragPetBounds(dragOrigin, dx, dy, workArea);
  pet.setBounds({ x: next.x, y: next.y, width: petSize, height: petSize });
  return true;
}

/**
 * 拖拽结束：清掉基准并存一次位置。
 * @returns 是否结束了一段拖拽。
 */
export function endPetDrag(): boolean {
  if (!dragOrigin) return false;
  dragOrigin = null;
  scheduleSave();
  return true;
}

/**
 * 菜单展开 / 收起：把窗口临时放大 / 还原。
 *
 * 精灵**始终锚在窗口右下角**，窗口向左上生长，所以展开前后精灵在屏幕上一动不动
 * （`petMenuBounds` 保证这点，桩测断言了「右下角坐标逐字相等」）。
 * @param open 是否展开。
 * @returns 展开后的窗口矩形；窗口没开时是 null。
 */
export function setPetMenuOpen(open: boolean): PetRect | null {
  const current = currentPetRect();
  if (!pet || pet.isDestroyed() || !current) return null;
  if (menuOpen === open) return current;
  menuOpen = open;
  const next = petMenuBounds(current, petSize, open, currentWorkArea(current));
  pet.setBounds(next);
  return next;
}

/**
 * 设置页改了桌宠大小 / 换了资源 / 换了 AI 头像：重设窗口尺寸并把「配置变了」推给
 * **所有读这份配置的窗口**。
 *
 * 尺寸变化保持**右下角对齐**（同菜单展开的锚点），否则把桌宠调大一次它就往右下跑一截。
 *
 * 收信人有两个，而且**都不能省**：
 * - 桌宠窗口——它按配置决定显示哪张图；
 * - **AI 窗口**——助手头像在这份配置里（`aiAvatarRef`，review 加的）。少推这一条的表现是
 *   「在设置页换了头像，已经开着的对话窗口还挂着旧头像，得关掉重开」。
 *
 * 广播**排在尺寸处理之前**，因为桌宠没开着的时候这个函数会早早返回 null，而那时候
 * AI 窗口可能正开着——头像不该因为「桌宠此刻没站在桌面上」就不更新。
 * @param size 新的精灵边长（会被夹进合法区间）。
 * @returns 新的窗口矩形；桌宠窗口没开时是 null。
 */
export function applyPetConfig(size: number): PetRect | null {
  // **锚点要在改 petSize 之前取**：currentPetRect() 用的就是 petSize，先改了它
  // 算出来的右下角就是「新尺寸摆在老位置上」的那个角，桌宠会随着调大小往右下爬。
  const current = currentPetRect();
  petSize = clampPetSize(size);
  // 配置整块在 `pet` 命名空间里，收到通知的窗口自己 refreshAppState + 重读，
  // 所以这里只送一个「变了」的信号，不把配置塞进 payload（免得两份数据对不上）
  getPanelWindow()?.webContents.send(PET_CHANNELS.configChanged);
  if (!pet || pet.isDestroyed() || !current) return null;
  const next = petMenuBounds(current, petSize, menuOpen, currentWorkArea(current));
  pet.setBounds(next);
  pet.webContents.send(PET_CHANNELS.configChanged);
  scheduleSave();
  return next;
}
