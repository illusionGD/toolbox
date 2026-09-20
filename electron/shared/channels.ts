/**
 * 主进程与预加载共享的 IPC 通道名。
 * 单一来源，避免字符串在两侧不一致。
 */

/** 窗口控制通道。 */
export const WINDOW_CHANNELS = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggleMaximize',
  close: 'window:close',
  isMaximized: 'window:isMaximized',
  onMaximizeChange: 'window:maximizeChange',
  /**
   * 渲染进程 → 主进程：改「关闭主窗口时」这个设置。
   *
   * 设置页那个 radio 与确认弹窗里的「记住我的选择」共用这一条。**必须过主进程**而不是
   * 渲染进程自己 `writeState`：`close` 事件的处理器是**同步**的，`preventDefault()` 等不了
   * 一次 `await readAppState()`，所以生效的动作在主进程里有一份缓存，这条通道就是刷新它的
   * 唯一入口（顺带落盘）。见 main/appClose.ts。
   */
  setCloseAction: 'window:setCloseAction',
  /**
   * 主进程 → 主窗口：请弹「关闭确认」弹窗。
   *
   * 两种情况都走它：① 设置是「每次询问」；② 设置是「最小化到托盘」但**托盘建不起来**
   * （那时不许静默退出，见 main/tray.ts 的硬规则）。弹窗是**应用内的 naive-ui 弹窗**而不是
   * `dialog.showMessageBox`：系统弹窗的配色跟不了主题，而这一下是用户最常看见的交互之一。
   */
  closePrompt: 'window:closePrompt',
  /**
   * 渲染进程 → 主进程：按用户在弹窗里点的那一下关。
   *
   * 返回**是否真做到了**：托盘建不起来时 `'tray'` 会回 false，渲染进程据此把弹窗留在
   * 屏幕上并把「最小化到托盘」置灰——所以不需要第二条通道来单独报「托盘不可用」。
   */
  resolveClose: 'window:resolveClose',
} as const;

/** 应用级通道。 */
export const APP_CHANNELS = {
  ping: 'app:ping',
} as const;

/** 文件对话框与文件系统通道。 */
export const DIALOG_CHANNELS = {
  openFiles: 'dialog:openFiles',
  openDirectory: 'dialog:openDirectory',
} as const;

/** 文件统计/文件系统操作通道。 */
export const FILE_CHANNELS = {
  scan: 'file:scan',
  cancelScan: 'file:cancelScan',
  /** 主进程 → 渲染进程：扫描进度推送。 */
  scanProgress: 'file:scanProgress',
  showInFolder: 'file:showInFolder',
  saveText: 'file:saveText',
  /** 读取文本文件内容（utf-8）。 */
  readText: 'file:readText',
  /** 批量重命名（含 pre-flight 校验，冲突则整批不动）。 */
  renameBatch: 'file:renameBatch',
} as const;

/** 图片处理通道。 */
export const IMAGE_CHANNELS = {
  thumbnail: 'image:thumbnail',
  dataUrl: 'image:dataUrl',
  compress: 'image:compress',
  /** 只算不写：探测自动裁剪的包围盒。 */
  probeCrop: 'image:probeCrop',
  crop: 'image:crop',
  /** 只算不写：按缩放尺寸生成风格化预览 data URL。 */
  stylizePreview: 'image:stylizePreview',
  stylize: 'image:stylize',
  /** 合并多图为精灵表 + 坐标数据。 */
  spriteMerge: 'image:spriteMerge',
  /** 只算不写：合并预览 data URL。 */
  spriteMergePreview: 'image:spriteMergePreview',
  /** 只算不写：探测精灵表将切出的单元。 */
  spriteSliceProbe: 'image:spriteSliceProbe',
  /** 切割精灵表为多张小图。 */
  spriteSlice: 'image:spriteSlice',
  /** 批量生成二维码。 */
  qrGenerate: 'image:qrGenerate',
  /** 只算不写：二维码预览 data URL。 */
  qrPreview: 'image:qrPreview',
  /** 解析单张图片的二维码。 */
  qrDecode: 'image:qrDecode',
} as const;

/** 视频处理通道（ffmpeg）。 */
export const VIDEO_CHANNELS = {
  /** 探测当前 ffmpeg 构建实际可用的编码器。 */
  capabilities: 'video:capabilities',
  /** ffprobe 读元信息，顺带把路径登记进 tb-media 播放白名单。 */
  probe: 'video:probe',
  /** 抽一帧作缩略图。 */
  thumbnail: 'video:thumbnail',
  /** 抽任意时间点的一帧（胶片条时间轴用）。 */
  frame: 'video:frame',
  transcode: 'video:transcode',
  cancelTranscode: 'video:cancelTranscode',
  /** 主进程 → 渲染进程：转码进度推送。 */
  transcodeProgress: 'video:transcodeProgress',
} as const;

