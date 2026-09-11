/**
 * AI 对话里助手头像的解析。
 *
 * 头像**存在桌宠配置里**（`PetConfig.aiAvatarRef`，review 定的：「ai 对话框的 ai 头像
 * 默认是 logo，桌宠可以设置该头像」）。配了就用那张图，没配就用应用 logo——和桌宠自己
 * 「没配资源用 logo」是同一条兜底。
 *
 * 走 `image:dataUrl` 而不是 `file://` / `tb-media:`：CSP 的 `img-src` 里只有
 * `'self' data: blob:`，而**我们不为头像松 CSP**（同 `usePetPresenter` 的理由）。
 *
 * **整个窗口共用一个 ref**：一屏对话里几十条助手消息都要这个头像，各自去过一趟 IPC
 * 纯属白烧。所以状态是模块级的，第一次调用时建好、之后所有调用方拿到同一个 ref——
 * 于是「换一张头像」在全窗口只触发一次读盘。
 */
import { ref, watch, type Ref } from 'vue';
import { getDataUrlApi } from '@/services/image';
import { usePetStore } from '@/stores/pet';

/** 没配头像时用的应用 logo（`public/icon.png` → `out/renderer/icon.png`，`img-src 'self'` 命中）。 */
const AVATAR_LOGO = './icon.png';

/** 全窗口共用的那个 ref；第一次调用时建。 */
let shared: Ref<string> | null = null;
/** 请求序号，用来丢弃**后发先至**的过期结果（快速换两张图时会遇上）。 */
let seq = 0;

/**
 * 把配置里的头像路径解析成 `<img src>` 能吃的东西。
 * @param path 头像文件绝对路径；空串表示用 logo。
 * @param target 要写进去的 ref。
 */
async function resolve(path: string, target: Ref<string>): Promise<void> {
  const token = ++seq;
  if (!path) {
    target.value = AVATAR_LOGO;
    return;
  }
  try {
    const url = await getDataUrlApi(path);
    // 等 IPC 回来的这段时间用户可能又换了一张，别把过期的贴上去
    if (token === seq) target.value = url;
  } catch {
    // 图读不出来（被删了、换了盘符）不该让头像变成一块空白
    if (token === seq) target.value = AVATAR_LOGO;
  }
}

/**
 * 取助手头像的 data URL（响应式）。
 *
 * 配置变了会自动重解析——**但前提是 store 里的值真的变了**。跨窗口的场景（在主窗口设置页
 * 换头像、AI 窗口已经开着）还得先 `refreshAppState()` + `petStore.hydrate()`，那是
 * `AiPanelWindowBody` 在 `pet:configChanged` 上做的事。
 * @returns 头像地址；没配时是应用 logo。
 */
export function useAiAvatar(): Ref<string> {
  if (shared) return shared;
  const store = usePetStore();
  const url = ref(AVATAR_LOGO);
  shared = url;
  // 刻意**不放在组件的 effect scope 里**：这个 watch 与窗口同寿，跟着第一个用到头像的
  // 组件一起卸载才是错的（下一条消息进来就没人重解析了）
  watch(
    () => store.config.aiAvatarRef,
    (path) => void resolve(path, url),
    { immediate: true },
  );
  return url;
}
