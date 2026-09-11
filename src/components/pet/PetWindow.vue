<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="zhCN">
    <div class="pet" @pointerdown="onBackdropDown" @contextmenu.prevent>
      <PetMenu v-if="presenter.menuOpen.value" class="pet__menu" @picked="presenter.closeMenu()" />
      <PetStage
        class="pet__stage"
        :src="presenter.src.value"
        :size="presenter.size.value"
        :dragging="presenter.dragging.value"
        @pointerdown="presenter.onPointerDown"
      />
    </div>
  </n-config-provider>
</template>

<script setup lang="ts">
/**
 * 桌宠窗口的根组件（`index.html?pet=1` 挂它，而不是 `App.vue`）。
 *
 * 与 `AiPanelWindow.vue` 平行，**provider 链必须自己再搭一遍**（这是第三个
 * BrowserWindow，主窗口那份在这里不存在）。区别是**只有 `n-config-provider`**：
 * 桌宠上不弹 toast、不弹 dialog——它只有一个精灵和三个按钮，真要提示就该把主窗口拿回来。
 *
 * 布局的关键：窗口在菜单展开时会被主进程**临时放大**，精灵始终锚在右下角，所以这里用
 * `flex-end` 而不是居中——菜单是往左上方向长出来的那块，精灵在屏幕上一动不动。
 *
 * 根节点上那个 `@contextmenu.prevent` 不能省：**菜单改成右键弹出之后**（review 定的），
 * 不拦的话右键会先弹一个 Chromium 自带的上下文菜单压在自家菜单上面。
 */
import { NConfigProvider, zhCN } from 'naive-ui';
import PetStage from './PetStage.vue';
import PetMenu from './PetMenu.vue';
import { useTheme } from '@/composables/useTheme';
import { usePetPresenter } from '@/composables/usePetPresenter';

// #region setup
const { naiveTheme, themeOverrides } = useTheme();
const presenter = usePetPresenter();
// #endregion

// #region methods
/**
 * 按在窗口的空白处（菜单展开时那一大片透明区）→ 收起菜单。
 *
 * 收起态下这块区域根本不存在（窗口就是精灵那么大），所以不会误伤。
 * @param event 指针事件。
 */
function onBackdropDown(event: PointerEvent): void {
  if (event.target === event.currentTarget) presenter.closeMenu();
}
// #endregion
</script>

<style scoped lang="scss">
.pet {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  width: 100vw;
  height: 100vh;
  // 窗口是 transparent 的：这里必须保持全透明，否则会在桌面上留一块矩形底
  background: transparent;
  // 桌宠不是文档，别让它能被框选出蓝色高亮
  user-select: none;
  overflow: hidden;

  &__menu {
    // 精灵在右下角，菜单贴着它左边
    margin-right: var(--tb-space-2);
  }

  &__stage {
    flex-shrink: 0;
  }
}
</style>
