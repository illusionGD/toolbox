---
name: app-close-tray
description: Toolbox 主窗口的关闭行为（2026-09-11）——三态「每次询问 / 退出 app / 最小化到托盘」+ 应用内确认弹窗 + 全进程唯一一个带 owner 的 Tray；记「`close` 处理器是同步的 ⇒ 生效动作必须在主进程有一份缓存」「`before-quit` 先于窗口 `close`，`quitting` 标志守着三个「退出 app」入口」「托盘建不起来就拒绝隐藏，绝不静默退出」「「退出 app」那一项由 `ensureTray` 自己追加」「换 owner 必须 `removeAllListeners('click')`」「`hide()` 不触发 `window-all-closed`、隐藏期间子进程照跑但渲染进程计时器被节流到 ~1 次/秒」「naive-ui 弹窗宽度只能内联 style，scoped 选择器匹配不上」等实测边界。桌宠那半见 [[desktop-pet]]
---

# 关闭主窗口时的行为 + 系统托盘（2026-09-11）

用户原话：「关闭 app 可以选择退出 app 或者最小化托盘，可以用户设置」。同一轮还有一条入口整理（「ai 入口放在设置 tab 上面」，见文末）。

**为什么不是在 `ipc/window.ts` 里改一行 `win.close()`**：自绘的 ✕ 只是两条路里的一条，`Alt+F4` 直接走窗口的 `close` 事件、压根不经 IPC。**拦 `close` 这一个事件才同时管住两条路**，所以有了 `electron/main/appClose.ts`。

文件：主进程 `electron/main/appClose.ts`（拦截 + 缓存 + 三态）、`electron/main/tray.ts`（全进程唯一一个 Tray，从 `pet/tray.ts` 泛化而来）、`electron/main/windowNav.ts` 的 `hideHostToTray()`、`electron/main/ipc/appClose.ts`；共享纯模块 `electron/shared/appWindow.ts`；渲染 `src/services/appWindow.ts`、`src/composables/useCloseAction.ts`、`src/components/layout/CloseConfirmModal.vue`、`SettingsView.vue` 的「窗口」卡片。

## 三态与默认值

| 值 | 行为 |
|---|---|
| `'ask'`（**默认**） | 弹应用内确认弹窗，三个出口：取消 / 最小化到托盘 / 退出 |
| `'quit'` | 真关，照旧走 `window-all-closed` 退进程 |
| `'tray'` | 窗口 `hide()`，托盘图标接管；托盘建不起来时**退回弹窗** |

**默认必须是 `'ask'`**：另外两个都不可逆——「退出」会把正在跑的 ffmpeg 转码一起杀掉，「收进托盘」要求用户知道托盘图标这回事。没存过设置的人第一次点 ✕ 不该被静默处理。归一化在 `normalizeCloseAction(value: unknown)` 里，**任何脏值（`undefined` / `null` / `{}` / `[]` / `0` / `'TRAY'` / `'quit '`）都回默认、永不抛**——这个值从磁盘来（用户手改过、旧版本写过、写坏过都可能），而它决定「点 ✕ 会发生什么」。

## 三条硬规则（改这块之前先读）

### 1. `close` 处理器是**同步**的 ⇒ 生效动作必须在主进程有一份缓存

`event.preventDefault()` 等不了一次 `await readAppState()`（等回来窗口早关了）。所以 `appClose.ts` 里有模块级 `closeAction`：启动时 `void loadCloseAction()` 异步载入，之后**只由 `setCloseAction()` 刷新**（顺带落盘）。

由此推出**渲染进程不许自己写这个设置**：`appWindow` 命名空间的唯一写方是主进程（同 `PetWindowState` 那条注释的理由——两边都整块写会互相抹掉），设置页的 radio 与弹窗的「记住我的选择」都走 `WINDOW_CHANNELS.setCloseAction`。`useCloseAction.ts` 只 `readState` 读初值 + 走 IPC 改，**永不 `writeState`**。

### 2. 「退出 app」这条路不许被自己的拦截器吃掉

`app.quit()` 会给每个窗口发 `close`，拦截器一 `preventDefault()`，用户点的「退出 app」就什么都没发生（`pet/petWindow.ts` 的 `quitAppFromPet` 早踩过同一个坑）。解法是 `app.on('before-quit')` 置 `quitting = true`，而 **`if (quitting) return;` 必须是 `close` 处理器的第一句**：

```ts
window.on('close', (event) => {
  if (quitting) return;              // ← 第一句。挪到 preventDefault 后面 = 点「退出」变成最小化
  if (isPetWindowOpen()) return;     // 桌宠那条规则优先（它会把这次 close 拦成 hide()）
  if (closeAction === 'quit') return;
  event.preventDefault();
  if (closeAction === 'tray' && hideHostToTray()) return;
  promptClose();                     // 'ask'，或「收进托盘」但托盘建不起来
});
```

