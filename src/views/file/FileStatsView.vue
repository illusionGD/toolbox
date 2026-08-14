<template>
  <ToolPageLayout
    title="文件统计"
    desc="扫描文件夹，按后缀统计文件数量与占用大小，可展开查看明细"
    category="文件工具"
  >
    <!-- 操作栏 -->
    <template #toolbar>
      <n-space>
        <n-button type="primary" :disabled="scanning" @click="handlePickDir">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          选择文件夹
        </n-button>
        <n-button :disabled="!config.root || scanning" @click="startScan">
          <template #icon><n-icon :component="RefreshOutline" /></template>
          重新扫描
        </n-button>
        <n-button v-if="scanning" type="warning" @click="handleCancel">
          <template #icon><n-icon :component="StopCircleOutline" /></template>
          取消扫描
        </n-button>
        <n-dropdown
          trigger="click"
          :options="exportOptions"
          :disabled="!groups.length"
          @select="handleExport"
        >
          <n-button :disabled="!groups.length">
            <template #icon><n-icon :component="DownloadOutline" /></template>
            {{ selectedGroups.length ? `导出选中 (${selectedGroups.length})` : '导出报告' }}
          </n-button>
        </n-dropdown>
        <n-button quaternary :disabled="!result || scanning" @click="handleClear">
          <template #icon><n-icon :component="TrashOutline" /></template>
          清空
        </n-button>
        <span v-if="config.root" class="stats__root" :title="config.root">{{ config.root }}</span>
      </n-space>
    </template>

    <!-- 统计表格 -->
    <template #main>
      <div class="stats__main">
        <!-- 扫描中 -->
        <div v-if="scanning" class="stats__placeholder">
          <n-spin size="large" />
          <p class="stats__progress-text">已扫描 {{ progressCount.toLocaleString() }} 个文件</p>
          <p class="stats__progress-dir" :title="progressDir">
            {{ progressDir || '正在读取目录…' }}
          </p>
        </div>

        <!-- 结果表格 -->
        <n-data-table
          v-else-if="groups.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="groups"
          :row-key="(row: ExtGroup) => row.ext"
          flex-height
          class="stats__table"
        />

        <!-- 空态 -->
        <div v-else class="stats__placeholder">
          <n-icon :size="40" :depth="3" :component="FolderOpenOutline" />
          <p>{{ emptyText }}</p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <h3 class="stats__panel-title">扫描选项</h3>
      <p class="stats__hint">修改后需重新扫描</p>

      <div class="stats__field stats__field--row">
        <label class="stats__label">包含隐藏文件</label>
        <n-switch v-model:value="config.includeHidden" size="small" />
      </div>

      <div class="stats__field stats__field--row">
        <label class="stats__label">跳过常见忽略目录</label>
        <n-switch v-model:value="config.skipIgnoredDirs" size="small" />
      </div>

      <div v-if="config.skipIgnoredDirs" class="stats__field">
        <label class="stats__label">忽略的目录名</label>
        <n-dynamic-tags v-model:value="config.ignoreDirs" size="small" />
      </div>

      <n-divider class="stats__divider" />

      <h3 class="stats__panel-title">后缀过滤</h3>
      <p class="stats__hint">即时生效，无需重新扫描</p>

      <div class="stats__field">
        <label class="stats__label">仅统计</label>
        <n-select
          v-model:value="config.include"
          :options="extSelectOptions"
          multiple
          filterable
          clearable
          size="small"
          placeholder="留空表示全部"
          :max-tag-count="3"
        />
      </div>

      <div class="stats__field">
        <label class="stats__label">排除</label>
        <n-select
          v-model:value="config.exclude"
          :options="extSelectOptions"
          multiple
          filterable
          clearable
          size="small"
          placeholder="不排除"
          :max-tag-count="3"
        />
      </div>

      <n-divider class="stats__divider" />

      <h3 class="stats__panel-title">占比</h3>
      <p class="stats__hint">
        {{
          selectedGroups.length ? `仅统计选中的 ${selectedGroups.length} 类后缀` : '统计全部后缀'
        }}
      </p>
      <n-radio-group v-model:value="config.metric" size="small" class="stats__field">
        <n-radio-button value="count">按数量</n-radio-button>
        <n-radio-button value="size">按大小</n-radio-button>
      </n-radio-group>

      <div v-if="donutSegments.length" class="stats__chart">
        <DonutChart
          :segments="donutSegments"
          :total="donutTotal.text"
          :unit="donutTotal.unit"
          :size="120"
          :thickness="14"
        />
        <div class="stats__legend">
          <div v-for="seg in donutLegend" :key="seg.key" class="stats__legend-row">
            <span class="stats__legend-dot" :style="{ background: seg.color }" />
            <span class="stats__legend-label">{{ seg.label }}</span>
            <span class="stats__legend-value">{{ seg.percentage }}%</span>
          </div>
        </div>
      </div>
      <p v-else class="stats__hint">暂无数据</p>
    </template>

    <!-- 底部统计 -->
    <template #footer>
      <div class="stats__footer">
        <div class="stats__footer-stats">
          <template v-if="selectedGroups.length">
            <span class="stats__selected">
              已选 {{ selectedGroups.length }} 类后缀 ·
              {{ selectedTotals.count.toLocaleString() }} 个文件 ·
              {{ formatBytes(selectedTotals.size) }}
            </span>
            <span>
              占全部 {{ selectedPercent.count }}% 数量 / {{ selectedPercent.size }}% 大小
            </span>
            <n-button text size="tiny" @click="checkedKeys = []">清除选择</n-button>
          </template>
          <template v-else>
            <span>文件 {{ totals.count.toLocaleString() }} 个</span>
            <span>总大小 {{ formatBytes(totals.size) }}</span>
            <span>后缀 {{ totals.extCount }} 类</span>
            <span v-if="result">目录 {{ result.dirCount.toLocaleString() }} 个</span>
            <span v-if="result">耗时 {{ (result.elapsed / 1000).toFixed(1) }}s</span>
          </template>
        </div>
        <div class="stats__footer-warn">
          <span v-if="result?.truncated" class="stats__warn">
            已达上限 {{ MAX_FILES.toLocaleString() }} 个文件，结果不完整
          </span>
          <span v-if="result?.canceled" class="stats__warn">已取消，仅为部分结果</span>
          <n-tooltip v-if="result?.errors.length">
            <template #trigger>
              <span class="stats__warn">{{ result.errors.length }} 个目录读取失败</span>
            </template>
            <div class="stats__errors">
              <div v-for="(err, i) in result.errors.slice(0, 10)" :key="i">{{ err }}</div>
            </div>
          </n-tooltip>
        </div>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, h, onUnmounted, ref } from 'vue';
