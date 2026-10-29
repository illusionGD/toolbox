<template>
  <div class="plugin-schema-field">
    <n-checkbox v-if="optional" :checked="value !== undefined" @update:checked="toggle"
      >填写此字段</n-checkbox
    >
    <template v-if="value !== undefined">
      <n-select
        v-if="schema.enum"
        :value="enumIndex"
        :options="enumOptions"
        @update:value="setEnum"
      />
      <template v-else-if="schema.type === 'object'">
        <n-form-item
          v-for="field in fields"
          :key="field.key"
          :label="field.schema.title || field.key"
          :required="schema.required?.includes(field.key)"
        >
          <plugin-schema-field
            :schema="field.schema"
            :value="objectValue[field.key]"
            :optional="!schema.required?.includes(field.key)"
            @update:value="setProperty(field.key, $event)"
          />
        </n-form-item>
      </template>
      <template v-else-if="schema.type === 'array'">
        <div v-for="row in rows" :key="row.id" class="plugin-schema-field__row">
          <plugin-schema-field
            v-if="schema.items"
            :schema="schema.items"
            :value="arrayValue[row.index]"
            @update:value="setItem(row.index, $event)"
          />
          <n-button size="small" @click="removeItem(row.index)">删除项</n-button>
        </div>
        <n-button :disabled="arrayValue.length >= 10000" size="small" @click="addItem"
          >添加项</n-button
        >
      </template>
      <n-switch
        v-else-if="schema.type === 'boolean'"
        :value="value === true"
        @update:value="emit('update:value', $event)"
      />
      <n-input-number
        v-else-if="schema.type === 'number' || schema.type === 'integer'"
        :value="numberValue"
        :precision="schema.type === 'integer' ? 0 : undefined"
        @update:value="setNumber"
      />
      <span v-else-if="schema.type === 'null'">null</span>
      <n-input
        v-else
        :value="String(value)"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 8 }"
        @update:value="emit('update:value', $event)"
      />
    </template>
    <span v-if="schema.description" class="plugin-schema-field__hint">{{
      schema.description
    }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type PropType } from 'vue';
import { NButton, NCheckbox, NFormItem, NInput, NInputNumber, NSelect, NSwitch } from 'naive-ui';
import type { JsonValue, PluginSchema } from '@shared/plugins/types';
import { pluginFieldDefault } from '@/utils/pluginSchema';

const props = defineProps({
  /** 已验证 Schema。 */
  schema: { type: Object as PropType<PluginSchema>, required: true },
  /** 禁止 Vue 的 Boolean prop 转换，JSON 空字符串必须保留为空字符串。 */
  value: { type: null as unknown as PropType<JsonValue | undefined>, default: undefined },
  /** 是否允许省略字段。 */
  optional: { type: Boolean, default: false },
});
const emit = defineEmits<{ 'update:value': [value: JsonValue | undefined] }>();
const ids = ref<string[]>([]);
const objectValue = computed<Record<string, JsonValue>>(() =>
  props.value && typeof props.value === 'object' && !Array.isArray(props.value) ? props.value : {},
);
const arrayValue = computed(() => (Array.isArray(props.value) ? props.value : []));
const numberValue = computed(() => (typeof props.value === 'number' ? props.value : null));
const fields = computed(() =>
  Object.entries(props.schema.properties ?? {}).map(([key, schema]) => ({ key, schema })),
);
const enumOptions = computed(
  () =>
    props.schema.enum?.map((value, index) => ({
      value: index,
      label: typeof value === 'string' ? value : JSON.stringify(value),
    })) ?? [],
);
const enumIndex = computed(
  () =>
    props.schema.enum?.findIndex(
      (value) => JSON.stringify(value) === JSON.stringify(props.value),
    ) ?? null,
);
const rows = computed(() => ids.value.map((id, index) => ({ id, index })));
watch(
  () => arrayValue.value.length,
  (length) => {
    while (ids.value.length < length) ids.value.push(crypto.randomUUID());
    ids.value.splice(length);
  },
  { immediate: true },
);
/** @param enabled 是否填写可选字段。 */
function toggle(enabled: boolean): void {
  emit('update:value', enabled ? pluginFieldDefault(props.schema) : undefined);
}
/** @param index 枚举选项。 */
function setEnum(index: number): void {
  emit('update:value', props.schema.enum?.[index]);
}
/** @param value 数字输入。 */
function setNumber(value: number | null): void {
  emit('update:value', value ?? 0);
}
/** @param key 对象属性。 @param value 新值。 */
function setProperty(key: string, value: JsonValue | undefined): void {
  const next = { ...objectValue.value };
  if (value === undefined) delete next[key];
  else next[key] = value;
  emit('update:value', next);
}
/** @param index 数组位置。 @param value 新值。 */
function setItem(index: number, value: JsonValue | undefined): void {
  const next = [...arrayValue.value];
  next[index] = value ?? null;
  emit('update:value', next);
}
/** 新增独立默认值。 */
function addItem(): void {
  if (props.schema.items)
    emit('update:value', [...arrayValue.value, pluginFieldDefault(props.schema.items)]);
}
/** @param index 删除数组元素并保持其他元素的 key。 */
function removeItem(index: number): void {
  ids.value.splice(index, 1);
  emit(
    'update:value',
    arrayValue.value.filter((_, i) => i !== index),
  );
}
</script>

<style scoped lang="scss">
.plugin-schema-field {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-2);
  width: 100%;
  min-width: 0;
  &__row {
    display: flex;
    align-items: flex-start;
    gap: var(--tb-space-2);
    padding-left: var(--tb-space-2);
    border-left: 1px solid var(--tb-border);
  }
  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }
}
</style>
