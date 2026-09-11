---
name: desktop-pet
description: Toolbox 桌宠（#26a）——切过去主窗口 `hide()`、右下角留一个无边框透明常驻小窗；记「桌宠不许成为唯一出口」「`app.quit()` 会被桌宠自己的 `close` 拦截、必须先带标志 destroy」「`resizable:false` 挡不住 `setBounds`」「**1.25 缩放下 `setPosition` 会把窗口越撑越大（160→296），摆窗口一律 `setBounds` 且显式带宽高**」「**`getBounds()` 在 1.25 下回 161，尺寸只许按 `petWindowSize` 现算**」「程序性写位置只发 `move` 不发 `moved`」「`getCursorScreenPoint()` 在本机回垃圾值 -1431655808 用不得」「拖拽必须绝对算不许增量累加」「菜单靠窗口临时放大、精灵锚右下角、高度按项数算且有源码金丝雀」「资源走 `data:`/`blob:` 不碰 `tb-media:`、CSP 一字不改」「**`alwaysOnTop` 只决定「哪一层」，层内后来者在前——会议软件共享屏幕那条悬浮条就是这么把桌宠压下去的，只能 `moveTop()` 周期性抢回来**」「**空图标的 `new Tray()` 在 Windows 上不抛异常，托盘可用性必须自己 `isEmpty()` 查**」「AI 头像存桌宠配置、双窗口广播、模块级单例」等实测边界。独立窗口那套模式见 [[ai-chat]]，26b spine 见 [[spine-preview]]
---

# 桌宠（#26a）

用户的七条需求，26a 做 1/3/4/5 与 2 的「图」这一支：切换后隐藏工具箱、右下角出现桌宠；五种动画状态（默认 / 点击后 / 拖拽时 / 放下 / 长时间待机 N 种轮播）与它们的映射兜底；没配资源就用 logo；点击弹菜单。**2 的 spine 是 26b、live2d 是 26c；7（待机对话）与 6 的「桌宠 AI」是 26d**——交付切分是用户拍的（「按资源类型分 4 段」，另一条是「先做图 + spine，live2d 后置」）。

**review 追加的东西（都已在 26a 里）**：菜单从三项变五项，多出「退出桌宠 / 退出 app」两个出口（原文「点击桌宠弹窗的按钮加：退出桌宠、退出 app 功能」）；**需求 6 的「AI 头像」那一半从 26d 提前到了 26a**（原文「ai 对话框的 ai 头像默认是 logo，桌宠可以设置该头像」），26d 只剩「桌宠 AI 对话」本身。**第二轮 review 又改了四处交互**（原文见下），其中两处推翻了原设计：

| review 要的 | 落地在哪 | 推翻了什么 |
|---|---|---|
| 「桌宠按钮放在顶部 logo 处，点击 logo 调出桌宠」 | `TitleBar.vue` 的 `title-bar__logo`（首页那块卡片删了） | 计划里的「首页入口」 |
| 「桌宠下拉按钮加一个可以实时调节大小的拖拽 + input 框」 | `PetMenu.vue` 顶部那一块 + `usePetStore().setSize` 的双档节奏 | —— |
| 「打开桌宠时关闭 app 不关闭桌宠，桌宠窗口的关闭是独立的」 | `initPetWindow` 里主窗口的 `close` → `hide()` | **硬规则 1 原来的推论**「主窗口 `closed` 就销毁桌宠」 |
| 「桌宠改成右键打开下拉按钮」 | `usePetPresenter.onPointerDown` 的 `event.button === 2` | 需求 5 原文的「**点击**桌宠会弹窗几个按钮」 |

外加两个 bug（都不报错、只能靠约定防住，各配了源码金丝雀）：**「桌宠图片每次都停留在上一次更新」**（落盘防抖 vs 立刻广播的顺序，见 3.1）、**「拖拽中图片会下移」**。

第二个 bug 修了两轮：先按现象改掉了两处旁支（4.1 的双份收菜单 IPC、4.2 的拖拽态 `transform`），用户复测**仍然报**「拖拽 bug 还是没解决，`n-config-provider` 宽高会越来越大」——**这句话才把根因指出来**。探针一量：1.25 缩放下 `setPosition` 连打 120 次会把 `160×160` 撑成 `296×256`，窗口一路长高、精灵贴底一路下掉。**「图片下移」和「宽高越来越大」是同一个 bug 的两副面孔**，见 4.3。教训：桌宠这类贴身窗口上，**「元素在动」的现象要先怀疑窗口几何，再怀疑 CSS**。

**第四轮 review 又加了一个功能和一个 bug**（原文「1、加个隐藏桌宠的功能，隐藏后放到任务栏的隐藏处 2、有 bug，好像没办法被录屏，一录屏桌宠就不见了，图层下去了」）：

| review 说的 | 落地在哪 | 关键点 |
|---|---|---|
| 「加个隐藏桌宠的功能，隐藏后放到任务栏的隐藏处」 | 新文件 `electron/main/pet/tray.ts` + `hidePetWindow()` + 菜单第六项 | **托盘建不起来就拒绝隐藏**——这是硬规则 1 在隐藏这条路上的形态，见下 |
| 「一录屏桌宠就不见了，图层下去了」 | `startTopmostGuard()`：每 2s 一次 `moveTop()` | **不是录屏 API 的事**，是置顶层内的排队；见下 |

那个 bug 的排查值得记：报的是「没办法被录屏」，听起来像 Windows 的 `SetWindowDisplayAffinity` / 硬件叠加层。**先问了两句才没走错路**——「屏幕上也看不见了，被压到别的窗口底下」+「腾讯会议 / 飞书 / 钉钉共享屏幕」，两句合起来就把范围从「录屏抓不到这个窗口」缩到「有个新窗口盖住了它」。**现象里的因果是用户的猜测，不是观测**：他看到的是「一开始录屏桌宠就没了」，「录屏导致图层下去」是解释；真正的观测只有「看不见」。

文件：主进程 `electron/main/pet/petWindow.ts` + **`electron/main/pet/tray.ts`**（第四轮加的隐藏出口）+ `ipc/pet.ts` + **`electron/main/windowNav.ts`**（新抽的共用件，见下）；共享纯模块 `electron/shared/petWindow.ts`（几何）+ `electron/shared/pet.ts`（状态机与映射）；渲染 `src/stores/pet.ts`、`src/services/pet.ts`、`src/composables/{usePetPresenter,useAiAvatar}.ts`、`src/components/pet/{PetWindow,PetStage,PetMenu,PetSettingsCard}.vue`。

技术上不是新东西：#23a 已经把「独立无边框透明置顶窗口 + 同一份 `index.html` 用 query 分叉 + 主窗口关掉时一起销毁」走通了（[[ai-chat]]），本轮**照那套再开一个窗口**，真正新的只有三处——手写拖拽、动画状态机与兜底、资源不动 CSP 地进渲染进程。

## 两个窗口的关系（先看懂这张图，否则会写出把用户锁死的代码）

```
主窗口 host ──桌宠开着时 close 被拦成 hide()──┐   两个窗口的寿命**各自独立**
   │  hide()                                 │
   ▼                                         │ showHostWindow('app'|'settings')
桌宠窗口 pet ──close 被 preventDefault────────┘   （菜单三项 + 标题栏 logo 都走它）
             ──host 真的 closed 时才被 destroy──   （走「退出 app」那条路）
```

- **桌宠模式下主窗口是 `hide()` 的**（需求 1），不是 close。隐藏窗口仍在 `getAllWindows()` 里，所以 **`window-all-closed` 不会误触发退出**（探针量过，见下表）。
- 桌宠 `skipTaskbar: true`，任务栏里只剩主窗口那一个图标——而主窗口此刻是隐藏的，于是**桌宠模式下任务栏一个图标都没有**。这正是下面规则 1 存在的理由。
- **桌宠开着时关主窗口不会带走桌宠**（第二轮 review 定的，见 1.2）；主窗口真的被销毁（「退出 app」那条路）时才一起销毁桌宠。

## 三条硬规则（写代码前先记住，破一条就是事故）

### 1. 桌宠窗口不许成为唯一出口

主窗口 `hide()` 之后，回到 app 的路径只有桌宠菜单。要是让 `Alt+F4` 真把桌宠关掉，进程就变成**一个没有任何界面、任务栏里也没有图标的僵尸**——用户只能去任务管理器。

