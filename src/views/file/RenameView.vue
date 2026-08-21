<template>
  <ToolPageLayout
    title="批量重命名"
    desc="用规则链批量改名：序号、查找替换、大小写、扩展名可自由组合，改前先看预览"
    category="文件工具"
  >
    <!-- 操作栏 -->
    <template #toolbar>
      <n-space align="center">
        <n-button type="primary" :disabled="running" @click="handlePickFiles">
          <template #icon><n-icon :component="DocumentOutline" /></template>
          添加文件
        </n-button>
        <n-button :disabled="running" :loading="scanning" @click="handlePickDir">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          添加文件夹
        </n-button>
        <n-checkbox
          v-model:checked="config.recursive"
          :disabled="running"
          class="rename__recursive"
        >
          含子文件夹
        </n-checkbox>
        <n-button :disabled="!checkedKeys.length || running" @click="handleRemoveChecked">
          <template #icon><n-icon :component="RemoveCircleOutline" /></template>
          移除选中 ({{ checkedKeys.length }})
        </n-button>
        <n-button quaternary :disabled="!items.length || running" @click="handleClear">
          <template #icon><n-icon :component="TrashOutline" /></template>
          清空
        </n-button>
        <n-button :disabled="!undoRecord.length || running" @click="handleUndo">
          <template #icon><n-icon :component="ArrowUndoOutline" /></template>
          撤销上一批{{ undoRecord.length ? ` (${undoRecord.length})` : '' }}
        </n-button>
      </n-space>
    </template>

    <!-- 文件列表 -->
    <template #main>
      <div
        class="rename__main"
        :class="{ 'rename__main--dragover': isDragOver }"
        v-bind="dropHandlers"
      >
        <n-data-table
          v-if="rows.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="rows"
          :row-key="rowKey"
          :row-class-name="rowClassName"
          flex-height
          class="rename__table"
          @update:sorter="handleSorterChange"
        />
        <div v-else class="rename__placeholder">
          <n-icon :size="40" :depth="3" :component="DocumentOutline" />
          <p>拖入文件，或点击上方按钮添加</p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <div class="rename__panel-head">
        <h3 class="rename__panel-title">规则链</h3>
        <span class="rename__hint rename__hint--inline">自上而下依次施加</span>
      </div>

      <p v-if="!config.rules.length" class="rename__hint">
        还没有规则，下面加一条试试。规则会一直记住，下次进来还在。
      </p>

      <div
        v-for="(rule, index) in config.rules"
        :key="rule.id"
        class="rename__rule"
        :class="{ 'rename__rule--dragging': draggingIndex === index }"
        :draggable="draggableId === rule.id"
        @dragstart="handleDragStart(index)"
        @dragover.prevent="handleDragOver(index)"
        @dragend="handleDragEnd"
      >
        <div class="rename__rule-head">
          <n-icon
            class="rename__rule-handle"
            :component="ReorderTwoOutline"
            title="拖动调整顺序"
            @mousedown="draggableId = rule.id"
          />
          <span class="rename__rule-title">{{ RULE_LABELS[rule.kind] }}</span>
          <n-switch v-model:value="rule.enabled" size="small" />
          <n-button text size="tiny" title="删除该规则" @click="removeRule(rule.id)">
            <n-icon :component="CloseOutline" />
          </n-button>
        </div>

        <!-- 设置名称（整名替换） -->
        <template v-if="rule.kind === 'name'">
          <n-input
            v-model:value="rule.name.text"
            size="small"
            placeholder="新名字，如 照片_{n}"
            class="rename__rule-field"
          />
          <p class="rename__rule-tip">整名替换，可用 {n} {name} {parent} {date}</p>
        </template>

        <!-- 插入文本 -->
        <template v-else-if="rule.kind === 'insert'">
          <n-select
            v-model:value="rule.insert.position"
            :options="INSERT_POSITION_OPTIONS"
            size="small"
            class="rename__rule-field"
          />
          <n-input-number
            v-if="rule.insert.position === 'index'"
            v-model:value="rule.insert.index"
            :min="0"
            size="small"
            class="rename__rule-field"
          />
          <n-input
            v-model:value="rule.insert.text"
            size="small"
            placeholder="文本，可用 {n} {name} …"
            class="rename__rule-field"
          />
        </template>

        <!-- 查找替换 -->
        <template v-else-if="rule.kind === 'replace'">
          <n-input
            v-model:value="rule.replace.find"
            size="small"
            placeholder="查找"
            :status="ruleErrors[rule.id] ? 'error' : undefined"
            class="rename__rule-field"
          />
          <p v-if="ruleErrors[rule.id]" class="rename__rule-error">表达式无效，该规则已跳过</p>
          <n-input
            v-model:value="rule.replace.replaceWith"
            size="small"
            placeholder="替换为（留空即删除）"
            class="rename__rule-field"
          />
          <div class="rename__rule-checks">
            <n-checkbox v-model:checked="rule.replace.regex" size="small">正则</n-checkbox>
            <n-checkbox v-model:checked="rule.replace.caseSensitive" size="small">
              区分大小写
            </n-checkbox>
            <n-checkbox v-model:checked="rule.replace.all" size="small">替换全部</n-checkbox>
          </div>
        </template>

        <!-- 大小写 -->
        <template v-else-if="rule.kind === 'case'">
          <n-select
            v-model:value="rule.case.mode"
            :options="CASE_OPTIONS"
            size="small"
            class="rename__rule-field"
          />
        </template>

        <!-- 删除字符 -->
        <template v-else-if="rule.kind === 'trim'">
          <n-select
            v-model:value="rule.trim.mode"
            :options="TRIM_OPTIONS"
            size="small"
            class="rename__rule-field"
          />
          <n-input-number
            v-if="rule.trim.mode === 'head' || rule.trim.mode === 'tail'"
            v-model:value="rule.trim.count"
            :min="0"
            size="small"
            class="rename__rule-field"
          />
          <div v-else-if="rule.trim.mode === 'range'" class="rename__rule-range">
            <n-input-number v-model:value="rule.trim.from" :min="1" size="small" />
            <span class="rename__rule-sep">–</span>
            <n-input-number v-model:value="rule.trim.to" :min="1" size="small" />
          </div>
        </template>

        <!-- 扩展名 -->
        <template v-else>
          <n-select
            v-model:value="rule.extension.mode"
            :options="EXTENSION_OPTIONS"
            size="small"
            class="rename__rule-field"
          />
          <n-input
            v-if="rule.extension.mode === 'set'"
            v-model:value="rule.extension.value"
            size="small"
            placeholder="新扩展名，如 jpg"
            class="rename__rule-field"
          />
        </template>
      </div>

      <n-dropdown trigger="click" :options="ADD_RULE_OPTIONS" @select="addRule">
        <n-button dashed block size="small">
          <template #icon><n-icon :component="AddOutline" /></template>
          添加规则
        </n-button>
      </n-dropdown>

      <n-divider class="rename__divider" />

      <h3 class="rename__panel-title">序号设置</h3>
      <p class="rename__hint">{n} 按下面的排序依次取值</p>

      <div class="rename__field rename__field--row">
        <label class="rename__label">起始值</label>
        <n-input-number
          v-model:value="config.numbering.start"
          :min="0"
          size="small"
          class="rename__num"
        />
      </div>
      <div class="rename__field rename__field--row">
        <label class="rename__label">步长</label>
        <n-input-number
          v-model:value="config.numbering.step"
          :min="1"
          size="small"
          class="rename__num"
        />
      </div>
      <div class="rename__field rename__field--row">
        <label class="rename__label">补零位数</label>
        <n-input-number
          v-model:value="config.numbering.padding"
          :min="1"
          :max="10"
          size="small"
          class="rename__num"
        />
      </div>
      <div class="rename__field">
        <label class="rename__label">排序依据</label>
        <n-select v-model:value="config.sortBy" :options="SORT_OPTIONS" size="small" />
      </div>
      <div class="rename__field rename__field--row">
        <label class="rename__label">降序</label>
        <n-switch v-model:value="config.sortDesc" size="small" />
      </div>

      <n-divider class="rename__divider" />

      <h3 class="rename__panel-title">选项</h3>

      <div class="rename__field rename__field--row">
        <label class="rename__label">规则作用于扩展名</label>
        <n-switch v-model:value="config.includeExt" size="small" />
      </div>
      <p class="rename__hint">撤销记录只在本页停留期间有效，离开页面即失效。</p>
    </template>

    <!-- 底部 -->
    <template #footer>
      <div class="rename__footer">
        <div class="rename__stats">
          <span>{{ rows.length }} 个文件</span>
          <span>{{ changedCount }} 个将被重命名</span>
          <span v-if="issueCount" class="rename__stats-bad">{{ issueCount }} 个有问题</span>
        </div>
        <n-button type="primary" :disabled="!canStart" :loading="running" @click="handleStart">
          开始重命名
        </n-button>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, h, ref } from 'vue';
