<template>
  <ToolPageLayout
    title="精灵图"
    desc="多图合并为图集 + 坐标数据，或把图集切割为多张小图"
    category="图片工具"
  >
    <template #toolbar>
      <n-tabs v-model:value="tab" type="segment" size="small" class="sprite__tabs">
        <n-tab name="merge">合并图集</n-tab>
        <n-tab name="slice">切割图集</n-tab>
      </n-tabs>
    </template>

    <!-- 主区：合并=文件列表，切割=画布 -->
    <template #main>
      <div
        v-if="tab === 'merge'"
        class="sprite__split"
        :class="{ 'sprite__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <!-- 左：文件列表 -->
        <div class="sprite__split-left">
          <div class="sprite__bar">
            <n-button size="small" type="primary" @click="handleAddFiles">
              <template #icon><n-icon :component="CloudUploadOutline" /></template>
              添加文件
            </n-button>
            <n-button size="small" :loading="scanning" @click="handleAddFolder">
              <template #icon><n-icon :component="FolderOpenOutline" /></template>
              添加文件夹
            </n-button>
            <n-checkbox v-model:checked="mergeConfig.recursive" class="sprite__dim"
              >含子文件夹</n-checkbox
            >
            <n-button
              size="small"
              quaternary
              :disabled="!mergeChecked.length"
              @click="handleRemoveChecked"
            >
              移除选中{{ mergeChecked.length ? `(${mergeChecked.length})` : '' }}
            </n-button>
            <n-button
              size="small"
              quaternary
              :disabled="!mergeItems.length"
              @click="handleClearMerge"
            >
              清空
            </n-button>
          </div>
          <n-data-table
            v-if="mergeItems.length"
            v-model:checked-row-keys="mergeChecked"
            :columns="mergeColumns"
            :data="mergeItems"
            :row-key="(row: SpriteMergeItem) => row.id"
            :pagination="pagination"
            flex-height
            class="sprite__table"
            @update:page="(p: number) => (pagination.page = p)"
          />
          <div v-else class="sprite__empty">
            <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
            <p>拖拽图片到此处，或点击「添加文件」</p>
          </div>
        </div>

        <!-- 右：图集预览 -->
        <div class="sprite__split-right">
          <div class="sprite__preview-head">
            <span class="sprite__dim">图集预览</span>
            <n-button
              size="small"
              :loading="previewing"
              :disabled="!mergeItems.length"
              @click="handlePreview"
            >
              <template #icon><n-icon :component="RefreshOutline" /></template>
              刷新
            </n-button>
          </div>
          <div class="sprite__preview-body">
            <div v-if="previewSheets.length" class="sprite__preview-sheets">
              <figure v-for="(s, i) in previewSheets" :key="i" class="sprite__preview-figure">
                <img :src="s.dataUrl" class="sprite__preview-img" :alt="`图集 ${i + 1}`" />
                <figcaption class="sprite__preview-cap">
                  图集 {{ i + 1 }}：{{ s.width }} × {{ s.height }}，{{ s.frameCount }} 帧
                </figcaption>
              </figure>
            </div>
            <n-spin v-else-if="previewing" />
            <div v-else class="sprite__preview-empty">
              <n-icon :size="32" :depth="3" :component="GridOutline" />
              <p>点「刷新」按当前参数预览图集排布</p>
            </div>
          </div>
          <p v-if="previewSheets.length" class="sprite__preview-info">
            共 {{ previewSheets.length }} 张图集、{{ previewFrames }} 帧
          </p>
        </div>
      </div>

      <div
        v-else
        class="sprite__stage"
        :class="{ 'sprite__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <SpriteSliceCanvas
          v-if="sheetUrl"
          v-model:columns="lineColumns"
          v-model:rows="lineRows"
          :src="sheetUrl"
          :natural-width="sheetWidth"
          :natural-height="sheetHeight"
          :cells="cells"
          :editable="sliceConfig.method === 'lines'"
        />
        <div v-else class="sprite__empty">
          <n-icon :size="40" :depth="3" :component="ImageOutline" />
          <p>拖拽一张精灵表到此处，或点击「选择图集」</p>
          <n-button size="small" @click="handlePickSheet">选择图集</n-button>
        </div>
      </div>
    </template>

    <!-- 参数面板：合并 / 切割 各一套 -->
    <template #panel>
      <template v-if="tab === 'merge'">
        <h3 class="sprite__ptitle">排列</h3>
        <div class="sprite__field">
          <label class="sprite__label">列数（0 = 自动近似正方形）</label>
          <n-input-number v-model:value="mergeConfig.columns" size="small" :min="0" :max="64" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">间距 {{ mergeConfig.spacing }} px</label>
          <n-slider v-model:value="mergeConfig.spacing" :min="0" :max="64" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">外边距 {{ mergeConfig.padding }} px</label>
          <n-slider v-model:value="mergeConfig.padding" :min="0" :max="64" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">格内对齐</label>
          <n-select v-model:value="mergeConfig.align" :options="alignOptions" size="small" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">单张图集最大尺寸</label>
          <n-select v-model:value="mergeConfig.maxSize" :options="maxSizeOptions" size="small" />
          <p class="sprite__tip">放不下时按此尺寸拆成多张图集；不限则始终合成单张</p>
        </div>
        <div class="sprite__field sprite__field--row">
          <label class="sprite__label">剔除透明边</label>
          <n-switch v-model:value="mergeConfig.trim" size="small" />
        </div>

        <h3 class="sprite__ptitle sprite__ptitle--sub">输出</h3>
        <div class="sprite__field">
          <label class="sprite__label">坐标数据格式</label>
          <n-select
            v-model:value="mergeConfig.dataFormat"
            :options="dataFormatOptions"
            size="small"
          />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">图片格式</label>
          <n-select v-model:value="mergeConfig.format" :options="sheetFormatOptions" size="small" />
          <p v-if="mergeConfig.format === 'jpeg'" class="sprite__tip">
            JPG 不支持透明，间距/空隙会变黑
          </p>
        </div>
        <div class="sprite__field">
          <label class="sprite__label">图片质量 {{ mergeConfig.quality }}%</label>
          <n-slider
            v-model:value="mergeConfig.quality"
            :min="1"
            :max="100"
            :disabled="mergeConfig.format === 'gif'"
          />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">输出文件名</label>
          <n-input v-model:value="mergeConfig.baseName" size="small" placeholder="sprite" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">输出目录</label>
          <div class="sprite__dir">
            <n-input :value="mergeConfig.outputDir" size="small" placeholder="选择输出目录" />
            <n-button size="small" @click="pickMergeDir"
              ><n-icon :component="FolderOpenOutline"
            /></n-button>
          </div>
        </div>
        <n-button
          type="primary"
          block
          class="sprite__mt"
          :loading="merging"
          :disabled="!canMerge"
          @click="handleMerge"
        >
          {{ mergeChecked.length ? `合并选中 (${mergeChecked.length})` : '合并全部' }}
        </n-button>
      </template>

      <template v-else>
        <div class="sprite__field">
          <n-button size="small" block @click="handlePickSheet">
            <template #icon><n-icon :component="ImageOutline" /></template>
            {{ sheetPath ? '更换图集' : '选择图集' }}
          </n-button>
          <p v-if="sheetPath" class="sprite__tip">
            {{ sheetName }}（{{ sheetWidth }}×{{ sheetHeight }}）
          </p>
        </div>

        <div class="sprite__field">
          <label class="sprite__label">切割方式</label>
          <n-select v-model:value="sliceConfig.method" :options="methodOptions" size="small" />
        </div>

        <!-- 固定网格 -->
        <template v-if="sliceConfig.method === 'grid'">
          <div class="sprite__field">
            <label class="sprite__label">划分依据</label>
            <n-radio-group v-model:value="sliceConfig.byCount" size="small">
              <n-space vertical>
                <n-radio :value="true">按行列数（把整图等分成 M×N）</n-radio>
                <n-radio :value="false">按单元固定宽高（每格固定像素）</n-radio>
              </n-space>
            </n-radio-group>
          </div>
          <div v-if="sliceConfig.byCount" class="sprite__field">
            <label class="sprite__label">列数 / 行数</label>
            <div class="sprite__pair">
              <n-input-number
                v-model:value="sliceConfig.columns"
                size="small"
                :min="1"
                :max="128"
              />
              <n-input-number v-model:value="sliceConfig.rows" size="small" :min="1" :max="128" />
            </div>
          </div>
          <div v-else class="sprite__field">
            <label class="sprite__label">单元宽 / 高 px</label>
            <div class="sprite__pair">
              <n-input-number v-model:value="sliceConfig.cellWidth" size="small" :min="1" />
              <n-input-number v-model:value="sliceConfig.cellHeight" size="small" :min="1" />
            </div>
          </div>
          <div class="sprite__field">
            <label class="sprite__label">间距 / 外边距 px</label>
            <div class="sprite__pair">
              <n-input-number v-model:value="sliceConfig.spacing" size="small" :min="0" />
              <n-input-number v-model:value="sliceConfig.margin" size="small" :min="0" />
            </div>
          </div>
          <div class="sprite__field">
            <n-button size="small" block :disabled="!cells.length" @click="gridToLines">
              转为可调切割线（微调每条线）
            </n-button>
            <p class="sprite__tip">把当前网格拆成切割线，之后可在左侧逐条拖动 / 删除</p>
          </div>
        </template>

        <!-- 自动检测 -->
        <template v-else-if="sliceConfig.method === 'auto'">
          <div class="sprite__field">
            <label class="sprite__label">alpha 阈值 {{ sliceConfig.alphaThreshold }}</label>
            <n-slider v-model:value="sliceConfig.alphaThreshold" :min="0" :max="254" />
            <p class="sprite__tip">大于此值视为不透明，仅对带透明通道的图集有效</p>
          </div>
          <div class="sprite__field">
            <label class="sprite__label">最小面积 {{ sliceConfig.minArea }} px²</label>
            <n-slider v-model:value="sliceConfig.minArea" :min="1" :max="500" />
            <p class="sprite__tip">小于此面积的连通块当噪点丢弃</p>
          </div>
        </template>

        <!-- 导入坐标 -->
        <template v-else-if="sliceConfig.method === 'import'">
          <div class="sprite__field">
            <n-button size="small" block @click="handlePickData"
              >选择坐标文件（JSON / plist）</n-button
            >
            <p v-if="dataPath" class="sprite__tip">{{ dataName }}</p>
          </div>
        </template>

        <!-- 手动切割线 -->
        <template v-else>
          <p class="sprite__tip sprite__tip--pull">
            双击画面加十字线，或用下方按钮单独加横 / 纵线；拖动线调整，双击线删除
          </p>
          <div class="sprite__field">
            <div class="sprite__pair">
              <n-button size="small" @click="addLine('col')">加纵线</n-button>
              <n-button size="small" @click="addLine('row')">加横线</n-button>
            </div>
          </div>
          <div class="sprite__field">
            <n-button
              size="small"
              block
              :disabled="!lineColumns.length && !lineRows.length"
              @click="clearLines"
            >
              清空切割线（纵 {{ lineColumns.length }} / 横 {{ lineRows.length }}）
            </n-button>
          </div>
        </template>

        <p class="sprite__count">将切出 {{ cells.length }} 张</p>

        <h3 class="sprite__ptitle sprite__ptitle--sub">输出</h3>
        <div class="sprite__field">
          <label class="sprite__label">输出格式</label>
          <n-select v-model:value="sliceConfig.format" :options="sheetFormatOptions" size="small" />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">图片质量 {{ sliceConfig.quality }}%</label>
          <n-slider
            v-model:value="sliceConfig.quality"
            :min="1"
            :max="100"
            :disabled="sliceConfig.format === 'gif'"
          />
        </div>
        <div class="sprite__field">
          <label class="sprite__label">输出目录</label>
          <div class="sprite__dir">
            <n-input
              :value="sliceConfig.outputDir"
              size="small"
              readonly
              placeholder="选择输出目录"
            />
            <n-button size="small" @click="pickSliceDir"
              ><n-icon :component="FolderOpenOutline"
            /></n-button>
          </div>
        </div>
        <n-button
          type="primary"
          block
          class="sprite__mt"
          :loading="slicing"
          :disabled="!canSlice"
          @click="handleSlice"
        >
          切割导出 ({{ cells.length }})
        </n-button>
      </template>
    </template>

    <template #footer>
      <div class="sprite__footer">
        <span v-if="tab === 'merge'">已选择 {{ mergeItems.length }} 张图片</span>
        <span v-else>{{
          sheetPath ? `图集 ${sheetWidth}×${sheetHeight}，将切出 ${cells.length} 张` : '未选择图集'
        }}</span>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NSpin,
  NSwitch,
  NTab,
  NTabs,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  CloudUploadOutline,
  FolderOpenOutline,
  GridOutline,
  ImageOutline,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  ImageOutputFormat,
  PickedFile,
  SpriteAlign,
  SpriteCell,
  SpriteDataFormat,
  SpriteGridSpec,
  SpriteMergeOptions,
  SpriteSheetPreview,
  SpriteSliceMethod,
  SpriteSliceProbeOptions,
} from '@shared/types';
import type { SpriteMergeItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import SpriteSliceCanvas from '@/components/common/SpriteSliceCanvas.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  getDataUrlApi,
  getThumbnailApi,
  spriteMergeApi,
  spriteMergePreviewApi,
  spriteSliceApi,
  spriteSliceProbeApi,
} from '@/services/image';
import { createTaskQueue } from '@/utils/taskQueue';