这条规则有**三个落地点**，加功能时先想清楚新路径落在哪一个：这里的 `close` 拦截、1.1 的 `app.quit()` 绕行、以及第四轮加的**「托盘建不起来就拒绝隐藏」**（见「隐藏到托盘」一节）。共同的形状是：**任何会让桌宠离开桌面的动作，都要先确认另一个出口已经在了。**

落地点是 `petWindow.ts` 里那个 `close` 拦截：

```ts
window.on('close', (event) => {
  if (closing) return;          // 我们自己退出桌宠模式时放行这一次
  event.preventDefault();
  void closePetWindow();        // Alt+F4 = 退出桌宠模式，不是关窗
});
```

`closing` 那个模块级布尔是必须的：`closePetWindow()` 自己要 `destroy()`，没有开关就会递归。**探针确认 `close` 是可 `preventDefault()` 的**（`destroy()` 则不可拦，所以退出路径用 `destroy()`）。

菜单里加了「退出桌宠 / 退出 app」两个显式出口之后**这条规则一个字都没变**：出口是用户主动选的，而 `Alt+F4` 仍然只是「退出桌宠模式」——差别在于前者走的是专门的通道，后者走的是这个 `close` 拦截。

### 1.1 `app.quit()` 会被桌宠自己的 `close` 拦掉（review 加「退出 app」时踩的）

上面那个拦截器是**无条件**的（除了 `closing`）。而 `app.quit()` 的做法是给每个窗口发 `close`——于是：

```ts
app.quit();   // 桌宠 close → preventDefault() → 退出被桌宠自己悄悄取消，什么都不会发生
```

**没有任何报错**，只是 app 不退。所以「退出 app」必须先把桌宠带标志销毁掉，再退：

```ts
// electron/main/pet/petWindow.ts
export async function quitAppFromPet(): Promise<boolean> {
  if (pet && !pet.isDestroyed()) {
    // 位置落盘是 400ms 防抖的，刚拖完就退会丢掉这一次的位置，所以同步补一次
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await saveEnabled(true, petMenuBounds(pet.getBounds(), petSize, false, currentWorkArea(...)));
    closing = true;
    pet.destroy();
    closing = false;
  }
  app.quit();
}
```

两处刻意的选择：

- **`enabled` 仍存 `true`**。用户是**在桌宠模式里**退出的，下次启动就该还在桌宠模式（`restorePetWindow()` 靠它）。存 `false` 会让「退出 app」偷偷兼职成「退出桌宠模式」。
- **位置要同步补存一次**。`scheduleSave()` 是 400ms 防抖，「拖完立刻退出」这个很自然的操作序列会把刚拖到的位置丢掉。
- 另外**不能让桌宠窗口去调 `window.api.window.close()`**：那条通道闭包的是**主窗口**，桌宠调它等于关主窗口，反而把唯一的正常出口关了。所以有专门的 `pet:quitApp`。

（grep 确认过：桌宠是本仓库**唯一**拦自己 `close` 的窗口，主窗口那条拦截也在同一个文件里，见 1.2。）

### 1.2 反过来：**主窗口关不掉桌宠**（第二轮 review 定的）

用户原话：「如果打开桌宠，那么关闭 app 的时候，不关闭桌宠，桌宠窗口的关闭是独立的」。所以桌宠开着时，**主窗口的 `close` 被拦成 `hide()`**：

```ts
// electron/main/pet/petWindow.ts —— initPetWindow(host)
window.on('close', (event) => {
  if (!isPetWindowOpen()) return;   // 桌宠没开 = 普通关窗，照旧走 window-all-closed 退进程
  event.preventDefault();
  window.hide();
});
window.on('closed', () => { if (pet && !pet.isDestroyed()) { closing = true; pet.destroy(); } });
```

三处非这么写不可的理由：

- **拦 `close` 而不是「真关掉、要用时再建」**：`createWindow()` 里顺带注册了十几组 `ipcMain.handle`，**重复注册会直接抛**。要支持重建就得先把它拆成两半，代价远大于收益。`hide()` 之后 `showHostWindow()` 一行都不用改。
- **对用户来说两者一样**：主窗口没了、任务栏图标也没了（桌宠 `skipTaskbar`）。区别只在进程还活着——而这正是需求要的。
- **规则 1 依旧成立**：桌宠一定还在（不然就不会拦），而「退出桌宠」永远会把主窗口 `show()` 回来。所以仍然不存在「一个窗口都没有的僵尸进程」。
- `closed` 那条**不能删**：走「退出 app」时主窗口是真的被销毁的，此时不销毁桌宠就会剩一个 `skipTaskbar`、任务栏上点不到的窗口。而 `quitAppFromPet` 先销毁桌宠再 `app.quit()`，那时 `isPetWindowOpen()` 已是 false，主窗口的 `close` 不会被拦——两条拦截互不打架。

### 2. 状态映射的兜底是纯函数，不是模板里的 `??`

需求 3 的「没配置的状态同一默认」要能被断言，所以三级回落全在 `resolvePetVisual(config, state, loopIndex)` 里，渲染层只消费返回值。**返回 `null` 就是「用 logo」**，不是「出错了」。

### 3. 不动 CSP

见「资源加载」一节。图片走已放行的 `data:`，spine（26b）走已放行的 `blob:`。`tb-media:` 那条白名单是它自己的安全边界，不为桌宠而扩。

### 3.1 落盘必须排在广播之前（review 报的「桌宠图片停留在上一次更新」）

**这是本轮唯一一个「代码看起来完全正确」的 bug。** 链路是：设置页改配置 → `writeState(PET_NS, ...)` → `petApplyConfigApi()` → 主进程 `send(configChanged)` → 桌宠窗口 `refreshAppState()` + `hydrate()`。

问题在第二步：**`writeState` 是 300ms 防抖的**（`src/services/appState.ts` 的 `DEBOUNCE_MS`），而广播是立刻发的。于是桌宠窗口收到通知时去读主进程手里那份，读回来的是**改动之前**那一版——表现就是「改了图，桌宠还是上一次那张；再改一次，才看到上一次选的」。

```ts
// src/stores/pet.ts —— persist()
writeState(PET_NS, plain);
void flushAppState()                                  // ← 先把防抖的写盘冲掉
  .then(() => petApplyConfigApi(plain.size));         // ← 再广播
```

**没有任何报错，typecheck / lint / build 全绿，肉眼看代码也看不出**——所以桩测里有一条源码金丝雀，正则抠出 `persist()` 那一段、比较 `flushAppState` 与 `petApplyConfigApi` 出现的先后。（正则**必须只圈 `persist()`**：`setSize` 里也有一次 `petApplyConfigApi`，那次是故意不等落盘的，拿整份文件去 `indexOf` 会把它数进来，金丝雀就废了——第一版就是这么写的，改完顺序它照样绿。）

同一类坑还在别处：任何「渲染进程写状态 → 立刻让别的窗口重读」的链路都要先 flush。目前有两处读者（桌宠窗口、AI 窗口的头像）。

## 真 Electron 探针的实测数字（与文档冲突时以这里为准）

