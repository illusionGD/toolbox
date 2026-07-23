<template>
  <!-- 账号能力未启用时不渲染任何账号入口 -->
  <div v-if="accountEnabled" class="account-entry">
    <!-- 已登录：头像下拉 -->
    <n-dropdown
      v-if="userStore.isLoggedIn"
      trigger="click"
      :options="menuOptions"
      @select="handleSelect"
    >
      <n-avatar round :size="28" class="account-entry__avatar">
        {{ avatarText }}
      </n-avatar>
    </n-dropdown>

    <!-- 未登录：登录按钮 -->
    <n-button v-else size="small" quaternary @click="handleLogin">
      <template #icon>
        <n-icon :component="PersonCircleOutline" />
      </template>
      登录
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NAvatar, NButton, NDropdown, NIcon, useMessage } from 'naive-ui';
import { PersonCircleOutline } from '@vicons/ionicons5';
import { useUserStore } from '@/stores/user';
import { useEntitlement } from '@/composables/useEntitlement';

// #region setup
const message = useMessage();
const userStore = useUserStore();
const { accountEnabled } = useEntitlement();

/** 头像显示的首字符。 */
const avatarText = computed(() => userStore.user?.name?.[0]?.toUpperCase() ?? 'U');

const menuOptions = [
  { label: '个人中心', key: 'profile' },
  { label: '退出登录', key: 'logout' },
];

/** 登录入口占位，后端就绪后打开登录弹窗/页面。 */
function handleLogin(): void {
  message.info('登录功能尚未开放');
}

/**
 * 头像下拉菜单选择。
 * @param key 选项 key。
 */
function handleSelect(key: string): void {
  if (key === 'logout') {
    void userStore.logout();
  } else {
    message.info('个人中心尚未开放');
  }
}
// #endregion
</script>

<style scoped lang="scss">
.account-entry {
  display: flex;
  align-items: center;
  padding: 0 var(--tb-space-2);
  -webkit-app-region: no-drag;

  &__avatar {
    cursor: pointer;
    background: var(--tb-color-primary);
    color: #fff;
  }
}
</style>
