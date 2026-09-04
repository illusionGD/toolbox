/**
 * AI 对话窗口的位置尺寸数学。
 *
 * AI 对话框是一个**独立的无边框窗口**（不是 app 里的 DOM 面板），拖动与缩放由 OS 负责，
 * 我们只管三件事：第一次开在哪、存下来的值还能不能用、以及别让它落到屏幕外。
 *
 * 这些函数刻意**不碰 Electron 也不碰 DOM**：最容易算错的部分（负坐标的副屏、工作区比
 * 默认宽度还窄、存下来的坏值）这样才能被桩测直接断言。
 */

/** 屏幕坐标下的一块矩形（Electron 的 bounds 形状，单位是 DIP）。 */
export interface PanelRect {
  /** 左上角 x。 */
  x: number;
  /** 左上角 y。 */
  y: number;
  /** 宽。 */
  width: number;
  /** 高。 */
  height: number;
}

/** 最小宽。比这更窄输入框和顶栏按钮就挤没了。 */
export const AI_PANEL_MIN_WIDTH = 320;
/** 最小高。 */
export const AI_PANEL_MIN_HEIGHT = 360;
/** 默认宽度（窄窗口，够读一段回复即可）。 */
export const AI_PANEL_DEFAULT_WIDTH = 380;
/** 至少要留在工作区内的宽度（允许贴边出屏，但不许整块看不见）。 */
const VISIBLE_WIDTH = 120;
/** 至少要留在工作区内的高度。顶栏是唯一的拖拽把手，滑出去就再也拖不回来了。 */
const VISIBLE_HEIGHT = 60;
/** 距主窗口边的留白。 */
const EDGE_GAP = 12;
/** 与主窗口内容区顶部对齐用的偏移（标题栏 48 + 8）。 */
const TOP_OFFSET = 56;

/**
 * 夹紧到 [min, max]。
 * @param value 原值。
 * @param min 下界。
 * @param max 上界；小于 min 时以 min 为准（工作区比最小尺寸还小的极端情形）。
 * @returns 夹紧后的值。
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * 把窗口矩形夹进工作区。
 *
 * 规则：尺寸先夹到 `[最小值, 工作区]`（不许比工作区还大，否则底部输入框会在屏幕外），
 * 再让位置至少留 {@link VISIBLE_WIDTH}×{@link VISIBLE_HEIGHT} 在工作区内。
 * @param bounds 待夹紧的矩形。
 * @param workArea 目标显示器的工作区（已扣掉任务栏）。
 * @returns 夹紧后的新对象（不改入参）。
 */
export function clampPanelBounds(bounds: PanelRect, workArea: PanelRect): PanelRect {
  const width = clamp(Math.round(bounds.width), AI_PANEL_MIN_WIDTH, workArea.width);
  const height = clamp(Math.round(bounds.height), AI_PANEL_MIN_HEIGHT, workArea.height);
  const x = clamp(
    Math.round(bounds.x),
    workArea.x + Math.min(VISIBLE_WIDTH - width, 0),
    workArea.x + Math.max(workArea.width - VISIBLE_WIDTH, 0),
  );
  const y = clamp(
    Math.round(bounds.y),
    workArea.y,
    workArea.y + Math.max(workArea.height - VISIBLE_HEIGHT, 0),
  );
  return { x, y, width, height };
}

/**
 * 第一次打开时的位置：贴主窗口右侧、窄、高度与主窗口一致。
 *
 * **必须按主窗口现算而不是存一个死值**：用户把 app 放在哪块屏幕上，对话窗口就该开在那儿。
 * @param host 主窗口的内容区矩形（屏幕坐标）。
 * @param workArea 主窗口所在显示器的工作区。
 * @returns 夹紧后的窗口矩形。
 */
export function defaultPanelBounds(host: PanelRect, workArea: PanelRect): PanelRect {
  const width = Math.min(AI_PANEL_DEFAULT_WIDTH, Math.max(workArea.width - EDGE_GAP * 2, 0));
  return clampPanelBounds(
    {
      x: host.x + host.width - width - EDGE_GAP,
      y: host.y + TOP_OFFSET,
      width,
      height: host.height - TOP_OFFSET - EDGE_GAP,
    },
    workArea,
  );
}

/**
 * 校验存下来的窗口矩形。
 *
 * 四个数都得是有限数才认，否则当成没存过（由 {@link defaultPanelBounds} 现算）——
 * 存了 `NaN` 或缺字段的话 `setBounds` 会直接抛，窗口根本开不出来。
 * @param value 从应用状态里读到的任意值。
 * @returns 合法时返回纯对象副本，否则 undefined。
 */
export function parsePanelBounds(value: unknown): PanelRect | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const rect = value as Partial<PanelRect>;
  const nums = [rect.x, rect.y, rect.width, rect.height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  return {
    x: rect.x as number,
    y: rect.y as number,
    width: rect.width as number,
    height: rect.height as number,
  };
}