| 量的东西 | 结果 | 它决定了什么 |
|---|---|---|
| **`resizable: false` 挡不挡 `setBounds`** | **挡不住**，程序照样改得动尺寸 | 「菜单靠窗口临时放大」这个方案成立的前提。同时说明 `resizable:false` 只挡用户拖边角 |
| **`setPosition` 连打 120 次（本机 `scaleFactor = 1.25`）** | 位置对，但 `160×160` **变成 `296×256`**——**尺寸自己一路膨胀** | **摆窗口一律用 `setBounds` 并显式带宽高，`setPosition` 全仓库禁用**。这是第二轮 review 那两条 bug 的真正根因，见 4.3 |
| **同样 120 次换成 `setBounds({...,width,height})`（宽高恒定）** | 尺寸**逐字不变**，位置同样正确 | 上一条的解法，已落地在 `dragPetMove` |
| **`getBounds()` 在 1.25 缩放下回什么** | 会回 **161** 而不是 160 | 尺寸**不许问窗口**：主进程统一走 `currentPetRect()`（位置问窗口、宽高按 `petWindowSize` 现算） |
| **程序性 `setPosition` / `setBounds` 触发哪些事件** | 只触发 **`move` / `resize`**（120 次 → `move` 119 / `resize` 88），**从不触发 `moved` / `resized`** | 落盘只听 `moved`/`resized` 即可：拖拽每帧写位置**不会**排一次写盘，不需要任何额外守卫（和 #23d 最小化那条同一个结论）。**换成 `setBounds` 之后这条结论依然成立**——已重新量过 |
| **渲染进程 `window.screenX/screenY`** | 与主进程 `getBounds().x/y` **逐字相等**（DIP，不是物理像素） | 拖拽位移用 `event.screenX/screenY` 算，跨进程不用换算 |
| **`screen.getCursorScreenPoint()`** | 本机回 **`-1431655808`** 这个垃圾哨兵值，**不可用** | 所以拖拽位移**只能由渲染进程给**，主进程不去问光标在哪。工作区改用 `getDisplayNearestPoint(落点中心)` |
| **写一次位置的开销** | **0.69 ms**／次 | 每帧一次 IPC + 一次写位置撑得住 60fps，不需要更激进的节流（rAF 合帧就够） |
| **「起始 bounds + 固定位移」反复算** | **幂等**，同一组 `(start, dx, dy)` 结果恒等 | 拖拽必须绝对算（见下） |
| **`host.hide()` 之后** | **不触发 `window-all-closed`** | 隐藏主窗口不会让 app 退出，`openPetWindow()` 里可以放心 `hide()` |
| **`pet.close()`** | 可被 `e.preventDefault()` 拦下 | 规则 1 的实现基础 |
| **data URL 成本** | 3000×3000 png **0.175 MB → 0.234 MB**，耗时 **~1 ms** | base64 膨胀约 33%、耗时可忽略。26a **没有**加「超过 N MB 拒绝」的阈值——量下来它不是瓶颈，加了反而是投机代码 |
| **两个 `alwaysOnTop` 窗口的 z 序**（第四轮） | 桌宠先开（名次 **1**），新建一个同样 `alwaysOnTop` 的窗口后桌宠掉到名次 **2**——**层内后来者在前** | 「一录屏桌宠就不见了」的根因：会议软件共享屏幕时弹的那条置顶悬浮工具条就是那个「后来者」。`alwaysOnTop` 只决定**在哪一层**，不决定层内次序 |
| **抢回置顶的两种打法**（同一批探针，用 PowerShell 枚举 z 序核对） | `moveTop()` → 名次 **0**；再调一次 `setAlwaysOnTop(true)` → 名次 **1** | 用 `moveTop()`：更彻底、**不抢焦点**。**它也不动窗口尺寸**（专门量过——`setPosition` 那个坑就在隔壁，凡是可能碰几何的 API 都要先量） |
| **`moveTop()` 的开销** | 100 次 **3 ms** | 2s 一次的常驻定时器代价可忽略；真正的代价是语义上的（桌宠会一直压在用户自己置顶的窗口上面），不是性能上的 |
| **`new Tray(nativeImage.createEmpty())`** | **不抛异常**，`isDestroyed()` 还是 `false`，只是托盘区**什么都看不见** | 托盘可用性**必须自己 `isEmpty()` 查**，光 try/catch 守不住。这条直接决定了 `ensurePetTray` 的写法（先查图标、再 `new Tray`） |
| **dev 下 `app.getAppPath()`** | 就是**项目根**（`out/renderer/` 此时并不存在，渲染进程由 vite dev server 供） | 托盘图标要两条候选路径：打包后 `__dirname/../renderer/icon.png`，dev 回落 `app.getAppPath()/public/icon.png` |

> 探针脚本是一次性的，跑完即删（[[toolbox-workflow-conventions]]）。上面这张表就是它们留下的全部产物。

## 拖拽：必须手写，`-webkit-app-region: drag` 用不了

两条硬理由：

1. 它**分不清点击与拖拽**——而单击要播「点击后」那个动画态（需求 3）。
2. 它由 OS 接管，**「拖拽中」「放下」这两个动画态拿不到任何事件**——而需求 3 要这两个态。

实现分三步，坑都在第 2 步：

1. `pointerdown`（**左键**）→ `setPointerCapture`、记 `startScreen = {screenX, screenY}`、`pet:dragStart`（主进程记下当时的矩形作为整段拖拽的基准）。**此时还不进 `drag` 态**。**右键**是另一条支线：`event.button === 2` → 弹 / 收菜单，直接 return。
2. `pointermove` → 位移超过 `PET_DRAG_THRESHOLD = 4` px 才算拖拽（否则是点击）：进 `drag` 态、rAF 节流发 `pet:dragMove {dx, dy}`。
3. `pointerup` / `pointercancel` → 释放捕获、`pet:dragEnd`（存一次位置）；没过阈值 = 单击 → **只播「点击后」动画，不弹菜单**；过了 = 进 `drop` 态，`transientMs` 后回 `idle`。

> **菜单归右键**（第二轮 review 定的，原文「桌宠改成右键打开下拉按钮」，推翻了需求 5 原文的「点击桌宠会弹窗几个按钮」）。**推翻得对**：左键单击既要弹菜单又是「拖之前先点一下」的必经路径，两件事抢同一个手势；而单击本身是需求 3 的一个动画态，它得有自己的手感。配套要在 `PetWindow.vue` 根节点上加 `@contextmenu.prevent`，否则 Chromium 自带的上下文菜单会压在自家菜单上面。

### 4.1 收菜单这件事只许由主进程做（review 报的「拖拽中图片会下移」的一半）

`pointerdown` 时**不要**再发一条 `setMenuOpen(false)`：主进程的 `beginPetDrag()` 已经顺手收了菜单，而且它**拿 `setPetMenuOpen(false)` 的返回值当拖拽基准，不再 `getBounds()` 问一遍**——

```ts
// electron/main/pet/petWindow.ts
dragOrigin = setPetMenuOpen(false) ?? pet.getBounds();
```

理由：`setBounds` 刚下发就立刻回读，Windows 上可能还是旧尺寸（缩放是异步落到窗口上的）。基准若是菜单展开时那个高矩形，`dragOrigin.y` 比真实窗口小一截，第一帧 `setPosition` 就把精灵甩上去几十像素。渲染进程那边只把自己的 `menuOpen.value = false`（纯赋值，不发 IPC），两边状态仍然一致。

### 4.2 拖拽反馈不许改几何（bug 的另一半）

桌宠窗口**贴着精灵大小**，且 `.pet` 是 `overflow: hidden`。所以拖拽态里任何 `transform: scale/translate` 都会把精灵顶出窗口边界被裁掉——用户看到的就是「拖着的时候图片往下挪了一截」。

```scss
&--dragging {
  cursor: grabbing;
  opacity: 0.86;   // 只能用不改几何的属性。别往这条规则里加 transform
}
```

桩测里有一条源码金丝雀：抠出 `PetStage.vue` 的 `&--dragging` 块，断言里面**不含 `transform:`**。

### 4.3 `setPosition` 在非整数缩放下会把窗口越撑越大（**bug 的真正根因**）

上面 4.1 / 4.2 两条都改完之后，用户复测**仍然**报「拖拽 bug 还是没解决，`n-config-provider` 宽高会越来越大」。探针一量就清楚了——**那两条是同现象的旁支，这条才是根因**：

```
scaleFactor = 1.25
A. setPosition ×120：{160,160} → {296,256}   位置对，尺寸自己膨胀
B. setBounds(带恒定宽高) ×120：{160,160} → {160,160}   尺寸逐字不变
```

非整数缩放下每次写位置都要做一遍 DIP ↔ 物理像素往返取整，而 `setPosition` 那条路会把尺寸一起重算进去，每帧攒一点。窗口一路长高，渲染进程又是 `align-items: flex-end` 贴底的，于是精灵一路往下掉——**「图片下移」和「宽高越来越大」是同一个 bug 的两副面孔，改样式治不了它。**

三条规矩，都有桩测金丝雀守着：

1. **`petWindow.ts` 里不许出现 `setPosition(`**，一律 `setBounds({x, y, width, height})` 且**宽高显式带上**。
2. **宽高不许问 `getBounds()`**（同一批探针：1.25 下它回 161 而不是 160）。主进程统一走 `currentPetRect()`——位置问窗口，宽高按 `petWindowSize(petSize, menuOpen)` 现算。这条尤其要紧，因为 `petMenuBounds` 是**按右下角锚点反推左上角**的，喂一个偏 1px 的宽高进去，每开合一次菜单精灵就挪一格。
3. **`petWindowSize` 是「窗口该多大」的唯一公式**，`petMenuBounds` 必须用它而不是自己再算一遍（桩测断言两者宽高逐字一致）。

