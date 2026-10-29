<template>
  <tool-page-layout
    title="插件管理"
    category="扩展"
    desc="导入外部插件或审阅 AI 草稿，授权后扩展工具与 AI 能力。"
  >
    <template #toolbar>
      <n-space>
        <n-button type="primary" :loading="busy" @click="importPackage(false)"
          >导入 .tbplugin</n-button
        >
        <n-button :disabled="busy" @click="importPackage(true)">导入开发目录</n-button>
        <n-button @click="store.refresh">刷新</n-button>
        <n-button @click="showLogs('system')">系统诊断</n-button>
      </n-space>
    </template>
    <template #main>
      <n-scrollbar>
        <div class="plugin-manager">
          <n-alert v-if="store.error" type="error">{{ store.error }}</n-alert>
          <plugin-maintenance @review="reviewToken" />
          <plugin-mcp-manager />
          <n-card v-if="store.candidates.length" title="待审阅 / AI 草稿" size="small">
            <n-space vertical>
              <n-button v-for="item in store.candidates" :key="item.token" @click="candidate = item"
                >{{ item.manifest.name }} · {{ item.manifest.version }} — 审阅</n-button
              >
            </n-space>
          </n-card>
          <n-empty
            v-if="!store.records.length"
            description="尚未安装插件。可先导入 examples/plugins/translation-checker 目录体验。"
          />
          <n-card
            v-for="record in store.records"
            :key="record.manifest.id"
            :title="record.manifest.name"
            size="small"
          >
            <template #header-extra
              ><n-tag :type="record.enabled ? 'success' : 'default'">{{
                record.enabled ? '已启用' : '未启用'
              }}</n-tag></template
            >
            <div class="plugin-manager__details">
              <span>{{ record.manifest.id }} · {{ record.manifest.version }}</span>
              <p>{{ record.manifest.description }}</p>
              <span
                >AI：{{ record.aiEnabled ? '已允许' : '未允许' }} · 权限
                {{ record.grants.length }}/{{ record.manifest.permissions.length }}</span
              >
            </div>
            <n-space>
              <n-button size="small" @click="editAccess(record)">授权 / 启用</n-button>
              <n-button v-if="record.enabled" size="small" @click="disable(record)">停用</n-button>
              <n-button size="small" @click="showLogs(record.manifest.id)">运行日志</n-button>
              <n-button
                size="small"
                :disabled="busy"
                @click="exportPackage({ id: record.manifest.id })"
                >导出插件</n-button
              >
              <n-popconfirm
                v-if="record.previous"
                @positive-click="change(record.manifest.id, 'rollback')"
              >
                <template #trigger
                  ><n-button size="small"
                    >回滚 {{ record.previous.manifest.version }}</n-button
                  ></template
                >
                回滚会终止运行并停用插件，保留插件数据。数据格式兼容性由插件负责。
              </n-popconfirm>
              <n-popconfirm @positive-click="change(record.manifest.id, 'uninstall')">
                <template #trigger
                  ><n-button size="small" type="error" secondary>卸载</n-button></template
                >
                卸载并终止运行，保留插件用户数据。
              </n-popconfirm>
            </n-space>
          </n-card>
        </div>
      </n-scrollbar>
    </template>
  </tool-page-layout>

  <n-modal
    :show="Boolean(candidate)"
    preset="card"
    title="审阅插件"
    style="width: min(760px, 90vw)"
    @update:show="closeCandidate"
  >
    <n-scrollbar style="max-height: 65vh">
      <div v-if="candidate" class="plugin-manager">
        <strong
          >{{ candidate.manifest.name }} · {{ candidate.currentVersion || '未安装' }} →
          {{ candidate.manifest.version }}</strong
        >
        <p>{{ candidate.manifest.description }}</p>
        <n-alert :type="candidate.addedPermissions.length ? 'warning' : 'info'">
          {{
            candidate.addedPermissions.length
              ? `新增能力：${candidate.addedPermissions.map(pluginPermissionLabel).join('、')}`
              : '没有新增宿主能力'
          }}。安装后仍需单独授权启用。
        </n-alert>
        <n-collapse
          ><n-collapse-item title="变更文件" name="files">
            <plugin-file-review
              :key="candidate.token"
              :token="candidate.token"
              :files="candidate.changedFiles"
            /> </n-collapse-item
        ></n-collapse>
        <n-select
          v-model:value="previewCommand"
          :options="
            candidate.manifest.contributes.commands.map((c) => ({ label: c.title, value: c.id }))
          "
        />
        <p>预览在独立沙箱运行，不授予宿主能力。开发目录可重新导入，或开启监听后自动刷新草稿。</p>
        <plugin-command-form
          v-if="selectedPreview"
          :key="`${candidate.token}:${previewCommand}`"
          :plugin-id="candidate.manifest.id"
          :command="selectedPreview"
          :candidate="candidate.token"
        />
        <n-button type="primary" :loading="busy" @click="install">安装此版本（保持停用）</n-button>
        <n-button :disabled="busy" @click="exportPackage({ token: candidate.token })"
          >导出草稿 .tbplugin</n-button
        >
        <n-popconfirm @positive-click="discard">
          <template #trigger><n-button type="error" secondary>丢弃此草稿</n-button></template>
          删除待审阅草稿，已安装版本不受影响。
        </n-popconfirm>
      </div>
    </n-scrollbar>
  </n-modal>

  <n-modal
    :show="Boolean(accessRecord)"
    preset="card"
    title="插件授权"
    style="width: min(560px, 90vw)"
    @update:show="closeAccess"
  >
    <n-space v-if="accessRecord" vertical size="large">
      <strong>{{ accessRecord.manifest.name }}</strong>
      <n-checkbox-group v-model:value="grants"
        ><n-space vertical
          ><n-checkbox
            v-for="permission in accessRecord.manifest.permissions"
            :key="permission"
            :value="permission"
            >{{ pluginPermissionLabel(permission) }}</n-checkbox
          ></n-space
        ></n-checkbox-group
      >
      <n-checkbox v-model:checked="enabled">启用插件</n-checkbox>
      <n-checkbox v-model:checked="aiEnabled"
        >允许 AI 调用此插件声明的 AI 命令（遵循 AI 的询问 / 自动模式）</n-checkbox
      >
      <n-button type="primary" :loading="busy" @click="saveAccess">保存授权</n-button>
    </n-space>
  </n-modal>

  <n-modal
    v-model:show="logsVisible"
    preset="card"
    title="插件诊断（最近 100 条）"
    style="width: min(760px, 90vw)"
  >
    <n-scrollbar style="max-height: 60vh">
      <pre class="plugin-manager__text">{{ logText || '暂无日志' }}</pre>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NModal,
  NPopconfirm,
  NScrollbar,
  NSelect,
  NSpace,
  NTag,
} from 'naive-ui';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import PluginCommandForm from '@/components/plugins/PluginCommandForm.vue';
import PluginFileReview from '@/components/plugins/PluginFileReview.vue';
import PluginMaintenance from '@/components/plugins/PluginMaintenance.vue';
import PluginMcpManager from '@/components/plugins/PluginMcpManager.vue';
import { usePluginsStore } from '@/stores/plugins';
import { pluginPermissionLabel } from '@shared/plugins/constants';
import type { PluginCandidate, PluginPermission, PluginRecord } from '@shared/plugins/types';
import {
  changePluginApi,
  discardCandidateApi,
  configurePluginApi,
  installPluginApi,
  pluginLogsApi,
  stagePluginApi,
  exportPluginApi,
} from '@/services/plugins';

