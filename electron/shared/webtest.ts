/** 可序列化的网页测试动作；定位仅使用 CSS，不依赖显示文案。 */
export type WebTestAction =
  | 'navigate'
  | 'click'
  | 'dblclick'
  | 'fill'
  | 'check'
  | 'select'
  | 'press'
  | 'scroll'
  | 'assertVisible'
  | 'assertHidden'
  | 'assertValue'
  | 'assertChecked'
  | 'assertUrl'
  | 'openPage'
  | 'closePage'
  | 'unsupported';

/** 一个步骤；不同动作的必填字段由主进程 schema 再校验。 */
export interface WebTestStep {
  /** 在编辑、进度推送和导入导出之间保持稳定。 */
  id: string;
  action: WebTestAction;
  /** 页签编号，首页固定为 page-1。 */
  pageId: string;
  /** 与上一步操作的间隔（毫秒）；旧用例缺省为 0，fill 回放时跳过等待。 */
  delayBeforeMs?: number;
  label?: string;
  selector?: string;
  /** 从最外层到最内层的 iframe CSS 定位。 */
  frames?: string[];
  /** 相对于用户指定环境根目录的路径，必须以 ./ 开头。 */
  path?: string;
  value?: string;
  values?: string[];
  checked?: boolean;
  x?: number;
  y?: number;
  button?: 'left' | 'middle' | 'right';
  modifiers?: ('Alt' | 'Control' | 'Meta' | 'Shift')[];
  openerId?: string;
  /** 结构定位可能随 DOM 改动失效，界面据此提醒维护定位。 */
  fragile?: boolean;
  /** 自动定位无法唯一匹配，回放前需在步骤编辑器补充稳定 CSS。 */
  locatorIssue?: string;
}

/** 与环境域名、登录状态和本地文件路径解耦的用例格式。 */
export interface WebTestFlow {
  schema: 'toolbox.webtest';
  version: 1;
  name: string;
  createdAt: string;
  viewport: WebTestViewport;
  steps: WebTestStep[];
}

/** 使用已安装浏览器，避免给 QA 额外下载 Chromium。 */
export type WebTestBrowser = 'msedge' | 'chrome';

/** 浏览器页面可视区域，单位为 CSS 像素，不含地址栏和窗口边框。 */
export interface WebTestViewport {
  width: number;
  height: number;
}

/** 未设置尺寸的新录制沿用旧版默认值。 */
export const WEBTEST_DEFAULT_VIEWPORT: Readonly<WebTestViewport> = { width: 1280, height: 720 };

/** UI 和主进程校验使用同一尺寸范围。 */
export const WEBTEST_VIEWPORT_LIMITS = {
  width: { min: 320, max: 3840 },
  height: { min: 240, max: 2160 },
} as const;

/** WebM 直接封装；MP4 在结束录制时转换为 H.264。 */
export type WebTestVideoFormat = 'webm' | 'mp4';

/** 新录制参数；startUrl 必须在 baseUrl 指定的根目录内。 */
export interface WebTestRecordOptions {
  name: string;
  startUrl: string;
  baseUrl: string;
  browser: WebTestBrowser;
  recordVideo: boolean;
  /** 缺省为 WebM，兼容旧调用方。 */
  videoFormat?: WebTestVideoFormat;
  /** 缺省为 1280 × 720，并保存到用例中。 */
  viewport?: WebTestViewport;
}

/** 回放始终不注入录制脚本，也不录视频。 */
export interface WebTestReplayOptions {
  flow: WebTestFlow;
  baseUrl: string;
  browser: WebTestBrowser;
  timeout: number;
  /** 仅覆盖本次回放的页面尺寸；省略时使用用例尺寸。 */
  viewport?: WebTestViewport;
}

/** 单步骤的执行结果，失败后剩余步骤保持 pending。 */
export interface WebTestStepResult {
  stepId: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  error?: string;
  duration?: number;
}

/** 主进程拥有会话，切换工具页后可重新取得完整状态。 */
export interface WebTestSnapshot {
  revision: number;
  mode: 'idle' | 'starting' | 'recording' | 'replaying' | 'stopping';
  outcome: 'none' | 'recorded' | 'passed' | 'failed' | 'canceled';
  flow: WebTestFlow | null;
  /** 当前或最近一次任务实际使用的页面尺寸。 */
  viewport?: WebTestViewport;
  results: WebTestStepResult[];
  activeStepId: string | null;
  error: string;
  artifacts: string[];
  /** 暂时离开环境根目录的页签；返回录制范围后自动恢复。 */
  pausedPageIds?: string[];
}

/** 导出扩展名；脚本包含可静态读取的 JSON 数据区。 */
export type WebTestFormat = 'json' | 'ts' | 'js';

/** 已保存的录制视频；独立于当前用例和回放结果。 */
export interface WebTestVideo {
  path: string;
  name: string;
  size: number;
  /** 文件最后写入时间（毫秒时间戳）。 */
  modifiedAt: number;
  /** 由主进程登记播放权限后生成的本地媒体 URL。 */
  url: string;
}
