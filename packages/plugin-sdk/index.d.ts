/** 可跨宿主边界传递的值。 */
export type JsonValue =
  null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
/** 文件句柄只在当前运行中有效，不含绝对路径。 */
export interface PluginFile {
  handle: string;
  name: string;
  size: number;
}
/** manifest 中声明的命令处理器。取消任务时宿主销毁整个运行实例。 */
export type CommandHandler = (input: Record<string, JsonValue>) => JsonValue | Promise<JsonValue>;
/** 宿主提供的最小能力集合，每次调用都会校验权限。 */
export interface ToolboxSDK {
  definePlugin(commands: Record<string, CommandHandler>): void;
  files: {
    select(): Promise<PluginFile[]>;
    readText(handle: string): Promise<string>;
    saveText(name: string, content: string): Promise<boolean>;
  };
  storage: {
    get(key: string): Promise<JsonValue>;
    set(key: string, value: JsonValue): Promise<void>;
  };
  /** 每个来源需声明并授权 network:https://example.com，重定向同样检查。 */
  network: {
    fetch(options: {
      url: string;
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
      headers?: Record<string, string>;
      body?: string;
    }): Promise<{ status: number; url: string; headers: Record<string, string>; body: string }>;
  };
  /** tools.image；输入来自 files.select，转换后由用户选择保存位置。 */
  image: {
    probe(handle: string): Promise<JsonValue>;
    compress(
      handle: string,
      options?: {
        format?: 'original' | 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff';
        quality?: number;
        maxWidth?: number;
      },
    ): Promise<SavedOutput>;
  };
  /** tools.media；取消运行会终止转码。 */
  media: {
    probeVideo(handle: string): Promise<JsonValue>;
    probeAudio(handle: string): Promise<JsonValue>;
    convertVideo(
      handle: string,
      options?: { format?: 'mp4' | 'webm' | 'mkv' | 'gif'; maxHeight?: number; crf?: number },
    ): Promise<SavedOutput>;
    convertAudio(
      handle: string,
      options?: {
        format?: 'mp3' | 'm4a' | 'aac' | 'wav' | 'flac' | 'ogg' | 'opus';
        bitrate?: number;
      },
    ): Promise<SavedOutput>;
  };
  /** tools.diff；复用工具箱的有界文本比较。 */
  diff: { compare(left: string, right: string): Promise<JsonValue> };
  /** tools.webtest；与工具页共享会话、版本校验与取消。 */
  webtest: {
    status(): Promise<JsonValue>;
    readSteps(options?: {
      from?: number;
      limit?: number;
      includeValues?: boolean;
    }): Promise<JsonValue>;
    inspect(options: {
      selector: string;
      pageId?: string;
      frames?: string[];
      limit?: number;
    }): Promise<JsonValue>;
    patchSteps(options: {
      expectedRevision: number;
      dryRun?: boolean;
      patches: JsonValue[];
    }): Promise<JsonValue>;
    replay(options: Record<string, JsonValue>): Promise<JsonValue>;
    wait(options?: Record<string, JsonValue>): Promise<JsonValue>;
    stop(): Promise<JsonValue>;
  };
  commands: { run(command: string, input: Record<string, JsonValue>): Promise<JsonValue> };
  log(message: string): Promise<void>;
}

/** 结果已在宿主缓存中完成，仅用户确认保存后 saved 为 true。 */
export interface SavedOutput {
  saved: boolean;
  name: string;
  bytes: number;
}
declare global {
  interface Window {
    toolbox: ToolboxSDK;
  }
}
