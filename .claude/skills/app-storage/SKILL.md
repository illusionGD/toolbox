---
name: app-storage
description: Toolbox 存储路径设施——数据缓存目录/数据保存目录的默认值与回退、可改+可迁移、清空缓存、app-state.json 取代 localStorage；后续所有落盘功能取路径的唯一入口
---

# 存储路径设施（P0 通用能力）

给整个应用定下**两个目录**，后续任何要落盘的功能都从这里取路径，不再各自 `app.getPath()`。

| 目录 | 默认值 | 语义 | 用户可做的事 |
| --- | --- | --- | --- |
| **数据缓存目录** | `%TEMP%\Toolbox` | 可随时丢弃的中间产物 | 改路径、清空 |
| **数据保存目录** | 安装目录下 `data`（dev 为仓库根 `data`） | 必须保住的数据 | 改路径（**连带迁移**） |

## 取路径的唯一入口

```ts
import { cachePath, dataPath, ensureCacheDir, ensureDataDir } from '../storage/paths';

const out = cachePath('video-clip', `${id}.mp4`); // 可丢弃
const db = dataPath('presets.json'); // 要保住
```

**不要自己拼 `app.getPath(...)`**：路径可被用户改掉并迁移，绕过 `paths.ts` 的代码在用户改完路径后会继续写老地方。`getCacheDir()/getDataDir()` 每次都读当前值，不要把结果缓存到模块变量里。

## 文件布局

```
%APPDATA%\Toolbox\settings.json     ← 路径设置本身（指针）
<dataDir>\.toolbox-data             ← 归属标记
<dataDir>\app-state.json            ← 主题 / 各工具配置 / 使用统计
<cacheDir>\.toolbox-cache
```

**指针不能放在被指的目录里**。`settings.json` 记的是「数据目录在哪」，放进数据目录就等于自己指自己——用户一改路径，下次启动去默认位置找不到它，路径设置凭空丢失。所以它固定在 `app.getPath('userData')`，且**只存被用户改过的键**（删空键而不是写默认值），这样默认值以后变了也能跟着走。

`app-state.json` 是**一个文件装全部命名空间**（`theme` / `usage` / `tools.<toolKey>`）：迁移时只搬一个文件，也不会出现多文件半新半旧。写盘一律临时文件 + `rename`。

## 实测结论（都推翻过一次直觉，别按文档写）

| 事 | 实测结果 | 因此代码里 |
| --- | --- | --- |
| `fs.access(dir, W_OK)` | 对 `C:\Program Files`、`C:\Windows\System32`、`C:\` **全都说「可写」**，真写是 `EPERM`。Windows 上它只看只读属性不看 ACL | `probeWritable()` 真写一个 `.tbprobe-*` 再删，**绝不用 access** |
| `app.getPath('cache')` | Windows 上 = `%APPDATA%`（Roaming），系统清理**根本不清** | 缓存默认用 `app.getPath('temp')`（= `%LOCALAPPDATA%\Temp`，正是磁盘清理/存储感知的目标） |
| 跨盘 `rename` | 文件与目录**都** `EXDEV` | 捕获 EXDEV 退化为 `fs.cp(recursive)` + `rm` |
| `rename` 到已存在的**目录** | `EPERM`（哪怕是空目录） | 目标非空且无我们标记就拒绝接管；这也是最好用的「中途失败」注入手段 |
| `rename` 到已存在的**文件** | 静默覆盖 | 临时文件 + rename 之所以原子 |
| `rmdir` 非空 | `ENOTEMPTY` | 源目录用**非递归 rmdir**，别人放了东西就让它失败 |
| 被其它进程 `r+` 持有的文件 | **仍然能 unlink**（node 带 FILE_SHARE_DELETE） | 「文件被占用所以删不掉」在 Windows+node 下不易复现；`clearCache` 的 `failed` 是防御性的，别指望测出来 |
| `fs.cp(recursive)` 跨盘 | 保留 mtime，嵌套完整；`errorOnExist` → `ERR_FS_CP_EEXIST` | — |
| `path.relative` | `('D:\\ab','D:\\a')` → `'..\\a'`；跨盘返回绝对路径 | 嵌套判断用它，**不用 `startsWith`**（会把 `D:\dataX` 判成在 `D:\data` 之内） |

## 迁移：顺序是全部的重点

```
suspend 状态写入 (await，等在途的写盘落完)
  ↓
校验目标                     ← 抛中文错，原样经 IPC 到界面
  ↓
写目标目录的归属标记
  ↓
逐个顶层条目 rename / EXDEV→cp+rm    ← 任一失败：把已搬的搬回去，再抛错
  ↓
切换内存中的 dataDir
  ↓
写 settings.json             ← 只有全部成功才写
  ↓
