<template>
  <div class="ai-window">
    <!-- 顶栏就是 OS 的拖拽把手（app-region: drag），控件必须逐个标 no-drag -->
    <header class="ai-window__bar">
      <n-input
        v-if="renaming"
        ref="renameInput"
        v-model:value="renameDraft"
        class="ai-window__rename no-drag"
        size="tiny"
        placeholder="会话名称"
        @keydown.enter="commitRename"
        @keydown.esc="cancelRename"
        @blur="commitRename"
      />
      <n-select
        v-else
        class="ai-window__session no-drag"
        size="tiny"
        filterable
        :consistent-menu-width="false"
        :value="chat.activeId || null"
        :options="sessionOptions"
        placeholder="还没有对话"
        :disabled="sessionOptions.length === 0"
        @update:value="(id: string) => chat.selectConversation(id)"
      />

      <!-- 纯粹留给 OS 的拖拽空白，别往里塞控件 -->
      <div class="ai-window__drag" />

      <div class="ai-window__actions no-drag">
        <n-button
          size="tiny"
          quaternary
          title="重命名当前会话"
          :disabled="!chat.activeConversation"
          @click="startRename"
        >
          <n-icon :size="15" :component="CreateOutline" />
        </n-button>
        <n-button size="tiny" quaternary title="新建对话" @click="chat.newConversation()">
          <n-icon :size="15" :component="AddOutline" />
        </n-button>
        <n-button
          size="tiny"
          quaternary
          title="删除当前会话"
          :disabled="!chat.activeConversation || chat.activeBusy"
          @click="removeActive"
        >
          <n-icon :size="15" :component="TrashOutline" />
        </n-button>
        <n-button size="tiny" quaternary title="AI 配置" @click="goSettings">
          <n-icon :size="15" :component="SettingsOutline" />
        </n-button>
        <n-button
          size="tiny"
          :quaternary="!alwaysOnTop"
          :secondary="alwaysOnTop"
          :type="alwaysOnTop ? 'primary' : 'default'"
          :title="alwaysOnTop ? '取消置顶' : '置顶显示'"
          @click="toggleTop"
        >
          <n-icon :size="15" :component="PinOutline" />
        </n-button>
        <n-button size="tiny" quaternary title="最小化" @click="minimizeWindow">
          <n-icon :size="15" :component="RemoveOutline" />
        </n-button>
        <n-button size="tiny" quaternary title="关闭窗口" @click="closeWindow">
          <n-icon :size="15" :component="CloseOutline" />
        </n-button>
      </div>
    </header>

    <n-alert v-if="configStore.configs.length === 0" type="warning" :bordered="false">
      还没有 AI 配置。点顶栏的齿轮到「设置」页添加一个厂商 + 模型的配置并填入 API Key。
    </n-alert>
    <n-alert v-else-if="!configStore.activeReady" type="warning" :bordered="false">
      配置「{{ configStore.activeConfig?.name }}」还没有填 API Key。
    </n-alert>

    <div ref="scrollEl" class="ai-window__messages" @scroll="onScroll">
      <!-- 这层包裹是 ResizeObserver 的观察对象：它的高度就是内容高度 -->
      <div ref="listEl">
        <AiMessageItem
          v-for="message in messages"
          :key="message.id"
          :message="message"
          :streaming="chat.activeBusy && message.id === lastMessageId"
        />
        <div v-if="messages.length === 0" class="ai-window__empty">
          发消息开始对话。支持流式输出、上传图片（视觉模型）与多会话保存。
        </div>
      </div>
    </div>

    <AiComposer />
  </div>
</template>

