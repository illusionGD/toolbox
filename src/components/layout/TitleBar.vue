<template>
  <header class="title-bar">
    <div class="title-bar__left">
      <n-icon :size="22" :color="themeStore.primaryColor">
        <CubeOutline />
      </n-icon>
      <span class="title-bar__brand">Toolbox</span>
    </div>

    <div class="title-bar__center">
      <div class="title-bar__search-wrap">
        <n-input
          v-model:value="searchKeyword"
          class="title-bar__search"
          placeholder="搜索工具..."
          clearable
          size="small"
          @focus="focused = true"
          @blur="handleBlur"
          @keydown="handleKeydown"
        >
          <template #prefix>
            <n-icon :component="SearchOutline" />
          </template>
        </n-input>

        <div v-if="showPanel" class="title-bar__results">
          <button
            v-for="(item, index) in results"
            :key="item.key"
            type="button"
            class="title-bar__result"
            :class="{ 'title-bar__result--active': index === activeIndex }"
            @mouseenter="activeIndex = index"
            @mousedown.prevent="selectTool(item)"
          >
            <span class="title-bar__result-label">{{ item.label }}</span>
            <span class="title-bar__result-cat">{{ item.categoryLabel }}</span>
          </button>
        </div>
      </div>
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
import { computed, ref, watch } from 'vue';
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
import { useToolLauncher } from '@/composables/useToolLauncher';
import { TOOL_MAP, type FlatTool } from '@/utils/navigation';
import AccountEntry from './AccountEntry.vue';

// #region setup
const themeStore = useThemeStore();
const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();
const { openTool } = useToolLauncher();

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

// #region search
/** 结果条数上限。 */
const MAX_RESULTS = 8;

/** 可搜索的叶子工具（有 path 的，顶层分类无 path 被排除），模块级算一次。 */
const candidates: FlatTool[] = [...TOOL_MAP.values()].filter((t) => !!t.path);

const searchKeyword = ref('');
const focused = ref(false);
const activeIndex = ref(0);

/** 命中结果：匹配工具名或分类名（忽略大小写、去空白），空关键词不出结果。 */
const results = computed<FlatTool[]>(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return [];
  return candidates
    .filter((t) => t.label.toLowerCase().includes(kw) || t.categoryLabel.toLowerCase().includes(kw))
    .slice(0, MAX_RESULTS);
});

/** 面板显隐：聚焦且有结果。 */
const showPanel = computed(() => focused.value && results.value.length > 0);

/**
 * 选中工具：跳转并复位搜索状态。
 * @param item 目标工具。
 */
function selectTool(item: FlatTool): void {
  openTool(item.key, item.path);
  searchKeyword.value = '';
  focused.value = false;
  activeIndex.value = 0;
}

/**
 * 键盘导航：↑↓ 循环移动、Enter 选中、Esc 关闭。
 * @param event 键盘事件。
 */
function handleKeydown(event: KeyboardEvent): void {
  const list = results.value;
  if (event.key === 'Escape') {
    searchKeyword.value = '';
    focused.value = false;
    return;
  }
  if (!list.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % list.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + list.length) % list.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const target = list[activeIndex.value];
    if (target) selectTool(target);
  }
}

/** 失焦延时关闭面板：留时间给结果项的 mousedown 先触发。 */
function handleBlur(): void {
  window.setTimeout(() => {
    focused.value = false;
  }, 150);
}

// 关键词变化时把高亮复位到第一项，避免停在越界下标
watch(searchKeyword, () => {
  activeIndex.value = 0;
});
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

  &__search-wrap {
    position: relative;
    width: 260px;
    // 搜索框与下拉面板都要排除拖拽，否则点不动
    -webkit-app-region: no-drag;
  }

  &__search {
    width: 100%;
  }

  &__results {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    left: 0;
    z-index: 20;
    max-height: 320px;
    overflow-y: auto;
    padding: var(--tb-space-1);
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
  }

  &__result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tb-space-3);
    width: 100%;
    padding: var(--tb-space-2) var(--tb-space-3);
    border: none;
    border-radius: var(--tb-radius-sm);
    background: transparent;
    cursor: pointer;
    text-align: left;

    &--active {
      background: var(--tb-bg-hover);
    }
  }

  &__result-label {
    font-size: 13px;
    color: var(--tb-text-primary);
  }

  &__result-cat {
    flex: none;
    font-size: 12px;
    color: var(--tb-text-secondary);
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
