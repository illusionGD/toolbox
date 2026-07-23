<template>
  <header class="title-bar">
    <div class="title-bar__left">
      <n-icon :size="22" :color="themeStore.primaryColor">
        <CubeOutline />
      </n-icon>
      <span class="title-bar__brand">Toolbox</span>
    </div>

    <div class="title-bar__center">
      <n-input
        v-model:value="searchKeyword"
        class="title-bar__search"
        placeholder="搜索工具..."
        clearable
        size="small"
      >
        <template #prefix>
          <n-icon :component="SearchOutline" />
        </template>
      </n-input>
    </div>

    <div class="title-bar__right">
      <AccountEntry />
      <button class="title-bar__ctrl" title="最小化" @click="handleMinimize">
        <n-icon :size="16" :component="RemoveOutline" />
      </button>
      <button class="title-bar__ctrl" title="最大化/还原" @click="handleToggleMaximize">
        <n-icon :size="15" :component="isMaximized ? CopyOutline : SquareOutline" />
      </button>
      <button class="title-bar__ctrl title-bar__ctrl--close" title="关闭" @click="handleClose">
        <n-icon :size="16" :component="CloseOutline" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { NIcon, NInput } from 'naive-ui';
import {
  CloseOutline,
  CopyOutline,
  CubeOutline,
  RemoveOutline,
  SearchOutline,
  SquareOutline,
} from '@vicons/ionicons5';
import { useThemeStore } from '@/stores/theme';
import { useWindowControls } from '@/composables/useWindowControls';
import AccountEntry from './AccountEntry.vue';

// #region setup
const themeStore = useThemeStore();
const searchKeyword = ref('');
const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

/** 最小化窗口。 */
function handleMinimize(): void {
  minimize();
}

/** 切换最大化/还原。 */
function handleToggleMaximize(): void {
  toggleMaximize();
}

/** 关闭窗口。 */
function handleClose(): void {
  close();
}
// #endregion
</script>

<style scoped lang="scss">
.title-bar {
  display: flex;
  align-items: center;
  height: 48px;
  padding-left: var(--tb-space-4);
  background: var(--tb-bg-surface);
  border-bottom: 1px solid var(--tb-border);
  // 整条标题栏可拖拽移动窗口
  -webkit-app-region: drag;
  user-select: none;

  &__left {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    width: 200px;
  }

  &__brand {
    font-size: 16px;
    font-weight: 600;
    color: var(--tb-text-primary);
  }

  &__center {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    padding-right: var(--tb-space-4);
  }

  &__search {
    width: 260px;
    // 仅搜索框排除拖拽，容器空白区仍可拖动窗口
    -webkit-app-region: no-drag;
  }

  &__right {
    display: flex;
    align-items: center;
    height: 100%;
    -webkit-app-region: no-drag;
  }

  &__ctrl {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 48px;
    border: none;
    background: transparent;
    color: var(--tb-text-secondary);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      background: var(--tb-bg-hover);
      color: var(--tb-text-primary);
    }

    &--close:hover {
      background: #e11d48;
      color: #fff;
    }
  }
}
</style>