import {
  NButton,
  NDataTable,
  NDivider,
  NDropdown,
  NDynamicTags,
  NIcon,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSpin,
  NSwitch,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  DownloadOutline,
  FolderOpenOutline,
  OpenOutline,
  RefreshOutline,
  StopCircleOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type { ScanResult } from '@shared/types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import DonutChart from '@/components/common/DonutChart.vue';
import { colorAt } from '@/constants/chart';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi } from '@/services/fs';
import {
  cancelScanApi,
  onScanProgress,
  saveTextApi,
  scanDirApi,
  showInFolderApi,
} from '@/services/file';
import { formatBytes, formatDateTime } from '@/utils/format';
import {
  aggregateByExt,
  buildTotals,
  collectExtOptions,
  toCsv,
  toJson,
  type ExportScope,
  type ExtGroup,
  type StatFileRow,
} from '@/utils/fileStats';

// #region state
const message = useMessage();

/** 单次扫描的文件数上限（与主进程默认值保持一致，用于提示文案）。 */
const MAX_FILES = 200_000;

/** 默认跳过的目录名。 */
const DEFAULT_IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.svn',
  'dist',
  'build',
  'out',
  '.cache',
  '.idea',
  '.vscode',
];

/** 持久化的工具配置。 */
const { config } = useToolConfig('file-stats', {
  root: '',
  includeHidden: true,
  skipIgnoredDirs: true,
  ignoreDirs: DEFAULT_IGNORE_DIRS,
  include: [] as string[],
  exclude: [] as string[],
  metric: 'count' as 'count' | 'size',
});

