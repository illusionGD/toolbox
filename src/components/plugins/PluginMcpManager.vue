<template>
  <n-card title="MCP / 扩展服务" size="small">
    <n-space vertical>
      <n-button @click="edit()">添加 MCP 服务</n-button>
      <n-space v-for="server in servers" :key="server.id" align="center">
        <span
          >{{ server.name }} · {{ server.transport === 'http' ? 'HTTP' : '本地 stdio' }} ·
          {{ server.enabled ? '已启用' : '已停用' }}</span
        >
        <n-button size="small" @click="edit(server)">配置</n-button>
        <n-button size="small" :disabled="!server.enabled || running" @click="discover(server)"
          >发现 / 调用工具</n-button
        >
        <n-popconfirm @positive-click="remove(server.id)"
          ><template #trigger><n-button size="small" type="error">移除</n-button></template
          >移除此连接并取消其任务。</n-popconfirm
        >
      </n-space>
    </n-space>
  </n-card>
  <n-modal v-model:show="editing" preset="card" title="MCP 配置" style="width: min(720px, 90vw)">
    <n-scrollbar style="max-height: 65vh">
      <n-form label-placement="top">
        <n-form-item label="名称"><n-input v-model:value="form.name" /></n-form-item>
        <n-form-item label="连接方式">
          <n-select v-model:value="form.transport" :options="transportOptions" />
        </n-form-item>
        <template v-if="form.transport === 'stdio'">
          <n-form-item label="可执行程序"
            ><n-input v-model:value="form.executable" /><n-button @click="pick"
              >选择</n-button
            ></n-form-item
          >
          <n-form-item label="启动参数（JSON 字符串数组）"
            ><n-input
              v-model:value="argsText"
              type="textarea"
              placeholder='["D:/plugins/server.js"]'
          /></n-form-item>
          <n-form-item label="工作目录（可选）"><n-input v-model:value="form.cwd" /></n-form-item>
          <n-alert type="warning"
            >此程序使用当前用户的系统权限，可访问文件和网络。仅配置你信任的本地程序。普通 .tbplugin
            插件仍在沙箱运行。</n-alert
          >
        </template>
        <template v-else>
          <n-form-item label="服务 URL（Streamable HTTP）">
            <n-input v-model:value="form.url" placeholder="https://example.com/mcp" />
          </n-form-item>
          <n-form-item label="请求头（可选，JSON 对象）">
            <n-input
              v-model:value="headersText"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 8 }"
              placeholder='{"Authorization":"Bearer your-token"}'
            />
          </n-form-item>
          <n-alert type="info"
            >填写服务提供的 MCP 端点，支持 HTTP /
            HTTPS。工具参数会发送给该服务，请求头保存在本机连接配置中。</n-alert
          >
        </template>
        <n-space vertical class="plugin-mcp__options">
          <n-checkbox v-model:checked="form.trusted">{{
            form.transport === 'http' ? '我信任此服务地址及请求头' : '我信任此程序及启动参数'
          }}</n-checkbox>
          <n-checkbox v-model:checked="form.enabled">启用连接</n-checkbox>
          <n-checkbox v-model:checked="form.aiEnabled"
            >允许 AI 使用（遵循询问 / 自动模式）</n-checkbox
          >
          <n-alert v-if="error" type="error">{{ error }}</n-alert>
          <n-button type="primary" :loading="saving" @click="save">保存</n-button>
        </n-space>
      </n-form>
    </n-scrollbar>
  </n-modal>
  <n-modal
    :show="Boolean(selected)"
    preset="card"
    :title="selected?.name || 'MCP 工具'"
    style="width: min(800px, 90vw)"
    @update:show="closeRunner"
  >
    <n-scrollbar style="max-height: 65vh">
      <n-space vertical>
        <n-select
          v-model:value="toolName"
          :options="toolOptions"
          :disabled="running"
          placeholder="选择工具"
        />
        <pre class="plugin-mcp__text"
          >{{ currentTool?.description
          }}{{ currentTool ? '\n' + JSON.stringify(currentTool.inputSchema, null, 2) : '' }}</pre>
        <n-input
          v-model:value="inputText"
          :disabled="running"
          type="textarea"
          :autosize="{ minRows: 3, maxRows: 12 }"
          placeholder="工具参数 JSON"
        />
        <n-space>
          <n-button type="primary" :loading="running" :disabled="!currentTool" @click="execute"
            >运行</n-button
          >
          <n-button v-if="running" @click="cancel">取消</n-button>
        </n-space>
        <n-alert v-if="runError" type="error">{{ runError }}</n-alert>
        <pre class="plugin-mcp__text">{{ resultText }}</pre>
      </n-space>
    </n-scrollbar>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NPopconfirm,
  NScrollbar,
  NSelect,
  NSpace,
} from 'naive-ui';
import type { McpServerConfig, McpToolInfo } from '@shared/plugins/mcp';
import {
  cancelMcpApi,
  listMcpApi,
  pickMcpApi,
  removeMcpApi,
  runMcpApi,
  saveMcpApi,
} from '@/services/mcp';

