/**
 * 桌宠窗口的位置尺寸数学。
 *
 * 桌宠是一个**独立的无边框透明窗口**，贴着精灵大小（不像 AI 窗口那样可缩放），
 * 所以这里要算的东西和 `aiPanel.ts` 不同：右下角停靠、拖拽落点、菜单展开时窗口
 * 临时长大而**精灵在屏幕上不许动**。
 *
 * 和 `aiPanel.ts` 一样刻意**不碰 Electron 也不碰 DOM**：最容易算错的部分（负坐标
 * 的副屏、工作区比桌宠还小、存下来的坏值、拖拽的累计漂移）这样才能被桩测直接断言。
 */

/** 屏幕坐标下的一块矩形（Electron 的 bounds 形状，单位是 DIP）。 */
export interface PetRect {
  /** 左上角 x。 */
  x: number;
  /** 左上角 y。 */
  y: number;
  /** 宽。 */
  width: number;
  /** 高。 */
  height: number;
}

/** 桌宠最小边长。再小连 logo 都看不清，也点不准。 */
export const PET_SIZE_MIN = 64;
/** 桌宠最大边长。 */
export const PET_SIZE_MAX = 512;
/** 默认边长。 */
export const PET_SIZE_DEFAULT = 160;
/** 首次开窗时距工作区右下角的留白。 */
export const PET_EDGE_GAP = 16;
/**
 * 至少要留在工作区内的像素。
 *
 * 桌宠**没有顶栏也没有任务栏图标**（`skipTaskbar`），整块拖出屏幕就再也点不到、
 * 也没有别的办法唤回来了——这个下限是它唯一的安全绳。
 */
export const PET_VISIBLE = 32;

/**
 * 菜单区的宽（含菜单与精灵之间那 8px 间距）。
 *
 * 菜单展开时**由主进程把窗口临时放大**（真 Electron 探针量过：`resizable: false`
 * 的窗口照样 `setBounds` 改得动尺寸），精灵始终锚在窗口右下角、窗口向左上长，
 * 于是精灵在屏幕上一动不动。这样就不必常驻一块吞点击的大透明窗口。
 *
 * 148 → 208 是 review 加「实时调节大小」那个滑块 + 输入框之后重新量的：滑块再窄就
 * 拖不准了。
 */
export const PET_MENU_WIDTH = 208;

/**
 * 菜单项数：设置 / AI 对话 / 打开 app / **隐藏桌宠** / **退出桌宠** / **退出 app**。
 *
 * 「隐藏桌宠」是第四轮 review 加的，前面两个出口项是第一轮加的（原来只有导航三项，
 * 且当时的假设是「菜单里没有任何出口」）。
 *
 * 这个数**必须跟 `PetMenu.vue` 里的 `ITEMS` 对得上**：少算一项，最下面那项就会被
 * 窗口边缘裁掉——而裁掉的恰好是「退出 app」。
 */
export const PET_MENU_ITEM_COUNT = 6;
/** 单个菜单项的高（上下各 6px 内边距 + 18px 行高，量的是 `PetMenu.vue` 的实际样式）。 */
export const PET_MENU_ITEM_HEIGHT = 30;
/**
 * 「大小」那一块的高：输入框那行 28（naive-ui `size="small"` 的高）+ 间距 4 + 滑块那行 14 = 46。
 *
 * **滑块单独占下面一整行**（review 第三轮定的：「布局应该在 input 下面」）——菜单一共才
 * {@link PET_MENU_WIDTH} 宽，两个控件挤在同一行时滑块只剩一百来像素，64→512 的量程摊在
 * 那么短的轨道上拖一格就是好几个 px。滑块本身也缩过一档（手柄 12 / 轨道 3，见
 * `PetMenu.vue` 的 `SLIDER_THEME`），默认那个 18px 手柄比菜单文字还高。
 *
 * 它不是菜单项（不可点、也不在 `ITEMS` 里），所以单独一个常数而不是把项数加一——
 * 混进项数里，那条「项数与 `ITEMS` 对得上」的桩测金丝雀就永远对不上了。
 */