顺带一条同源的：**`applyPetConfig` 必须先取锚点、再改 `petSize`**。`currentPetRect()` 读的就是 `petSize`，先改了它，算出来的右下角是「新尺寸摆在老位置上」的那个角，反推出的左上角原地不动 = 窗口向**右下**长，桌宠每调一次大小就往右下角爬一截。

### 位移必须是「起始 bounds + 从按下点算起的累计位移」，绝不增量累加

```ts
// 对：绝对算，幂等
const next = dragPetBounds(dragOrigin, dx, dy, workArea);   // dragOrigin 是按下那一刻的
// 错：增量累加，会漂
const next = { x: current.x + stepX, y: current.y + stepY };
```

理由：每帧都写一次位置，而它会回灌窗口自己的 `move` 事件；增量写法把取整误差和回灌事件一起滚雪球，**拖着拖着精灵就跑偏了**。桩测里有一条专门守这个——同一组 `(start, dx, dy)` 连算三次结果逐字相等。

`dragOrigin` 的宽高也**按 `petSize` 现算**（`{ ...base, width: petSize, height: petSize }`），理由同 4.3 第 2 条：把 161 当基准，等于让这个误差在每一帧里复现一次。

另外两处：**位移要用 `screenX` 不是 `clientX`**（窗口自己在跟着动，`clientX` 会一边动一边变）；**工作区按落点取而不是按起点取**（`getDisplayNearestPoint(落点中心)`），这样跨屏拖拽时夹紧的边界会跟着换屏。

## 菜单：窗口临时长大，精灵锚在右下角

菜单要显示在桌宠旁边，而桌宠窗口是贴着精灵大小的。两条都不选：常驻一个「桌宠 + 菜单」那么大的透明窗口会**在屏幕右下角常年吞掉一片点击**；再开第三个 BrowserWindow 代价太大。

**选的是：菜单打开时主进程 `setBounds(petMenuBounds(..., true))` 把窗口临时放大，关闭时还原。** 精灵**始终锚在窗口右下角**，窗口向左上生长，所以展开前后精灵在屏幕上一动不动（桩测断言「右下角坐标逐字相等」）。渲染侧 `setMenu(true)` 会 **`await` 主进程放大完再显示菜单**——顺序反了就是「菜单先画出来被旧尺寸裁掉，闪一下才出来」。

**退路（不要临场重新设计）**：真要是量到透明窗口反复 `setBounds` 会闪 / 留残影，就退到原生 `Menu.popup()`，牺牲配色一致性换稳。26a 没走这条。

### 菜单高度按项数算，且有一条源码金丝雀守着

窗口要放多大是**主进程**算的（`shared/petWindow.ts`），菜单里有几项是**渲染进程**写的（`PetMenu.vue` 的 `ITEMS`）——这两处对不上，多出来的那一项就被窗口边缘裁掉。review 加两项时正是这个风险，所以高度不再是一个写死的数：

```ts
export const PET_MENU_ITEM_COUNT = 5;    // 必须与 PetMenu.vue 的 ITEMS 对得上
export const PET_MENU_ITEM_HEIGHT = 30;  // 上下各 6px 内边距 + 18px 行高
export const PET_MENU_SIZE_ROW = 46;     // 「大小」那块：输入框行 28 + 间距 4 + 滑块行 14
export const PET_MENU_CHROME = 47;       // 内边距 8 + 边框 2 + 7 道 2px 间距 14 + 两条分隔线 18 = 42，再留 5px 富余
export const PET_MENU_HEIGHT =
  PET_MENU_ITEM_COUNT * PET_MENU_ITEM_HEIGHT + PET_MENU_SIZE_ROW + PET_MENU_CHROME;   // 243
```

**「大小」那一块刻意不并进项数**：它不可点、不在 `ITEMS` 里，混进去金丝雀就永远对不上。宽度也从 148 涨到 **208**——滑块再窄就拖不准了。

富余是**故意不对称**的：算多了只是菜单开着时窗口顶上多一截透明区（点它 = 点菜单外，本来就该收起）；算少了是**最下面那项被裁掉**，而最下面那项恰好是「退出 app」。

**加减菜单项时必须同步改 `PET_MENU_ITEM_COUNT`。** 这条约定靠桩测里一条**源码金丝雀**守着——它 `readFile('src/components/pet/PetMenu.vue')`、正则抠出 `ITEMS` 数组、数里面有几个 `key:`，与 `PET_MENU_ITEM_COUNT` 比：

```ts
const block = /const ITEMS[^=]*= \[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
eq((block.match(/\bkey:/g) ?? []).length, PET_MENU_ITEM_COUNT, '菜单项数与 PET_MENU_ITEM_COUNT 一致');
```

之所以值得用这么脏的手段：这个失败**只在运行时肉眼可见**（一个被裁掉半截的菜单项），任何类型系统都拦不住。正则写得**宽松是有意的**（`[^=]*` 容得下 `: MenuItem[]` 这样的类型标注）——它曾经写死成 `const ITEMS = [...] as const;`，给 `ITEMS` 加类型标注时金丝雀就哑了。金丝雀哑掉比金丝雀报错危险，所以宁可松。

**几何断言要拆得开才有意义。** `PET_MENU_HEIGHT` 是由那三个常数算出来的，所以「高度 ≥ 项数×项高 + 大小块」这条**恒真**（改小 `PET_MENU_SIZE_ROW` 它照样绿）。因此另有两条独立的下限：`PET_MENU_SIZE_ROW >= 46`、`PET_MENU_CHROME >= 42`，以及一条把余量写死的 `HEIGHT >= 项数×项高 + SIZE_ROW + 42`。拆红时才发现第一版三条里有一条永远绿——**桩测本身也要拆红验一遍**。

### 菜单里那块「实时调大小」：两档节奏（review 加的）

用户原话「加一个可以实时调节大小的拖拽 + input 框」。滑块一路拖会一路发值，「立刻落盘 + 立刻广播」就是刷爆写盘，于是 `usePetStore().setSize` 拆成两档：

```ts
config.value.size = next;
void petApplyConfigApi(next);                 // 窗口尺寸**立刻**跟上（主进程不读盘，参数就是这个数）
if (sizeTimer) clearTimeout(sizeTimer);
sizeTimer = setTimeout(() => { sizeTimer = null; persist(); }, SIZE_COMMIT_MS /* 120 */);
```

配套两处，缺一个就有肉眼可见的毛病：

- **`hydrate()` 里要跳过 size**：正在拖的时候磁盘那份必然落后于手上这份，照原样灌回去滑块会一跳一跳往回弹（`if (sizeTimer) next.size = config.value.size`）。
- **`usePetPresenter` 的图片缓存不能见广播就清**：配置广播是**整份配置**的，拖一次大小滑块会广播若干次，每次清缓存 = 每张图重新过一遍 IPC（读盘 + base64），拖起来一顿一顿。所以只在**资源指纹**（`kind` / `defaultRef` / `states` 的 JSON）真的变了时才清。

**排版是「输入框在上、滑块单独占下面一整行」，不是两个控件并排**（review 第三轮：「设置大小的拖拽太大了，而且布局应该在 input 下面」）。两条各自的理由：

- **并排放不下。** 菜单一共 `PET_MENU_WIDTH = 208` 宽，扣掉内边距、输入框、间距，滑块只剩一百来像素，而量程是 64→512——一格就是好几个 px，`:step="8"` 根本拖不准。让滑块独占一行才有完整的可拖长度，而这不花额外高度：`28 + 4 + 14` 与原来的 `16 + 4 + 26` 都是 46，`PET_MENU_SIZE_ROW` 一个字没改。
- **滑块要显式缩一档**：naive-ui 默认手柄 18px / 轨道 4px，那是给设置页整页表单用的，放进一个每项才 30px 高的菜单里，手柄比旁边的菜单文字还高。`:theme-overrides="{ handleSize: '12px', railHeight: '3px' }"` 缩到和菜单文字同量级。**改这两个数要回头看 `.pet-menu__size-ctrl` 那 14px 的行高**——手柄一大，滑块自己的盒子跟着高，菜单会被窗口边缘裁掉一截。

