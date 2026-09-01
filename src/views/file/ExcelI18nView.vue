<template>
  <ToolPageLayout
    title="Excel 多语言"
    desc="把多语言翻译表转成一种语言一个 i18n JSON，key 带点号自动转嵌套对象"
    category="文件工具"
  >
    <template #main>
      <div class="xi__main" :class="{ 'xi__main--drag': isDragOver }" v-bind="dropHandlers">
        <!-- 未选表格 -->
        <div v-if="!source" class="xi__empty">
          <n-icon :size="40" :depth="3" :component="GridOutline" />
          <p>拖拽表格到此处，或点击选择（XLSX / XLSM / CSV）</p>
          <n-button size="small" @click="handlePickFile">选择表格</n-button>
        </div>

        <!-- 已选表格：左语言列表 / 右 JSON 预览 -->
        <div v-else class="xi__split">
          <div class="xi__split-left">
            <div class="xi__source">
              <div>
                <div class="xi__source-name">{{ source.name }}</div>
                <div class="xi__dim">
                  {{ sheets.length }} 个工作表 · {{ formatBytes(source.size) }}
                </div>
              </div>
              <n-button size="small" @click="handlePickFile">更换</n-button>
            </div>

            <div class="xi__field">
              <label class="xi__label">参与解析的工作表（可多选，合并进同一套 JSON）</label>
              <n-checkbox-group v-model:value="selectedSheets">
                <n-space size="small">
                  <n-checkbox v-for="s in sheets" :key="s.name" :value="s.name">
                    {{ s.name }}（{{ s.rowCount }} 行）
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </div>

            <div class="xi__bar">
              <span class="xi__dim">语言列 {{ enabledRows.length }}/{{ langRows.length }}</span>
              <n-button size="small" @click="detectColumns">
                <template #icon><n-icon :component="ScanOutline" /></template>
                重新识别
              </n-button>
              <n-button size="small" quaternary :disabled="!langRows.length" @click="toggleAll">
                {{ enabledRows.length === langRows.length ? '全不选' : '全选' }}
              </n-button>
            </div>

            <div class="xi__rows">
              <p v-if="!langRows.length" class="xi__dim xi__pad">
                未识别到语言列，检查「表头行」与「多语言起始列」后点「重新识别」
              </p>
              <div
                v-for="row in langRows"
                :key="row.column"
                class="xi__row"
                :class="{ 'xi__row--active': row.column === previewColumn }"
                @click="previewColumn = row.column"
              >
                <n-checkbox v-model:checked="row.enabled" @click.stop />
                <div class="xi__row-main">
                  <div class="xi__row-head">
                    <span class="xi__col">{{ columnLabel(row.column) }}</span>
                    {{ row.header || '(空表头)' }}
                  </div>
                  <div v-if="row.keyCount || row.emptyCount" class="xi__dim">
                    {{ row.keyCount }} 条译文<template v-if="row.emptyCount">
                      · {{ row.emptyCount }} 条为空已跳过</template
                    >
                  </div>
                </div>
                <n-input
                  v-model:value="row.fileName"
                  size="small"
                  class="xi__row-name"
                  placeholder="文件名"
                  spellcheck="false"
                  @click.stop
                />
              </div>
            </div>
          </div>

          <div class="xi__split-right">
            <div class="xi__preview-head">
              <span class="xi__dim">
                JSON 预览<template v-if="previewColumn">
                  · {{ activeFileName || columnLabel(previewColumn) }}</template
                >
              </span>
              <n-button
                size="small"
                :loading="previewing"
                :disabled="!canRun"
                @click="handlePreview"
              >
                <template #icon><n-icon :component="RefreshOutline" /></template>
                刷新
              </n-button>
            </div>
            <p v-if="stale && previewJson" class="xi__warn">配置已变，点「刷新」重新解析</p>
            <p v-for="w in warnings" :key="w" class="xi__warn">{{ w }}</p>
            <div class="xi__preview-body">
              <pre v-if="previewJson" class="xi__code">{{ previewJson }}</pre>
              <p v-else class="xi__dim">点「刷新」生成预览</p>
            </div>
            <div v-if="result" class="xi__result">
              <div class="xi__result-head">
                <span>转换完成，产出 {{ result.files.length }} 个 JSON</span>
                <n-button size="small" @click="openResultDir">
                  <template #icon><n-icon :component="FolderOpenOutline" /></template>
                  打开目录
                </n-button>
              </div>
              <p class="xi__result-dir">{{ result.outDir }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #panel>
      <h3 class="xi__ptitle">行列位置</h3>
      <div class="xi__field xi__field--row">
        <label class="xi__label">表头行</label>
        <n-input-number v-model:value="config.headerRow" size="small" :min="1" class="xi__num" />
      </div>
      <div class="xi__field xi__field--row">
        <label class="xi__label">数据起始行</label>
        <n-input-number v-model:value="config.startRow" size="small" :min="1" class="xi__num" />
      </div>
      <div class="xi__field">
        <label class="xi__label">key 所在列</label>
        <n-input
          v-model:value="config.keyColumn"
          size="small"
          placeholder="如 C 或 3"
          :status="keyColumn ? undefined : 'error'"
          spellcheck="false"
        />
        <p class="xi__tip">
          字母列标或数字均可<template v-if="keyColumn">，当前 = 第 {{ keyColumn }} 列</template>
        </p>
      </div>
      <div class="xi__field">
        <label class="xi__label">多语言起始列</label>
        <n-input
          v-model:value="config.langStartColumn"
          size="small"
          placeholder="如 D 或 4"
          :status="langStartColumn ? undefined : 'error'"
          spellcheck="false"
        />
        <p class="xi__tip">从这一列起、每列一个语言，识别时自动跳过空表头列</p>
      </div>

      <h3 class="xi__ptitle xi__ptitle--sub">JSON 格式</h3>
      <div class="xi__field xi__field--row">
        <label class="xi__label">点号转嵌套对象</label>
        <n-switch v-model:value="config.nested" size="small" />
      </div>
      <p class="xi__tip xi__tip--tight">
        开启时 <code>code.1008</code> 输出为 <code>{ "code": { "1008": … } }</code>；关闭则整串作
        key
      </p>
      <div class="xi__field">
        <label class="xi__label">缩进</label>
        <n-radio-group v-model:value="config.indent" size="small">
          <n-radio-button :value="2">2 空格</n-radio-button>
          <n-radio-button :value="4">4 空格</n-radio-button>
          <n-radio-button :value="0">压缩</n-radio-button>
        </n-radio-group>
      </div>

      <h3 class="xi__ptitle xi__ptitle--sub">输出</h3>
      <div class="xi__field">
        <label class="xi__label">输出目录</label>
        <div class="xi__dir">
          <n-input
            v-model:value="config.outputDir"
            size="small"
            placeholder="选择或粘贴输出目录"
            spellcheck="false"
          />
          <n-button size="small" @click="pickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
        <p class="xi__tip">JSON 直接写在该目录下，不再建子文件夹</p>
      </div>

      <n-button
        type="primary"
        block
        class="xi__mt"
        :loading="processing"
        :disabled="!canRun || !config.outputDir"
        @click="handleStart"
      >
        {{ processing ? '转换中…' : '开始转换' }}
      </n-button>
    </template>

    <template #footer>
      <div class="xi__footer">
        <span v-if="!source">未选择表格</span>
        <span v-else>{{ source.name }} · 已选 {{ enabledRows.length }} 个语言</span>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NIcon,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui';
import { FolderOpenOutline, GridOutline, RefreshOutline, ScanOutline } from '@vicons/ionicons5';
import type {
  ExcelI18nColumn,
  ExcelI18nOptions,
  ExcelI18nWriteResult,
  ExcelProbeResult,
  ExcelSheetInfo,
  PickedFile,
} from '@shared/types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { showInFolderApi } from '@/services/file';
import { excelI18nToJsonApi, previewExcelI18nApi, probeExcelApi } from '@/services/excel';
import { columnLabel, localeFromHeader, parseColumnRef, sanitizeFileName } from '@/utils/excel';
import { formatBytes } from '@/utils/format';

/** 语言列在页面上的可编辑行。 */
interface LangRow {
  /** 列号（1-based）。 */
  column: number;
  /** 表头原文。 */
  header: string;
  /** 输出文件名（可手改）。 */
  fileName: string;
  /** 是否导出。 */
  enabled: boolean;
  /** 上次解析出的译文条数。 */
  keyCount: number;
  /** 上次解析中译文为空的条数。 */
  emptyCount: number;
}

// #region constants
const ACCEPT = ['xlsx', 'xlsm', 'csv'];
// #endregion

// #region state
const message = useMessage();

const source = ref<PickedFile | null>(null);
const sheets = ref<ExcelSheetInfo[]>([]);
const selectedSheets = ref<string[]>([]);
const langRows = ref<LangRow[]>([]);
const previewColumn = ref(0);
const previewJson = ref('');
const warnings = ref<string[]>([]);
const result = ref<ExcelI18nWriteResult | null>(null);
const previewing = ref(false);
const processing = ref(false);
/** 预览生成后参数又被改过，提示用户刷新（不自动重算，全表解析不便宜）。 */
const stale = ref(false);

const { config } = useToolConfig('file-excel-i18n', {
  headerRow: 1,
  startRow: 2,
  keyColumn: 'C',
  langStartColumn: 'D',
  nested: true,
  indent: 2,
  outputDir: '',
});
// #endregion

// #region getters
const keyColumn = computed(() => parseColumnRef(config.keyColumn));
const langStartColumn = computed(() => parseColumnRef(config.langStartColumn));
const enabledRows = computed(() => langRows.value.filter((r) => r.enabled));
const activeFileName = computed(
  () => langRows.value.find((r) => r.column === previewColumn.value)?.fileName ?? '',
);
const canRun = computed(
  () =>
    !!source.value &&
    !!keyColumn.value &&
    selectedSheets.value.length > 0 &&
    enabledRows.value.length > 0,
);
// #endregion

const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => {
    if (files[0]) void loadSource(files[0]);
  },
});

