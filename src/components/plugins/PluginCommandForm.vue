<template>
  <div class="plugin-form">
    <p>{{ command.description }}</p>
    <n-form label-placement="top" :disabled="runner.running.value">
      <plugin-schema-field
        :schema="command.inputSchema"
        :value="values"
        @update:value="updateValues"
      />
    </n-form>
    <n-space>
      <n-button type="primary" :loading="runner.running.value" @click="execute">{{
        candidate ? '隔离预览' : '运行'
      }}</n-button>
      <n-button v-if="runner.running.value" @click="runner.cancel"
        >取消（{{ runner.elapsed.value }} 秒）</n-button
      >
    </n-space>
    <n-alert v-if="runner.error.value" type="error" :show-icon="false">{{
      runner.error.value
    }}</n-alert>
    <n-input
      v-if="runner.result.value"
      :value="runner.result.value"
      type="textarea"
      readonly
      :autosize="{ minRows: 5, maxRows: 20 }"
      aria-label="命令运行结果"
    />
  </div>
</template>

<script setup lang="ts">
import { shallowRef, watch } from 'vue';
import { NAlert, NButton, NForm, NInput, NSpace } from 'naive-ui';
import type { JsonValue, PluginCommand } from '@shared/plugins/types';
import PluginSchemaField from './PluginSchemaField.vue';
import { pluginFieldDefault } from '@/utils/pluginSchema';
import { usePluginRunner } from '@/composables/usePluginRunner';

interface Props {
  /** 插件标识。 */
  pluginId: string;
  /** Manifest 命令声明。 */
  command: PluginCommand;
  /** 预览候选令牌；为空则运行安装版本。 */
  candidate?: string;
}
const props = withDefaults(defineProps<Props>(), { candidate: '' });
const runner = usePluginRunner();
const values = shallowRef<JsonValue>({});
watch(
  () => props.command,
  () => {
    values.value = pluginFieldDefault(props.command.inputSchema);
  },
  { immediate: true },
);
/** @param value 结构化表单的新值。 */
function updateValues(value: JsonValue | undefined): void {
  values.value = value ?? {};
}
/** 执行命令，参数由宿主统一验证。 */
async function execute(): Promise<void> {
  await runner.run(props.pluginId, props.command.id, values.value, props.candidate || undefined);
}
</script>

<style scoped lang="scss">
.plugin-form {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-3);
  p {
    margin: 0;
    color: var(--tb-text-secondary);
  }
}
</style>