顺序由一条**源码金丝雀**守着（`<n-input-number` 的下标 < `<n-slider` 的下标）。它**只在 `<template>` 里比先后**：文件头注释里也讲了这个排版，拿整份文件去 `indexOf` 会一直命中注释（注释恒在两个标签之上），顺序反过来照样绿——这正是本功能已经栽过两次的坏金丝雀写法，见桩测那一节。

## 资源加载：`data:` / `blob:`，`tb-media:` 不碰

CSP（`index.html`）是 `img-src 'self' data: blob:` / `connect-src 'self' blob: data:` / `media-src 'self' tb-media: blob:`——**`tb-media:` 只在 `media-src` 里，`img-src` 里没有**。所以：

| 类型 | 走法 | 依据 |
|---|---|---|
| **图片（26a）** | 复用现成的 `image:dataUrl` → `getDataUrlApi(path)` → `data:` 塞进 `<img src>` | `img-src` 本来就有 `data:`；主进程那个实现对 png/gif/webp/svg **原样回传（gif 动画不丢）**，其余用 sharp 转 png |
| **默认 logo（需求 4）** | `<img src="./icon.png">`，就是窗口图标那张 | `img-src 'self'`，dev 与 prod 路径一致 |
| **spine（26b）** | 拟新增 `pet:readAsset(path) → Uint8Array` → `new Blob()` + `URL.createObjectURL` | `img-src`/`connect-src` 本来就有 `blob:`；`useSpine.ts` 现在吃的就是 objectURL |

**因此 CSP 一个字没改。** 代价（诚实写出来）：data URL 是整张读进内存 + base64 膨胀 33%——探针量下来 3000×3000 的 png 也就 0.234 MB / 1 ms，可接受，所以**没有**加体积阈值。

渲染侧有一层 `Map` 缓存（同一路径不重复过 IPC），配置变更时整个换掉。`await` 回来还要**再解一次当前该播的资源并比对**，否则状态早变了还把过期的图贴上去。

## 状态机与三级兜底（需求 3 的完整语义）

### 迁移表（`nextPetState(current, event, config)`，纯函数、无计时器）

| 当前 | 事件 | 下一个 | `holdMs` |
|---|---|---|---|
| 任意 | `click` | `click` | `transientMs` |
| 任意（非 `drag`） | `dragStart` | `drag` | `null`（手拖着，不自动走） |
| `drag` | `dragEnd` | `drop` | `transientMs` |
| **非 `drag`** | `dragEnd` | **原地不动** | — |
| `click` / `drop` | `timeout` | `idle` | `idleAfterMs` |
| `idle` | `idleTick` | `idleLoop` | `idleLoopMs` |
| `idleLoop` | `idleTick` | `idleLoop`（下标 +1） | `idleLoopMs` |
| **`drag`** | `idleTick` | **原地不动**（手正拖着它） | — |
| `idleLoop` | 任一交互事件 | 立刻离开轮播到对应态 | 按上面 |

两条容易漏的：**`idle` 回的 `holdMs` 语义和别的不一样**——它不是「离开 idle 的倒计时」而是「静置多久开始轮播」，所以到点发的是 `idleTick` 而不是 `timeout`（运行时那边靠 `next.state === 'idle' || 'idleLoop'` 选后续事件）；**没在拖的时候来 `dragEnd` 不许凭空产生 `drop` 动画**。

### 三级回落（`resolvePetVisual`）

```
该状态自己配的 → 没配就用 defaultRef → defaultRef 也空就 null（调用方用 logo）
```

- 五个状态**全不配** → 五个全部回 `defaultRef`。
- `defaultRef` 也空 → 五个**全 `null`** → 界面上是应用 logo（需求 4）。
- `idleLoop` 是**空数组**时 `resolvePetVisual('idleLoop')` **回落到 `defaultRef`**，不是抛错也不是空串。
- `nextIdleLoopIndex(index, count)` 取模环绕；`count === 0` 时恒为 0。

`normalizePetConfig(value)` 吃任何脏数据都**不抛**，且返回值 `structuredClone` 得过（纯对象铁律，本仓库踩过五次，见 [[ipc-contract]]）。

## 两个命名空间必须分开：`pet`（渲染写）/ `petWindow`（主进程写）

照抄 `ai` / `aiWindow` 的理由：`pet` 那块是渲染进程 store **整块覆盖**写的，而窗口 bounds 与 `enabled` 是**主进程**写的。混在一个命名空间里，两边各写一次整块就会互相抹掉。

- `pet`：`PetConfig` 全部字段（kind / defaultRef / states / size / 三个时长）。
- `petWindow`：`{ bounds?: PetRect; enabled?: boolean }`。**`enabled` 在这边**，因为改它的是主进程（关桌宠、启动恢复）。
- **启动恢复**：`whenReady` 里 `restorePetWindow()`——上次退出时停在桌宠模式，这次也直接进桌宠，否则「切桌宠 → 关 app → 再开」会莫名回到工具箱。
- **跨窗口刷新**：主窗口改完设置 → `applyPetConfig(size)` → 主进程重设尺寸并 `send(configChanged)` → 桌宠窗口 `await refreshAppState()` 再重读 store。**这条不加就是「改了设置桌宠没反应，重启才生效」**（独立窗口的内存快照会过期，`refreshAppState` 就是为这个存在的）。广播里**不带 payload**，只送一个「变了」的信号——带上就是两份数据，迟早对不上。

## 与计划的两处偏离（都是有意的，代码里有注释）

1. **计划里的 `setSize` 通道折进了 `configChanged`**：一次保存本来就要「重设尺寸 + 让桌宠重读配置」两件事，两条通道就是两次 IPC 和两个可能失配的时刻。
2. **新增了 `stateChanged` 广播**（主进程 → 主窗口）：`Alt+F4` 打在桌宠上、或菜单里点「退出桌宠」，都会退出桌宠模式，**标题栏那个 logo 入口不能只靠自己的点击**维护状态。它同时还在挂载时做一次 `isPetOpenApi()` 对账。
3. **入口从首页挪到了标题栏 logo**（第二轮 review，原文「桌宠按钮放在顶部 logo 处，点击 logo 调出桌宠」）。首页那块卡片连同 `home__pet-entry` / `home__pet-icon` 样式一起删了。两处要注意：标题栏整条是 `-webkit-app-region: drag`，**能点的东西必须自己声明 `no-drag`**（搜索框那块已有先例）；`can('desktop-pet')` 关掉时**退回纯展示的 logo**，而不是留一个点不动的按钮。

## 菜单六项接到哪

| 按钮 | 行为 |
|---|---|
| —— 大小（滑块 + 输入框）—— | 不是菜单项，见上一节 |
| 设置 | `showHostFromPet('settings')` → 主窗口显示并跳设置页（复用现成的 `AI_CHANNELS.navigateSettings`） |
| AI 对话 | 主进程内部直接调 `openPanelWindow()`，**主窗口保持隐藏**——用户要的是和小精灵说话，不是把整个工具箱翻出来 |
| 打开 app 界面 | `showHostFromPet('app')` |
| —— 分隔线 —— | 上面三项是导航，下面三项是「让桌宠离开桌面」 |
| **隐藏桌宠**（第四轮加的） | `hidePetApi()` → `hidePetWindow()`：收进系统托盘，**桌宠模式不退**。**它不算出口项、不降色**——它什么都没结束 |
| **退出桌宠** | `closePetApi()`——和标题栏那个 logo 是同一条通道：主窗口回来 + 桌宠销毁 |
| **退出 app** | `petQuitAppApi()` → `pet:quitApp` → `quitAppFromPet()`（**不是** `app.quit()`，理由见规则 1.1） |

> **原来的假设已被 review 推翻。** 26a 初版是「三项都不关桌宠、菜单里一个出口都没有」，依据是「小精灵拥有整个 app 的控制权，它退场了控制权就没了」。用户 review 的原话是「点击桌宠弹窗的按钮加：退出桌宠、退出 app 功能」。**推翻得对**：原设计要求用户先想到「打开 app 界面」、再去找那个开关，才能退出——桌宠模式下最想干的两件事反而最绕。控制权那条理由仍然成立，但它论证的是「导航三项不关桌宠」，论证不了「不给出口」。

两处设计细节：