export const PET_MENU_SIZE_ROW = 46;
/**
 * 除菜单项与大小块以外的合计余量：容器内边距 8 + 边框 2 + 八个子元素之间的 7 道 2px
 * 间距 14 + **两条**分隔线（各是 1px 线 + 上下 4px 外边距 = 9）18 = 42，**再留 5px 富余**。
 *
 * 富余是故意的：行高会随字体渲染差一两像素，而算少了的后果是最下面那项被窗口边缘裁掉；
 * 算多了只是窗口顶上多一截透明区（菜单开着时才存在，点它等于点菜单外，本来就该收起）。
 */
export const PET_MENU_CHROME = 47;
/** 菜单区的高。**按项数算而不是写死一个数**，加菜单项时只改上面的项数。 */
export const PET_MENU_HEIGHT =
  PET_MENU_ITEM_COUNT * PET_MENU_ITEM_HEIGHT + PET_MENU_SIZE_ROW + PET_MENU_CHROME;

/** 判定「点击」还是「拖拽」的位移阈值（px）。 */
export const PET_DRAG_THRESHOLD = 4;

/**
 * 每隔多久把桌宠重新抬回置顶（ms）。
 *
 * `alwaysOnTop: true` 只保证「在非置顶窗口之上」，**置顶窗口之间还要再排一次队，而后
 * 来者在前**。真 Electron 探针量到的：桌宠先开着（z 序名次 1），随后新建一个同样
 * `alwaysOnTop` 的窗口，桌宠立刻掉到它下面（名次 2）——**会议软件共享屏幕时那条悬浮
 * 工具条正是这么把桌宠压下去的**（review 第四轮报的「一录屏桌宠就不见了，图层下去了」）。
 *
 * 抢回来只能靠主动重排，而且必须**周期性**重排：悬浮条什么时候出现、会不会自己再抬一次，
 * 都不在我们的可观测范围内，也没有任何事件可听（桌宠本来就没有焦点，悬浮条出现时它
 * **不会** blur）。
 *
 * 2 秒是「被压住最多难看两秒」和「常驻定时器的代价」之间的折中——探针量到 `moveTop()`
 * 调 100 次只要 3 ms，所以代价那一侧基本是零；真正的代价是**语义上的**：桌宠会一直压在
 * 用户自己置顶的窗口上面。那本来就是「常驻置顶小精灵」的题中之义，但写在这里以免以后
 * 有人以为是 bug。
 */
export const PET_TOPMOST_REASSERT_MS = 2000;

/**
 * 夹紧到 [min, max]。
 * @param value 原值。
 * @param min 下界。
 * @param max 上界；小于 min 时以 min 为准（工作区比桌宠还小的极端情形）。
 * @returns 夹紧后的值。
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 把桌宠大小夹进合法区间。
 * @param size 任意输入（可能来自存盘的脏数据）。
 * @returns [{@link PET_SIZE_MIN}, {@link PET_SIZE_MAX}] 内的整数；不是有限数时回默认值。
 */
export function clampPetSize(size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return PET_SIZE_DEFAULT;
  return clamp(Math.round(size), PET_SIZE_MIN, PET_SIZE_MAX);
}

/**
 * 把窗口矩形夹进工作区。
 *
 * 规则：位置至少留 {@link PET_VISIBLE} 在工作区内（允许贴边出屏，不许整块看不见）。
 * **尺寸原样带过**——桌宠尺寸由配置决定，不该被工作区改写（菜单展开时窗口比精灵大，
 * 夹尺寸会把菜单裁掉）。
 * @param bounds 待夹紧的矩形。
 * @param workArea 目标显示器的工作区（已扣掉任务栏）。
 * @returns 夹紧后的新对象（不改入参）。
 */
export function clampPetBounds(bounds: PetRect, workArea: PetRect): PetRect {
  const width = Math.round(bounds.width);
  const height = Math.round(bounds.height);
  const x = clamp(
    Math.round(bounds.x),
    workArea.x + Math.min(PET_VISIBLE - width, 0),
    workArea.x + Math.max(workArea.width - PET_VISIBLE, 0),
  );
  const y = clamp(
    Math.round(bounds.y),
    workArea.y + Math.min(PET_VISIBLE - height, 0),
    workArea.y + Math.max(workArea.height - PET_VISIBLE, 0),
  );
  return { x, y, width, height };
}