<script setup lang="ts">
/**
 * AI 对话窗口的内容（对应主窗口的 `AppLayout`）。
 *
 * 拖动与缩放**全部交给 OS**：顶栏 `-webkit-app-region: drag`，边角由 `resizable` 窗口
 * 自带。上一版内嵌浮动面板那套八向把手 + 视口夹紧的几何代码因此整块删掉了。
 *
 * **不要用 `useWindowControls`**：`registerWindowControlIpc(mainWindow)` 闭包的是主窗口，
 * 在这个窗口里调 `window.api.window.*` 会去最小化/关闭**主窗口**。这里的 ✕ 用渲染进程
 * 自己的 `window.close()`，而 ─ 最小化没有对应的 DOM API，只能走专用的 `ai:minimizeWindow`。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { NAlert, NButton, NIcon, NInput, NSelect, useMessage } from 'naive-ui';
import {
  AddOutline,
  CloseOutline,
  CreateOutline,
  PinOutline,
  RemoveOutline,
  SettingsOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { AiWindowState } from '@shared/types';
import AiMessageItem from './AiMessageItem.vue';
import AiComposer from './AiComposer.vue';
import { useAiChatStore } from '@/stores/aiChat';
import { useAiConfigStore } from '@/stores/aiConfig';
import { minimizeAiWindowApi, openAiSettingsApi, setAiWindowTopApi } from '@/services/ai';
import { readState, refreshAppState } from '@/services/appState';
import { setMessageApi } from '@/utils/feedback';
import { formatRelativeTime } from '@/utils/format';

// #region setup
const chat = useAiChatStore();
const configStore = useAiConfigStore();

// 注册全局 message 实例：这个窗口有自己的 provider 树，不注册 showError 只会进 console
setMessageApi(useMessage());

/** 消息滚动容器。 */
const scrollEl = ref<HTMLElement | null>(null);
/** 消息列表（内容高度的载体，`ResizeObserver` 观察它）。 */
const listEl = ref<HTMLElement | null>(null);
/** 重命名输入框（用于聚焦）。 */
const renameInput = ref<InstanceType<typeof NInput> | null>(null);
/** 是否正在重命名（此时下拉框原位换成输入框）。 */
const renaming = ref(false);
/** 重命名草稿。 */
const renameDraft = ref('');
/** 是否置顶。初值取上次记住的（主进程建窗口时已按它设过 alwaysOnTop）。 */
const alwaysOnTop = ref(readState<AiWindowState>('aiWindow')?.alwaysOnTop === true);

/** 当前会话的消息。 */
const messages = computed(() => chat.activeConversation?.messages ?? []);

/** 最后一条消息 id（流式中的那条就是它）。 */
const lastMessageId = computed(() => messages.value[messages.value.length - 1]?.id ?? '');

/** 会话下拉项。 */
const sessionOptions = computed(() =>
  chat.conversations.map((c) => ({
    label: `${c.title} · ${formatRelativeTime(c.updatedAt)} · ${c.messages.length} 条`,
    value: c.id,
  })),
);

/** 贴底判定的容差（像素）。 */
const STICK_THRESHOLD = 40;

/** 视图是不是贴着底（用户往上翻过就不是）。 */
let stick = true;
/** 内容高度观察器。 */
let contentObserver: ResizeObserver | null = null;

/**
 * 滚动跟随：**由真实的高度变化驱动，而不是由文本长度驱动**。
 *
 * 旧写法是 `watch(contentLength) → nextTick → scrollTop = scrollHeight`。#23c 之后
 * markdown 渲染带了合帧节流，文本长度每个分片都变、但 DOM 要等下一次 flush 才更新，
 * `nextTick` 里量到的 `scrollHeight` 是**上一帧的**——视图会持续落后一个节流周期，
 * 停流后还可能停在离底几十像素的地方。挂 `ResizeObserver` 与 DOM 何时更新无关，天然对。
 *
 * 顺带修掉旧写法「生成中用户没法往上翻」的毛病：只有原本就贴着底才跟随。
 */