const message = useMessage();

const ACCEPT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff'];
const PAGE_SIZE = 50;
const MAX_FILES = 10_000;
const PROBE_DEBOUNCE = 300;

/** 当前 tab。 */
const tab = ref<'merge' | 'slice'>('merge');

type SheetFormat = Exclude<ImageOutputFormat, 'original'>;

const alignOptions = [
  { label: '左上对齐', value: 'topLeft' },
  { label: '居中', value: 'center' },
];
const dataFormatOptions = [
  { label: 'JSON（TexturePacker / PixiJS）', value: 'json' },
  { label: '纯 CSS', value: 'css' },
  { label: 'Cocos plist', value: 'plist' },
  { label: '只出图，不出坐标', value: 'none' },
];
const sheetFormatOptions = [
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'AVIF', value: 'avif' },
  { label: 'JPG', value: 'jpeg' },
  { label: 'GIF', value: 'gif' },
  { label: 'TIFF', value: 'tiff' },
];
const methodOptions = [
  { label: '固定网格', value: 'grid' },
  { label: '手动切割线', value: 'lines' },
  { label: '导入坐标（JSON / plist）', value: 'import' },
  { label: '自动检测边界（透明连通域）', value: 'auto' },
];
const maxSizeOptions = [
  { label: '不限（单张）', value: 0 },
  { label: '1024 × 1024', value: 1024 },
  { label: '2048 × 2048', value: 2048 },
  { label: '4096 × 4096', value: 4096 },
];