resume（finally，成功失败都要）
```

三处踩过的坑：

1. **suspend 必须在校验之前**。校验自己要做磁盘 I/O（探测可写、列目录），这段窗口里一次防抖写盘就会在旧目录留下 `app-state.json.tmp-<pid>`，搬迁枚举到它、真去 rename 时它已被改名 → `ENOENT` → 整批回滚，一次本该成功的迁移变成失败。验证脚本的 G3/G5 就是这条的回归。
2. **suspend 要 await**。光把开关拨过去不够，此刻可能正有一次写盘停在「临时文件已写好、还没 rename」的中间态。`suspend()` 里 `await chain` 把队列排空。
3. **指针最后写**。反过来一旦搬到一半失败，指针已指新目录而数据还在旧目录，下次启动就是一个空应用。
4. 兜底：`moveDirContents` 对「枚举后自己消失了的条目」（`ENOENT` 且源确实不存在）**跳过而不回滚**——源里已经没有它，没什么会丢。

挂起期间 `writeAppState` 返回 `false`：改动**照样合并进内存**，只是不写盘，`resume` 时统一写到新目录，一条都不丢。渲染进程另外在切换前调 `flushAppState()`，但**不能只靠它**——挂起窗口的保护必须在主进程侧。

## 归属标记是递归删除的前提

`.toolbox-cache` / `.toolbox-data`。清空缓存是递归删除，动手前必须能证明「这个目录是我们的」：

- 目标目录**非空且没有我们的标记** → 拒绝接管，提示选空文件夹。
- `clearDirContents` 没读到标记 → 直接拒绝，不删任何东西。
- **盘根一律拒绝**（`path.parse(x).root === x`）。

校验矩阵（每条都有断言）：非绝对路径 / 盘根 / 与当前相同 / 目标在当前之内 / 当前在目标之内 / 非空且无标记 / 不可写。中间两条是防「把自己搬进自己」和「递归删掉自己」。

## 渲染进程：一次异步快照，保住所有同步读

主题 store、`useToolConfig`、usage store 的读都是**同步**的（store 创建即读）。改成每处 await IPC 就得三处全变异步、17 个 `useToolConfig` 调用点跟着改，主题色还会先闪一帧默认紫。做法是在 `app.mount()` 之前 **await 一次** IPC 把整个 blob 读进内存：

- `src/services/appState.ts`：`initAppState()`（启动读一次 + 一次性 localStorage 迁移）、`readState<T>(ns)`（**同步**）、`writeState(ns, value)`（防抖 300ms 合并后经 IPC）、`flushAppState()`、`appStateStatus()`。
- 三个 store 只把 `localStorage.getItem/setItem` 换成 `readState/writeState`，**响应式形状与 17 个调用点一行没改**。

三条硬约束：

- **`writeState` 必须 JSON 往返一次去掉 Vue 响应式代理**。代理对象过 IPC 直接抛 `An object could not be cloned`，而类型检查和构建全绿——本仓库已踩 5 次。
- **`initAppState()` 绝不能抛**。`unwrap` 在 IPC 返回错误码时是**抛错**不是返回假值，一旦冒出去就把 `app.mount()` 一起挡掉 = 整片白屏。`main.ts` 里 `.catch()` 写在 `.then()` **之前**，存储坏了也只该让设置不持久化。
- **一次性迁移：写盘成功才删旧键**。顺序反了就是丢数据。而且只信 `write` 返回的 true（主进程已完成 rename）——再 `read` 一次读到的是主进程内存副本，验证不了磁盘，那是假验证。写失败时旧键留着下次再试，但**数据先进内存**，本次会话照旧显示用户的设置而不是像被重置过。写成功但上次残留了旧键（比如当时正撞上目录迁移，只进了内存）→ 下次启动发现文件里已有同名命名空间，顺手清掉残留。
- 读不到数据目录 → `degraded`，退回 localStorage 并在设置页显著提示。差别是「设置不持久化」而不是「应用打不开」。

## 两处「不能挡住启动」

同一个教训在两侧各有一份，都被实测抓到过：

- 主进程：`initStoragePaths()` await 在 `createWindow()` **之前**。它一抛错就没有任何窗口被创建，进程静默退出，用户看到的是双击图标毫无反应。所以 `initStoragePaths` 内部自己兜住所有异常退到 userData，`index.ts` 的调用点再包一层 try/catch。
- 渲染进程：`initAppState()` await 在 `app.mount()` **之前**，一抛错就是整片白屏。`main.ts` 的 `.catch()` 必须写在 `.then()` 前面。

存储坏掉的正确后果是「设置不持久化」，不是「应用打不开」。

## 不做进度推送

数据目录目前只有一个 json，迁移是毫秒级。UI 只走按钮 loading。等到数据目录里装了大文件再说——这是有意的取舍。

## 文件清单

```
electron/shared/channels.ts   STORAGE_CHANNELS / APP_STATE_CHANNELS
electron/shared/types.ts      AppPathsInfo / DirUsage / MigrateResult / ClearCacheResult / AppStateBlob / StorageFallback
electron/main/storage/dirs.ts     底层原语，**刻意不 import electron**，能被 node 直跑
electron/main/storage/settings.ts 指针文件（同步读，很小）
electron/main/storage/paths.ts    默认值解析 + 回退 + 改路径/迁移；取路径的唯一入口
electron/main/storage/appState.ts app-state.json 读写 + 迁移期挂起
electron/main/ipc/storage.ts      9 个通道，见 [[ipc-contract]]
src/services/appState.ts / storage.ts
src/views/SettingsView.vue        「存储」卡片
```

`electron/main/index.ts` 里 `initStoragePaths()` 必须在**建窗口之前 await**：渲染进程一挂载就读状态，路径得先定下来。

## 打包相关

**实测值**（打包后真机跑出来的，不是推断）：

| | `nsis` / `--dir` 安装版 | `portable` 免安装版 |
| --- | --- | --- |
| `app.getPath('exe')` | `<安装目录>\Toolbox.exe` | `%TEMP%\3IlKHUdnRPRlwcjmD2lTMwJa13E\Toolbox.exe`（**自解压临时目录**） |
| `app.getAppPath()` | `<安装目录>\resources\app.asar` | 同上临时目录下的 app.asar |
| `PORTABLE_EXECUTABLE_DIR` | `null` | `<真正双击的那个 exe 所在目录>` |
| `app.getPath('temp')` | `%LOCALAPPDATA%\Temp` | 同 |
| `app.getPath('userData')` | `%APPDATA%\toolbox`（**小写**，跟的是 package.json 的 `name` 而非 productName） | 同 |
| 解析出的数据目录 | `<安装目录>\data` | `<便携 exe 目录>\data` |

- **portable 版必须用 `process.env.PORTABLE_EXECUTABLE_DIR`**：上表第一行就是理由——portable 的 `exe` 指向每次都重新解压的随机临时目录，数据写进去下次运行就没了。dev 下这个环境变量是 undefined。
- 安装目录可能不可写（`nsis.allowToChangeInstallationDirectory: true`，用户能装到 `C:\Program Files`）→ 启动时探测，不可写就回退 `%APPDATA%\toolbox\data`，并把 `{requested, reason}` 一路带到设置页显示。见 [[packaging]]。
- `.gitignore` 加了 `data`（dev 时数据目录就在仓库根）。

## 验证

两份 esbuild 打包法脚本（同 [[media-audio]] / [[video-clip]] 的手法，把真实生产代码打成 bundle 只换掉 electron 依赖，桩没被命中就抛错——否则断言全是假的）：

- 主进程 74 条：路径原语、校验矩阵 10 例、同盘 rename / 跨盘 cp / **回滚**（用同名非空目录注入 EPERM）、清空缓存、dev/packaged/portable 三种默认值 + 不可写回退、改路径端到端（含 settings.json 只在成功后写）、迁移期并发写入。
- 渲染进程 35 条：快照同步读、防抖合并、代理脱壳、localStorage 迁移的四种结局（成功 / IPC 报错 / 返回 false / 残留清理）、降级模式读写。

`dirs.ts` 刻意不 import electron，就是为了让风险最高的那部分逻辑能被 node 直接跑。

**只有人能判断的**：改保存路径 → 重启 → 主题色/各工具上次参数/使用统计全都还在（这是唯一能证明「搬对了」的动作）；清空缓存后占用归零；把路径指到另一个盘再指回来；装到 `C:\Program Files` 时设置页出现回退提示。

### 跑打包版做实测时的两个坑

1. **本仓库这个 bash 里 `ELECTRON_RUN_AS_NODE` 是设着的**。不 `unset` 就直接跑打包出来的 `Toolbox.exe`，它会当成裸 node 启动、**立刻以 0 退出**：没有窗口、没有日志、什么都不写。看着像「打包版启动失败」，其实一行代码都没执行。排查花了三轮才想到。
2. **electron-builder 的输出目录不能放在仓库里**：`--dir` 解压 electron 后那步 `rename win-unpacked.tmp -> win-unpacked` 在 `d:\web\toolbox\release\` 下必定 `EPERM`（有东西盯着仓库目录、握着刚解压出来的句柄），换到 `%TEMP%` 下就一次成功。要跑实测就 `-c.directories.output=%TEMP%/xxx`。

从 bash 里 `unset ELECTRON_RUN_AS_NODE` 后启动打包版，主进程的 `console.log` 会直接打到终端——`[storage] cache=... / data=...` 那两行就是最省事的读数方式。