**探针量过顺序：`before-quit` 先于窗口的 `close`**（`app.quit()` 与托盘菜单两条路各量一次，结论一致），所以标志一定赶得上。它守着**三个**入口：托盘「退出 app」、桌宠菜单「退出 app」、弹窗里的「退出」。

### 3. 托盘建不起来就拒绝隐藏，**而且不许改成静默退出**

这是 [[desktop-pet]] 硬规则 1 在主窗口上的同一副面孔：主窗口一藏、桌宠又没开，托盘图标是屏幕上唯一还能点的东西。`hideHostToTray()` 先 `ensureTray()` 再 `window.hide()`，返回 false 时窗口原样留着、转而弹窗（弹窗里那个「最小化到托盘」置灰 + 一行 `n-alert`）。

**退回弹窗而不是退回「直接退出」**：静默退出会杀掉正在跑的转码，比「没藏成」糟得多。`resolveClose()` 的返回值就是「做到了没有」，渲染进程据此决定弹窗留不留——不需要第二条通道来报「托盘不可用」。

`hideHostToTray()` 放在 `windowNav.ts` 而不是 `appClose.ts`：桌宠的「退出桌宠」也要用它，而 `appClose.ts` 反过来要用 `isPetWindowOpen()`，放一起会成环。

## 单个 `Tray` + owner 标签

```ts
export type TrayOwner = 'pet' | 'host';
export function ensureTray(spec: TraySpec): boolean;  // 复用同一个 Tray，只换文案与菜单
export function releaseTray(by: TrayOwner): void;     // 只有持有者能撤，别人调是 no-op
export function destroyTray(): void;
```

- **「退出 app」那一项由 `ensureTray` 自己追加**，`TraySpec.items` 里传不了它 —— 于是「一个没有出口的托盘」在结构上就拼不出来（把一条金丝雀变成了不变量）。
- **换 owner 必须 `removeAllListeners('click')`**：探针量过，直接第二次 `on('click')` 之后监听数是 2，一次 click 把两个回调都跑了 —— 表现就是「点一下托盘，桌宠和主窗口一起冒出来」。
- **`releaseTray(by)` 而不是无条件 `destroyTray()`**：主窗口 `window.on('show')` 会无条件撤一次 `releaseTray('host')`，而那一刻托盘可能正被桌宠占着。
- 撤托盘听的是 **`window.on('show')`**，不是只在托盘菜单里撤：把主窗口从托盘里拉回来的路不止一条（AI 窗口的 ⚙ → `showHostWindow()` 也算一条，那条不经过托盘菜单）。

**「两个托盘永不共存」的论证有前提**：桌宠开着时主窗口的 `close` 已经被 `petWindow.ts` 拦成 `hide()`，走不到「收进托盘」那一支；反过来主窗口躺在托盘里时桌宠模式是关着的。**前提是主窗口那份托盘菜单里不许有「打开桌宠」**——真要加那一项，就得先重新论证一遍，或者改成两个 Tray 实例。（有金丝雀守着这条，注意它断言的是 `label: '打开桌宠'` 而不是裸的「打开桌宠」——函数里的解释性注释就含那四个字，拿裸串去查是条假绿的哨兵，本轮红证当场抓到。）

## 「退出桌宠」= 桌宠退场 + app 收进托盘

用户 2026-09-11 的原话：「退出桌宠不需要重新打开 app」。点「退出桌宠」多半只是想让小精灵下班，不是要看工具箱。所以 `closePetWindow()`：

1. **先**把托盘立起来（`hideHostToTray()`），托盘建不起来才回落到 `showHostWindow('app')`；
2. 主窗口**此刻已经露着就一个字都不动它**（AI 窗口的 ⚙ 能把它叫出来）；
3. 然后才销毁桌宠窗口。

顺序不许反：销毁之后才是「既没窗口也没托盘」的那一瞬。

## 探针数字（真 Electron 实测，与文档不符以这里为准）

| 量的是什么 | 结果 | 因此 |
|---|---|---|
| `app.on('before-quit')` vs 窗口 `close` | **`before-quit` 先** | `quitting` 标志的写法成立（否则得改成「调用点自己置标志」，即 `quitAppFromPet` 里 `closing` 的样子） |
| 只剩一个**隐藏**窗口时 `window-all-closed` | **不触发**（隐藏窗口仍计入 `getAllWindows()`） | 收进托盘不会误退进程 |
| 隐藏期间的长跑子进程 | **一个 tick 都没少**（转码继续跑） | 「最小化到托盘」的全部价值就在这条上 |
| 隐藏期间渲染进程的计时器 | 被 Chromium **节流到约 1 次/秒** | 托盘期间进度条只是刷得慢，不是停了；别把它当 bug 修 |
| `new Tray(nativeImage.createEmpty())` | **不抛异常**，`isDestroyed()` 还是 false，托盘区什么都看不见 | 图标可用性**必须自己 `isEmpty()` 查**（这条继承自 26a） |
| 同一个 `Tray` 二次 `on('click')` | 监听数变成 2，一次 click 跑两个 | 换 owner 前 `removeAllListeners('click')` |