// ── drop：合并 tab 收图片，切割 tab 收单张表 ──
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: tab.value === 'merge' ? ACCEPT : ACCEPT,
  onDrop: (files) => {
    if (tab.value === 'merge') addFiles(files);
    else if (files[0]) loadSheet(files[0]);
  },
});

/* ═══════════════ 合并 ═══════════════ */

const mergeItems = ref<SpriteMergeItem[]>([]);
const mergeChecked = ref<string[]>([]);
const merging = ref(false);

// 合并预览
const previewing = ref(false);
const previewSheets = ref<SpriteSheetPreview[]>([]);
const previewFrames = ref(0);
let seq = 0;

const { config: mergeConfig } = useToolConfig('image-sprite-merge', {
  columns: 0,
  spacing: 2,
  padding: 0,
  align: 'topLeft' as SpriteAlign,
  maxSize: 0,
  trim: false,
  dataFormat: 'json' as SpriteDataFormat,
  format: 'png' as SheetFormat,
  quality: 90,
  baseName: 'sprite',
  outputDir: '',
  recursive: false,
});

const { scanning, importFolder } = useFolderImport({
  key: 'sprite',
  accept: ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择图片文件夹',
});

const thumbQueue = createTaskQueue(4);
const thumbRequested = new Set<string>();

const pagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  showQuickJumper: true,
  prefix: ({ itemCount }: { itemCount?: number }) => `共 ${itemCount ?? 0} 张`,
});
watch(
  () => mergeItems.value.length,
  (count) => {
    pagination.itemCount = count;
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (pagination.page > pageCount) pagination.page = pageCount;
  },
  { immediate: true },
);

const visibleItems = computed(() =>
  mergeItems.value.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE),
);
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (row.thumbnail || thumbRequested.has(row.id)) continue;
      thumbRequested.add(row.id);
      const { id, path } = row;
      thumbQueue.push(async () => {
        const url = await getThumbnailApi(path);
        const target = mergeItems.value.find((i) => i.id === id);
        if (target) target.thumbnail = url;
      });
    }
  },
  { immediate: true },
);

const mergeColumns: DataTableColumns<SpriteMergeItem> = [
  { type: 'selection' },
  {
    title: '预览',
    key: 'thumbnail',
    width: 56,
    render: (row) =>
      row.thumbnail
        ? h('img', {
            src: row.thumbnail,
            style: 'width:36px;height:36px;object-fit:contain;border-radius:4px;display:block;',
          })
        : h('div', {
            style: 'width:36px;height:36px;border-radius:4px;background:var(--tb-bg-hover);',
          }),
  },
  { title: '文件名', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '操作',
    key: 'actions',
    width: 56,
    render: (row) =>
      h(
        NButton,
        { text: true, type: 'error', size: 'small', onClick: () => removeItem(row.id) },
        { icon: () => h(NIcon, { component: TrashOutline }) },
      ),
  },
];

