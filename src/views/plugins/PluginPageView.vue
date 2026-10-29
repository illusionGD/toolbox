<template>
  <tool-page-layout
    :title="page?.title || '插件页面'"
    category="插件"
    :desc="record?.manifest.description"
  >
    <template #main>
      <n-scrollbar>
        <n-empty v-if="!record || !page" description="插件未启用或页面已移除" />
        <plugin-command-form
          v-else-if="command"
          :key="`${record.revision}:${page.id}`"
          :plugin-id="record.manifest.id"
          :command="command"
        />
        <n-space v-else vertical>
          <p>此插件使用独立窗口显示自定义界面。</p>
          <n-button type="primary" @click="openPage">打开 {{ page.title }}</n-button>
        </n-space>
      </n-scrollbar>
    </template>
  </tool-page-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { NButton, NEmpty, NScrollbar, NSpace } from 'naive-ui';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import PluginCommandForm from '@/components/plugins/PluginCommandForm.vue';
import { usePluginsStore } from '@/stores/plugins';
import { useThemeStore } from '@/stores/theme';
import { closePluginPageApi, openPluginPageApi, updatePluginThemeApi } from '@/services/plugins';

const store = usePluginsStore();
const theme = useThemeStore();
const route = useRoute();
watch(
  () => [theme.mode, theme.primaryColor],
  () => {
    void updatePluginThemeApi({ mode: theme.mode, primaryColor: theme.primaryColor }).catch(
      () => {},
    );
  },
);
store.init();
const record = computed(() =>
  store.records.find((r) => r.enabled && r.manifest.id === route.params.pluginId),
);
const page = computed(() =>
  record.value?.manifest.contributes.pages.find((p) => p.id === route.params.pageId),
);
const command = computed(() =>
  record.value?.manifest.contributes.commands.find((c) => c.id === page.value?.command),
);
watch(
  () => route.fullPath,
  () => {
    void closePluginPageApi();
  },
);
onBeforeUnmount(() => {
  void closePluginPageApi();
});
/** 打开属于当前页面的独立沙箱。 */
async function openPage(): Promise<void> {
  if (!record.value || !page.value) return;
  await openPluginPageApi(record.value.manifest.id, page.value.id, {
    primaryColor: theme.primaryColor,
    mode: theme.mode,
  }).catch(() => {});
}
</script>