## 弹窗是应用内的 naive-ui 弹窗

不是 `dialog.showMessageBox`：系统弹窗的配色跟不了主题，而这一下是用户最常看见的交互之一。文案点明「正在进行的任务（转码、压缩）会随退出一起中断」——这才是三个选项的意义所在。「退出」用 `type="error"`，紫色留给强调不留给危险动作（[[toolbox-color-scheme]]）。

**弹窗宽度只能走内联 `style`。** `<style scoped>` 里写 `.close-confirm { width: 340px }` 是**无效的**：naive-ui 把 `class` 一路 `h()` 传给内部的 `NCard`（`modal/src/BodyWrapper.mjs` 里 `Object.assign({}, $attrs, …)`），那个节点拿不到本组件的 `data-v-*` 作用域属性，选择器一条都匹配不上——表现是弹窗**铺满整个窗口宽度**（review 截图实测）。`style` 走同一条 `$attrs`，但内联样式不带作用域，落地就生效。**插槽里的内容不受影响**（它们在本组件模板里编译，照常带 `data-v-*`），所以只有根节点那一层要注意。同一个坑 `AiConfigDialog.vue` 也有（`width: 560px` 同样没生效），只是它开在窄的 AI 窗口里，铺满看着正常。

## 顺带做的入口整理

用户原话「ai 入口放在设置 tab 上面」：侧栏底部 `footerOptions` 加一项 `{ key: 'ai', label: 'AI 助手' }`，**排在 `settings` 之前**（顺序就是需求本身，有金丝雀比下标），紫色 Sparkles 图标，未配置时 `extra` 挂一个小圆点；`handleSelect` 里 `key === 'ai'` 直接 `openAiWindowApi()` 并 return（不进 `keyToPath`，`:value="activeKey"` 是路由派生的受控值，所以高亮不会粘在它上面）。**首页那块 AI 卡片整块删掉**，全 app 只留侧栏这一个入口（见 [[home-page]]、[[ai-chat]]）。

## 验证

`pnpm verify:ai` **370 + 193**（主进程从 324 涨到 370），**十条突变逐条验过红**；typecheck（node+web）/ lint / format / build 全绿；渲染进程 JS **+8,039 B**、CSS **−681 B**（首页删掉那块卡片的样式多于侧栏新加的）。

红证里有一条**突变自己没做成**（脚本会当场喊出来，因为它先断言「待替换的原文命中恰好 1 次」）：`if (!window) return false;` 在 `windowNav.ts` 里有两处，锚点得带上紧跟的 `if (\n    !ensureTray({` 才唯一。**红证脚本必须自己校验锚点唯一性**，否则「突变没做成」会伪装成「哨兵没红」，也可能反过来伪装成绿。

## 人工验清单（本机做得了）

**三态各走一遍**：设置页选「退出 app」→ 点 ✕ **直接退**；选「最小化到托盘」→ 点 ✕ **窗口没了、托盘区出现图标**，左键点回来、右键有「打开 app 界面」和「退出 app」；选「每次询问」→ 点 ✕ **弹窗**（**宽度约 340px，不是铺满整窗**），三个按钮各按一次（取消 = 什么都不发生）。
**记住**：弹窗勾「记住我的选择」+ 选「最小化到托盘」→ 从托盘回来 → **设置页 radio 已经是「最小化到托盘」**，再点 ✕ 不再弹窗。
**Alt+F4** 与 ✕ 表现一致（同一个 `close` 事件）。
**桌宠回归**：开桌宠 → 点主窗口 ✕ **不弹窗**（桌宠规则优先，直接 hide）→ 桌宠菜单「退出 app」→ **真的退出**（不是被拦成最小化）→ 再开一次 → 菜单「退出桌宠」→ **桌宠消失、app 收进托盘**；「隐藏桌宠」→ 托盘是桌宠那套文案 → 放回来 → 图标消失。**全程托盘区只出现过一个图标。**
**托盘期间任务继续**：起一个长转码 → 收进托盘 → 等它跑完 → 打开，**进度是走完的**。
**AI 窗口那条路**：主窗口收进托盘 → 点 AI 窗口的 ⚙ → 主窗口出现在设置页 → **托盘图标自动消失**（验 `window.on('show')`）。
**入口**：侧栏「设置」上面有一行「AI 助手」，高度与「设置 / 关于」一致，点开 AI 窗口且**高亮不粘**；删掉全部 AI 配置 → 出现小圆点；首页**再没有那块卡片**。

相关：[[desktop-pet]]（托盘的第一个使用者、桌宠的 `close` 拦截优先级）、[[ipc-contract]]（新通道走 `handle` + `unwrap`，`window:` 那三条旧的仍是裸返回值）、[[app-storage]]（`appWindow` 命名空间与单写方规则）、[[app-layout]]（侧栏底部菜单与全局弹窗挂载）、[[ai-chat]]（入口现在在侧栏那一行）、[[home-page]]（首页删掉的那块卡片）。
