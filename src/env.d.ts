/// <reference types="vite/client" />

/** 应用环境变量类型声明。 */
interface ImportMetaEnv {
  /** 是否启用账号/计费能力，'true' 启用。 */
  readonly VITE_ENABLE_ACCOUNT: string;
  /** 后端 API 基址，空串表示走本地 mock。 */
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
