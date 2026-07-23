<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-message-provider>
      <n-dialog-provider>
        <AppLayout />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NMessageProvider, dateZhCN, zhCN } from 'naive-ui';
import AppLayout from '@/components/layout/AppLayout.vue';
import { useTheme } from '@/composables/useTheme';

// #region setup
const { naiveTheme, themeOverrides } = useTheme();
// #endregion
</script>

<style scoped lang="scss"></style>
