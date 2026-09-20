<template>
  <n-modal
    :show="show"
    preset="card"
    title="编辑测试步骤"
    :style="{ width: '620px', maxWidth: '92vw' }"
    @update:show="close"
  >
    <n-form label-placement="left" label-width="100" :disabled="loading">
      <n-form-item label="步骤说明">
        <n-input v-model:value="draft.label" placeholder="例如：提交登录表单" maxlength="200" />
      </n-form-item>
      <n-form-item label="动作">
        <n-select v-model:value="draft.action" :options="actionOptions" />
      </n-form-item>
      <n-form-item label="页签编号">
        <n-input v-model:value="draft.pageId" placeholder="page-1" />
      </n-form-item>
      <n-form-item label="步骤间隔">
        <n-input-number
          v-model:value="draft.delayBeforeMs"
          :min="0"
          :max="86400000"
          :precision="0"
          :step="100"
          placeholder="执行前等待（毫秒）"
          :disabled="draft.action === 'fill'"
        />
      </n-form-item>
      <n-form-item v-if="needsSelector" label="CSS 定位">
        <n-input v-model:value="draft.selector" placeholder='[data-testid="submit"]' />
      </n-form-item>
      <n-form-item v-if="needsSelector" label="iframe 链">
        <n-input
          v-model:value="frameText"
          type="textarea"
          placeholder="每行一个 iframe 的 CSS 定位；主页面留空"
        />
      </n-form-item>
      <n-form-item v-if="needsPath" label="相对路径">
        <n-input v-model:value="draft.path" placeholder="./login?from=test" />
      </n-form-item>
      <n-form-item v-if="needsValue" label="输入 / 预期值">
        <n-input
          v-model:value="draft.value"
          type="textarea"
          placeholder="输入值、快捷键或检查点的预期值"
        />
      </n-form-item>
      <n-form-item v-if="draft.action === 'select'" label="选项 value">
        <n-input v-model:value="valuesText" type="textarea" placeholder="每行一个 option.value" />
      </n-form-item>
      <n-form-item v-if="needsChecked" label="预期勾选">
        <n-switch v-model:value="draft.checked" />
      </n-form-item>
      <n-form-item v-if="draft.action === 'scroll'" label="滚动坐标">
        <n-space>
          <n-input-number v-model:value="draft.x" :min="0" placeholder="X" />
          <n-input-number v-model:value="draft.y" :min="0" placeholder="Y" />
        </n-space>
      </n-form-item>
      <n-form-item v-if="draft.action === 'openPage'" label="来源页签">
        <n-input v-model:value="draft.openerId" placeholder="page-1" />
      </n-form-item>
    </n-form>
    <n-alert type="info" :show-icon="false"
      >步骤间隔按录制节奏等待，输入步骤跳过间隔并一次填充。旧用例未记录的间隔默认为
      0，可手动调整。检查点用于验证业务结果。</n-alert
    >
    <template #footer>
      <n-space justify="end">
        <n-button :disabled="loading" @click="close">取消</n-button>
        <n-button type="primary" :loading="loading" @click="save">保存步骤</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSwitch,
} from 'naive-ui';
import type { WebTestAction, WebTestStep } from '@shared/webtest';
import { WEBTEST_ACTION_LABELS } from '@/constants/webtest';

interface Props {
  /** 编辑弹窗是否可见。 */
  show: boolean;
  /** 当前步骤，null 时创建检查点。 */
  step?: WebTestStep | null;
  /** 默认沿用所选步骤的页签。 */
  pageId?: string;
  /** 保存中的交互锁。 */
  loading?: boolean;
}
const props = withDefaults(defineProps<Props>(), { step: null, pageId: 'page-1', loading: false });
const emit = defineEmits<{ close: []; save: [step: WebTestStep] }>();
const draft = ref<WebTestStep>({
  id: '',
  pageId: 'page-1',
  action: 'assertVisible',
  checked: true,
});
const frameText = ref('');
const valuesText = ref('');
const needsPath = computed(() => ['navigate', 'assertUrl'].includes(draft.value.action));
const needsSelector = computed(
  () =>
    !['navigate', 'assertUrl', 'openPage', 'closePage', 'unsupported'].includes(draft.value.action),
);
const needsValue = computed(() =>
  ['fill', 'press', 'assertValue', 'unsupported'].includes(draft.value.action),
);
const needsChecked = computed(() => ['check', 'assertChecked'].includes(draft.value.action));
const actionOptions = Object.entries(WEBTEST_ACTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));
watch(
  () => props.show,
  (show) => {
    if (!show) return;
    draft.value = props.step
      ? (JSON.parse(JSON.stringify(props.step)) as WebTestStep)
      : {
          id: crypto.randomUUID(),
          pageId: props.pageId,
          action: 'assertVisible',
          selector: '',
          checked: true,
        };
    frameText.value = draft.value.frames?.join('\n') ?? '';
    draft.value.delayBeforeMs ??= 0;
    valuesText.value = draft.value.values?.join('\n') ?? '';
  },
);

/** 关闭编辑器并通知父页面。 */
const close = (): void => emit('close');
/** 只提交当前动作对应的字段，父页面负责 schema 校验及持久化。 */
const save = (): void => {
  const value = draft.value;
  const step: WebTestStep = {
    id: value.id,
    action: value.action as WebTestAction,
    pageId: value.pageId,
    delayBeforeMs: value.delayBeforeMs ?? 0,
    ...(value.label ? { label: value.label } : {}),
  };
  if (needsSelector.value) {
    step.selector = value.selector || undefined;
    step.frames = frameText.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (needsPath.value) step.path = value.path;
  if (needsValue.value) step.value = value.value ?? '';
  if (needsChecked.value) step.checked = value.checked ?? true;
  if (value.action === 'select') step.values = valuesText.value.split('\n');
  if (value.action === 'scroll') {
    step.x = value.x ?? 0;
    step.y = value.y ?? 0;
  }
  if (value.action === 'openPage') step.openerId = value.openerId;
  if (value.action === 'click' || value.action === 'dblclick') {
    step.button = value.button;
    step.modifiers = value.modifiers;
  }
  // 修改说明或输入值不能解除定位问题；只有实际改了定位，才交给回放严格模式重新验证。
  const sameLocator =
    step.selector === props.step?.selector &&
    JSON.stringify(step.frames ?? []) === JSON.stringify(props.step?.frames ?? []);
  if (
    (sameLocator && props.step?.fragile) ||
    [step.selector ?? '', ...(step.frames ?? [])].some((selector) =>
      /:nth-(?:last-)?(?:child|of-type)\(/i.test(selector),
    )
  )
    step.fragile = true;
  if (props.step?.locatorIssue && sameLocator) {
    step.locatorIssue = props.step.locatorIssue;
    step.fragile = true;
  }
  emit('save', step);
};
</script>

<style scoped lang="scss"></style>
