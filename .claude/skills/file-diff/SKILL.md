---
name: file-diff
description: 维护 Toolbox 文件工具下的批量文件 Diff，包括文件/目录比较、类型与状态筛选、diff2html 左右详情弹窗，以及行号溢出和开发监听问题排查。
---

# 批量文件 Diff

入口为「文件工具 → 批量文件 Diff」，路由 `/file/diff`、工具 key `file-diff`。比较两个文件或两个目录，只读展示结果。用户已选择详情弹窗和左右并排布局。

## 改动入口

| 位置                                                                                   | 职责                                                                |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `electron/shared/fileDiff.ts`                                                          | 状态、进度、结果、预览类型与默认媒体后缀                            |
| `electron/main/fileDiff/compare.ts`                                                    | 校验、扫描、后缀过滤、内容比较、稳定读取                            |
| `electron/main/fileDiff/text.ts`                                                       | 编码识别、有界行差异、上下文和换行信息                              |
| `electron/main/ipc/fileDiff.ts`                                                        | 主窗口任务、结果缓存、取消与详情读取                                |
| `electron/shared/channels.ts`、`electron/preload/index.ts`、`src/services/fileDiff.ts` | `FILE_DIFF_CHANNELS` 与 IPC 桥接                                    |
| `src/composables/useFileDiff.ts`                                                       | 配置持久化、状态与路径查询、任务和弹窗状态                          |
| `src/constants/fileDiff.ts`                                                            | 状态文案和筛选选项                                                  |
| `src/views/file/FileDiffView.vue`                                                      | 页面和结果区                                                        |
| `src/views/file/components/`                                                           | `FileDiffTable.vue`、`FileDiffDetail.vue`、`FileDiffSideBySide.vue` |
| `src/utils/fileDiff.ts`                                                                | 预览行转换为 diff2html 数据与 HTML                                  |

涉及 IPC 时遵循 [ipc-contract](../ipc-contract/SKILL.md)，自定义颜色与间距遵循 [theme-system](../theme-system/SKILL.md)。

## 比较与筛选边界

- 两侧需为绝对路径，且同时为文件或目录。单文件不要求同名；目录按相对路径精确配对，包括大小写。改名表现为仅左侧/仅右侧，不做重命名识别；空目录不单独产生差异。
- 状态为 `same`、`modified`、`left-only`、`right-only`、`type-conflict`、`error`。目录扫描失败、截断或跳过链接后，不能确认的另一侧条目应标为无法比较，不能当作文件缺失。
- 后缀规则支持 `ts`、`.ts`、`*.ts`、`.d.ts`、`*`、`(无扩展名)`；逗号、分号、空白分隔，忽略后缀大小写，排除优先。默认排除图片（含 SVG）、视频和音频。单文件的两侧都要满足规则。
- 后缀过滤由主进程执行，改路径或后缀需重新比较，界面保留旧结果并提示配置变化。状态筛选和路径搜索仅过滤已返回的结果，不触发扫描；状态筛选不能计入 `staleConfig`。
- `useToolConfig('file-diff')` 保存路径、后缀和状态筛选。新增状态筛选时兼容旧 `onlyDifferences` 偏好；`all` 表示全部，`differences` 排除 `same`，具体状态直接匹配。无匹配结果不能提示「文件内容相同」。

## 文件读取、任务和预览限制

- 大小不同直接判不同；相同大小用 64 KiB 分块 SHA-256 比较。时间戳或大小相同不代表内容相同。
- `readStable` 在打开前、文件句柄上和读取后校验文件身份/大小/时间等信息，并在 `finally` 关闭句柄。详情读取前仍需校验扫描快照，过期文件提示重新比较。
- 扫描使用 `lstat` 和异步 `opendir`，跳过符号链接、junction 和特殊文件。每侧扫描与结果各限制为 50000 项；错误详情最多返回 50 条，总错误数单独累计。进度约 150ms 节流。
- 取消保留已完成部分，`canceled`、`truncated`、`errorCount` 需要明确显示，不能宣称整体一致。离开页面取消任务并退订进度；进度按 `jobId` 隔离。
- IPC 使用 `handle` / `unwrap`。主进程校验发送方属于主工具窗口；详情仅接受 `{ jobId, entryId }` 并查本次缓存，不接受任意详情路径。窗口销毁取消读取任务并释放结果。
- 文本预览上限为每文件 1 MiB、20000 行。支持 UTF-8、UTF-8 BOM、带 BOM 的 UTF-16 LE/BE；二进制/未知编码返回说明。单侧空文件要和两侧相同空文件区分。
- `diffText` 保留 CRLF/LF/CR 和末尾无换行信息，编码/BOM 不同但解码文本相同时单独提示。Myers 搜索有工作量/深度上限，周期让出主进程，复杂差异降级为整段替换。
- 预览保留差异前后各 3 行，输出约 3000 行、每行最多 4000 字符；截断和简化均带标志。显示限制不改变文件内容比较结论。