// #region methods
/**
 * 载入表格：探测结构、默认全选 sheet、识别语言列。
 * @param file 选中的表格文件。
 */
async function loadSource(file: PickedFile): Promise<void> {
  if (!ACCEPT.includes(file.ext)) return;
  source.value = file;
  sheets.value = [];
  langRows.value = [];
  previewJson.value = '';
  warnings.value = [];
  result.value = null;
  let probe: ExcelProbeResult;
  try {
    probe = await probeExcelApi(file.path, config.headerRow);
  } catch (error) {
    // 带上主进程的真实原因，否则「解析失败」四个字无从排查（老版 .xls / 文件被占用 / 行号非法都长一样）
    const reason = error instanceof Error ? error.message : String(error);
    message.error(`表格解析失败：${reason || '确认文件未损坏且不是老版 .xls'}`);
    return;
  }
  sheets.value = probe.sheets;
  selectedSheets.value = probe.sheets.map((s) => s.name);
  detectColumns();
}

/**
 * 按当前行列配置重新识别语言列并重置文件名。
 *
 * 只取第一个勾选的 sheet 的表头——多 sheet 合并时要求同构，用第一个即可代表。
 */
function detectColumns(): void {
  const start = langStartColumn.value;
  if (!start) {
    message.warning('「多语言起始列」填写不正确');
    return;
  }
  const sheet =
    sheets.value.find((s) => s.name === selectedSheets.value[0]) ?? sheets.value[0] ?? null;
  if (!sheet) return;

  const rows: LangRow[] = [];
  const used = new Set<string>();
  for (let col = start; col <= sheet.headers.length; col += 1) {
    const header = sheet.headers[col - 1] ?? '';
    // 空表头列多是分隔列或备注列，不当语言
    if (!header) continue;
    const locale = localeFromHeader(header);
    let fileName = sanitizeFileName(locale || header) || `col${col}`;
    // 同名（如两列都解析出 en）时补列标区分，免得后写的覆盖前面的文件
    if (used.has(fileName)) fileName = `${fileName}-${columnLabel(col)}`;
    used.add(fileName);
    rows.push({ column: col, header, fileName, enabled: true, keyCount: 0, emptyCount: 0 });
  }
  langRows.value = rows;
  previewColumn.value = rows[0]?.column ?? 0;
  previewJson.value = '';
  stale.value = false;
  if (!rows.length) message.warning('该起始列之后没有非空表头，检查「表头行」与「多语言起始列」');
}

