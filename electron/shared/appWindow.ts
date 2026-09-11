/**
 * 主窗口的关闭行为（纯数据 + 纯函数，不碰 Electron 也不碰 DOM）。
 *
 * 单独成一个模块而不是塞进 `types.ts`，理由同 `shared/petWindow.ts`：**它要能被桩测
 * 直接断言**。`normalizeCloseAction` 是存盘值进内存的唯一入口，脏数据全靠它挡。
 *
 * 为什么需要「三态」而不是一个布尔：用户要的是「可以选择退出 app 或者最小化托盘，
 * 可以用户设置」，而**默认不能替用户选**——点 ✕ 直接静默藏进托盘会让人以为 app 崩了，
 * 直接退出又会把正在跑的转码任务一起带走。所以默认是「每次询问」。
 */

/**
 * 关闭主窗口时的动作。
 *
 * - `ask`：弹应用内确认弹窗（默认）
 * - `quit`：直接退出整个 app
 * - `tray`：隐藏主窗口、收进系统托盘（**后台任务继续跑**，探针量过：隐藏期间子进程一个
 *   tick 都没少）
 */
export const APP_CLOSE_ACTIONS = ['ask', 'quit', 'tray'] as const;

/** 关闭动作。 */
export type AppCloseAction = (typeof APP_CLOSE_ACTIONS)[number];

/**
 * 默认动作。
 *
 * 刻意选最保守的那个：另外两个都是**不可撤销**的（退出杀任务 / 藏起来找不到窗口），
 * 而「询问」把选择权交回用户，且弹窗里就能顺手把偏好记下来。
 */
export const APP_CLOSE_ACTION_DEFAULT: AppCloseAction = 'ask';

/**
 * 存盘值 → 合法动作。
 *
 * **任何脏数据都回默认，永不抛**：这个值来自 `app-state.json`，可能是手改坏的、可能是
 * 旧版本留下的。抛在这里等于「配置文件坏了就关不掉窗口」。
 * @param value 任意存盘值。
 * @returns 合法的关闭动作。
 */
export function normalizeCloseAction(value: unknown): AppCloseAction {
  return (APP_CLOSE_ACTIONS as readonly string[]).includes(value as string)
    ? (value as AppCloseAction)
    : APP_CLOSE_ACTION_DEFAULT;
}

/**
 * 确认弹窗里点下去的那一下。
 *
 * 和 {@link AppCloseAction} 分开：`cancel` 只是「关掉弹窗什么都不做」，它**不是**一个
 * 能被记住的偏好——混在一起就会出现「记住我的选择 = 以后点 ✕ 永远关不掉」。
 */
export type AppCloseChoice = 'cancel' | 'quit' | 'tray';