/**
 * 第一次打开时的位置：工作区**右下角**（需求 1「右下角出现桌宠」）。
 * @param workArea 目标显示器的工作区。
 * @param size 桌宠边长。
 * @returns 夹紧后的窗口矩形。
 */
export function defaultPetBounds(workArea: PetRect, size: number): PetRect {
  const side = clampPetSize(size);
  return clampPetBounds(
    {
      x: workArea.x + workArea.width - side - PET_EDGE_GAP,
      y: workArea.y + workArea.height - side - PET_EDGE_GAP,
      width: side,
      height: side,
    },
    workArea,
  );
}

/**
 * 拖拽过程中的落点。
 *
 * **必须基于「按下时的 bounds + 从按下点算起的累计位移」，绝不能拿上一帧的位置做增量
 * 累加**：每一帧都 `setPosition` 一次，而 `setPosition` 会触发窗口自己的 `move`
 * 事件（真 Electron 探针量到的），增量写法会把取整误差和回灌的事件一起滚雪球，
 * 拖着拖着精灵就跑偏了。绝对计算天然幂等——同一组 `(start, dx, dy)` 算多少次结果都一样。
 * @param start 按下那一刻的窗口矩形。
 * @param dx 相对按下点的 x 位移（屏幕坐标，DIP）。
 * @param dy 相对按下点的 y 位移。
 * @param workArea 落点所在显示器的工作区。
 * @returns 夹紧后的窗口矩形。
 */
export function dragPetBounds(start: PetRect, dx: number, dy: number, workArea: PetRect): PetRect {
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;
  return clampPetBounds(
    { x: start.x + safeDx, y: start.y + safeDy, width: start.width, height: start.height },
    workArea,
  );
}

/**
 * 窗口在给定状态下**应该**是多大。
 *
 * 抽出来是因为主进程有两处需要「我认定的尺寸」而**不能问 `getBounds()`**：非整数缩放
 * （实测 1.25）下它会回 161 这种数。而 {@link petMenuBounds} 是按右下角锚点反推左上角
 * 的，喂一个偏 1px 的宽高进去，每开合一次菜单精灵就挪一格。
 * @param size 精灵边长（会被夹进合法区间）。
 * @param open 菜单是否展开。
 * @returns 窗口宽高。
 */
export function petWindowSize(size: number, open: boolean): { width: number; height: number } {
  const side = clampPetSize(size);
  return {
    width: open ? side + PET_MENU_WIDTH : side,
    height: open ? Math.max(side, PET_MENU_HEIGHT) : side,
  };
}

/**
 * 菜单展开 / 收起时的窗口矩形。
 *
 * **精灵锚在窗口右下角**：窗口向左上生长，所以展开前后精灵在屏幕上的位置逐字不变
 * （桩测断言的就是「右下角坐标相等」这条）。
 * @param petBounds 当前窗口矩形（收起态时它就等于精灵矩形）。
 * @param size 精灵边长。
 * @param open 菜单是否展开。
 * @param workArea 所在显示器的工作区。
 * @returns 新的窗口矩形。
 */
export function petMenuBounds(
  petBounds: PetRect,
  size: number,
  open: boolean,
  workArea: PetRect,
): PetRect {
  // 右下角是不动点：先从当前窗口算出它，再按新尺寸往左上推
  const right = petBounds.x + petBounds.width;
  const bottom = petBounds.y + petBounds.height;
  const { width, height } = petWindowSize(size, open);
  return clampPetBounds({ x: right - width, y: bottom - height, width, height }, workArea);
}

/**
 * 校验存下来的窗口矩形。
 *
 * 四个数都得是有限数才认，否则当成没存过（由 {@link defaultPetBounds} 现算）——
 * 存了 `NaN` 或缺字段的话 `setBounds` 会直接抛，窗口根本开不出来。
 * @param value 从应用状态里读到的任意值。
 * @returns 合法时返回纯对象副本，否则 undefined。
 */
export function parsePetBounds(value: unknown): PetRect | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const rect = value as Partial<PetRect>;
  const nums = [rect.x, rect.y, rect.width, rect.height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return {
    x: rect.x as number,
    y: rect.y as number,
    width: rect.width as number,
    height: rect.height as number,
  };
}
