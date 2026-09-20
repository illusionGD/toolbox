<template>
  <n-data-table
    ref="table"
    class="webtest-steps"
    :columns="columns"
    :data="rows"
    :row-key="rowKey"
    :row-props="rowProps"
    :row-class-name="rowClass"
    :max-height="430"
    :scroll-x="880"
    virtual-scroll
    size="small"
  />
</template>

<script setup lang="ts">
import { computed, h, nextTick, ref, watch } from 'vue';
import {
  NButton,
  NDataTable,
  NSpace,
  NTag,
  type DataTableColumns,
  type DataTableInst,
} from 'naive-ui';
import type { WebTestStep, WebTestStepResult } from '@shared/webtest';
import { WEBTEST_ACTION_LABELS } from '@/constants/webtest';

interface Props {
  /** 按录制顺序排列的操作。 */
  steps: WebTestStep[];
  /** 当前回放的执行结果。 */
  results?: WebTestStepResult[];
  /** 正在执行或失败的步骤。 */
  activeStepId?: string | null;
  /** 用户选择的插入检查点位置。 */
  selectedId?: string | null;
  /** 会话进行中禁止编辑。 */
  disabled?: boolean;
}
interface StepRow {
  step: WebTestStep;
  index: number;
  result?: WebTestStepResult;
}
const props = withDefaults(defineProps<Props>(), {
  results: () => [],
  activeStepId: null,
  selectedId: null,
  disabled: false,
});
const emit = defineEmits<{
  edit: [step: WebTestStep];
  remove: [id: string];
  select: [id: string];
}>();
const table = ref<DataTableInst | null>(null);
const rows = computed<StepRow[]>(() => {
  const results = new Map(props.results.map((result) => [result.stepId, result]));
  return props.steps.map((step, index) => ({
    step,
    index: index + 1,
    result: results.get(step.id),
  }));
});
const columns = computed<DataTableColumns<StepRow>>(() => [
  { title: '#', key: 'index', width: 46 },
  {
    title: '间隔',
    key: 'delay',
    width: 115,
    render: ({ step }) =>
      step.action === 'fill' ? '输入：不等待' : `${step.delayBeforeMs ?? 0} ms`,
  },
  {
    title: '状态',
    key: 'status',
    width: 84,
    render: ({ result }) => {
      const status = result?.status ?? 'pending';
      const types = {
        pending: 'default',
        running: 'info',
        passed: 'success',
        failed: 'error',
      } as const;
      const labels = { pending: '待执行', running: '执行中', passed: '通过', failed: '失败' };
      return h(NTag, { type: types[status], size: 'small', bordered: false }, () => labels[status]);
    },
  },
  {
    title: '动作',
    key: 'action',
    width: 145,
    ellipsis: { tooltip: true },
    render: ({ step }) => step.label || WEBTEST_ACTION_LABELS[step.action],
  },
  {
    title: '定位 / 路径',
    key: 'target',
    minWidth: 220,
    ellipsis: { tooltip: true },
    render: ({ step }) =>
      `${step.locatorIssue ? '⚠ 待补充定位 · ' : step.fragile ? '⚠ 结构定位 · ' : ''}${step.frames?.length ? step.frames.join(' → ') + ' → ' : ''}${step.selector || step.path || step.pageId}`,
  },
  {
    title: '参数',
    key: 'value',
    width: 130,
    ellipsis: { tooltip: true },
    render: ({ step }) =>
      step.value ??
      step.values?.join(', ') ??
      (step.checked === undefined ? '' : step.checked ? '选中' : '取消选中'),
  },
  {
    title: '操作',
    key: 'actions',
    width: 128,
    fixed: 'right',
    render: ({ step }) =>
      h(NSpace, { size: 4 }, () => [
        h(
          NButton,
          { size: 'tiny', disabled: props.disabled, onClick: () => edit(step) },
          () => '编辑',
        ),
        h(
          NButton,
          { size: 'tiny', disabled: props.disabled, onClick: () => remove(step.id) },
          () => '删除',
        ),
      ]),
  },
]);
watch(
  () => props.activeStepId,
  async (id) => {
    await nextTick();
    const index = props.steps.findIndex((step) => step.id === id);
    if (index >= 0) table.value?.scrollTo({ top: index * 40 });
  },
);
const rowKey = (row: StepRow): string => row.step.id;
const rowClass = (row: StepRow): string => {
  if (row.step.id === props.activeStepId) return 'is-active';
  return row.step.id === props.selectedId ? 'is-selected' : '';
};
const rowProps = (row: StepRow) => ({ onClick: () => select(row.step.id) });
/** @param step 被编辑的步骤。 */
const edit = (step: WebTestStep): void => emit('edit', step);
/** @param id 被删除的步骤 ID。 */
const remove = (id: string): void => emit('remove', id);
/** @param id 选中的插入位置。 */
const select = (id: string): void => emit('select', id);
</script>

<style scoped lang="scss">
.webtest-steps {
  :deep(.is-selected td) {
    background: var(--tb-color-primary-soft);
  }
  :deep(.is-active td) {
    box-shadow:
      inset 0 1px var(--tb-color-primary),
      inset 0 -1px var(--tb-color-primary);
  }
}
</style>