/**
 * 音频处理通道（ffmpeg）。
 *
 * 与 VIDEO_CHANNELS 分开：那组是视频语义（分辨率/帧率/调色板），且音频要自己的
 * 波形图与静音检测通道。但**能力探测复用 `VIDEO_CHANNELS.capabilities`**——
 * `probeCapabilities()` 返回的结构里本来就有 audioEncoders，再开一条是重复。
 */
export const AUDIO_CHANNELS = {
  /** ffprobe 读音频元信息，顺带把路径登记进 tb-media 播放白名单。 */
  probe: 'audio:probe',
  /** 画波形图（PNG data URL，不落盘）。 */
  waveform: 'audio:waveform',
  /** 转码 / 剪切单个音频。 */
  convert: 'audio:convert',
  /** 检测静音区间（按静音分割用）。 */
  detectSilence: 'audio:detectSilence',
  /** 按区间列表切成多段。 */
  split: 'audio:split',
  cancel: 'audio:cancel',
  /** 主进程 → 渲染进程：处理进度推送。 */
  progress: 'audio:progress',
} as const;

/** 字体处理通道（subset-font + fontkit）。 */
export const FONT_CHANNELS = {
  /** 读字体元信息（字体名/字形数/大小）。 */
  probe: 'font:probe',
  /** 只裁不写盘：返回裁剪后 woff2 的 data URL 供页面预览。 */
  subsetPreview: 'font:subsetPreview',
  /** 按字符集裁剪字体并落盘。 */
  subset: 'font:subset',
  /** 网页分包：一个字体切成多个 unicode-range 分包 + CSS。 */
  split: 'font:split',
  /** 纯容器格式转换（fontverter，无损不裁剪）。 */
  convert: 'font:convert',
  /** 取消正在进行的格式转换。 */
  cancelConvert: 'font:cancelConvert',
  /** 主进程 → 渲染进程：格式转换进度推送。 */
  convertProgress: 'font:convertProgress',
} as const;

/**
 * 位图字体通道（fontkit 取字形路径 + sharp 栅格化）。
 *
 * 与 FONT_CHANNELS 分开：那组是「字体文件进、字体文件出」，这里产出的是 PNG 图集 +
 * 描述文件，且有自己的进度与取消，混在一起会让两组的语义都变模糊。
 */
export const BITMAP_FONT_CHANNELS = {
  /** 从字体生成图集 + 描述文件。 */
  generate: 'bitmapFont:generate',
  /** 生成预览（只算不写盘）。 */
  preview: 'bitmapFont:preview',
  /** 从字符图片打包成位图字体。 */
  packImages: 'bitmapFont:packImages',
  /** 取消正在进行的生成。 */
  cancel: 'bitmapFont:cancel',
  /** 主进程 → 渲染进程：生成进度推送。 */
  progress: 'bitmapFont:progress',
} as const;

/** Excel 多语言表转 i18n JSON 通道（exceljs）。 */
export const EXCEL_CHANNELS = {
  /** 读工作簿结构：sheet 名 / 指定表头行的各列文字 / 行列数。 */
  probe: 'excel:probe',
  /** 只算不写：按当前配置统计各语言列，并序列化其中一列的 JSON 供预览。 */
  preview: 'excel:preview',
  /** 转换并落盘：一种语言一个 JSON。 */
  toJson: 'excel:toJson',
} as const;

/** 存储路径（数据缓存目录 / 数据保存目录）通道。 */
export const STORAGE_CHANNELS = {
  /** 读当前生效路径、默认路径与回退情况。 */
  getPaths: 'storage:getPaths',
  /** 统计某个目录的占用（字节数与文件数）。 */
  dirUsage: 'storage:dirUsage',
  /** 更改数据保存目录，并把现有数据迁移过去。 */
  setDataDir: 'storage:setDataDir',
  /** 更改数据缓存目录（缓存可丢弃，不迁移，清空旧目录）。 */
  setCacheDir: 'storage:setCacheDir',
  /** 恢复某个目录为默认值（同时清掉用户显式设置）。 */
  resetDir: 'storage:resetDir',
  /** 清空缓存目录内容（保留目录本身）。 */
  clearCache: 'storage:clearCache',
  /** 在系统文件管理器中打开某个目录。 */
  openDir: 'storage:openDir',
} as const;

/**
 * AI 对话通道。
 *
 * 所有网络调用都在主进程：① API Key 绝不进渲染进程；② Anthropic 在浏览器环境还要
 * 额外的 dangerous-direct-browser-access 头、各家 CORS 也不一致，主进程一概没这问题；
 * ③ 第二轮的工具调用本来就得在主进程跑。
 */