const canMerge = computed(
  () => mergeItems.value.length > 0 && !merging.value && !!mergeConfig.outputDir,
);

function addFiles(files: PickedFile[]): void {
  const existing = new Set(mergeItems.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;
  for (const file of fresh) {
    mergeItems.value.push({ ...file, id: `sm-${seq++}`, status: 'pending' });
  }
}

async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '图片', extensions: ACCEPT }],
    title: '选择要合并的图片',
  });
  if (files.length) addFiles(files);
}

async function handleAddFolder(): Promise<void> {
  const before = mergeItems.value.length;
  const files = await importFolder(mergeConfig.recursive);
  if (!files.length) return;
  addFiles(files);
  const added = mergeItems.value.length - before;
  if (added) message.success(`已添加 ${added} 张图片`);
  else message.info('这些图片已在列表中');
}

function handleClearMerge(): void {
  mergeItems.value = [];
  mergeChecked.value = [];
  thumbQueue.clear();
  thumbRequested.clear();
}

function handleRemoveChecked(): void {
  const removing = new Set(mergeChecked.value);
  mergeItems.value = mergeItems.value.filter((i) => !removing.has(i.id));
  mergeChecked.value = [];
}

function removeItem(id: string): void {
  mergeItems.value = mergeItems.value.filter((i) => i.id !== id);
  mergeChecked.value = mergeChecked.value.filter((k) => k !== id);
}

async function pickMergeDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) mergeConfig.outputDir = dir;
}

/** 组装合并选项（合并与预览共用，保证所见即所得）。 */
function buildMergeOptions(): SpriteMergeOptions {
  const selected = new Set(mergeChecked.value);
  const targets = selected.size
    ? mergeItems.value.filter((i) => selected.has(i.id))
    : mergeItems.value;
  return {
    sources: targets.map((i) => i.path),
    layout: 'grid',
    columns: mergeConfig.columns,
    spacing: mergeConfig.spacing,
    padding: mergeConfig.padding,
    align: mergeConfig.align,
    maxSize: mergeConfig.maxSize,
    trim: mergeConfig.trim,
    dataFormat: mergeConfig.dataFormat,
    format: mergeConfig.format,
    quality: mergeConfig.quality,
    outputDir: mergeConfig.outputDir,
    baseName: mergeConfig.baseName || 'sprite',
  };
}

async function handlePreview(): Promise<void> {
  previewing.value = true;
  try {
    const result = await spriteMergePreviewApi(buildMergeOptions());
    previewSheets.value = result.sheets;
    previewFrames.value = result.frameCount;
  } catch {
    // 预览失败已由 service 静默处理
  } finally {
    previewing.value = false;
  }
}

async function handleMerge(): Promise<void> {
  merging.value = true;
  try {
    const result = await spriteMergeApi(buildMergeOptions());
    const msg =
      result.sheetCount > 1
        ? `已合并 ${result.frameCount} 张 → ${result.sheetCount} 张图集`
        : `已合并 ${result.frameCount} 张`;
    message.success(msg);
  } catch {
    // 错误已由 service 统一弹出
  } finally {
    merging.value = false;
  }
}