const store = usePluginsStore();
store.init();
const candidate = shallowRef<PluginCandidate | null>(null);
const busy = ref(false);
const previewCommand = ref('');
const selectedPreview = computed(() =>
  candidate.value?.manifest.contributes.commands.find((c) => c.id === previewCommand.value),
);
watch(candidate, (value) => {
  previewCommand.value = value?.manifest.contributes.commands[0]?.id ?? '';
});
const accessRecord = shallowRef<PluginRecord | null>(null);
const grants = ref<PluginPermission[]>([]);
const enabled = ref(false);
const aiEnabled = ref(false);
const logsVisible = ref(false);
const logText = ref('');

/** @param token 打开当前监听生成的草稿。 */
async function reviewToken(token: string): Promise<void> {
  await store.refresh();
  candidate.value = store.candidates.find((item) => item.token === token) ?? null;
}
/** @param source 导出安装包或 AI 草稿，不包含授权与数据。 */
async function exportPackage(source: { id?: string; token?: string }): Promise<void> {
  await perform(async () => {
    await exportPluginApi(source);
  });
}
watch(
  () => store.candidates,
  (items) => {
    if (candidate.value && !items.some((item) => item.token === candidate.value!.token)) {
      candidate.value =
        items.find((item) => item.manifest.id === candidate.value!.manifest.id) ?? null;
    }
  },
);

