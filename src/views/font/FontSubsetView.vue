<template>
  <ToolPageLayout
    title="字体裁剪"
    desc="按指定字符裁剪字体、可选转换格式，批量处理并实时预览"
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
          :row-key="(row: FontItem) => row.id"
          :pagination="pagination"
          flex-height
          class="font__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="font__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽字体文件到此处，或点击「添加字体」（TTF / OTF / WOFF / WOFF2）</p>
        </div>

        <!-- 预览区 -->
        <div class="font__preview">
          <div class="font__preview-head">
            <span class="font__dim">效果预览{{ previewName ? `：${previewName}` : '' }}</span>
            <n-button
              size="small"
              :loading="previewing"
              :disabled="!activeRow || !finalChars"
              @click="handlePreview"
            >
              <template #icon><n-icon :component="RefreshOutline" /></template>
              预览选中字体
            </n-button>
          </div>
          <div
            class="font__preview-body"
            :style="previewReady ? { fontFamily: previewFamily } : undefined"
          >
            {{ previewText || '在右侧输入要保留的字符，选中一个字体后点预览' }}
          </div>
        </div>
      </div>
    </template>

    <template #panel>
      <h3 class="font__ptitle">保留字符</h3>
      <div class="font__field">
        <label class="font__label">手动输入</label>
        <n-input
          v-model:value="manualChars"
          type="textarea"
          :rows="3"
          :input-props="{ spellcheck: 'false' }"
          placeholder="输入要保留的字符，如 你好世界ABC123"
        />
      </div>
      <div class="font__field">
        <label class="font__label">从文件提取（可多选 txt / json）</label>
        <div class="font__file-row">
          <n-input
            :value="charFileNames.join('、')"
            size="small"
            readonly
            placeholder="选择 txt / json，可多选"
          />
          <n-button size="small" @click="pickCharFile">
            <n-icon :component="DocumentTextOutline" />
          </n-button>
          <n-button v-if="fileChars" size="small" quaternary @click="clearCharFile">清除</n-button>
        </div>
        <n-checkbox v-model:checked="jsonValueOnly" class="font__mt-sm">
          JSON 只提取 value 值（忽略 key）
        </n-checkbox>
        <p v-if="fileChars" class="font__tip">
          已从 {{ charFileNames.length }} 个文件提取
          {{ [...new Set([...fileChars])].length }} 个字符
        </p>
      </div>
      <div class="font__field">
        <label class="font__label">预设字符集</label>
        <n-checkbox-group v-model:value="checkedPresets">
          <n-space vertical size="small">
            <n-checkbox v-for="p in CHARSET_PRESETS" :key="p.key" :value="p.key">
              {{ p.label }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
      </div>
      <p class="font__count">共保留 {{ finalChars.length }} 个字符（已去重）</p>

      <h3 class="font__ptitle font__ptitle--sub">输出</h3>
      <div class="font__field">
        <label class="font__label">输出格式（可多选，一个字体各出一份）</label>
        <n-checkbox-group v-model:value="config.formats">
          <n-space size="small">
            <n-checkbox
              v-for="f in formatOptions"
              :key="f.value"
              :value="f.value"
              :disabled="config.overwrite && f.value !== config.formats[0]"
            >
              {{ f.label }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
        <p v-if="config.overwrite && config.formats.length > 1" class="font__tip font__tip--warn">
          覆盖模式只能输出单一格式
        </p>
      </div>
      <div class="font__field">
        <label class="font__label">输出目录</label>
        <div class="font__dir">
          <n-input v-model:value="config.outputDir" size="small" placeholder="选择或粘贴输出目录" />
          <n-button size="small" :disabled="config.overwrite" @click="pickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>
      <div class="font__field font__field--row">
        <label class="font__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

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
    </template>

    <template #footer>
      <div class="font__footer">
        <span>已选择 {{ items.length }} 个字体</span>
        <div class="font__footer-stats">
          <span>已处理 {{ doneCount }} / {{ items.length }}</span>
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>裁后 {{ formatBytes(totalSubset) }}</span>
        </div>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, reactive, ref, watch } from 'vue';
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
import {
  CloudUploadOutline,
  DocumentTextOutline,
  FolderOpenOutline,
  RefreshOutline,
} from '@vicons/ionicons5';
import type { FontOutputFormat, PickedFile } from '@shared/types';
import type { FontItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { readTextApi } from '@/services/file';
import { probeFontApi, subsetFontApi, subsetPreviewApi } from '@/services/font';
import { CHARSET_PRESETS } from '@/constants/charset';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

const message = useMessage();

const ACCEPT = ['ttf', 'otf', 'woff', 'woff2'];
const PAGE_SIZE = 50;
const MAX_FILES = 5_000;

const formatOptions: { label: string; value: FontOutputFormat }[] = [
  { label: '保持原格式', value: 'original' },
  { label: 'TTF', value: 'ttf' },
  { label: 'OTF', value: 'otf' },
  { label: 'WOFF', value: 'woff' },
  { label: 'WOFF2', value: 'woff2' },
];

const items = ref<FontItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;

const { config } = useToolConfig('font-subset', {
  formats: ['original'] as FontOutputFormat[],
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

// #region 字符来源
const manualChars = ref('');
const fileChars = ref('');
/** 已选来源文件名列表（展示用）。 */
const charFileNames = ref<string[]>([]);
/** JSON 文件只提取 value 值（忽略 key）。 */
const jsonValueOnly = ref(true);
/** 已选来源文件的原始内容（name+text），供切换 valueOnly 时重新提取。 */
const rawFiles = ref<{ name: string; text: string }[]>([]);
const checkedPresets = ref<string[]>([]);

/** 最终保留字符 = 手输 + 文件 + 勾选预设，合并去重。 */
const finalChars = computed(() => {
  let all = manualChars.value + fileChars.value;
  for (const key of checkedPresets.value) {
    const preset = CHARSET_PRESETS.find((p) => p.key === key);
    if (preset) all += preset.chars;
  }
  // 去重，去掉换行/回车（换行不该进字体字符集）
  return [...new Set([...all])].filter((c) => c !== '\n' && c !== '\r').join('');
});

/**
 * 递归收集 JSON 里所有字符串「值」（不含对象 key），拼成一段文本。
 * @param node 任意 JSON 节点。
 * @param acc 累加字符串数组。
 */
function collectJsonValues(node: unknown, acc: string[]): void {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) node.forEach((v) => collectJsonValues(v, acc));
  else if (node && typeof node === 'object') {
    // 只递归 value，跳过 key
    Object.values(node).forEach((v) => collectJsonValues(v, acc));
  }
}

/**
 * 从一个文件的文本内容提取字符。
 * json 且开了「只提取 value」时，解析后只取字符串值；否则/解析失败则全文。
 * @param name 文件名（判断扩展名）。
 * @param text 文件内容。
 * @returns 提取出的文本。
 */
function extractChars(name: string, text: string): string {
  const isJson = name.toLowerCase().endsWith('.json');
  if (isJson && jsonValueOnly.value) {
    try {
      const values: string[] = [];
      collectJsonValues(JSON.parse(text), values);
      return values.join('');
    } catch {
      // JSON 解析失败（格式不合法）时退回全文，不阻断
      return text;
    }
  }
  return text;
}

/** 由已读入的原始文件重新算出提取字符（切换 valueOnly 或选文件后调用）。 */
function recomputeFileChars(): void {
  fileChars.value = rawFiles.value.map((f) => extractChars(f.name, f.text)).join('');
}

/** 选文件提取字符（可多选）。 */
async function pickCharFile(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '文本', extensions: ['txt', 'json'] }],
    title: '选择字符来源文件（可多选）',
  });
  if (!files.length) return;
  const raw: { name: string; text: string }[] = [];
  const names: string[] = [];
  for (const file of files) {
    try {
      const text = await readTextApi(file.path);
      raw.push({ name: file.name, text });
      names.push(file.name);
    } catch {
      // 单个文件读失败跳过，提示已由 service 弹出
    }
  }
  if (!raw.length) return;
  rawFiles.value = raw;
  charFileNames.value = names;
  recomputeFileChars();
}

