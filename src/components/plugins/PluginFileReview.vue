<template>
  <div class="plugin-review">
    <n-select
      :value="selected"
      :options="files.map((name) => ({ label: name, value: name }))"
      placeholder="选择文件，查看安装前后的源码"
      @update:value="selectFile"
    />
    <n-spin :show="loading">
      <n-alert v-if="truncated" type="info">每侧最多显示 64 KB，内容已截断。</n-alert>
      <div v-if="selected" class="plugin-review__sides">
        <div>
          <span>当前安装版本</span
          ><n-input
            :value="before"
            type="textarea"
            readonly
            :autosize="{ minRows: 6, maxRows: 15 }"
          />
        </div>
        <div>
          <span>待安装版本</span
          ><n-input
            :value="after"
            type="textarea"
            readonly
            :autosize="{ minRows: 6, maxRows: 15 }"
          />
        </div>
      </div>
    </n-spin>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { NAlert, NInput, NSelect, NSpin } from 'naive-ui';
import { candidateFileApi } from '@/services/plugins';
interface Props {
  /** 宿主候选令牌。 */
  token: string;
  /** 已验证的变更路径。 */
  files: string[];
}
const props = defineProps<Props>();
const selected = ref('');
const before = ref('');
const after = ref('');
const truncated = ref(false);
const loading = ref(false);
/** @param name 用户选择的包内路径。 */
async function selectFile(name: string): Promise<void> {
  selected.value = name;
  loading.value = true;
  try {
    const value = await candidateFileApi(props.token, name);
    if (selected.value !== name) return;
    before.value = value.before;
    after.value = value.after;
    truncated.value = value.truncated;
  } catch {
    before.value = '';
    after.value = '';
  } finally {
    if (selected.value === name) loading.value = false;
  }
}
</script>

<style scoped lang="scss">
.plugin-review {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-2);
  &__sides {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--tb-space-2);
  }
}
</style>
