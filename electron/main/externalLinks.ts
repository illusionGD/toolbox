/**
 * 外链兜底：把「窗口里被点开的外部地址」一律交给系统浏览器，窗口本身**永不导航走**。
 *
 * 两道口子，缺一不可：
 * - `setWindowOpenHandler` 管 `window.open` / `target="_blank"`；
 * - **`will-navigate` 管不带 `target` 的普通 `<a href>`** —— 没有它，点一下就把渲染进程
 *   整个导航走（对话窗口变成一张网页，而且回不来：这是个 frameless 窗口，没有地址栏也没有
 *   后退键）。#23c 之前全仓库都没有这一条；我们渲染出去的 `a` 都带 `target="_blank"`，
 *   所以它是纯兜底，但少了它，将来任何一处漏写 `target` 都是这个后果。
 *
 * 同源必须放行：dev 的 HMR 整页刷新与 prod 的 `file://` 自身都走 `will-navigate`。
 */

import { shell, type WebContents } from 'electron';

/**
 * 取地址的 origin，取不到就回原串（`file://` 的 origin 是 `'null'`，所以拿它没用）。
 * @param url 地址。
 * @returns origin 或原串。
 */
function originOf(url: string): string {
  try {
    const parsed = new URL(url);
    // file: 的 origin 一律是 'null'，用 protocol 当同源判据
    return parsed.protocol === 'file:' ? 'file:' : parsed.origin;
  } catch {
    return url;
  }
}

/**
 * 给一个 `WebContents` 挂上两道外链兜底。
 * @param contents 目标 webContents。
 */
export function registerExternalLinkGuards(contents: WebContents): void {
  contents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  contents.on('will-navigate', (event, url) => {
    if (originOf(url) === originOf(contents.getURL())) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}
