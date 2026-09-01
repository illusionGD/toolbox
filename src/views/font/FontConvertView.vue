<template>
  <ToolPageLayout
    title="字体格式转换"
    desc="批量把字体转成 TTF / WOFF / WOFF2，字形一个不丢"
    category="字体工具"
  >
    <template #toolbar>
      <n-space align="center">
        <n-button type="primary" @click="handleAddFiles">
          <template #icon><n-icon :component="CloudUploadOutline" /></template>
          添加字体
        </n-button>
        <n-button :loading="scanning" @click="handleAddFolder">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          添加文件夹
        </n-button>
        <n-checkbox v-model:checked="config.recursive" class="font__dim">含子文件夹</n-checkbox>
        <n-button quaternary :disabled="!checkedKeys.length" @click="handleRemoveChecked">
          移除选中{{ checkedKeys.length ? `(${checkedKeys.length})` : '' }}
        </n-button>
        <n-button quaternary :disabled="!items.length" @click="handleClear">清空</n-button>
      </n-space>
    </template>

    <template #main>
      <div class="font__main" :class="{ 'font__main--drag': isDragOver }" v-bind="dropHandlers">
        <n-data-table
          v-if="items.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="items"
          :row-key="(row: FontConvertItem) => row.id"
          :pagination="pagination"
          flex-height
          class="font__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="font__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽字体文件到此处，或点击「添加字体」（TTF / OTF / WOFF / WOFF2）</p>
        </div>
      </div>
    </template>

    <template #panel>
      <h3 class="font__ptitle">目标格式</h3>
      <div class="font__field">
        <n-checkbox-group v-model:value="config.formats">
          <n-space size="small">
            <n-checkbox v-for="f in FORMAT_OPTIONS" :key="f.value" :value="f.value">
              {{ f.label }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
        <p class="font__tip">勾几个就各出一份，一次读取多次输出。</p>
      </div>

      <h3 class="font__ptitle font__ptitle--sub">输出</h3>
      <div class="font__field">
        <label class="font__label">输出目录（留空 = 源文件所在目录）</label>
        <div class="font__dir">
          <n-input
            v-model:value="config.outputDir"
            size="small"
            placeholder="留空则输出到源文件同目录"
          />
          <n-button size="small" @click="pickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
          <n-button v-if="config.outputDir" size="small" quaternary @click="config.outputDir = ''">
            清除
          </n-button>
        </div>
      </div>
      <div class="font__field font__field--row">
        <label class="font__label">覆盖同名文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>
      <p class="font__tip">
        源文件本身永不被改写：若目标就是源文件（如 a.ttf 转 TTF 且输出到同目录），该格式记为跳过。
      </p>

      <n-button
        type="primary"
        block
        class="font__mt"
        :loading="processing"
        :disabled="!canStart"
        @click="handleStart"
      >
        {{ startLabel }}
      </n-button>
      <n-button v-if="processing" block quaternary class="font__mt" @click="handleCancel">
        取消
      </n-button>
      <p v-if="processing" class="font__tip">
        取消会在当前格式转换完成后生效（WOFF2 编码不可中断，大字体可能要等十几秒）。
      </p>
    </template>

    <template #footer>
      <div class="font__footer">
        <span>已选择 {{ items.length }} 个字体</span>
        <div class="font__footer-stats">
          <span>完成 {{ doneCount }} / {{ items.length }}</span>
          <span v-if="failedCount">失败 {{ failedCount }}</span>
          <span v-if="skippedCount">跳过 {{ skippedCount }}</span>
          <span>产出 {{ outputCount }} 个文件 {{ formatBytes(totalOutput) }}</span>
        </div>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NDataTable,
  NIcon,
  NInput,
  NSpace,
  NSwitch,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { CloudUploadOutline, FolderOpenOutline } from '@vicons/ionicons5';
import type { FontConvertFormat, PickedFile } from '@shared/types';
import type { FontConvertItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  cancelFontConvertApi,
  convertFontApi,
  onFontConvertProgress,
  probeFontApi,
} from '@/services/font';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

const message = useMessage();

const ACCEPT = ['ttf', 'otf', 'woff', 'woff2'];
const PAGE_SIZE = 50;
const MAX_FILES = 5_000;

/** 可选目标格式。没有 otf：轮廓格式互转做不到，给了就是骗人。 */
const FORMAT_OPTIONS: { label: string; value: FontConvertFormat }[] = [
  { label: 'TTF', value: 'ttf' },
  { label: 'WOFF', value: 'woff' },
  { label: 'WOFF2', value: 'woff2' },
];

/** 源容器格式的展示名。fontverter 的 sfnt 对用户来说就是 ttf/otf 这类。 */
const SOURCE_FORMAT_LABEL: Record<string, string> = {
  sfnt: 'TTF / OTF',
  woff: 'WOFF',
  woff2: 'WOFF2',
};

const items = ref<FontConvertItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;

const { config } = useToolConfig('font-convert', {
  formats: ['woff2'] as FontConvertFormat[],
  outputDir: '',
  overwrite: false,
  recursive: false,
});

const { scanning, importFolder } = useFolderImport({
  key: 'font',
  accept: ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择字体文件夹',
});

// #region 列表
const probeQueue = createTaskQueue(4);
const probeRequested = new Set<string>();

const pagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  showQuickJumper: true,
  prefix: ({ itemCount }: { itemCount?: number }) => `共 ${itemCount ?? 0} 个`,
});
watch(
  () => items.value.length,
  (count) => {
    pagination.itemCount = count;
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (pagination.page > pageCount) pagination.page = pageCount;
  },
  { immediate: true },
);

