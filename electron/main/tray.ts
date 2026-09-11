/**
 * 系统托盘图标（全进程唯一一个）。
 *
 * 两个用户共用它，而且**永不共存**：
 *
 * - **桌宠**（`owner: 'pet'`）：菜单里的「隐藏桌宠」期间（26a review 第四轮加的：
 *   「加个隐藏桌宠的功能，隐藏后放到任务栏的隐藏处」）；
 * - **主窗口**（`owner: 'host'`）：关闭行为设成「最小化到托盘」时。
 *
 * 为什么可以断定不共存：桌宠开着的时候主窗口的 `close` **已经**被 `pet/petWindow.ts` 拦成
 * `hide()`（两个窗口寿命独立那条规则），根本走不到「收进托盘」那一支；反过来主窗口躺在
 * 托盘里的时候桌宠模式是关着的。**这个结论有个前提：主窗口的托盘菜单里不许有「打开
 * 桌宠」**——真要加那一项，就得先重新论证一遍，或者改成两个 Tray 实例。
 *
 * **它是隐藏期间唯一的出口**，这条硬规则从 `pet/petWindow.ts` 的文件头继承下来：窗口一藏，
 * 任务栏上就没有能点的东西了（桌宠本来 `skipTaskbar`，主窗口藏起来图标也没了）。所以：
 *
 * 1. {@link ensureTray} 返回 false 时**调用方必须放弃隐藏**，绝不能「先藏了再说」；
 * 2. 菜单里**必须有「退出 app」**——这一项由本模块**自己追加**，不从 `spec.items` 里来，
 *    于是「一个没有出口的托盘」在结构上就不可能被拼出来。
 *
 * **空图标不会抛异常**（真 Electron 探针量过：`new Tray(nativeImage.createEmpty())`
 * 在 Windows 上照建不误，`isDestroyed()` 还是 false，只是任务栏上什么都看不见）——
 * 所以图标可用性**必须自己 `isEmpty()` 查一遍**，光 try/catch 守不住那个「藏进去就再
 * 也叫不出来」的场面。
 */
import { app, Menu, Tray, nativeImage } from 'electron';
import { join } from 'path';

/** 托盘图标边长（Windows 托盘区是 16px，给高 DPI 留一档到 32）。 */
const TRAY_ICON_SIZE = 32;

/** 托盘图标；没人用的时候是 null。 */
let tray: Tray | null = null;
/** 当前是谁在用（见文件头「永不共存」那段）。 */
let owner: TrayOwner | null = null;

/** 托盘的使用者。 */
export type TrayOwner = 'pet' | 'host';

/** 托盘要长什么样。所有动作都由调用方注入，本模块自己不碰窗口。 */
export interface TraySpec {
  /** 谁在用它。 */
  owner: TrayOwner;
  /** 悬浮提示。 */
  tooltip: string;
  /** 菜单项，**不含「退出 app」**——那一项由本模块追加（见文件头规则 2）。 */
  items: { label: string; click: () => void }[];
  /** 左键单击托盘图标。托盘图标常年藏在「隐藏的图标」里，能少一次右键就少一次。 */
  onClick: () => void;
  /** 退出整个 app。 */
  onQuit: () => void;
}

/**
 * 找一张能用的图标。
 *
 * 两条路都要留：打包后 `public/` 的东西被 electron-vite 拷进 `out/renderer/`（也就是
 * asar 里），而 **dev 下 `out/renderer/` 根本不存在**（渲染进程由 vite dev server 供），
 * 那时得回落到项目根的 `public/icon.png`（探针确认 dev 下 `app.getAppPath()` 就是项目根）。
 * @returns 非空图标；两条路都读不出来时返回空图标（由调用方拒绝隐藏）。
 */
function loadTrayIcon(): Electron.NativeImage {
  const candidates = [
    join(__dirname, '../renderer/icon.png'),
    join(app.getAppPath(), 'public/icon.png'),
  ];
  for (const path of candidates) {
    const image = nativeImage.createFromPath(path);
    // 源图是 1024×1024 的应用图标，直接塞给托盘会被系统缩得很难看
    if (!image.isEmpty()) return image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE });
  }
  return nativeImage.createEmpty();
}

/**
 * 按 spec 装好托盘（已经建过就复用同一个 `Tray`，只换文案与菜单）。
 *
 * **调用方必须看返回值**：false 意味着没有出口，这时候不许隐藏窗口。
 * @param spec 文案 + 菜单 + 两个动作。
 * @returns 托盘是否可用。
 */
export function ensureTray(spec: TraySpec): boolean {
  if (!tray || tray.isDestroyed()) {
    const icon = loadTrayIcon();
    // 见文件头：空图标建得出来但看不见，那正是「藏进去叫不出来」的场面
    if (icon.isEmpty()) return false;
    try {
      tray = new Tray(icon);
    } catch {
      return false;
    }
  }

  owner = spec.owner;
  tray.setToolTip(spec.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      ...spec.items.map((item) => ({ label: item.label, click: item.click })),
      { type: 'separator' as const },
      // **这一项由本模块追加**（文件头规则 2）：托盘一旦出问题，用户就只剩任务管理器了
      { label: '退出 app', click: () => spec.onQuit() },
    ]),
  );
  // **必须先清掉旧的**：换 owner 时不清，两边的左键回调会叠着跑（探针量过：直接第二次
  // `on('click')` 之后监听数是 2，一次 click 把两个都跑了 —— 表现就是「点一下托盘，
  // 桌宠和主窗口一起冒出来」）
  tray.removeAllListeners('click');
  tray.on('click', () => spec.onClick());
  return true;
}

/**
 * 撤掉托盘，但**只有持有者能撤**。
 *
 * 别人调是 no-op：主窗口从托盘里被叫回来时会无条件调一次
 * `releaseTray('host')`（`window.on('show')` 那条，见 main/appClose.ts），
 * 而那一刻托盘可能正被桌宠占着——撤掉就把桌宠的出口一起撤了。
 * @param by 谁想撤。
 */
export function releaseTray(by: TrayOwner): void {
  if (owner !== by) return;
  destroyTray();
}

/** 无条件撤掉托盘（窗口销毁、退出 app 时调）。 */
export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy();
  tray = null;
  owner = null;
}