/* ═══════════════ 切割 ═══════════════ */

const sheetPath = ref('');
const sheetUrl = ref('');
const sheetWidth = ref(0);
const sheetHeight = ref(0);
const dataPath = ref('');
const cells = ref<SpriteCell[]>([]);
const slicing = ref(false);

const lineColumns = ref<number[]>([]);
const lineRows = ref<number[]>([]);

const sheetName = computed(() => sheetPath.value.split(/[\\/]/).pop() ?? '');
const dataName = computed(() => dataPath.value.split(/[\\/]/).pop() ?? '');

const { config: sliceConfig } = useToolConfig('image-sprite-slice', {
  method: 'grid' as SpriteSliceMethod,
  byCount: true,
  columns: 4,
  rows: 4,
  cellWidth: 64,
  cellHeight: 64,
  spacing: 0,
  margin: 0,
  alphaThreshold: 0,
  minArea: 16,
  format: 'png' as SheetFormat,
  quality: 90,
  outputDir: '',
});

const canSlice = computed(
  () => !!sheetPath.value && cells.value.length > 0 && !slicing.value && !!sliceConfig.outputDir,
);

/** 载入一张精灵表：用原图 data URL 显示，并读原始尺寸后触发探测。 */
async function loadSheet(file: PickedFile): Promise<void> {
  sheetPath.value = file.path;
  cells.value = [];
  lineColumns.value = [];
  lineRows.value = [];
  sheetUrl.value = '';
  let url = '';
  try {
    url = await getDataUrlApi(file.path);
  } catch {
    // 错误提示已由 service 弹出
    sheetPath.value = '';
    return;
  }
  // 用 <img> 读原始像素尺寸，画布坐标全靠它
  const img = new Image();
  img.onload = (): void => {
    sheetWidth.value = img.naturalWidth;
    sheetHeight.value = img.naturalHeight;
    sheetUrl.value = url;
    scheduleProbe();
  };
  img.onerror = (): void => {
    message.error('无法读取该图片');
    sheetPath.value = '';
  };
  img.src = url;
}

async function handlePickSheet(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '图片', extensions: ACCEPT }],
    title: '选择精灵表',
  });
  if (files[0]) await loadSheet(files[0]);
}

async function handlePickData(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '坐标数据', extensions: ['json', 'plist'] }],
    title: '选择坐标文件',
  });
  if (files[0]) {
    dataPath.value = files[0].path;
    scheduleProbe();
  }
}

function clearLines(): void {
  lineColumns.value = [];
  lineRows.value = [];
}

/** 单独加一条切割线，落在表正中央，加完即可在画布上拖到目标位置。 */
function addLine(kind: 'col' | 'row'): void {
  if (kind === 'col') {
    const mid = Math.round(sheetWidth.value / 2);
    lineColumns.value = [...lineColumns.value, mid].sort((a, b) => a - b);
  } else {
    const mid = Math.round(sheetHeight.value / 2);
    lineRows.value = [...lineRows.value, mid].sort((a, b) => a - b);
  }
}

/**
 * 把当前固定网格拆成可拖动的切割线并切到 lines 模式。
 *
 * 网格模式的线是「按参数算出来的」不能逐条拖；用户想微调某一条时，用这个把网格的
 * 内部边界取出来当切割线（去掉 0 与表边界，只留内部分隔线），之后就能逐条拖 / 删。
 */
function gridToLines(): void {
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (const cell of cells.value) {
    const { left, top, width, height } = cell.rect;
    if (left > 0) xs.add(left);
    if (top > 0) ys.add(top);
    if (left + width < sheetWidth.value) xs.add(left + width);
    if (top + height < sheetHeight.value) ys.add(top + height);
  }
  lineColumns.value = [...xs].sort((a, b) => a - b);
  lineRows.value = [...ys].sort((a, b) => a - b);
  sliceConfig.method = 'lines';
}