const visibleItems = computed(() =>
  items.value.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE),
);

// 只为当前页的行探测元信息（文件夹导入可能上千个，全量探测会卡死）
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (row.probed || probeRequested.has(row.id)) continue;
      probeRequested.add(row.id);
      const { id, path } = row;
      probeQueue.push(async () => {
        const meta = await probeFontApi(path).catch(() => null);
        // await 期间用户可能已移除该行，按 id 重查
        const target = items.value.find((i) => i.id === id);
        if (!target) return;
        if (meta) {
          target.fontName = meta.familyName;
          target.glyphCount = meta.glyphCount;
        }
        target.probed = true;
      });
    }
  },
  { immediate: true },
);

const columns: DataTableColumns<FontConvertItem> = [
  { type: 'selection' },
  {
    title: '字体名',
    key: 'fontName',
    minWidth: 150,
    ellipsis: { tooltip: true },
    render: (row) => row.fontName || row.name,
  },
  {
    title: '源格式',
    key: 'sourceFormat',
    width: 100,
    render: (row) => {
      // 转换后用主进程探测到的真实容器格式，转换前按扩展名先给个近似值
      if (row.sourceFormat) return SOURCE_FORMAT_LABEL[row.sourceFormat] ?? row.sourceFormat;
      return row.ext.toUpperCase();
    },
  },
  { title: '原大小', key: 'size', width: 90, render: (row) => formatBytes(row.size) },
  {
    title: '字形数',
    key: 'glyphCount',
    width: 80,
    render: (row) => (row.probed ? (row.glyphCount ?? 0) : '—'),
  },
  {
    title: '产物',
    key: 'outputs',
    minWidth: 220,
    render: (row) => {
      const parts: ReturnType<typeof h>[] = [];
      for (const file of row.outputs ?? []) {
        parts.push(
          h(
            'span',
            { class: 'font__out', key: file.format },
            `${file.format} ${formatBytes(file.size)}`,
          ),
        );
      }
      for (const format of row.skipped ?? []) {
        parts.push(
          h('span', { class: 'font__out font__out--skip', key: `s-${format}` }, `${format} 跳过`),
        );
      }
      if (!parts.length) return '—';
      return h('div', { class: 'font__outs' }, parts);
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 116,
    render: (row) => {
      const tag =
        row.status === 'error' && row.error
          ? h(NTooltip, null, {
              trigger: () => h(StatusTag, { status: row.status }),
              default: () => row.error,
            })
          : h(StatusTag, { status: row.status });
      // 进度只到「第几个格式」这一粒度：fontverter 的转换是一次不可分割的调用，
      // 没有内部进度可读，与其编个假百分比不如告诉用户正在转哪个格式
      if (row.status === 'processing' && row.currentFormat) {
        return h('div', { class: 'font__status' }, [
          tag,
          h('span', { class: 'font__step' }, `${row.currentFormat} ${row.formatStep ?? ''}`),
        ]);
      }
      return tag;
    },
  },
];
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => addFiles(files),
});
// #endregion

// #region getters
const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length);
const failedCount = computed(() => items.value.filter((i) => i.status === 'error').length);
const skippedCount = computed(() => items.value.reduce((s, i) => s + (i.skipped?.length ?? 0), 0));
const outputCount = computed(() => items.value.reduce((s, i) => s + (i.outputs?.length ?? 0), 0));
const totalOutput = computed(() =>
  items.value.reduce((s, i) => s + (i.outputs ?? []).reduce((a, f) => a + f.size, 0), 0),
);

const canStart = computed(
  () => items.value.length > 0 && !processing.value && config.formats.length > 0,
);

const startLabel = computed(() => {
  if (!config.formats.length) return '请选择目标格式';
  return checkedKeys.value.length ? `转换选中 (${checkedKeys.value.length})` : '开始转换';
});
// #endregion

// #region 进度订阅
/** 当前在跑的任务 id，用于过滤过期推送。 */
const currentTaskId = ref('');
/** 正在处理的行 id（进度推送只带 taskId 不带行信息，靠这个定位）。 */
let currentRowId = '';
/** 用户是否点了取消（拦下后续未开始的字体）。 */
let canceledByUser = false;
let stopProgress: (() => void) | null = null;

onMounted(() => {
  stopProgress = onFontConvertProgress((p) => {
    if (p.taskId !== currentTaskId.value) return;
    const row = items.value.find((i) => i.id === currentRowId);
    if (!row) return;
    row.currentFormat = p.format;
    row.formatStep = `${p.done + 1}/${p.total}`;
  });
});