## diff2html 展示约定

采用 [diff2html](https://github.com/rtfpessoa/diff2html)（当前锁定 3.4.56、MIT）提供只读左右对齐和字符级高亮。`FileDiffDetail` 用 `defineAsyncComponent` 加载展示组件，使库和 CSS 按需加载。CodeMirror Merge 更偏编辑/合并，当前需求无需引入编辑器。

- 主进程返回的 `FileDiffLine[]` 已有原始行号、缺失侧与 `gap`。`renderFileDiff` 直接转成 `DiffFile.blocks`，省略段变为块标题。不要把截断行拼回两个文件重新 diff，那会造成行号和缺失内容判断失真。
- 配置为 `outputFormat: 'side-by-side'`、`matching: 'lines'`、`diffStyle: 'char'`。行匹配最多 1000 次比较、参与匹配的行小于 200 字符，行内高亮限制 500 字符；过长行仍显示整行差异。
- `v-html` 仅接收库转义生成的 HTML。文件内容或文件名不能直接拼入 HTML；文件路径由 Vue 插值显示。换行标记通过 `textContent` 追加到对应行号，不混入待比较文本，也不参与复制。
- 覆盖 `--d2h-dark-*` 为项目 tokens；保持等高、单行不折行，删除侧中性色、增加侧主题色，行内变化加深。
- 两侧纵向共用 `.diff-sides__content`，横向分别滚动并同步偏移。短侧滚动范围较小时，不让其自动回调把长侧拉回；重绘或卸载时清除监听。

### 行号越过弹窗的根因与修复

库的 `.d2h-code-side-linenumber` 使用 `position: absolute`。左右面板没有定位上下文时，绝对定位包含块落到滚动区外，即使祖先设了 `overflow`，行号仍可能越过内容边界覆盖关闭按钮。

保留组件中的局部覆盖：

```scss
:deep(.d2h-file-side-diff) {
  position: relative;
}
```

定位包含块在面板内，外层滚动容器才能正确裁剪行号。不要靠提高关闭按钮的 `z-index` 遮盖问题。检查长文件在纵向、横向及弹窗内容滚动后的效果；只有几行的截图无法覆盖此问题。

### 弹窗生命周期

`FileDiffDetail` 使用 Naive UI `NModal` 的 `preset="card"`，宽度通过 `style` 设置，内容高度通过 `content-style` 限制；不要依赖 scoped class 给内部 Card 根节点设置尺寸。保留关闭按钮、Esc 和遮罩关闭。单条结果自动打开；关闭后列表筛选不变，迟到的详情响应不能重新打开弹窗。

## 开发排障与验证

- Vite 的监听不会自动沿用 `.gitignore`。之前循环 junction 测试残留在 `out-tbverify`，开发服务跟随链接后报 `ELOOP`，日志恰好出现在正常的 `[storage]` 路径输出后。保留 `electron.vite.config.ts` 中 `server.watch.ignored: ['**/out-tbverify/**']`；更改监听配置后重启开发服务。
- 如需临时验证目录循环，结束时只删除链接本身，避免残留；清理测试目录前核对绝对路径范围，不跟随链接删除目标。
- 本次文件 Diff 专用测试脚本和命令已按用户要求移除，不再调用旧 `verify:file-diff*`。后续按改动范围运行格式检查、lint、类型检查或构建，再检查实际交互。
- 重点回归：类型过滤与状态查询组合；仅左/右、相同、类型冲突、无法比较；中文与 BOM、末尾换行；旧快照拒绝；长行滚动和长文件行号裁剪；HTML 源码按文本显示；弹窗关闭后保留筛选。
- Electron 隐藏窗口截图可能超时或停留在旧帧。必要时在隔离的测试宿主使用 `offscreen: true`、`backgroundThrottling: false`，通过 `capturePage(undefined, { stayHidden: true, stayAwake: true })` 截图；不因此改生产窗口配置。裁剪验证可用 `elementsFromPoint` 检查区域外是否还能命中行号，单看元素矩形不足以证明它被裁剪。