const result = ref<ScanResult | null>(null);
const scanning = ref(false);
/** 勾选的后缀（ExtGroup.ext）。 */
const checkedKeys = ref<string[]>([]);
const progressCount = ref(0);
const progressDir = ref('');
/** 扫描完成时间，用于导出报告标注。 */
const scannedAt = ref(0);

let scanSeq = 0;
let currentScanId = '';

// 进度订阅：只认当前扫描的 id，避免上一次未收尾的推送串台
const disposeProgress = onScanProgress((progress) => {
  if (progress.scanId !== currentScanId) return;
  progressCount.value = progress.scanned;
  progressDir.value = progress.currentDir;
});
onUnmounted(() => {
  disposeProgress();
  // 离开页面时结束扫描，否则主进程会继续遍历一个没人看的目录树
  if (scanning.value && currentScanId) void cancelScanApi(currentScanId);
});
// #endregion

// #region getters
/** 当前过滤条件下的后缀分组。 */
const groups = computed(() =>
  aggregateByExt(result.value, { include: config.include, exclude: config.exclude }),
);

const totals = computed(() => buildTotals(groups.value));

/** 勾选的后缀分组；未勾选时为空数组。 */
const selectedGroups = computed(() => {
  if (!checkedKeys.value.length) return [];
  const checked = new Set(checkedKeys.value);
  // 按 groups 过滤而非直接用 keys，过滤条件变化后失效的勾选自然被忽略
  return groups.value.filter((g) => checked.has(g.ext));
});

const selectedTotals = computed(() => buildTotals(selectedGroups.value));

/** 占比图与导出的作用范围：有勾选时只算选中的，否则算全部。 */
const activeGroups = computed(() =>
  selectedGroups.value.length ? selectedGroups.value : groups.value,
);

const activeTotals = computed(() =>
  selectedGroups.value.length ? selectedTotals.value : totals.value,
);

/** 选中部分占全部的比例（百分比，保留一位小数）。 */
const selectedPercent = computed(() => {
  const ratio = (part: number, whole: number): number =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
  return {
    count: ratio(selectedTotals.value.count, totals.value.count),
    size: ratio(selectedTotals.value.size, totals.value.size),
  };
});

/** 过滤下拉的选项（来自扫描结果的全部后缀）。 */
const extSelectOptions = computed(() =>
  collectExtOptions(result.value).map((item) => ({
    label: `${item.label} (${item.count})`,
    value: item.ext,
  })),
);

const emptyText = computed(() => {
  if (!result.value) return '选择一个文件夹开始统计';
  if (result.value.files.length) return '当前过滤条件下没有文件';
  return '该文件夹下没有扫描到文件';
});

/** 占比图数据：Top 6 + 其他。有勾选时只统计选中的后缀。 */
const donutLegend = computed(() => {
  const metric = config.metric;
  const total = metric === 'count' ? activeTotals.value.count : activeTotals.value.size;
  if (!total) return [];

  const top = activeGroups.value
    .map((g) => ({ key: g.ext, label: g.label, value: metric === 'count' ? g.count : g.size }))
    .sort((a, b) => b.value - a.value);

  const head = top.slice(0, 6);
  const restValue = top.slice(6).reduce((sum, item) => sum + item.value, 0);
  if (restValue > 0) head.push({ key: '__rest__', label: '其他', value: restValue });

  return head.map((item, i) => ({
    ...item,
    color: colorAt(i),
    percentage: Math.round((item.value / total) * 100),
  }));
});

const donutSegments = computed(() =>
  donutLegend.value.map((item) => ({ key: item.key, value: item.value, color: item.color })),
);

