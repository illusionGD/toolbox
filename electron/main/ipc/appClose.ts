/**
 * 关闭行为的 IPC 层。
 *
 * **单独一个文件，不塞进 `ipc/window.ts`**：那三条旧的窗口通道（minimize / toggleMaximize /
 * close）回的是裸值，这两条走统一的 `{code,data,message}` 契约。两种契约混在一个文件里，
 * 下次改的人分不清哪条该 `unwrap`。
 *
 * 逻辑全在 `main/appClose.ts`（那边有那份非它不可的同步缓存），这里只过契约。
 */
import { WINDOW_CHANNELS } from '../../shared/channels';
import type { AppCloseAction, AppCloseChoice } from '../../shared/appWindow';
import { resolveClose, setCloseAction } from '../appClose';
import { handle } from './helper';

/** 注册关闭行为相关 IPC。 */
export function registerAppCloseIpc(): void {
  // 设置页那个 radio 与弹窗的「记住我的选择」共用这一条。回的是**归一化之后**的值，
  // 渲染进程照它回填，两边就不会因为一个脏值各显示一套
  handle<AppCloseAction>(WINDOW_CHANNELS.setCloseAction, async (_e, action: AppCloseAction) =>
    setCloseAction(action),
  );

  // 返回 false 只有一种情况：选了「最小化到托盘」但托盘建不起来，窗口原样留着。
  // 渲染进程据此把弹窗留在屏幕上并置灰那个按钮——不需要第二条通道来报这件事
  handle<boolean>(
    WINDOW_CHANNELS.resolveClose,
    async (_e, choice: AppCloseChoice, remember: boolean) => resolveClose(choice, remember),
  );
}