/**
 * 收集当前配置为 IPC 选项。
 * @returns 转换选项。
 */
function buildOptions(): ExcelI18nOptions {
  const columns: ExcelI18nColumn[] = enabledRows.value.map((r) => ({
    column: r.column,
    header: r.header,
    fileName: r.fileName.trim() || `col${r.column}`,
  }));
  return {
    sheets: [...selectedSheets.value],
    headerRow: config.headerRow,
    startRow: config.startRow,
    keyColumn: keyColumn.value ?? 1,
    columns,
    nested: config.nested,
    indent: config.indent,
    outputDir: config.outputDir,
  };
}

/**
 * 把主进程回来的各列统计写回列表行。
 * @param stats 各列统计。
 */
function applyStats(stats: { column: number; keyCount: number; emptyCount: number }[]): void {
  const map = new Map(stats.map((s) => [s.column, s]));
  for (const row of langRows.value) {
    const stat = map.get(row.column);
    row.keyCount = stat?.keyCount ?? 0;
    row.emptyCount = stat?.emptyCount ?? 0;
  }
}

/** 生成预览：全部列统计 + 当前选中列的 JSON。 */
async function handlePreview(): Promise<void> {
  if (!source.value || !canRun.value) return;
  previewing.value = true;
  try {
    const column = previewColumn.value || enabledRows.value[0]?.column || 0;
    previewColumn.value = column;
    const res = await previewExcelI18nApi(source.value.path, buildOptions(), column);
    applyStats(res.columns);
    previewJson.value = res.previewJson || '{}';
    warnings.value = res.warnings;
    stale.value = false;
    if (res.skippedRows) message.info(`${res.skippedRows} 行因 key 为空被跳过`);
  } catch {
    previewJson.value = '';
    message.error('预览失败，检查行列配置是否指向了正确的单元格');
  } finally {
    previewing.value = false;
  }
}

