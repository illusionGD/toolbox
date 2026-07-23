<template>
  <div class="placeholder">
    <n-icon :size="56" :depth="3">
      <ConstructOutline />
    </n-icon>
    <h2 class="placeholder__title">{{ title }}</h2>
    <p class="placeholder__desc">该功能尚未开发，敬请期待。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { NIcon } from 'naive-ui';
import { ConstructOutline } from '@vicons/ionicons5';

// #region setup
const route = useRoute();
const title = computed(() => (route.meta.title as string | undefined) ?? '功能开发中');
// #endregion
</script>

<style scoped lang="scss">
.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: var(--tb-space-3);
  color: var(--tb-text-secondary);

  &__title {
    margin: 0;
    color: var(--tb-text-primary);
  }

  &__desc {
    margin: 0;
    font-size: 13px;
  }
}
</style>