/** 环形图中心的总量文案（按数量显示个数，按大小显示可读体积）。 */
const donutTotal = computed(() => {
  if (config.metric === 'count') {
    return { text: activeTotals.value.count.toLocaleString(), unit: '个文件' };
  }
  const [value, unit] = formatBytes(activeTotals.value.size).split(' ');
  return { text: value, unit };
});

/** 导出下拉选项。 */
const exportOptions = [
  { label: 'CSV · 仅汇总', key: 'csv-summary' },
  { label: 'CSV · 含明细', key: 'csv-detail' },
  { label: 'JSON · 仅汇总', key: 'json-summary' },
  { label: 'JSON · 含明细', key: 'json-detail' },
];
// #endregion

// #region columns
/**
 * 渲染占比进度条。
 * @param value 当前值。
 * @param total 总量。
 * @returns 进度条节点。
 */
function renderRatio(value: number, total: number): ReturnType<typeof h> {
  const percentage = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return h(NProgress, {
    type: 'line',
    percentage,
    height: 6,
    borderRadius: 3,
    fillBorderRadius: 3,
    indicatorPlacement: 'inside',
    showIndicator: false,
  });
}

/** 明细表列定义（各分组展开时共用）。 */
const detailColumns: DataTableColumns<StatFileRow> = [
  { title: '文件名', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '大小',
    key: 'size',
    width: 100,
    sorter: (a, b) => a.size - b.size,
    render: (row) => formatBytes(row.size),
  },
  {
    title: '修改日期',
    key: 'mtime',
    width: 150,
    sorter: (a, b) => a.mtime - b.mtime,
    render: (row) => formatDateTime(row.mtime),
  },
  {
    title: '操作',
    key: 'actions',
    width: 60,
    align: 'center',
    render: (row) =>
      h(NTooltip, null, {
        trigger: () =>
          h(
            NButton,
            { text: true, size: 'small', onClick: () => void showInFolderApi(row.path) },
            { icon: () => h(NIcon, { component: OpenOutline }) },
          ),
        default: () => '在资源管理器中显示',
      }),
  },
];

const columns = computed<DataTableColumns<ExtGroup>>(() => [
  { type: 'selection' },
  {
    type: 'expand',
    // 明细可达数万条，开虚拟滚动只渲染视口内的行
    renderExpand: (row) =>
      h(NDataTable, {
        columns: detailColumns,
        data: row.files,
        rowKey: (item: StatFileRow) => item.path,
        size: 'small',
        virtualScroll: true,
        maxHeight: 300,
        bordered: false,
      }),
  },
  { title: '后缀', key: 'label', width: 140 },
  {
    title: '数量',
    key: 'count',
    width: 100,
    sorter: (a, b) => a.count - b.count,
    render: (row) => row.count.toLocaleString(),
  },
  {
    title: '总大小',
    key: 'size',
    width: 110,
    defaultSortOrder: 'descend',
    sorter: (a, b) => a.size - b.size,
    render: (row) => formatBytes(row.size),
  },
  {
    title: '数量占比',
    key: 'countRatio',
    minWidth: 120,
    render: (row) => renderRatio(row.count, totals.value.count),
  },
  {
    title: '大小占比',
    key: 'sizeRatio',
    minWidth: 120,
    render: (row) => renderRatio(row.size, totals.value.size),
  },
]);
// #endregion

// #region actions
/** 选择要统计的文件夹，选完立即扫描。 */
async function handlePickDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择要统计的文件夹');
  if (!dir) return;
  config.root = dir;
  await startScan();
}