function scrollToBottom(): void {
  const el = scrollEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** 用户滚动时重算贴底状态（**必须在这里记，不能在 RO 回调里量**——那时内容已经变高了）。 */
function onScroll(): void {
  const el = scrollEl.value;
  if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
}

// 切换会话 / 新建会话 / 发出一条消息：无条件滚到底（保留原有行为）
watch(
  () => messages.value.length,
  async () => {
    stick = true;
    await nextTick();
    scrollToBottom();
  },
);

onMounted(() => {
  void chat.ensureLoaded();
  void configStore.refreshKeyStatus();
  window.addEventListener('focus', onWindowFocus);
  const list = listEl.value;
  if (list) {
    contentObserver = new ResizeObserver(() => {
      if (stick) scrollToBottom();
    });
    contentObserver.observe(list);
  }
});

onUnmounted(() => {
  window.removeEventListener('focus', onWindowFocus);
  contentObserver?.disconnect();
  contentObserver = null;
});
// #endregion

/**
 * 回到这个窗口时重读配置。
 *
 * 用户刚在主窗口的设置页加了配置或填了 key，这边的内存快照还是打开窗口时读到的那份，
 * 不重读就会一直显示「还没有 AI 配置」。
 */
async function onWindowFocus(): Promise<void> {
  await refreshAppState();
  configStore.hydrate();
  await configStore.refreshKeyStatus();
}

/** 进入重命名态并聚焦。 */
async function startRename(): Promise<void> {
  const conversation = chat.activeConversation;
  if (!conversation) return;
  renameDraft.value = conversation.title;
  renaming.value = true;
  await nextTick();
  renameInput.value?.focus();
}

/** 提交重命名。空串在 store 里回落成「新对话」并允许再次自动取名。 */
function commitRename(): void {
  if (!renaming.value) return;
  const id = chat.activeConversation?.id;
  renaming.value = false;
  if (id) chat.renameConversation(id, renameDraft.value);
}

/** 放弃重命名。 */
function cancelRename(): void {
  renaming.value = false;
}

/** 删除当前会话。 */
function removeActive(): void {
  const id = chat.activeConversation?.id;
  if (id) chat.removeConversation(id);
}

/** 让主窗口跳到设置页（配置界面在主窗口里，这个窗口没有路由）。 */
function goSettings(): void {
  void openAiSettingsApi();
}

/** 切换置顶。以主进程返回的实际状态为准。 */
async function toggleTop(): Promise<void> {
  alwaysOnTop.value = await setAiWindowTopApi(!alwaysOnTop.value);
}

/**
 * 收进任务栏。
 *
 * **不能走 `useWindowControls`**（那套控的是主窗口），而 DOM 的 `window` 只有 `close()`
 * 没有 minimize，所以这件事必须过 `ai:minimizeWindow`。收起来之后从任务栏点回来，
 * 或者再点一次首页的 AI 入口（主进程那边会先 `restore()`）。
 */
function minimizeWindow(): void {
  void minimizeAiWindowApi();
}

/** 关掉这个窗口。生成中的请求由主进程在 sender 销毁时取消。 */
function closeWindow(): void {
  window.close();
}
</script>

<style scoped lang="scss">
.ai-window {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--tb-bg-surface);
  // 无边框透明窗口的圆角外壳（同主窗口）
  border: 1px solid var(--tb-border-strong);
  border-radius: var(--tb-radius-lg);

  &__bar {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    flex-shrink: 0;
    padding: var(--tb-space-2) var(--tb-space-2) var(--tb-space-2) var(--tb-space-3);
    border-bottom: 1px solid var(--tb-border);
    background: var(--tb-bg-elevated);
    -webkit-app-region: drag;
  }

  // 下拉、输入框与按钮都必须退出拖拽区，否则按下去只会拖窗口、永远点不开
  .no-drag {
    -webkit-app-region: no-drag;
  }

  // 会话下拉**不许吃满整条**：顶栏是这个无边框窗口唯一的拖拽把手，铺满了就只剩按钮间的
  // 缝可以按，等于拖不动。窄到 min-width 时它自己先让位（basis 可收缩）。
  &__session,
  &__rename {
    flex: 0 1 140px;
    min-width: 0;
  }

  // 拖拽留白：不给它一块，下拉 + 八个按钮会把顶栏铺满。**`min-width` 是保命的那条**——
  // 按钮不缩、下拉缩到 0 之后，这 32px 就是窄窗口里唯一还能按住拖动的地方
  &__drag {
    flex: 1 1 auto;
    min-width: 32px;
    align-self: stretch;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
  }

  &__messages {
    flex: 1;
    min-height: 0;
    padding: var(--tb-space-3);
    overflow-y: auto;
  }

  // 告警与输入区都不许被压缩：消息区是唯一该让出空间的那个（漏了这条就会超框）
  :deep(.n-alert) {
    flex-shrink: 0;
  }

  > .ai-composer {
    flex-shrink: 0;
  }

  &__empty {
    padding: var(--tb-space-5) var(--tb-space-2);
    color: var(--tb-text-secondary);
    font-size: 13px;
    text-align: center;
  }
}
</style>
