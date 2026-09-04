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
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useMessage } from 'naive-ui';
import { useRouter } from 'vue-router';
import TitleBar from './TitleBar.vue';
import SideNav from './SideNav.vue';
import { useWindowControls } from '@/composables/useWindowControls';
import { onAiNavigateSettings } from '@/services/ai';
import { setMessageApi } from '@/utils/feedback';

// #region setup
const { isMaximized } = useWindowControls();
const router = useRouter();

// 注册全局 message 实例，供 services 等非组件上下文统一提示
setMessageApi(useMessage());

/** AI 窗口点齿轮时的推送订阅取消函数。 */
let offNavigate: (() => void) | null = null;

// AI 对话是独立窗口、自己没有路由，它的 ⚙ 只能让主窗口跳到设置页
onMounted(() => {
  offNavigate = onAiNavigateSettings(() => {
    void router.push('/settings');
  });
});

onUnmounted(() => {
  offNavigate?.();
  offNavigate = null;
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
