<template>
  <!-- 允许：透明放行，直接渲染内容 -->
  <slot v-if="allowed" />

  <!-- 拦截：付费墙占位（仅账号启用且功能需付费时出现） -->
  <div v-else class="pro-guard">
    <n-icon :size="32" :depth="3" :component="LockClosedOutline" />
    <p class="pro-guard__title">该功能需要 Pro 会员</p>
    <n-button type="primary" size="small" @click="handleUpgrade">升级 Pro</n-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NIcon, useMessage } from 'naive-ui';
import { LockClosedOutline } from '@vicons/ionicons5';
import { useEntitlement } from '@/composables/useEntitlement';

interface Props {
  /** 功能标识，对应 NavItem.key。 */
  featureKey: string;
}

const props = defineProps<Props>();

// #region setup
const message = useMessage();
const { can } = useEntitlement();

/** 当前功能是否放行。free 阶段恒为 true。 */
const allowed = computed(() => can(props.featureKey));

/** 升级入口占位，后端就绪后跳转付费流程。 */
function handleUpgrade(): void {
  message.info('付费功能尚未开放');
}
// #endregion
</script>

<style scoped lang="scss">
.pro-guard {
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
}
</style>