onBeforeUnmount(() => {
  stopProgress?.();
  stopProgress = null;
  // 离开页面时把在跑的任务标记取消，否则主进程会继续转完整批
  if (processing.value && currentTaskId.value) void cancelFontConvertApi(currentTaskId.value);
  canceledByUser = true;
});
// #endregion

// #region actions
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;
  for (const file of fresh) {
    items.value.push({ ...file, id: `fc-${seq++}`, status: 'pending' });
  }
}

async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '字体', extensions: ACCEPT }],
    title: '选择要转换的字体',
  });
  if (files.length) addFiles(files);
}

async function handleAddFolder(): Promise<void> {
  const before = items.value.length;
  const files = await importFolder(config.recursive);
  if (!files.length) return;
  addFiles(files);
  const added = items.value.length - before;
  if (added) message.success(`已添加 ${added} 个字体`);
  else message.info('这些字体已在列表中');
}

function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
  probeQueue.clear();
  probeRequested.clear();
}

function handleRemoveChecked(): void {
  const removing = new Set(checkedKeys.value);
  items.value = items.value.filter((i) => !removing.has(i.id));
  checkedKeys.value = [];
}

async function pickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/** 取消：置标记 + 通知主进程，当前格式转完即停。 */
async function handleCancel(): Promise<void> {
  canceledByUser = true;
  if (currentTaskId.value) await cancelFontConvertApi(currentTaskId.value);
  message.info('已请求取消，当前格式转换完成后停止');
}

/**
 * 开始转换：有勾选只转选中，否则全部。
 *
 * 严格串行：WOFF2 编码吃满单核（9.7MB 中文字体约 12s），并发只会互相抢 CPU。
 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;
  processing.value = true;
  canceledByUser = false;
  let okFiles = 0;
  let failed = 0;
  let canceled = false;
  let lastError = '';
  try {
    for (const item of targets) {
      if (canceledByUser) {
        canceled = true;
        break;
      }
      const taskId = `fc-${Date.now()}-${seq++}`;
      currentTaskId.value = taskId;
      currentRowId = item.id;
      item.status = 'processing';
      item.error = undefined;
      item.outputs = [];
      item.skipped = [];
      try {
        const result = await convertFontApi(item.path, {
          taskId,
          formats: config.formats,
          outputDir: config.outputDir,
          overwrite: config.overwrite,
        });
        item.sourceFormat = result.sourceFormat;
        item.glyphCount = result.glyphCount;
        item.probed = true;
        item.outputs = result.files;
        item.skipped = result.skipped;
        okFiles += result.files.length;
        if (result.canceled) {
          canceled = true;
          // 没有 canceled 状态，退回 pending 让用户可以重跑；已产出的格式仍显示在产物列
          item.status = 'pending';
          break;
        }
        item.status = 'done';
      } catch (e) {
        item.status = 'error';
        item.error = e instanceof Error ? e.message : '转换失败';
        lastError = item.error;
        failed += 1;
      } finally {
        item.currentFormat = undefined;
        item.formatStep = undefined;
      }
    }

    if (canceled) message.info(`已取消，共产出 ${okFiles} 个文件`);
    else if (failed === 0) message.success(`转换完成，共产出 ${okFiles} 个文件`);
    else if (okFiles === 0) message.error(`转换失败：${lastError}`);
    else message.warning(`产出 ${okFiles} 个文件，${failed} 个字体失败（悬停状态查看）`);
  } finally {
    processing.value = false;
    currentTaskId.value = '';
    currentRowId = '';
  }
}
// #endregion
</script>

<style scoped lang="scss">
.font {
  &__dim {
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: var(--tb-space-3);
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    transition: border-color 0.15s;

    &--drag {
      border-color: var(--tb-color-primary);
      background: var(--tb-color-primary-soft);
    }
  }

  &__table {
    flex: 1;
    min-height: 0;
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__outs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
  }

  &__out {
    padding: 1px 6px;
    font-size: 12px;
    color: var(--tb-color-primary);
    background: var(--tb-color-primary-soft);
    border-radius: var(--tb-radius-sm);

    &--skip {
      color: var(--tb-text-secondary);
      background: transparent;
      border: 1px solid var(--tb-border);
    }
  }

  &__status {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
  }

  &__step {
    font-size: 12px;
    color: var(--tb-text-secondary);
    white-space: nowrap;
  }

  &__ptitle {
    margin: 0 0 var(--tb-space-4);
    font-size: 15px;
    color: var(--tb-text-primary);

    &--sub {
      margin-top: var(--tb-space-5);
      padding-top: var(--tb-space-4);
      border-top: 1px solid var(--tb-border);
    }
  }

  &__field {
    margin-bottom: var(--tb-space-4);

    &--row {
      display: flex;
      align-items: center;
      justify-content: space-between;
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

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.6;
    color: var(--tb-text-secondary);
  }

  &__dir {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__mt {
    margin-top: var(--tb-space-2);
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__footer-stats {
    display: flex;
    gap: var(--tb-space-4);
  }
}
</style>