/** 组装探测选项（纯对象，可过 IPC）。 */
function buildProbeOptions(): SpriteSliceProbeOptions {
  const grid: SpriteGridSpec = {
    columns: sliceConfig.byCount ? sliceConfig.columns : 0,
    rows: sliceConfig.byCount ? sliceConfig.rows : 0,
    cellWidth: sliceConfig.byCount ? 0 : sliceConfig.cellWidth,
    cellHeight: sliceConfig.byCount ? 0 : sliceConfig.cellHeight,
    spacing: sliceConfig.spacing,
    margin: sliceConfig.margin,
  };
  return {
    method: sliceConfig.method,
    grid,
    columnsAt: [...lineColumns.value],
    rowsAt: [...lineRows.value],
    dataPath: dataPath.value || undefined,
    alphaThreshold: sliceConfig.alphaThreshold,
    minArea: sliceConfig.minArea,
  };
}

async function probeCells(): Promise<void> {
  if (!sheetPath.value) return;
  if (sliceConfig.method === 'import' && !dataPath.value) {
    cells.value = [];
    return;
  }
  try {
    const probe = await spriteSliceProbeApi(sheetPath.value, buildProbeOptions());
    sheetWidth.value = probe.width;
    sheetHeight.value = probe.height;
    cells.value = probe.cells;
  } catch {
    cells.value = [];
  }
}

let probeTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleProbe(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(probeCells, PROBE_DEBOUNCE);
}

// 任一切割参数 / 切割线变化都要重新探测
watch(
  () => [
    sliceConfig.method,
    sliceConfig.byCount,
    sliceConfig.columns,
    sliceConfig.rows,
    sliceConfig.cellWidth,
    sliceConfig.cellHeight,
    sliceConfig.spacing,
    sliceConfig.margin,
    sliceConfig.alphaThreshold,
    sliceConfig.minArea,
    lineColumns.value,
    lineRows.value,
  ],
  () => scheduleProbe(),
  { deep: true },
);

async function pickSliceDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) sliceConfig.outputDir = dir;
}

async function handleSlice(): Promise<void> {
  slicing.value = true;
  try {
    const result = await spriteSliceApi(sheetPath.value, {
      cells: cells.value.map((c) => ({ rect: { ...c.rect }, name: c.name })),
      format: sliceConfig.format,
      quality: sliceConfig.quality,
      outputDir: sliceConfig.outputDir,
    });
    const msg = result.skipped
      ? `已切出 ${result.outputPaths.length} 张，跳过 ${result.skipped} 个非法单元`
      : `已切出 ${result.outputPaths.length} 张`;
    message.success(msg);
  } catch {
    // 错误已由 service 统一弹出
  } finally {
    slicing.value = false;
  }
}
</script>

<style scoped lang="scss">
.sprite {
  &__tabs {
    max-width: 260px;
  }

  &__bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-3);
    align-items: center;
  }

  &__dim {
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__list,
  &__stage {
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

  &__stage {
    align-items: stretch;
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
    height: 100%;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
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

  &__pair {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--tb-text-secondary);

    &--pull {
      margin-top: 0;
      margin-bottom: var(--tb-space-3);
    }
  }

  &__count {
    margin: var(--tb-space-3) 0 0;
    font-size: 13px;
    color: var(--tb-color-primary);
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

  &__split {
    display: flex;
    gap: var(--tb-space-3);
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
    overflow: auto;
    border-radius: var(--tb-radius-sm);
    // 透明图集的棋盘底，看清帧边界与间距
    background:
      linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
      linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
    background-color: #1e1e1e;
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  // 多张图集竖排；顶端对齐，只有一张时也不拉伸
  &__preview-sheets {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
    align-self: flex-start;
    width: 100%;
    padding: var(--tb-space-2);
  }

  &__preview-figure {
    margin: 0;
    text-align: center;
  }

  &__preview-cap {
    margin-top: var(--tb-space-1);
    font-size: 12px;
    color: var(--tb-text-secondary);
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
  }

  &__preview-img {
    max-width: 100%;
    object-fit: contain;
  }

  &__preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--tb-space-2);
    padding: var(--tb-space-4);
    font-size: 12px;
    text-align: center;
    color: var(--tb-text-secondary);
  }

  &__preview-info {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    text-align: center;
    color: var(--tb-text-secondary);
  }
}
</style>