- **出口排在最后并降一档颜色**（默认次级灰，hover 也不给紫色，只提亮到主文本色——紫色是主动作的强调色，[[theme-system]]），「退出 app」垫底，减少手滑。
- **不给二次确认**。这个窗口上压根没挂 dialog / message provider（它不该弹任何东西，见下），而所有状态（会话、配置、窗口位置）本来就是随时落盘的——退出不丢东西，一个「确定要退出吗」只是白挡一下。

`focusHostSettings()` 原来长在 `ai/panelWindow.ts` 里，现在抽成 **`electron/main/windowNav.ts` 的 `showHostWindow(target)`**，host 引用也一起挪过去了——两个子窗口各存一份 host 引用，迟早会有一份是过期的。`showHostWindow` 里的 `show()` **不能省**：桌宠模式下 host 是隐藏的，只 `restore()+focus()` 显示不出来。

## 隐藏到托盘（第四轮 review）

用户原话：「加个隐藏桌宠的功能，隐藏后放到任务栏的隐藏处」。Windows 上「任务栏的隐藏处」就是托盘区的「隐藏的图标」抽屉——所以这条需求实际要的是**系统托盘图标**，不是 `minimize()`（桌宠 `skipTaskbar`，最小化之后任务栏上连个能点的东西都没有）。

**隐藏 ≠ 退出**：窗口不销毁、主窗口不叫回来、桌宠模式不退，位置 / 大小 / 正在播的动画一个都不动，点托盘图标原样回来。

### 硬规则 1 在这条路上的形态：**托盘建不起来就拒绝隐藏**

```ts
export function hidePetWindow(): boolean {
  if (!pet || pet.isDestroyed()) return false;
  if (!ensurePetTray({ show, showHost, quit })) return false;  // ← 先确认出口，再动窗口
  setPetMenuOpen(false);
  stopTopmostGuard();
  pet.hide();
  notifyHost(false);
  return true;
}
```

顺序**不许反**。隐藏之后主窗口多半也是隐藏的（桌宠模式的常态），桌宠自己又 `skipTaskbar`——托盘图标就是屏幕上唯一还能点的东西。先 `hide()` 再发现托盘建不出来，用户就被锁在一个没有任何界面的进程里了，正是规则 1 说的那种事故。

而**「托盘建不出来」不会以异常的形式告诉你**：探针量到 `new Tray(nativeImage.createEmpty())` 在 Windows 上照建不误、`isDestroyed()` 还是 `false`，只是托盘区什么都看不见。所以 `ensurePetTray` 自己查 `isEmpty()`，try/catch 只是兜第二层。这条有源码金丝雀守着（`isEmpty()` 的下标必须小于 `new Tray` 的下标）。

托盘右键菜单三项：**显示桌宠 / 打开 app 界面 / 退出 app**（左键单击 = 显示桌宠，少一次右键）。**「退出 app」不能省**——托盘一旦出问题，用户就只剩任务管理器了。「打开 app 界面」时**桌宠继续躺在托盘里**：用户要的是 app 界面，不是把小精灵也一起翻出来。

图标要两条候选路径（打包后在 `out/renderer/`，dev 下那个目录根本不存在，回落项目根的 `public/`），源图 1024×1024 直接塞给托盘会被系统缩得很难看，统一 `resize` 到 32。

### 隐藏时**广播「桌宠模式关了」**

`notifyHost(false)` 让标题栏那个 logo 入口变回「未开启」，于是用户点它就是「把桌宠叫回来」——`openPetWindow()` 认得这个隐藏态：

```ts
if (pet && !pet.isDestroyed()) {
  if (!pet.isVisible()) return showPetWindow();   // 躺在托盘里 → 放回桌面
  …
}
```

反过来（隐藏时仍然显示成「开着」）才是真会让人懵的：屏幕上什么都没有，点一下还把它彻底退掉。

**托盘只在隐藏期间存在**，平时不常驻（桌宠自己就在桌面上，再挂一个托盘图标是重复入口）。`showPetWindow()` 里 `destroyPetTray()`；窗口 `closed` 时也要 `destroyPetTray()`——**窗口有可能是在隐藏状态下被销毁的**（从托盘点「退出 app」），不撤的话托盘区会留一个点了什么都不会发生的图标。

## 置顶要周期性抢回来（第四轮 review 的 bug）

用户报「一录屏桌宠就不见了，图层下去了」。**不是录屏 API 的事**：

**`alwaysOnTop: true` 只把窗口放进「置顶那一层」，层内还要再排一次队，而后来者在前。** 探针量到的：桌宠先开着（z 序名次 1），随后新建一个同样 `alwaysOnTop` 的窗口，桌宠立刻掉到它下面（名次 2）。会议软件共享屏幕时弹的那条置顶悬浮工具条，就是那个后来者。

```ts
function startTopmostGuard(): void {
  if (topmostTimer) return;
  topmostTimer = setInterval(() => {
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return;   // 躺在托盘里就别抬
    pet.moveTop();
  }, PET_TOPMOST_REASSERT_MS);   // 2000
}
```

三处不显然的：

1. **只能轮询，没有事件可听。** 悬浮条出现时桌宠**不会** `blur`——它本来就没有焦点；也没有任何「我被别人盖住了」的事件。悬浮条什么时候出现、会不会自己再抬一次，都不在可观测范围内。
2. **用 `moveTop()` 而不是再调一次 `setAlwaysOnTop(true)`。** 同一批探针里两者都能抢回来（名次分别是 0 和 1），但 `moveTop()` 更彻底、**不抢焦点**、100 次只要 3 ms。**而且它不动窗口尺寸**——这一条是专门量的，`setPosition` 那个把 `160×160` 撑成 `296×256` 的坑就在隔壁（见 4.3），凡是可能碰几何的 API 在这个文件里都得先量过再用。
3. **周期是 `PET_TOPMOST_REASSERT_MS`，写在 `shared/petWindow.ts` 里**（有金丝雀守着「不许在守卫里写死字面量」，另有一条守它落在 `[500, 5000]`）。2 秒是「被压住最多难看两秒」和「常驻定时器」之间的折中——探针说代价那一侧基本是零，所以真正被权衡的是**语义**：桌宠会一直压在用户自己置顶的窗口上面。那本来就是「常驻置顶小精灵」的题中之义，但写下来免得以后有人当 bug 修。

守卫的开关点有三处，**漏一处就是泄漏或者白抬**：`ready-to-show` 起、`showPetWindow()` 起（并且**显式先抬一次**，不等下一拍）、`hidePetWindow()` 停、窗口 `closed` 停（不停的话这个 interval 会把事件循环一直吊着）。



用户原话：「ai 对话框的 ai 头像默认是 logo，**桌宠可以设置该头像**」。

**存在 `PetConfig.aiAvatarRef` 里，不在 `ai` 命名空间里。** 头像属于「这只小精灵长什么样」，不属于「连哪个厂商的哪个模型」——于是**换一只桌宠就换一套形象**，AI 配置那边一个字不用动，AI 窗口只是这份配置的读者。它也**刻意和 `defaultRef` 分开**：桌宠站在桌面上的样子（可能是一整只角色）和聊天气泡边上那个 28px 的小圆头像，通常不是同一张图。

空串是**有意义的值**（= 用应用 logo），所以 `normalizePetConfig` 里它不走 `states` 那套「留空就删掉」的处理，只 trim。

链路上三处不显然的：

1. **同样走 `image:dataUrl` → `data:`，不为头像松 CSP**（`img-src 'self' data: blob:`）。logo 兜底是 `./icon.png`，命中 `'self'`。
2. **`applyPetConfig` 要广播给两个窗口，且必须在「桌宠没开」的早退之前广播**：
   ```ts
   getPanelWindow()?.webContents.send(PET_CHANNELS.configChanged);   // 先给 AI 窗口
   if (!pet || pet.isDestroyed()) return null;                        // 桌宠没开也不影响头像生效
   ```
   顺序反了就是「桌宠没开时换头像，AI 窗口纹丝不动」。`getPanelWindow()` 这个 export 就是为它加的。AI 窗口那边订阅 `pet:configChanged` → `refreshAppState()` + `petStore.hydrate()`；**光靠 focus 不够**——那个窗口可能一直不再获得焦点。