/** @param operation 管理操作；错误由 service 统一显示。 */
async function perform(operation: () => Promise<void>): Promise<void> {
  busy.value = true;
  try {
    await operation();
    await store.refresh();
  } catch {
    /* unwrap 已提示 */
  } finally {
    busy.value = false;
  }
}
/** @param directory 是否导入开发目录快照。 */
async function importPackage(directory: boolean): Promise<void> {
  await perform(async () => {
    candidate.value = await stagePluginApi(directory);
  });
}
/** 丢弃用户确认删除的独立草稿。 */
async function discard(): Promise<void> {
  if (candidate.value)
    await perform(async () => {
      await discardCandidateApi(candidate.value!.token);
      candidate.value = null;
    });
}
/** 安装已审阅的候选。 */
async function install(): Promise<void> {
  if (candidate.value)
    await perform(async () => {
      await installPluginApi(candidate.value!.token);
      candidate.value = null;
    });
}
/** @param record 展开此插件授权。 */
function editAccess(record: PluginRecord): void {
  accessRecord.value = record;
  grants.value = [...record.grants];
  enabled.value = record.enabled;
  aiEnabled.value = record.aiEnabled;
}
/** 保存用户勾选的能力，撤销即时生效。 */
async function saveAccess(): Promise<void> {
  if (accessRecord.value)
    await perform(async () => {
      await configurePluginApi(accessRecord.value!.manifest.id, enabled.value, aiEnabled.value, [
        ...grants.value,
      ]);
      accessRecord.value = null;
    });
}
/** @param record 终止该插件任务。 */
async function disable(record: PluginRecord): Promise<void> {
  await perform(async () => {
    await configurePluginApi(record.manifest.id, false, record.aiEnabled, [...record.grants]);
  });
}
/** @param id 插件。 @param action 用户确认的操作。 */
async function change(id: string, action: 'uninstall' | 'rollback'): Promise<void> {
  await perform(() => changePluginApi(id, action));
}
/** @param id 插件或系统诊断。 */
async function showLogs(id: string): Promise<void> {
  await perform(async () => {
    const logs = await pluginLogsApi(id);
    logText.value = logs.map((item) => `${item.time} [${item.level}] ${item.message}`).join('\n');
    logsVisible.value = true;
  });
}
/** @param show 模态显示状态。 */
function closeCandidate(show: boolean): void {
  if (!show) candidate.value = null;
}
/** @param show 模态显示状态。 */
function closeAccess(show: boolean): void {
  if (!show) accessRecord.value = null;
}
</script>

<style scoped lang="scss">
.plugin-manager {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-3);
  &__details {
    color: var(--tb-text-secondary);
    margin-bottom: var(--tb-space-3);
    overflow-wrap: anywhere;
  }
  &__text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--tb-text-secondary);
    font-size: 12px;
  }
  p {
    margin: 0;
    color: var(--tb-text-secondary);
  }
}
</style>