const servers = shallowRef<McpServerConfig[]>([]);
const editing = ref(false);
const saving = ref(false);
const argsText = ref('[]');
const headersText = ref('{}');
const error = ref('');
const transportOptions = [
  { label: '本地程序（stdio）', value: 'stdio' },
  { label: 'HTTP（Streamable HTTP）', value: 'http' },
];
const form = reactive({
  id: '',
  name: '',
  transport: 'stdio' as McpServerConfig['transport'],
  executable: '',
  cwd: '',
  url: '',
  enabled: false,
  aiEnabled: false,
  trusted: false,
  revision: '',
});
const selected = shallowRef<McpServerConfig | null>(null);
const tools = shallowRef<McpToolInfo[]>([]);
const toolName = ref('');
const toolOptions = computed(() =>
  tools.value.map((tool) => ({ label: tool.name, value: tool.name })),
);
const currentTool = computed(() => tools.value.find((tool) => tool.name === toolName.value));
const inputText = ref('{}');
const resultText = ref('');
const runError = ref('');
const running = ref(false);
let requestId = '';
watch(
  () => [form.transport, form.executable, form.cwd, argsText.value, form.url, headersText.value],
  () => {
    form.trusted = false;
  },
  { flush: 'sync' },
);
onMounted(() => void refresh());
onBeforeUnmount(() => {
  void cancel();
});
/** 刷新连接配置。 */
async function refresh(): Promise<void> {
  try {
    servers.value = await listMcpApi();
  } catch {
    /* service 已提示 */
  }
}
/** @param server 可选现有连接。 */
function edit(server?: McpServerConfig): void {
  const value: McpServerConfig = server
    ? structuredClone(server)
    : {
        id: crypto.randomUUID(),
        name: '',
        transport: 'stdio',
        executable: '',
        args: [],
        cwd: '',
        enabled: false,
        aiEnabled: false,
        trusted: false,
        revision: crypto.randomUUID(),
      };
  Object.assign(form, { executable: '', cwd: '', url: '' }, value);
  argsText.value = JSON.stringify(value.transport === 'stdio' ? value.args : []);
  headersText.value = JSON.stringify(value.transport === 'http' ? value.headers : {}, null, 2);
  form.trusted = value.trusted;
  error.value = '';
  editing.value = true;
}
/** 选择程序。 */
async function pick(): Promise<void> {
  try {
    const value = await pickMcpApi();
    if (value) form.executable = value;
  } catch {
    /* 已提示 */
  }
}
/** 保存用户确认的配置。 */
async function save(): Promise<void> {
  saving.value = true;
  error.value = '';
  try {
    const common = {
      id: form.id,
      name: form.name,
      enabled: form.enabled,
      trusted: form.trusted,
      aiEnabled: form.aiEnabled,
      revision: form.revision,
    };
    if (form.transport === 'http') {
      const headers: unknown = JSON.parse(headersText.value);
      if (
        !headers ||
        Array.isArray(headers) ||
        typeof headers !== 'object' ||
        Object.values(headers).some((value) => typeof value !== 'string')
      )
        throw new Error('请求头应为字符串值的 JSON 对象');
      await saveMcpApi({
        ...common,
        transport: 'http',
        url: form.url,
        headers: headers as Record<string, string>,
      });
    } else {
      const args: unknown = JSON.parse(argsText.value);
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string'))
        throw new Error('启动参数应为字符串数组');
      await saveMcpApi({
        ...common,
        transport: 'stdio',
        executable: form.executable,
        cwd: form.cwd,
        args,
      });
    }
    editing.value = false;
    await refresh();
  } catch (cause) {
    error.value = String(cause);
  } finally {
    saving.value = false;
  }
}
/** @param id 移除连接。 */
async function remove(id: string): Promise<void> {
  try {
    await removeMcpApi(id);
    await refresh();
  } catch {
    /* 已提示 */
  }
}
/** @param server 发现授权服务的工具列表。 */
async function discover(server: McpServerConfig): Promise<void> {
  selected.value = server;
  tools.value = [];
  toolName.value = '';
  resultText.value = '';
  runError.value = '';
  running.value = true;
  requestId = crypto.randomUUID();
  try {
    tools.value = (await runMcpApi({ id: server.id, requestId })) as McpToolInfo[];
    toolName.value = tools.value[0]?.name ?? '';
  } catch (cause) {
    runError.value = String(cause);
  } finally {
    running.value = false;
    requestId = '';
  }
}
/** 执行当前工具，显示原始有界响应。 */
async function execute(): Promise<void> {
  if (!selected.value || running.value || !toolName.value) return;
  running.value = true;
  runError.value = '';
  resultText.value = '';
  requestId = crypto.randomUUID();
  try {
    const input = JSON.parse(inputText.value);
    if (!input || Array.isArray(input) || typeof input !== 'object')
      throw new Error('参数必须是 JSON 对象');
    resultText.value = JSON.stringify(
      await runMcpApi({ id: selected.value.id, requestId, tool: toolName.value, input }),
      null,
      2,
    );
  } catch (cause) {
    runError.value = String(cause);
  } finally {
    running.value = false;
    requestId = '';
  }
}
/** 取消当前 MCP 进程或 HTTP 请求。 */
async function cancel(): Promise<void> {
  if (requestId) await cancelMcpApi(requestId).catch(() => {});
}
/** @param show 弹窗是否保留。 */
function closeRunner(show: boolean): void {
  if (!show) {
    void cancel();
    selected.value = null;
  }
}
</script>

<style scoped lang="scss">
.plugin-mcp {
  &__options {
    margin-top: var(--tb-space-3);
  }
  &__text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
    color: var(--tb-text-secondary);
  }
}
</style>