/** 转换并落盘。 */
async function handleStart(): Promise<void> {
  if (!source.value || !canRun.value) return;
  processing.value = true;
  result.value = null;
  try {
    const res = await excelI18nToJsonApi(source.value.path, buildOptions());
    result.value = res;
    warnings.value = res.warnings;
    message.success(`转换完成，产出 ${res.files.length} 个 JSON`);
  } catch {
    // 错误已由 service 弹出
  } finally {
    processing.value = false;
  }
}

async function handlePickFile(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '表格', extensions: ACCEPT }],
    title: '选择多语言表格',
  });
  if (files[0]) await loadSource(files[0]);
}

async function pickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/** 全选 / 全不选语言列。 */
function toggleAll(): void {
  const next = enabledRows.value.length !== langRows.value.length;
  for (const row of langRows.value) row.enabled = next;
}

/** 打开产物目录。 */
function openResultDir(): void {
  const first = result.value?.files[0];
  if (first) void showInFolderApi(first.path);
  else if (result.value) void showInFolderApi(result.value.outDir);
}
// #endregion

// 表头行变了要重新读表头，才能识别到正确的语言列
watch(
  () => config.headerRow,
  () => {
    if (!source.value) return;
    void loadSource(source.value);
  },
);

// 参数或选择变化后标脏，提示刷新预览；不自动重算，全表解析不便宜
watch(
  [
    () => config.startRow,
    () => config.keyColumn,
    () => config.nested,
    () => config.indent,
    selectedSheets,
    langRows,
  ],
  () => {
    if (previewJson.value) stale.value = true;
  },
  { deep: true },
);

// 切换预览语言时立刻重算该列（只序列化一列，代价可接受）
watch(previewColumn, () => {
  if (previewJson.value) void handlePreview();
});
</script>

<style scoped lang="scss">
.xi {
  &__main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    transition: border-color 0.15s;

    &--drag {
      border-color: var(--tb-color-primary);
      background: var(--tb-color-primary-soft);
    }
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

  &__split {
    display: flex;
    gap: var(--tb-space-3);
    flex: 1;
    min-height: 0;
  }

  &__split-left {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  &__split-right {
    display: flex;
    flex-direction: column;
    // 与左侧列表各占一半
    flex: 1;
    min-width: 0;
    border-left: 1px solid var(--tb-border);
    padding-left: var(--tb-space-3);
  }

  &__source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--tb-space-3);
    margin-bottom: var(--tb-space-3);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__source-name {
    font-size: 15px;
    color: var(--tb-text-primary);
  }

  &__bar {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  &__rows {
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    padding: var(--tb-space-2) var(--tb-space-3);
    cursor: pointer;
    border-bottom: 1px solid var(--tb-border);

    &:last-child {
      border-bottom: none;
    }

    &--active {
      background: var(--tb-color-primary-soft);
    }
  }

  &__row-main {
    flex: 1;
    min-width: 0;
  }

  &__row-head {
    font-size: 13px;
    color: var(--tb-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__row-name {
    width: 120px;
    flex: none;
  }

  &__col {
    display: inline-block;
    min-width: 22px;
    margin-right: var(--tb-space-2);
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__preview-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--tb-space-2);
  }

  &__preview-body {
    display: flex;
    flex: 1;
    min-height: 0;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    overflow: hidden;
  }

  &__code {
    margin: 0;
    flex: 1;
    align-self: stretch;
    overflow: auto;
    padding: var(--tb-space-3);
    font-family: var(--tb-font-mono, monospace);
    font-size: 12px;
    line-height: 1.5;
    color: var(--tb-text-primary);
    white-space: pre-wrap;
    word-break: break-all;
  }

  &__result {
    margin-top: var(--tb-space-3);
    padding: var(--tb-space-3);
    border: 1px solid var(--tb-color-primary);
    border-radius: var(--tb-radius-md);
    background: var(--tb-color-primary-soft);
  }

  &__result-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    color: var(--tb-text-primary);
  }

  &__result-dir {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
    word-break: break-all;
  }

  &__warn {
    margin: 0 0 var(--tb-space-2);
    font-size: 12px;
    color: var(--tb-color-warning, #d89614);
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

  &__num {
    width: 110px;
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--tb-text-secondary);

    &--tight {
      margin: calc(-1 * var(--tb-space-2)) 0 var(--tb-space-4);
    }
  }

  &__dim {
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__pad {
    padding: var(--tb-space-4);
    text-align: center;
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
    font-size: 13px;
    color: var(--tb-text-secondary);
  }
}
</style>