3. **`useAiAvatar()` 是模块级单例**（一个 `ref` + 一个 `watch`，第一次调用时建）。一屏对话里几十条助手消息都要这个头像，各自过一趟 IPC 纯属白烧；单例让「换一张头像」在全窗口只触发一次读盘。里面有个 `seq` 令牌丢弃**后发先至**的过期结果（快速换两张图会遇上），读盘失败则回落 logo（图被删了、盘符换了，不该让头像变成一块空白）。那个 `watch` **刻意不在组件的 effect scope 里**：它与窗口同寿，跟着第一个用到头像的组件一起卸载才是错的。


## 桩测

`electron/shared/{pet,petWindow}.ts` 都是纯函数，直接进 `scripts/tbverify/main-ai-review.ts`，**不新开 bundle**。主进程套件 **142 → 324 条**（渲染进程仍 193），0 失败。

拆红**逐条验过红**（每条改完即还原）。26a 初版那六条：

| 拆掉什么 | 该红的 | 红了几条 |
|---|---|---|
| `resolvePetVisual` 去掉 `defaultRef` 兜底 | 映射那组的「全不配」 | 11 |
| `nextIdleLoopIndex` 去掉取模 | 环绕序列 | 2 |
| `dragPetBounds` 改成增量累加 | 幂等那条 | 3 |
| `petMenuBounds` 改成向右下生长 | 「右下角坐标相等」 | 2 |
| `clampPetBounds` 去掉 `PET_VISIBLE` | 「拖出屏幕还留一角」 | 1 |
| 状态机允许 `drag` 被 `idleTick` 打断 | 拖拽中不被待机打断 | 1 |

第二轮 review 加的八条（源码金丝雀为主——这一轮修的东西**全都是类型系统看不见的顺序与样式约定**）：

| 拆掉什么 | 该红的 |
|---|---|
| `persist()` 里把 `flushAppState()` 挪到 `petApplyConfigApi` 之后 | 「落盘排在广播之前」 |
| `.pet-stage--dragging` 加回 `transform: scale(1.04)` | 「拖拽态不含 transform」 |
| `usePetPresenter` 的 `event.button === 2` 改成 `=== 0` | 「右键才弹菜单」 |
| `PetMenu.vue` 删掉 `n-slider` | 「菜单里有滑块」 |
| `PetMenu.vue` 删掉 `n-input-number` | 「菜单里有输入框」 |
| 把 `store.setSize(` 改成别的名字 | 「滑块与输入框接的是 setSize」 |
| `PET_MENU_SIZE_ROW` 调小到 40 | 「装得下标题行与滑块行」 |
| `PET_MENU_CHROME` 调小到 30 | 「容器余量覆盖内边距 + 边框 + 项间距 + 两条分隔线」 |

**这一轮红一遍抓出了我自己写的三条坏断言**，都是「看着在守、其实守不住」，记下来别再犯：

1. `store.indexOf('flushAppState()')` 扫的是**整个** `src/stores/pet.ts`，`setSize` 里也有 `petApplyConfigApi`，所以顺序反过来它照样绿。改成先用 `/function persist\(\)[\s\S]*?\n  \}/` 把 `persist()` 那一段抠出来、只在段内比下标——**源码金丝雀必须先划定作用域再比位置**。
2. `source.includes('store.setSize')` 匹配得上 `store.setSizeX`。**判「调用了某个函数」要带左括号。**
3. `PET_MENU_HEIGHT >= COUNT * ITEM_HEIGHT + SIZE_ROW` 是**同义反复**：`PET_MENU_HEIGHT` 本身就是这几个常数加出来的，把 `SIZE_ROW` 从公式里删掉它也绿。改成和一个**绝对下限**比（`+ 42`）才有信息量。**断言不能拿被测量自己的定义当期望值。**

第三轮（`setPosition` 那个根因）加的七条，同样逐条验过红：

| 拆掉什么 | 该红的 |
|---|---|
| `dragPetMove` 退回 `setPosition` | 「不用 setPosition」+「setBounds 带宽高」 |
| `setBounds` 只写 `x/y`、不带宽高 | 「setBounds 显式带上宽高」 |
| `currentPetRect` 改回整块 `getBounds()` | 「只从 getBounds() 取 x/y」 |
| `petMenuBounds` 自己再算一遍宽高 | 「与 petWindowSize 逐字一致」+「展开后窗口宽」 |
| `petWindowSize` 展开态漏掉菜单宽 | 三条（宽度、向左生长、展开态公式） |
| `petWindowSize` 不夹尺寸 | 「越界尺寸先被夹进合法区间」 |
| `applyPetConfig` 先改 `petSize` 再取锚点 | 「先取锚点再改 petSize」 |

**这一轮又抓出一条我自己的坏断言，而且和上面第 1 条是同一个病**：`apply.indexOf('currentPetRect()')` 命中的是**那段解释性注释里**的 `currentPetRect()`——注释恒在两行代码之上，所以把顺序反过来它照样绿。改成锚在赋值语句 `const current = currentPetRect()` 上才红。**教训升级版：源码金丝雀不但要划作用域，还要确认锚点串没有出现在同段的注释里**——而这恰恰容易发生，因为好代码往往会在旁边解释这条约定。

第四轮（菜单里那块大小的排版）只加了一条：

| 拆掉什么 | 该红的 |
|---|---|
| `PetMenu.vue` 里把 `<n-input-number>` 那块与 `<n-slider>` 那块对调 | 「输入框排在滑块之前」 |

这条金丝雀**只在 `<template>` 里比先后**（先用 `/<template>([\s\S]*?)<\/template>/` 抠出模板段），理由就是上面第三轮那条教训：文件头注释里也写了这个排版决定，拿整份文件去 `indexOf` 会命中注释——而注释恒在两个标签之上，顺序反过来照样绿。

**这一轮还栽在变异脚本本身上**：第一次拆红我用的正则是 `/^    <div class="pet-menu__size-head">/`（四空格缩进），而源码在 `.pet-menu` 那层里是**六空格**，于是替换悄悄没生效，套件仍是 308 通过 0 失败——**那个「绿」是我的变异没写成，不是断言在守**。是脚本自己打的那行校验（`swapped: false`）暴露的。**拆红脚本必须自证变异真的写进去了**（改完断言两块确实换了位置，换不成就 `throw`），否则「跑完还是绿」有两种解释，而你会默认取错的那种。

第五轮（隐藏到托盘 + 置顶抢占，共 16 条新断言）拆了九条，**每条都带「变异写进去了: true/false」的自证**：

| 拆掉什么 | 该红的 |
|---|---|
| 菜单里删掉「隐藏桌宠」这一项（`hidePetApi()` → `void 0`） | 「菜单第六项接的是 hidePetApi」 |
| `tray.ts` 把 `isEmpty()` 守卫挪到 `new Tray` 之后 | 「先查空图标再建托盘」 |
| 托盘菜单里的「退出 app」改成别的字 | 「托盘菜单里有退出 app」 |
| `hidePetWindow` 先 `pet.hide()` 再建托盘 | 「确认托盘可用之后才 hide」 |
| 守卫里 `moveTop()` 换成 `setAlwaysOnTop(true)` | 「周期性主动抬回置顶」 |
| 守卫里把周期写死成 `2000` 字面量 | 「周期走 shared 里那个常数」 |
| 桌宠 `closed` 里不停守卫 | 「销毁时 stopTopmostGuard」 |
| 桌宠 `closed` 里不撤托盘 | 「销毁时 destroyPetTray」 |
| `PET_TOPMOST_REASSERT_MS` 调到 50 | 「周期落在 [500, 5000]」 |

**其中两条第一次跑出来是 0 红——又是同一个病，这是本功能第 5、6 条被红证抓出来的坏金丝雀**：

1. `tray.includes('退出 app')` 拿**整份文件**去查，而文件头注释里正写着「托盘右键菜单里**必须有「退出 app」**」——把真菜单项改名照样绿。改成先用 `/Menu\.buildFromTemplate\(\[([\s\S]*?)\]\)/` 抠出模板段，只在段内查（并加一条「找得到这个模板段」的结构哨兵，抠不出来就红，免得结构一变金丝雀静默失效）。
2. `petWindow.includes('moveTop()')` 同理：`showPetWindow()` 自己也调一次 `moveTop()`，守卫里那句换掉照样绿。改成只在已经抠出来的 `startTopmostGuard` 函数体里查。

