<template>
  <n-card title="开发与数据" size="small">
    <n-space vertical>
      <n-space>
        <n-button :loading="busy" @click="start">监听开发目录</n-button>
        <n-button :loading="busy" @click="loadStorage">管理插件数据</n-button>
      </n-space>
      <n-alert
        v-for="session in sessions"
        :key="session.id"
        :type="session.error ? 'error' : 'info'"
      >
        <div class="plugin-maintenance__path">{{ session.directory }}</div>
        <div>{{ session.error || `草稿已刷新：${session.updatedAt}` }}</div>
        <n-space>
          <n-button size="small" @click="emit('review', session.token)">审阅最新草稿</n-button>
          <n-button size="small" @click="stop(session.id)">停止监听</n-button>
        </n-space>
      </n-alert>
    </n-space>
  </n-card>
  <n-modal
    v-model:show="storageVisible"
    preset="card"
    title="插件数据"
    style="width: min(680px, 90vw)"
  >
    <n-scrollbar style="max-height: 60vh">
      <n-space vertical>
        <n-empty v-if="!storage.length" description="没有插件数据" />
        <n-card v-for="item in storage" :key="item.id" size="small" :title="item.name">
          <n-space justify="space-between" align="center">
            <span
              >{{ item.installed ? '已安装' : '已卸载，数据保留' }} · {{ item.bytes }} 字节</span
            >
            <n-popconfirm @positive-click="clear(item.id)">
              <template #trigger><n-button type="error" size="small">清理数据</n-button></template>
              清理 {{ item.name }} 的全部持久数据并终止其运行，无法撤销。插件安装文件保留。
            </n-popconfirm>
          </n-space>
        </n-card>
      </n-space>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue';
import { NAlert, NButton, NCard, NEmpty, NModal, NPopconfirm, NScrollbar, NSpace } from 'naive-ui';
import type { PluginDevelopment, PluginStorageInfo } from '@shared/plugins/types';
import {
  clearPluginStorageApi,
  onPluginsChangedApi,
  pluginDevelopmentApi,
  pluginStorageInfoApi,
  startPluginDevelopmentApi,
  stopPluginDevelopmentApi,
} from '@/services/plugins';

const emit = defineEmits<{ review: [token: string] }>();
const sessions = shallowRef<PluginDevelopment[]>([]);
const storage = shallowRef<PluginStorageInfo[]>([]);
const busy = ref(false);
const storageVisible = ref(false);
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  void refresh();
  unsubscribe = onPluginsChangedApi(() => void refresh());
});
onBeforeUnmount(() => unsubscribe?.());
/** 刷新开发状态，错误由 service 提示。 */
async function refresh(): Promise<void> {
  try {
    sessions.value = await pluginDevelopmentApi();
  } catch {
    /* 已提示 */
  }
}
/** 选择目录后开始刷新草稿。 */
async function start(): Promise<void> {
  busy.value = true;
  try {
    const session = await startPluginDevelopmentApi();
    if (session) emit('review', session.token);
  } catch {
    /* 已提示 */
  } finally {
    busy.value = false;
  }
}
/** @param id 停止监听。 */
async function stop(id: string): Promise<void> {
  try {
    await stopPluginDevelopmentApi(id);
    await refresh();
  } catch {
    /* 已提示 */
  }
}
/** 显示独立于安装列表的数据。 */
async function loadStorage(): Promise<void> {
  try {
    storage.value = await pluginStorageInfoApi();
    storageVisible.value = true;
  } catch {
    /* 已提示 */
  }
}
/** @param id 清理已确认的数据。 */
async function clear(id: string): Promise<void> {
  try {
    await clearPluginStorageApi(id);
    await loadStorage();
  } catch {
    /* 已提示 */
  }
}
</script>

<style scoped lang="scss">
.plugin-maintenance__path {
  overflow-wrap: anywhere;
}
</style>