export const AI_CHANNELS = {
  /**
   * 打开 AI 对话窗口（没开就建，开着就聚焦）。
   *
   * 对话框是**独立的无边框窗口**而不是 app 内的浮动面板：用户要求能拖到第二块屏幕、
   * 能置顶盖住其他程序，这两件事 DOM 面板做不到。
   */
  openWindow: 'ai:openWindow',
  /** 切换 AI 窗口置顶。 */
  setWindowTop: 'ai:setWindowTop',
  /**
   * 最小化 AI 窗口。
   *
   * **DOM 的 `window` 没有 minimize**（`window.close()` 有，所以 ✕ 不用过 IPC，最小化必须过），
   * 而这个窗口里 `window.api.window.minimize()` 控的是**主窗口**（那套 IPC 闭包的是主窗口），
   * 所以只能给它一条专用通道——同 `setWindowTop`。
   */
  minimizeWindow: 'ai:minimizeWindow',
  /** AI 窗口里的 ⚙：聚焦主窗口并让它跳到设置页。 */
  openSettings: 'ai:openSettings',
  /** 主进程 → 主窗口：跳到设置页（`openSettings` 的下半程）。 */
  navigateSettings: 'ai:navigateSettings',
  /** 各配置的 key 状态（只回是否存在 + 掩码，明文不出主进程）。 */
  listKeyStatus: 'ai:listKeyStatus',
  /** 写入某份配置的 key。 */
  setKey: 'ai:setKey',
  /** 删除某份配置的 key。 */
  deleteKey: 'ai:deleteKey',
  /**
   * 把一份配置的 key 复制给另一份（「复制配置」用）。
   *
   * 存在的理由：明文永不回渲染进程，界面拿不到源 key，所以复制这一步只能在主进程完成。
   */
  copyKey: 'ai:copyKey',
  /** 测试连接：真发一次最小请求。 */
  testConnection: 'ai:testConnection',
  /** 发起对话，**流结束才 resolve**（同 video:transcode）。 */
  chat: 'ai:chat',
  /** 主进程 → 渲染进程：流式分片推送。 */
  chatStream: 'ai:chatStream',
  /** 按 requestId 中断。 */
  cancel: 'ai:cancel',
  /**
   * 回答一次工具确认（允许 / 拒绝）。
   *
   * **只需要这一个新通道**：工具事件本身搭现成的 `chatStream` 走（`type:'tool'`），
   * 所以渲染进程那边一处订阅全包了。
   */
  toolReply: 'ai:toolReply',
  /** 把图片暂存到数据目录并降采样。 */
  stageImage: 'ai:stageImage',
  /** 读全部会话（AI 窗口打开时懒加载）。 */
  loadConversations: 'ai:loadConversations',
  /** 覆盖写全部会话（防抖后调用）。 */
  saveConversations: 'ai:saveConversations',
} as const;

/**
 * 桌宠通道。
 *
 * 桌宠是**第二个独立的无边框透明窗口**（第一个是 AI 对话窗）。它和 AI 窗口的关键差别
 * 是：**打开桌宠会把主窗口 `hide()` 掉**，于是这一组通道里有好几条在别处不需要——
 * 主窗口不在了，回到 app 的路只剩桌宠自己。
 */