**规律已经很清楚了**：坏金丝雀无一例外是「**拿整份文件去 `includes` / `indexOf`**」。锚点串会出现在同段注释里（第 3、5 条）、出现在同文件的别的函数里（第 1、6 条）、或者被更长的名字包住（第 2 条）。写源码金丝雀的固定动作应该是：**先用正则把作用域抠出来 → 断言抠到了 → 再在段内比**。三步缺一步就是一条看着在守、其实守不住的断言。

几何那组还守着：`defaultPetBounds` 贴右下角且留 `PET_EDGE_GAP`；**负坐标副屏**（`x: -1920`）上按那块屏算；`clampPetBounds` 四个方向都至少留 `PET_VISIBLE = 32`（**这条漏了桌宠就永远拖不回来**）；`clampPetBounds` **不改宽高**（菜单展开时窗口比精灵宽，改了就把菜单裁掉）；`parsePetBounds` 拒 `NaN`/`Infinity`/字符串/`null`。

## 人工验清单（26a，本机做得了、不用真 key）

**基本流**：**标题栏点 logo** → **主窗口消失、右下角出现 logo 桌宠** → 拖着满屏走、**拖到第二块屏幕**、松手 → 位置留住 → 拖到屏幕边缘外**拖不丢**（至少留一角）→ 关掉整个 app 再启动，**还是桌宠模式且在上次的位置**。

**交互与动画**：**右键**桌宠 → 弹出菜单：**顶上一块「大小」滑块 + 输入框**，下面五项（**桌宠自己一动不动**，菜单向左上展开）；**左键单击不弹菜单**（只播点击动画）；**没有 Chromium 自带的上下文菜单压在上面**；点菜单外收起 → 菜单开着**直接按住就能拖**，而且**第一帧不许上跳**；配好五个状态的图后：静止 = 默认图 / 点一下 = 点击图并在 `transientMs` 后回落 / 拖着 = 拖拽图 / 松手 = 放下图再回落 / 放着不动 `idleAfterMs` 后**开始轮播待机图，多条依次换**；**只配默认图**时五个状态全是那一张；**一张都不配**时是 logo。

**拖拽的尺寸稳定性（第三轮 review 那个根因，务必在 125% 缩放下验）**：**按住来回拖十几秒不松手** → 精灵**大小逐字不变、不下移**（松手才停的话看不出来，膨胀是每帧攒的）；松手后再拖第二轮 → 仍不变；**开合菜单十几次** → 精灵在屏幕上**一个像素都不许挪**（`getBounds()` 回 161 那条如果漏了，这里会一格一格地爬）；**反复调大小十几次**（滑块来回拖）→ 桌宠**不往右下角爬**。这四条各对应一条桩测金丝雀，但金丝雀守的是源码写法，**几何本身只有肉眼能验**。

**菜单里那块大小**：排版是**「大小」+ 输入框 + `px` 一行，滑块单独占下面一整行**（第四轮改动，也就是源码注释里说的「review 第三轮」：「设置大小的拖拽太大了，而且布局应该在 input 下面」）——看一眼滑块轨道是不是横贯整块菜单、手柄是不是和菜单文字一个量级（12px，不是默认那个比文字还高的 18px）；拖滑块 → **桌宠边跟着实时缩放**（不是松手才变），而且**从 64 拖到 512 全程可控**（挤在同一行时一格就是好几个 px，这轮改的就是它）；输入框打 `300` → 同样立刻生效；**输入框清空**时桌宠不许弹回 160；**菜单最下面那项「退出 app」不许被窗口边缘裁掉**（这块高度换了写法但总高仍是 46，裁掉就说明 `PET_MENU_SIZE_ROW` 没跟上）；改完不重启，回设置页那个滑块**读到的是新值**（验落盘）。

**五项菜单**：设置 → **主窗口出现并停在设置页，桌宠还在** → AI 对话 → **AI 窗口开出来，主窗口仍然隐藏** → 打开 app 界面 → 主窗口出现 → **再点一次标题栏 logo** → **桌宠消失、主窗口留下**；菜单里「退出桌宠」→ 同上；「退出 app」→ **整个进程退出**（任务管理器里没有残留）。

**隐藏到托盘（第四轮 review）**：菜单点「隐藏桌宠」→ **桌宠从桌面消失**，托盘区（多半在「隐藏的图标」抽屉里）出现一个 app 图标，**图标看得见**（不是空白方块——空图标不抛异常，只能肉眼验）；**左键单击托盘图标** → 桌宠**原样回来**（位置、大小、正在播的动画都没变），**托盘图标随之消失**；再隐藏一次 → 托盘右键 → 三项齐全（显示桌宠 / 打开 app 界面 / 退出 app）；点「打开 app 界面」→ **主窗口出来，桌宠仍留在托盘里**；隐藏期间**标题栏那个 logo 显示成「未开启」**，点它 → **桌宠回来**（而不是彻底退掉）；隐藏状态下从托盘点「退出 app」→ **进程干净退出，托盘图标不残留**；隐藏后菜单不许留在展开态（再显示出来时精灵旁边不该挂一片透明区）。**dev 与打包后各验一遍**——托盘图标那两条候选路径是分别给这两种情形准备的。

**置顶抢占（第四轮 review 的 bug，要真开一次会议软件）**：桌宠开着 → 用腾讯会议 / 飞书 / 钉钉**共享屏幕**，等那条置顶悬浮工具条出现 → 桌宠**最多两秒内自己回到最上层**，之后一直在上面；结束共享 → 桌宠仍在。顺带验两件事：抬回置顶的过程中**桌宠不抢焦点**（正在打字的窗口不会掉输入焦点）、**桌宠大小不变**（`moveTop()` 不动几何这条是探针量的，肉眼再确认一次）；桌宠躺在托盘里时**不该有任何动静**（守卫停了）。

**两个窗口各关各的**（第二轮 review 推翻了原来的「主窗口关掉带走桌宠」）：桌宠开着时点主窗口的 ✕ / `Alt+F4` → **主窗口消失、桌宠还在原地照常用**；再从菜单「打开 app 界面」→ **主窗口原样回来**（不是重开一个空窗口，验的是 `hide()` 而非 destroy）；反过来 `Alt+F4` 打在桌宠上 → **退回主窗口**，且标题栏 logo 的状态跟着变（验 `stateChanged` 广播）；桌宠**没开**的时候关主窗口 → **进程照旧退出**。

**边界**：桌宠模式下**任务栏只有一个图标**；设置页改大小 / 换图 → **桌宠立刻变，且是刚改的那张**（不是上一次那张——那是 bug 1，验 `flushAppState` 排在广播之前）；150% 缩放下再走一遍拖拽与右下角停靠；`can('desktop-pet')` 关掉时标题栏**是纯 logo 而不是点不动的按钮**；DevTools 控制台**没有 CSP 报错**（验「不动 CSP」）；透明窗口有没有阴影矩形边 / 重绘残影（`hasShadow:false` 已经是为这个下的，真有残影就退 `transparent:false`）。

## 26b / 26c / 26d 的接口已经留好

- **26b spine**：`PetStage` 加 spine 分支，复用 `useSpine.ts`（见 [[spine-preview]]）；新增 `pet:readAsset` 返回二进制 → Blob → objectURL；**`PetStateMap` 的值在 spine 模式下是动画名而不是路径**，`resolvePetVisual` 一行不用改（它只管兜底、不管语义）。设置页要能**列出 skeleton 里的动画名**供下拉选，比让用户手打字符串靠谱。
- **26c live2d**：先探针再选型。要量：包体、是否需要 CDN（本仓库 CSP 禁）、能不能跑在 pixi v8 上（`pixi-live2d-display` 主流版本钉的是 pixi v6/v7，**很可能与现有 v8 冲突**，这是最大未知数）。
- **26d 桌宠 AI + 待机对话**：复用主进程整套 AI 栈（`runChat` / 13 个工具，**一行不改**，见 [[ai-tools]]）；**桌宠的内置 prompt 必须进 `electron/shared/prompts.ts`**——那是 #23 review 拍的「全仓库唯一出处」，加具名常量，不许在调用点内联。AI 头像同样走 `data:`。

相关：[[ai-chat]]（独立窗口那套模式的第一个使用者，`focusHostSettings` 已抽成共用）、[[ipc-contract]]（`{code,data,message}` 与纯对象铁律）、[[app-storage]]（两层存储与命名空间）、[[home-page]]（首页入口）、[[theme-system]]（配色：紫色留给 AI 入口，桌宠入口用中性面板色）、[[spine-preview]]（26b 要复用的渲染器）。
