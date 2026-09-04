/**
 * AI 对话窗口（独立的无边框 `BrowserWindow`）。
 *
 * **为什么是独立窗口而不是 app 里的浮动面板**：用户要求「可以拖拽出 app」——DOM 面板
 * 越过窗口边界只会被裁掉，拖到第二块屏幕、置顶盖住其他程序这两件事只有真窗口做得到。
 * 代价是多一个渲染进程入口，收益是拖动/缩放/多屏全交给 OS，我们一行几何代码都不用写。
 *
 * 它**载入的是同一个 `index.html`，只多一个 `?ai=1`**：渲染进程据此挂 `AiPanelWindow`
 * 而不是 `App`。这样 electron-vite 的 renderer 入口保持一个，不必维护第二份 html 与 bundle。
 */
import { BrowserWindow, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { registerExternalLinkGuards } from '../externalLinks';
import { AI_CHANNELS } from '../../shared/channels';
import type { AiWindowState } from '../../shared/types';
import {
  AI_PANEL_MIN_HEIGHT,
  AI_PANEL_MIN_WIDTH,
  clampPanelBounds,
  defaultPanelBounds,
  parsePanelBounds,
  type PanelRect,
} from '../../shared/aiPanel';
import { readAppState, writeAppState } from '../storage/appState';

/** 窗口状态所在的应用状态命名空间。 */
const AI_WINDOW_NS = 'aiWindow';
/** 位置尺寸落盘防抖毫秒数。拖动窗口时 `move` 会连续触发，不防抖会刷爆写盘。 */
const SAVE_DEBOUNCE = 400;

/** 主窗口（推送与默认位置都要用它）。 */
let host: BrowserWindow | null = null;
/** AI 对话窗口；没开时为 null。 */
let panel: BrowserWindow | null = null;
/** 落盘防抖计时器。 */
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 当前置顶状态（开窗口时从磁盘读，切换时更新）。 */
let alwaysOnTop = false;

/**
 * 读出存下来的窗口状态。
 * @returns 窗口状态；读不到或格式不对时是空对象。
 */
async function loadWindowState(): Promise<AiWindowState> {
  try {
    const blob = await readAppState();
    const value = blob.entries[AI_WINDOW_NS];
    return typeof value === 'object' && value !== null ? (value as AiWindowState) : {};
  } catch {
    // 状态读不出来只该让窗口回落到默认位置，不该让它开不出来
    return {};
  }
}

/** 防抖把当前位置尺寸与置顶状态写进 `aiWindow` 命名空间。 */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!panel || panel.isDestroyed()) return;
    const state: AiWindowState = { bounds: panel.getBounds(), alwaysOnTop };
    void writeAppState({ [AI_WINDOW_NS]: state }).catch(() => {
      // 位置记不住不影响对话本身，静默
    });
  }, SAVE_DEBOUNCE);
}

/**
 * 记住主窗口，并保证它关掉时 AI 窗口跟着走。
 *
 * 不销毁 AI 窗口的话，用户关掉主窗口后 `window-all-closed` 不会触发，
 * 进程会留着一个孤零零的对话窗口不退出。
 * @param window 主窗口。
 */
export function initPanelWindow(window: BrowserWindow): void {
  host = window;
  window.on('closed', () => {
    host = null;
    if (panel && !panel.isDestroyed()) panel.destroy();
  });
}

/**
 * 算出这次该开在哪。
 * @returns 屏幕坐标下的窗口矩形。
 */
async function resolveBounds(): Promise<PanelRect> {
  const state = await loadWindowState();
  alwaysOnTop = state.alwaysOnTop === true;
  const saved = parsePanelBounds(state.bounds);
  if (saved) {
    // **必须重新夹一次**：上次存的位置可能来自一块已经拔掉的显示器
    const display = screen.getDisplayMatching(saved);
    return clampPanelBounds(saved, display.workArea);
  }
  const reference = host && !host.isDestroyed() ? host.getContentBounds() : undefined;
  const display = reference ? screen.getDisplayMatching(reference) : screen.getPrimaryDisplay();
  return defaultPanelBounds(reference ?? display.workArea, display.workArea);
}

/** 打开 AI 对话窗口；已经开着就聚焦它。 */
export async function openPanelWindow(): Promise<void> {
  if (panel && !panel.isDestroyed()) {
    if (panel.isMinimized()) panel.restore();
    panel.focus();
    return;
  }

  const bounds = await resolveBounds();
  // 窗口选项与主窗口保持一致（无边框 + 透明 + 自绘圆角），只多了 resizable 的最小尺寸；
  // 不设 parent——要能独立于 app 之上或之下，也要能单独出现在任务栏
  const window = new BrowserWindow({
    ...bounds,
    minWidth: AI_PANEL_MIN_WIDTH,
    minHeight: AI_PANEL_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop,
    autoHideMenuBar: true,
    title: 'AI 对话',
    icon: join(__dirname, '../renderer/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });
  panel = window;

  window.on('ready-to-show', () => window.show());
  window.on('moved', scheduleSave);
  window.on('resized', scheduleSave);
  window.on('closed', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    panel = null;
  });

  // 外链兜底两道口子（window.open + 普通 a href）。对话里的 markdown 链接就走这儿，
  // 而且这个窗口 frameless、没有地址栏也没有后退键，被导航走就真回不来了
  registerExternalLinkGuards(window.webContents);

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?ai=1`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { ai: '1' } });
  }
}

/**
 * 切换 AI 窗口置顶。
 * @param top 是否置顶。
 * @returns 切换后的状态；窗口没开时恒为 false。
 */
export function setPanelTop(top: boolean): boolean {
  if (!panel || panel.isDestroyed()) return false;
  alwaysOnTop = top;
  panel.setAlwaysOnTop(top);
  scheduleSave();
  return top;
}

/**
 * 最小化 AI 窗口。
 *
 * 渲染进程做不到这件事：DOM 的 `window` 只有 `close()` 没有 minimize，而
 * `window.api.window.minimize()` 闭包的是**主窗口**。所以走这条专用通道。
 *
 * **不用担心位置被写坏**（真 Electron 探针量的，Windows）：最小化时 `getBounds()`
 * 回的仍是还原后的位置（Win32 那个 -32000 被 Electron 兜住了），而且最小化只触发
 * `move` 与 `minimize`，**不触发我们落盘用的 `moved` / `resized`** —— 于是最小化
 * 压根不会排一次写盘，也就没有「把窗口位置存成屏幕外」这回事。
 * @returns 是否真最小化了；窗口没开时是 false。
 */
export function minimizePanelWindow(): boolean {
  if (!panel || panel.isDestroyed()) return false;
  panel.minimize();
  return true;
}

/**
 * AI 窗口里点 ⚙：把主窗口拉到前面并让它跳到设置页。
 *
 * AI 窗口自己没有路由（它只挂对话那一个组件），配置界面在主窗口的设置页里。
 * @returns 是否推给了主窗口。
 */
export function focusHostSettings(): boolean {
  if (!host || host.isDestroyed()) return false;
  if (host.isMinimized()) host.restore();
  host.focus();
  host.webContents.send(AI_CHANNELS.navigateSettings);
  return true;
}
