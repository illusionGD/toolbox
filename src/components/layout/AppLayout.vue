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
import { useMessage } from 'naive-ui';
import TitleBar from './TitleBar.vue';
import SideNav from './SideNav.vue';
import { useWindowControls } from '@/composables/useWindowControls';
import { setMessageApi } from '@/utils/feedback';

// #region setup
const { isMaximized } = useWindowControls();

// 注册全局 message 实例，供 services 等非组件上下文统一提示
setMessageApi(useMessage());
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
