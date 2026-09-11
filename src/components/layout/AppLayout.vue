<template>
  <div class="app-layout" :class="{ 'app-layout--maximized': isMaximized }">
    <TitleBar />
    <div class="app-layout__body">
      <SideNav />
      <main class="app-layout__content">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>
    <CloseConfirmModal :show="closePromptOpen" @close="closePromptOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import TitleBar from './TitleBar.vue';
import SideNav from './SideNav.vue';
import CloseConfirmModal from './CloseConfirmModal.vue';
import { useWindowControls } from '@/composables/useWindowControls';
import { onAiNavigateSettings } from '@/services/ai';
import { onClosePrompt } from '@/services/appWindow';
import { setMessageApi } from '@/utils/feedback';

// #region setup
const { isMaximized } = useWindowControls();
const router = useRouter();

// 注册全局 message 实例，供 services 等非组件上下文统一提示
setMessageApi(useMessage());

/** AI 窗口点齿轮时的推送订阅取消函数。 */
let offNavigate: (() => void) | null = null;
/** 「请弹关闭确认弹窗」的订阅取消函数。 */
let offClosePrompt: (() => void) | null = null;
/** 关闭确认弹窗开着没有。 */
const closePromptOpen = ref(false);

// AI 对话是独立窗口、自己没有路由，它的 ⚙ 只能让主窗口跳到设置页
onMounted(() => {
  offNavigate = onAiNavigateSettings(() => {
    void router.push('/settings');
  });
  // 点 ✕ / Alt+F4 时主进程可能拦下来问一句。挂在布局这一层而不是标题栏：Alt+F4 那条路
  // 压根不经过标题栏那个按钮
  offClosePrompt = onClosePrompt(() => {
    closePromptOpen.value = true;
  });
});

onUnmounted(() => {
  offNavigate?.();
  offNavigate = null;
  offClosePrompt?.();
  offClosePrompt = null;
});
// #endregion
</script>

<style scoped lang="scss">
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--tb-bg-base);
  // 无边框窗口的圆角外壳
  border: 1px solid var(--tb-border);
  border-radius: var(--tb-radius-window);

  // 最大化时铺满屏幕，取消圆角与边框
  &--maximized {
    border-color: transparent;
    border-radius: 0;
  }

  &__body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  &__content {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--tb-bg-base);
  }
}
</style>
