<template>
  <n-config-provider
    :theme="naiveTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
    :hljs="hljs"
  >
    <n-message-provider>
      <n-dialog-provider>
        <AiPanelWindowBody />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
/**
 * AI 对话窗口的根组件（`index.html?ai=1` 挂它，而不是 `App.vue`）。
 *
 * 与 `App.vue` 平行：**provider 链必须自己再搭一遍**——这是另一个 BrowserWindow，
 * 主窗口那份 provider 在这里不存在，少一层 `n-message-provider` 就等于 `showError`
 * 只进 console。区别是这里没有路由（窗口只有对话一件事）。
 *
 * `:hljs` 是 #23c 加的：`n-code`（代码块高亮）只认从这里注入的实例。naive-ui 自己
 * **不打进产物**，所以不注入就等于不高亮。主窗口的 `App.vue` 不用加——AI 对话只在这个窗口里。
 */
import { NConfigProvider, NDialogProvider, NMessageProvider, dateZhCN, zhCN } from 'naive-ui';
import AiPanelWindowBody from './AiPanelWindowBody.vue';
import { useTheme } from '@/composables/useTheme';
import { hljs } from '@/utils/highlight';

// #region setup
const { naiveTheme, themeOverrides } = useTheme();
// #endregion
</script>

<style scoped lang="scss"></style>