/** 执行扫描。 */
async function startScan(): Promise<void> {
  if (!config.root || scanning.value) return;

  currentScanId = `scan-${++scanSeq}-${Date.now()}`;
  scanning.value = true;
  progressCount.value = 0;
  progressDir.value = '';
  result.value = null;
  checkedKeys.value = [];

  try {
    const data = await scanDirApi({
      scanId: currentScanId,
      root: config.root,
      includeHidden: config.includeHidden,
      skipIgnoredDirs: config.skipIgnoredDirs,
      // config 是 reactive Proxy，数组需转纯对象才能结构化克隆
      ignoreDirs: JSON.parse(JSON.stringify(config.ignoreDirs)) as string[],
      maxFiles: MAX_FILES,
    });
    result.value = data;
    scannedAt.value = Date.now();
    if (data.canceled) {
      message.warning(`已取消，共扫描 ${data.files.length.toLocaleString()} 个文件`);
    } else if (data.truncated) {
      message.warning(`文件数超过上限 ${MAX_FILES.toLocaleString()}，结果不完整`);
    } else {
      message.success(`扫描完成，共 ${data.files.length.toLocaleString()} 个文件`);
    }
  } catch {
    // 错误提示已由 services 统一弹出
  } finally {
    scanning.value = false;
  }
}

/** 取消当前扫描。 */
async function handleCancel(): Promise<void> {
  if (!currentScanId) return;
  await cancelScanApi(currentScanId);
}

/** 清空扫描结果与过滤条件。 */
function handleClear(): void {
  result.value = null;
  config.include = [];
  config.exclude = [];
  checkedKeys.value = [];
  progressCount.value = 0;
  progressDir.value = '';
}

/**
 * 导出报告。有勾选时只导出选中的后缀。
 * @param key 下拉项 key，形如 `csv-detail`。
 */
async function handleExport(key: string): Promise<void> {
  const [format, scope] = key.split('-') as ['csv' | 'json', ExportScope];
  const isCsv = format === 'csv';
  const data = activeGroups.value;
  const content = isCsv
    ? toCsv(data, scope)
    : toJson(data, scope, { root: config.root, scannedAt: scannedAt.value });

  const scopeName = scope === 'detail' ? '明细' : '汇总';
  const savedPath = await saveTextApi({
    defaultName: `文件统计-${scopeName}${selectedGroups.value.length ? '-选中' : ''}.${format}`,
    content,
    filters: [{ name: isCsv ? 'CSV 文件' : 'JSON 文件', extensions: [format] }],
    // CSV 需 BOM，否则 Excel 打开中文乱码
    bom: isCsv,
  });
  if (savedPath) message.success(`已导出到 ${savedPath}`);
}
// #endregion
</script>

<style scoped lang="scss">
.stats {
  &__root {
    align-self: center;
    max-width: 360px;
    overflow: hidden;
    font-size: 12px;
    color: var(--tb-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__main {
    flex: 1;
    min-height: 0;
  }

  &__table {
    height: 100%;
  }

  &__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__progress-text {
    margin: 0;
    font-size: 14px;
    color: var(--tb-text-primary);
  }

  &__progress-dir {
    max-width: 80%;
    margin: 0;
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__panel-title {
    margin: 0 0 4px;
    font-size: 15px;
    color: var(--tb-text-primary);
  }

  &__hint {
    margin: 0 0 var(--tb-space-3);
    font-size: 12px;
    color: var(--tb-text-secondary);
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

  &__divider {
    margin: var(--tb-space-3) 0 var(--tb-space-4);
  }

  &__chart {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--tb-space-3);
  }

  &__legend {
    width: 100%;
  }

  &__legend-row {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    padding: 2px 0;
    font-size: 12px;
  }

  &__legend-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  &__legend-label {
    flex: 1;
    overflow: hidden;
    color: var(--tb-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__legend-value {
    color: var(--tb-text-primary);
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__footer-stats,
  &__footer-warn {
    display: flex;
    align-items: center;
    gap: var(--tb-space-4);
  }

  &__selected {
    color: var(--tb-color-primary);
  }

  &__warn {
    // 提示类警告，tokens 里暂无语义色，与 naive-ui warning 取同色
    color: #d97706;
    cursor: default;
  }

  &__errors {
    max-width: 420px;
    font-size: 12px;
    word-break: break-all;
  }
}
</style>
