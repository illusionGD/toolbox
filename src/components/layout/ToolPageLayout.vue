<template>
  <div class="tool-page">
    <!-- 面包屑 -->
    <div class="tool-page__breadcrumb">
      <n-breadcrumb>
        <n-breadcrumb-item @click="goHome">
          <n-icon :component="ArrowBackOutline" />
        </n-breadcrumb-item>
        <n-breadcrumb-item v-if="category">{{ category }}</n-breadcrumb-item>
        <n-breadcrumb-item>{{ title }}</n-breadcrumb-item>
      </n-breadcrumb>
    </div>

    <!-- 标题 + 描述 -->
    <div class="tool-page__head">
      <h1 class="tool-page__title">{{ title }}</h1>
      <p v-if="desc" class="tool-page__desc">{{ desc }}</p>
    </div>

    <!-- 操作栏（可选） -->
    <div v-if="$slots.toolbar" class="tool-page__toolbar">
      <slot name="toolbar" />
    </div>

    <!-- 主体：左内容 + 右参数面板 -->
    <div class="tool-page__body">
      <section class="tool-page__main">
        <slot name="main" />
      </section>
      <aside v-if="$slots.panel" class="tool-page__panel">
        <slot name="panel" />
      </aside>
    </div>

    <!-- 底部（可选） -->
    <div v-if="$slots.footer" class="tool-page__footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router';
import { NBreadcrumb, NBreadcrumbItem, NIcon } from 'naive-ui';
import { ArrowBackOutline } from '@vicons/ionicons5';

interface Props {
  /** 页面标题。 */
  title: string;
  /** 一句话描述。 */
  desc?: string;
  /** 面包屑中的上级分类名（可选）。 */
  category?: string;
}

defineProps<Props>();

// #region setup
const router = useRouter();

/** 返回首页。 */
function goHome(): void {
  void router.push('/home');
}
// #endregion
</script>

<style scoped lang="scss">
.tool-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--tb-space-4) var(--tb-space-5);
  gap: var(--tb-space-2);

  &__breadcrumb {
    flex-shrink: 0;
    cursor: pointer;

    // 面包屑整体更紧凑
    :deep(.n-breadcrumb) {
      font-size: 12px;
    }

    :deep(.n-breadcrumb .n-breadcrumb-item .n-breadcrumb-item__link) {
      font-size: 12px;
    }
  }

  &__head {
    flex-shrink: 0;
  }

  &__title {
    margin: 0 0 4px;
    font-size: 20px;
    color: var(--tb-text-primary);
  }

  &__desc {
    margin: 0;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__toolbar {
    flex-shrink: 0;
  }

  &__body {
    flex: 1;
    display: flex;
    gap: var(--tb-space-4);
    min-height: 0;
  }

  &__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  &__panel {
    width: 280px;
    flex-shrink: 0;
    overflow: auto;
    padding: var(--tb-space-4);
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__footer {
    flex-shrink: 0;
    padding-top: var(--tb-space-2);
    border-top: 1px solid var(--tb-border);
  }
}
</style>