export const PET_CHANNELS = {
  /** 打开桌宠（建窗 + 隐藏主窗口）。 */
  open: 'pet:open',
  /**
   * 退出桌宠模式：销毁桌宠窗口 + **把 app 收进系统托盘**。
   *
   * 刻意**不把主窗口弹出来**（用户原话「退出桌宠不需要重新打开 app」）：点「退出桌宠」
   * 多半只是想让小精灵下班，不是要看工具箱。托盘图标那时是唯一的出口，所以主进程侧
   * 必须先确认托盘建起来了再销毁桌宠，建不起来就回落到显示主窗口。
   * 主窗口此刻已经露着（AI 窗口的 ⚙ 能把它叫出来）就一个字都不动它。
   */
  close: 'pet:close',
  /** 桌宠模式当前开着没有（首页那个开关要按它显示状态）。 */
  isOpen: 'pet:isOpen',
  /**
   * 菜单里的「隐藏桌宠」：把窗口收进系统托盘（Windows 上通常落在「隐藏的图标」里）。
   *
   * 和 {@link close} 是两码事：`close` 退出桌宠模式（销毁窗口 + 主窗口回来），
   * `hide` 只是让它从桌面上消失，**桌宠模式还在**，会话与位置一个都不动。
   *
   * **托盘图标是隐藏之后唯一的出口**——主窗口那时多半也是隐藏的，而桌宠 `skipTaskbar`。
   * 所以主进程侧的实现必须「先确认托盘真的建起来了，再 `hide()`」，建不起来就拒绝隐藏
   * （见 pet/tray.ts：空图标的 `new Tray()` 在 Windows 上**不抛异常**，探针量过，
   * 光靠 try/catch 守不住）。
   */
  hide: 'pet:hide',
  /**
   * 手写拖拽的三段。
   *
   * 不用 `-webkit-app-region: drag`：① 它分不清点击与拖拽，而点击要弹菜单；
   * ② 拖拽由 OS 接管，「拖拽中 / 放下」这两个动画态拿不到事件。
   * `dragStart` 让主进程记下按下那刻的 bounds，`dragMove` 只送**相对按下点的累计位移**
   * （绝对计算，绝不增量累加，理由见 shared/petWindow.ts 的 dragPetBounds）。
   */
  dragStart: 'pet:dragStart',
  /** 拖拽中：送累计位移（rAF 节流）。 */
  dragMove: 'pet:dragMove',
  /** 拖拽结束：落盘位置（防抖）。 */
  dragEnd: 'pet:dragEnd',
  /**
   * 菜单展开 / 收起。
   *
   * 菜单不是第三个窗口、也不常驻一块大透明窗口（那会在屏幕角上常年吞掉一片点击）：
   * **展开时由主进程把窗口临时放大**，精灵始终锚在窗口右下角、窗口向左上长，
   * 于是精灵在屏幕上一动不动。
   */
  setMenuOpen: 'pet:setMenuOpen',
  /** 菜单里的「AI 对话」：主进程内部直接调 openPanelWindow()，主窗口保持隐藏。 */
  openAiWindow: 'pet:openAiWindow',
  /** 菜单里的「设置」/「打开 app 界面」：显示主窗口（`'settings'` 时顺带跳设置页）。 */
  showHost: 'pet:showHost',
  /**
   * 菜单里的「退出 app」：整个进程退出。
   *
   * **不能让桌宠窗口去调 `window.api.window.close()`**：那条通道闭包的是**主窗口**
   * （见 ipc/window.ts），从桌宠这边调它是「关掉那个已经藏起来的窗口」，语义全靠巧合。
   *
   * 主进程侧也不是直接 `app.quit()` 就完事：桌宠的 `close` 处理器会无条件
   * `preventDefault()`（那是「桌宠不许成为唯一出口」那条硬规则的实现），而 `app.quit()`
   * 会给每个窗口发 `close`——**于是退出会被桌宠自己拦掉**。必须先带标志销毁桌宠再退出，
   * 见 pet/petWindow.ts 的 `quitAppFromPet`。
   */
  quitApp: 'pet:quitApp',
  /**
   * 主窗口 → 桌宠窗口：配置变更广播。
   *
   * 桌宠窗口是**另一个 BrowserWindow**，它的应用状态内存快照在主窗口改完设置后就过期了；
   * 不广播的表现是「改了设置桌宠没反应，重启才生效」。
   *
   * 带上新的桌宠大小：**改大小是主进程的活**（要重设窗口 bounds 并保持右下角对齐），
   * 不另开一条 `setSize` ——那会让设置页为一次保存发两趟 IPC，两趟之间还能穿插别的写。
   */
  configChanged: 'pet:configChanged',
  /**
   * 主进程 → 主窗口：桌宠模式开关变了。
   *
   * 首页那个开关不能只靠自己点的那一下来记状态：桌宠窗口被 `Alt+F4` 打中时也会退出
   * 桌宠模式（见 petWindow.ts 的 close 拦截），不广播的话开关就停在错的位置上了。
   */
  stateChanged: 'pet:stateChanged',
} as const;

/** 应用状态（主题 / 各工具配置 / 使用统计）持久化通道，落在数据保存目录。 */
export const APP_STATE_CHANNELS = {
  /** 读取整个状态 blob（渲染进程启动时读一次）。 */
  read: 'appState:read',
  /** 按命名空间合并写入（防抖后调用）。 */
  write: 'appState:write',
} as const;

/** 网页测试的请求与状态推送通道。 */
export const WEBTEST_CHANNELS = {
  snapshot: 'webtest:snapshot',
  videos: 'webtest:videos',
  saveVideo: 'webtest:saveVideo',
  deleteVideo: 'webtest:deleteVideo',
  record: 'webtest:record',
  replay: 'webtest:replay',
  stop: 'webtest:stop',
  update: 'webtest:update',
  import: 'webtest:import',
  export: 'webtest:export',
  changed: 'webtest:changed',
} as const;