/** 清除文件字符。 */
function clearCharFile(): void {
  fileChars.value = '';
  charFileNames.value = [];
  rawFiles.value = [];
}

// 切换「只提取 value」时，对已选文件重新提取
watch(jsonValueOnly, () => {
  if (rawFiles.value.length) recomputeFileChars();
});
// #endregion

// #region 列表
const thumbQueue = createTaskQueue(4);
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

// 只为当前页的行探测元信息
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (row.probed || probeRequested.has(row.id)) continue;
      probeRequested.add(row.id);
      const { id, path } = row;
      thumbQueue.push(async () => {
        const meta = await probeFontApi(path).catch(() => null);
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

const columns: DataTableColumns<FontItem> = [
  { type: 'selection' },
  {
    title: '字体名',
    key: 'fontName',
    minWidth: 160,
    ellipsis: { tooltip: true },
    render: (row) => row.fontName || row.name,
  },
  {
    title: '字形数',
    key: 'glyphCount',
    width: 90,
    render: (row) => (row.probed ? (row.glyphCount ?? 0) : '—'),
  },
  { title: '原大小', key: 'size', width: 90, render: (row) => formatBytes(row.size) },
  {
    title: '裁后',
    key: 'subsetSize',
    width: 90,
    render: (row) => (row.subsetSize !== undefined ? formatBytes(row.subsetSize) : '—'),
  },
  {
    title: '体积变化',
    key: 'ratio',
    width: 88,
    render: (row) => {
      if (row.ratio === undefined) return '—';
      const grew = row.ratio < 0;
      return h(
        'span',
        { style: grew ? 'color:var(--tb-text-secondary)' : 'color:var(--tb-color-primary)' },
        grew ? `+${-row.ratio}%` : `-${row.ratio}%`,
      );
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: (row) =>
      row.status === 'error' && row.error
        ? h(NTooltip, null, {
            trigger: () => h(StatusTag, { status: row.status }),
            default: () => row.error,
          })
        : h(StatusTag, { status: row.status }),
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
const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalSubset = computed(() => items.value.reduce((s, i) => s + (i.subsetSize ?? 0), 0));

const canStart = computed(
  () =>
    items.value.length > 0 &&
    !processing.value &&
    finalChars.value.length > 0 &&
    config.formats.length > 0 &&
    (config.overwrite || !!config.outputDir),
);

const startLabel = computed(() => {
  if (!finalChars.value.length) return '请先输入保留字符';
  if (!config.formats.length) return '请选择输出格式';
  return checkedKeys.value.length ? `裁剪选中 (${checkedKeys.value.length})` : '开始裁剪';
});

// 覆盖模式下只允许单一输出格式：开启覆盖时把多选收敛为第一个
watch(
  () => config.overwrite,
  (on) => {
    if (on && config.formats.length > 1) config.formats = [config.formats[0]];
  },
);
// #endregion

// #region 预览
const previewing = ref(false);
const previewFamily = ref('');
const previewReady = ref(false);
const previewName = ref('');
let previewFace: FontFace | null = null;

/** 预览示例文字：优先用保留字符（截前 200），否则给默认串。 */
/** 预览示例文字：保留字符已去重，去掉空格避免占位干扰，截前 300。 */
const previewText = computed(() =>
  [...new Set([...finalChars.value])]
    .filter((c) => c !== ' ')
    .slice(0, 300)
    .join(''),
);

/** 当前选中行（预览目标）：优先勾选项，否则第一行。 */
const activeRow = computed(() => {
  const selected = new Set(checkedKeys.value);
  return items.value.find((i) => selected.has(i.id)) ?? items.value[0] ?? null;
});

/** 卸载已挂载的预览字体，避免 FontFace 累积。 */
function disposePreviewFace(): void {
  if (previewFace) {
    document.fonts.delete(previewFace);
    previewFace = null;
  }
  previewReady.value = false;
}

/** 预览：用裁剪后的 woff2 挂 FontFace，渲染保留字符。 */
async function handlePreview(): Promise<void> {
  const row = activeRow.value;
  if (!row || !finalChars.value) return;
  previewing.value = true;
  try {
    const dataUrl = await subsetPreviewApi(row.path, finalChars.value);
    if (!dataUrl) return;
    disposePreviewFace();
    const family = `font-preview-${seq++}`;
    const face = new FontFace(family, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    previewFace = face;
    previewFamily.value = family;
    previewReady.value = true;
    previewName.value = row.fontName || row.name;
  } catch {
    message.error('预览失败');
  } finally {
    previewing.value = false;
  }
}

onBeforeUnmount(disposePreviewFace);
// #endregion

// #region actions
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;
  for (const file of fresh) {
    items.value.push({ ...file, id: `font-${seq++}`, status: 'pending' });
  }
}

async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '字体', extensions: ACCEPT }],
    title: '选择要裁剪的字体',
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
  thumbQueue.clear();
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

/** 开始裁剪：有勾选只裁选中，否则全部；每个字体按所选每种格式各出一份，串行回写行状态。 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;
  const chars = finalChars.value;
  const formats = config.formats;
  processing.value = true;
  let okFiles = 0;
  let failedFonts = 0;
  let lastError = '';
  try {
    for (const item of targets) {
      item.status = 'processing';
      let itemFailed = false;
      // 每种格式各裁一份；行上展示最后一次结果的大小（多格式时体积相近，够参考）
      for (const format of formats) {
        try {
          const result = await subsetFontApi(item.path, {
            chars,
            format,
            outputDir: config.outputDir,
            overwrite: config.overwrite,
          });
          item.subsetSize = result.subsetSize;
          item.ratio = result.ratio;
          item.outputPath = result.outputPath;
          item.outputFormat = result.outputFormat;
          okFiles += 1;
        } catch (e) {
          itemFailed = true;
          item.error = e instanceof Error ? e.message : '裁剪失败';
          lastError = item.error;
        }
      }
      item.status = itemFailed ? 'error' : 'done';
      if (itemFailed) failedFonts += 1;
    }
    if (failedFonts === 0) message.success(`裁剪完成，共产出 ${okFiles} 个文件`);
    else if (okFiles === 0) message.error(`裁剪失败：${lastError}`);
    else message.warning(`产出 ${okFiles} 个文件，${failedFonts} 个字体有失败（悬停状态查看）`);
  } finally {
    processing.value = false;
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

  &__preview {
    flex: none;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    padding: var(--tb-space-3);
  }

  &__preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--tb-space-2);
  }

  &__preview-body {
    min-height: 64px;
    max-height: 160px;
    overflow: auto;
    font-size: 28px;
    line-height: 1.5;
    color: var(--tb-text-primary);
    word-break: break-all;
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

  &__file-row {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__count {
    margin: var(--tb-space-2) 0 0;
    font-size: 13px;
    color: var(--tb-color-primary);
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    color: var(--tb-text-secondary);

    &--warn {
      color: var(--tb-color-warning, #e0a030);
    }
  }

  &__dir {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__mt {
    margin-top: var(--tb-space-2);
  }

  &__mt-sm {
    margin-top: var(--tb-space-2);
    font-size: 13px;
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