import {
  NButton,
  NCheckbox,
  NDataTable,
  NDivider,
  NDropdown,
  NIcon,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NTooltip,
  useDialog,
  useMessage,
  type DataTableColumns,
  type DataTableSortState,
} from 'naive-ui';
import {
  AddOutline,
  ArrowUndoOutline,
  CloseOutline,
  DocumentOutline,
  FolderOpenOutline,
  OpenOutline,
  RemoveCircleOutline,
  ReorderTwoOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { PickedFile, RenameConflict, RenameDone } from '@shared/types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickFilesApi } from '@/services/fs';
import { renameBatchApi, showInFolderApi } from '@/services/file';
import { formatBytes, formatDateTime } from '@/utils/format';
import { basenameOf, dirnameOf } from '@/utils/path';
import {
  applyRules,
  createRule,
  normalizeRules,
  sortRows,
  validateNames,
  type RenameRule,
  type RenameRuleKind,
  type RenameSortBy,
} from '@/utils/rename';
import type { RenameItem } from './types';

/** 表格一行：列表项 + 算好的新名与问题。 */
interface RenameRow extends RenameItem {
  /** 规则链算出的新文件名。 */
  newName: string;
  /** 校验出的问题；无问题为空串。 */
  issue: string;
  /** 新名与当前名是否不同。 */
  changed: boolean;
}

// #region constants
/** 添加文件夹时的扫描上限。重命名是逐个 syscall，量级比只读统计小得多。 */
const MAX_FILES = 50_000;

/** 规则种类的显示名。 */
const RULE_LABELS: Record<RenameRuleKind, string> = {
  name: '设置名称',
  insert: '插入文本',
  replace: '查找替换',
  case: '大小写',
  trim: '删除字符',
  extension: '扩展名',
};

/** 「添加规则」下拉项。「插入序号」只是预填 {n} 的插入规则，机制不另起一套。 */
const ADD_RULE_OPTIONS = [
  { label: '设置名称（整名替换）', key: 'name' },
  { label: '插入序号', key: 'serial' },
  { label: '插入文本', key: 'insert' },
  { label: '查找替换', key: 'replace' },
  { label: '大小写', key: 'case' },
  { label: '删除字符', key: 'trim' },
  { label: '扩展名', key: 'extension' },
];

const INSERT_POSITION_OPTIONS = [
  { label: '放在开头', value: 'start' },
  { label: '放在结尾', value: 'end' },
  { label: '第 N 个字符后', value: 'index' },
];

const CASE_OPTIONS = [
  { label: '全部小写', value: 'lower' },
  { label: '全部大写', value: 'upper' },
  { label: '句首大写', value: 'sentence' },
  { label: '每词首字母大写', value: 'title' },
];

const TRIM_OPTIONS = [
  { label: '去掉首尾空格', value: 'spaces' },
  { label: '从头删除 N 个', value: 'head' },
  { label: '从尾删除 N 个', value: 'tail' },
  { label: '删除指定区间', value: 'range' },
];

const EXTENSION_OPTIONS = [
  { label: '转为小写', value: 'lower' },
  { label: '转为大写', value: 'upper' },
  { label: '改为指定值', value: 'set' },
  { label: '移除扩展名', value: 'remove' },
];

const SORT_OPTIONS = [
  { label: '文件名（自然排序）', value: 'name' },
  { label: '修改时间', value: 'mtime' },
  { label: '文件大小', value: 'size' },
  { label: '添加顺序', value: 'added' },
];
// #endregion

// #region state
const message = useMessage();
const dialog = useDialog();

/** 持久化配置。规则链是本页最值钱的用户输入，一套调好的规则会反复用。 */
const { config } = useToolConfig('file-rename', {
  rules: [] as RenameRule[],
  numbering: { start: 1, step: 1, padding: 2 },
  sortBy: 'name' as RenameSortBy,
  sortDesc: false,
  includeExt: false,
  recursive: false,
});

// 存储里读回的老规则可能缺新加的字段，补齐后再交给模板
config.rules = normalizeRules(config.rules);

/** 从文件夹添加（与图片三页共用实现）。重命名不限扩展名，不传 accept。 */
const { scanning, importFolder } = useFolderImport({
  key: 'rename',
  maxFiles: MAX_FILES,
  title: '选择要重命名的文件夹',
});

const items = ref<RenameItem[]>([]);
const checkedKeys = ref<string[]>([]);
const running = ref(false);
/** 上一批成功改名的记录，反向即为撤销。 */
const undoRecord = ref<RenameDone[]>([]);
/** 拖拽中的规则下标。 */
const draggingIndex = ref(-1);
/** 当前允许拖拽的规则 id：按住手柄才置起，免得拖输入框里的文字也触发排序。 */
const draggableId = ref('');

let seq = 0;

const { isDragOver, handlers: dropHandlers } = useFileDrop({ onDrop: addFiles });
// #endregion

// #region getters
/** 按面板设置排好序的列表。 */
const sortedItems = computed(() => sortRows(items.value, config.sortBy, config.sortDesc));

/** 规则链的计算结果：纯字符串运算、无 IPC，改一个字符即整表重算。 */
const computation = computed(() =>
  applyRules(sortedItems.value, config.rules, {
    numbering: config.numbering,
    includeExt: config.includeExt,
  }),
);

const ruleErrors = computed(() => computation.value.ruleErrors);

const rows = computed<RenameRow[]>(() => {
  const { names } = computation.value;
  const issues = validateNames(sortedItems.value, names);
  return sortedItems.value.map((item, index) => {
    const newName = names[index] ?? item.name;
    return { ...item, newName, issue: issues[index] ?? '', changed: newName !== item.name };
  });
});

const changedCount = computed(() => rows.value.filter((row) => row.changed).length);
const issueCount = computed(() => rows.value.filter((row) => row.issue).length);

/** 有问题就不给点，不留「点了才知道不行」的机会。 */
const canStart = computed(() => !running.value && changedCount.value > 0 && issueCount.value === 0);
// #endregion

// #region table
/**
 * 表格行 key。
 * @param row 行数据。
 * @returns 唯一 id。
 */
function rowKey(row: RenameRow): string {
  return row.id;
}

/**
 * 有问题的行整行标红，一眼能定位。
 * @param row 行数据。
 * @returns 行 class。
 */
function rowClassName(row: RenameRow): string {
  return row.issue ? 'rename__row--bad' : '';
}

/**
 * 算出某列当前的排序状态。
 * 排序的唯一真相是面板配置，表头只是它的另一个入口——{n} 取值依赖顺序，不能有两套。
 * @param by 该列对应的排序依据。
 * @returns naive-ui 的 sortOrder。
 */
function sortOrderOf(by: RenameSortBy): 'ascend' | 'descend' | false {
  if (config.sortBy !== by) return false;
  return config.sortDesc ? 'descend' : 'ascend';
}

const columns = computed<DataTableColumns<RenameRow>>(() => [
  { type: 'selection' },
  { title: '#', key: 'index', width: 48, render: (_row, index) => index + 1 },
  {
    title: '原文件名',
    key: 'name',
    ellipsis: { tooltip: true },
    sorter: true,
    sortOrder: sortOrderOf('name'),
  },
  {
    title: '',
    key: 'arrow',
    width: 32,
    align: 'center',
    render: (row) => (row.changed ? '→' : ''),
  },
  {
    title: '新文件名',
    key: 'newName',
    render: (row) => {
      if (row.issue) {
        return h(NTooltip, null, {
          trigger: () =>
            h('span', { class: 'rename__cell rename__cell--bad' }, row.newName || '（空）'),
          default: () => row.issue,
        });
      }
      const cls = row.changed ? 'rename__cell rename__cell--changed' : 'rename__cell';
      return h('span', { class: cls }, row.newName);
    },
  },
  {
    title: '大小',
    key: 'size',
    width: 96,
    sorter: true,
    sortOrder: sortOrderOf('size'),
    render: (row) => formatBytes(row.size),
  },
  {
    title: '修改时间',
    key: 'mtime',
    width: 156,
    sorter: true,
    sortOrder: sortOrderOf('mtime'),
    render: (row) => formatDateTime(row.mtime),
  },
  {
    title: '状态',
    key: 'status',
    width: 88,
    render: (row) =>
      row.error
        ? h(NTooltip, null, {
            trigger: () => h(StatusTag, { status: row.status }),
            default: () => row.error,
          })
        : h(StatusTag, { status: row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 76,
    align: 'center',
    render: (row) =>
      h(NSpace, { size: 4, justify: 'center', wrap: false }, () => [
        h(
          NButton,
          {
            text: true,
            size: 'small',
            title: '在资源管理器中定位',
            onClick: () => void showInFolderApi(row.path),
          },
          { icon: () => h(NIcon, { component: OpenOutline }) },
        ),
        h(
          NButton,
          { text: true, size: 'small', title: '移出列表', onClick: () => removeItem(row.id) },
          { icon: () => h(NIcon, { component: CloseOutline }) },
        ),
      ]),
  },
]);

/**
 * 表头点击排序：写回面板配置，保证序号取值顺序只有一个来源。
 * @param state naive-ui 给出的排序状态。
 */
function handleSorterChange(state: DataTableSortState | DataTableSortState[] | null): void {
  const current = Array.isArray(state) ? state[0] : state;
  if (!current || !current.order) {
    config.sortBy = 'added';
    config.sortDesc = false;
    return;
  }
  config.sortBy = current.columnKey as RenameSortBy;
  config.sortDesc = current.order === 'descend';
}
// #endregion

// #region list
/**
 * 把选中的文件并入列表（按路径忽略大小写去重）。
 * @param files 新增文件。
 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((item) => item.path.toLowerCase()));
  const added: RenameItem[] = [];
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    added.push({
      ...file,
      id: `rn-${(seq += 1)}`,
      status: 'pending',
      dir: dirnameOf(file.path),
      mtime: file.mtime,
      order: items.value.length + added.length,
    });
  }
  if (added.length) items.value = [...items.value, ...added];
}

/** 选择文件加入列表。 */
async function handlePickFiles(): Promise<void> {
  const files = await pickFilesApi({ title: '选择要重命名的文件' });
  if (files.length) addFiles(files);
}

/** 选择文件夹，把其中的文件加入列表。 */
async function handlePickDir(): Promise<void> {
  const files = await importFolder(config.recursive);
  if (files.length) addFiles(files);
}

/**
 * 从列表移除一项。
 * @param id 列表项 id。
 */
function removeItem(id: string): void {
  items.value = items.value.filter((item) => item.id !== id);
  checkedKeys.value = checkedKeys.value.filter((key) => key !== id);
}

/** 移除全部勾选项。 */
function handleRemoveChecked(): void {
  const checked = new Set(checkedKeys.value);
  items.value = items.value.filter((item) => !checked.has(item.id));
  checkedKeys.value = [];
}

/** 清空列表。 */
function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
}
// #endregion

// #region rules
/**
 * 追加一条规则。
 * @param key 下拉项 key；'serial' 是预填 {n} 的插入规则。
 */
function addRule(key: string): void {
  const id = `rule-${Date.now()}-${config.rules.length}`;
  if (key === 'serial') {
    const rule = createRule('insert', id);
    rule.insert.position = 'start';
    rule.insert.text = '{n}_';
    config.rules.push(rule);
    return;
  }
  config.rules.push(createRule(key as RenameRuleKind, id));
}

/**
 * 删除一条规则。
 * @param id 规则 id。
 */
function removeRule(id: string): void {
  config.rules = config.rules.filter((rule) => rule.id !== id);
}

/**
 * 开始拖拽规则。
 * @param index 规则下标。
 */
function handleDragStart(index: number): void {
  draggingIndex.value = index;
}

/**
 * 拖过另一条规则时立刻换位，松手即定稿（列表很短，不额外画落点指示线）。
 * @param index 悬停位置的下标。
 */
function handleDragOver(index: number): void {
  const from = draggingIndex.value;
  if (from < 0 || from === index) return;
  const next = [...config.rules];
  const [moved] = next.splice(from, 1);
  if (!moved) return;
  next.splice(index, 0, moved);
  config.rules = next;
  draggingIndex.value = index;
}

/** 结束拖拽。 */
function handleDragEnd(): void {
  draggingIndex.value = -1;
  draggableId.value = '';
}
// #endregion

// #region rename
/**
 * 把主进程返回的冲突逐行标到列表上。
 * @param conflicts 冲突项。
 */
function markConflicts(conflicts: RenameConflict[]): void {
  const reasons = new Map(conflicts.map((item) => [item.path.toLowerCase(), item.reason]));
  items.value = items.value.map((item) => {
    const reason = reasons.get(item.path.toLowerCase());
    return reason
      ? { ...item, status: 'error' as const, error: reason }
      : { ...item, status: 'pending' as const, error: undefined };
  });
}

/** 点「开始重命名」：先二次确认，再落盘。 */
function handleStart(): void {
  const targets = rows.value.filter((row) => row.changed);
  if (!targets.length) return;

  dialog.warning({
    title: '确认重命名',
    content: `将重命名 ${targets.length} 个文件。这会直接改动磁盘上的原文件，只能在本页用「撤销上一批」回滚。`,
    positiveText: '确认重命名',
    negativeText: '取消',
    onPositiveClick: () => {
      void runRename(targets);
    },
  });
}

/**
 * 调用主进程落盘并回写列表。
 * @param targets 要改名的行。
 */
async function runRename(targets: RenameRow[]): Promise<void> {
  running.value = true;
  try {
    const result = await renameBatchApi(
      targets.map((row) => ({ path: row.path, newName: row.newName })),
    );

    if (result.conflicts.length) {
      markConflicts(result.conflicts);
      message.error(`${result.conflicts.length} 项存在冲突，整批未执行`);
      return;
    }

    // 只按 done 回写路径：真改成功的才更新，失败的保持原样，列表不会与盘上脱节
    const doneMap = new Map(result.done.map((item) => [item.from.toLowerCase(), item.to]));
    const failMap = new Map(result.failures.map((item) => [item.path.toLowerCase(), item.reason]));
    items.value = items.value.map((item) => {
      const to = doneMap.get(item.path.toLowerCase());
      if (to) {
        return {
          ...item,
          path: to,
          name: basenameOf(to),
          dir: dirnameOf(to),
          status: 'done' as const,
          error: undefined,
        };
      }
      const reason = failMap.get(item.path.toLowerCase());
      return reason ? { ...item, status: 'error' as const, error: reason } : item;
    });

    undoRecord.value = result.done;

    if (result.failures.length) {
      message.warning(`成功 ${result.done.length} 项，失败 ${result.failures.length} 项`);
    } else {
      message.success(`已重命名 ${result.done.length} 个文件`);
    }
  } catch {
    // 错误提示已由 services 统一弹出
  } finally {
    running.value = false;
  }
}

/** 撤销上一批：把 done 反过来再走一次同一个 renameBatch，pre-flight 与两趟改名原样复用。 */
async function handleUndo(): Promise<void> {
  if (!undoRecord.value.length) return;
  running.value = true;
  try {
    const result = await renameBatchApi(
      undoRecord.value.map((item) => ({ path: item.to, newName: basenameOf(item.from) })),
    );

    if (result.conflicts.length) {
      message.error(`${result.conflicts.length} 项无法撤销（文件可能已被别处改动），整批未执行`);
      return;
    }

    const doneMap = new Map(result.done.map((item) => [item.from.toLowerCase(), item.to]));
    items.value = items.value.map((item) => {
      const to = doneMap.get(item.path.toLowerCase());
      if (!to) return item;
      return {
        ...item,
        path: to,
        name: basenameOf(to),
        dir: dirnameOf(to),
        status: 'pending' as const,
        error: undefined,
      };
    });

    // 不做多级撤销：撤完即清，免得给出「还能再退一步」的错觉
    undoRecord.value = [];
    if (result.failures.length) {
      message.warning(`撤销 ${result.done.length} 项，失败 ${result.failures.length} 项`);
    } else {
      message.success(`已撤销 ${result.done.length} 个文件`);
    }
  } catch {
    // 错误提示已由 services 统一弹出
  } finally {
    running.value = false;
  }
}
// #endregion
</script>

<style scoped lang="scss">
.rename {
  &__main {
    flex: 1;
    min-height: 0;
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    transition: border-color 0.2s;

    &--dragover {
      border-color: var(--tb-color-primary);
    }
  }

  &__table {
    height: 100%;
  }

  // 「含子文件夹」只服务于旁边的「添加文件夹」，压暗一档避免与主操作抢注意力
  &__recursive {
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);

    p {
      margin: 0;
    }
  }

  &__panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--tb-space-2);
  }

  &__panel-title {
    margin: 0 0 4px;
    font-size: 14px;
    color: var(--tb-text-primary);
  }

  &__hint {
    margin: 0 0 var(--tb-space-3);
    font-size: 12px;
    line-height: 1.5;
    color: var(--tb-text-secondary);

    &--inline {
      margin: 0;
    }
  }

  &__rule {
    margin-bottom: var(--tb-space-2);
    padding: var(--tb-space-2);
    background: var(--tb-bg-elevated);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);

    &--dragging {
      opacity: 0.4;
    }
  }

  &__rule-head {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  &__rule-handle {
    color: var(--tb-text-secondary);
    cursor: grab;
  }

  &__rule-title {
    flex: 1;
    font-size: 13px;
    color: var(--tb-text-primary);
  }

  &__rule-field {
    margin-bottom: var(--tb-space-2);
  }

  &__rule-range {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  &__rule-sep {
    color: var(--tb-text-secondary);
  }

  &__rule-checks {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
  }

  &__rule-error {
    margin: -4px 0 var(--tb-space-2);
    font-size: 12px;
    color: var(--tb-color-error, #e88080);
  }

  &__rule-tip {
    margin: -4px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--tb-text-secondary);
  }

  &__divider {
    margin: var(--tb-space-4) 0;
  }

  &__field {
    margin-bottom: var(--tb-space-3);

    &--row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--tb-space-2);
    }
  }

  &__label {
    display: block;
    margin-bottom: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__field--row &__label {
    margin-bottom: 0;
  }

  &__num {
    width: 108px;
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__stats {
    display: flex;
    align-items: center;
    gap: var(--tb-space-4);
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__stats-bad {
    color: var(--tb-color-error, #e88080);
  }
}
</style>

<style lang="scss">
/* 单元格由 render 函数生成，落在 scoped 作用域外 */
.rename__cell--changed {
  color: var(--tb-color-primary);
}

.rename__cell--bad {
  color: var(--tb-color-error, #e88080);
}

.rename__row--bad .n-data-table-td {
  background-color: rgb(232 128 128 / 8%);
}
</style>
