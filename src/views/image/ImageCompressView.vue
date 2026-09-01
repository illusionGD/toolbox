<template>
  <ToolPageLayout
    title="图片压缩 / 转换"
    desc="批量压缩与格式转换，支持 JPG / PNG / WebP / AVIF / GIF / TIFF"
    category="图片工具"
  >
    <!-- 操作栏 -->
    <template #toolbar>
      <n-space align="center">
        <n-button type="primary" @click="handleAddFiles">
          <template #icon><n-icon :component="CloudUploadOutline" /></template>
          添加文件
        </n-button>
        <n-button :loading="scanning" @click="handleAddFolder">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          添加文件夹
        </n-button>
        <n-checkbox v-model:checked="config.recursive" class="compress__recursive">
          含子文件夹
        </n-checkbox>
        <n-button quaternary :disabled="!checkedKeys.length" @click="handleRemoveChecked">
          <template #icon><n-icon :component="TrashOutline" /></template>
          移除选中{{ checkedKeys.length ? `(${checkedKeys.length})` : '' }}
        </n-button>
        <n-button quaternary :disabled="!items.length" @click="handleClear">
          <template #icon><n-icon :component="TrashOutline" /></template>
          清空列表
        </n-button>
      </n-space>
    </template>

    <!-- 文件列表 -->
    <template #main>
      <div
        class="compress__list"
        :class="{ 'compress__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <n-data-table
          v-if="items.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="items"
          :row-key="(row: CompressItem) => row.id"
          :pagination="pagination"
          flex-height
          class="compress__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="compress__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽图片到此处，或点击「添加文件」</p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <h3 class="compress__panel-title">输出设置</h3>

      <div class="compress__field">
        <label class="compress__label">输出格式</label>
        <n-select v-model:value="config.format" :options="formatOptions" size="small" />
        <p v-if="config.format === 'original'" class="compress__tip">
          SVG / HEIC 等只读格式将输出为 PNG
        </p>
      </div>

      <div class="compress__field">
        <label class="compress__label">压缩模式</label>
        <n-radio-group v-model:value="config.mode" size="small" @update:value="handleModeChange">
          <n-space vertical>
            <n-radio value="fast">快速压缩</n-radio>
            <n-radio value="balanced">均衡压缩</n-radio>
            <n-radio value="high">高质量压缩</n-radio>
          </n-space>
        </n-radio-group>
      </div>

      <div class="compress__field">
        <label class="compress__label">图片质量 {{ config.quality }}%</label>
        <n-slider
          v-model:value="config.quality"
          :min="1"
          :max="100"
          :step="1"
          :disabled="!qualityEnabled"
        />
        <p v-if="!qualityEnabled" class="compress__tip">
          {{
            config.format === 'gif'
              ? 'GIF 为调色板格式，体积由「颜色数」决定'
              : 'TIFF 仅在 JPEG 压缩下使用质量参数'
          }}
        </p>
      </div>

      <!-- 动图保留：仅当列表里有 gif/webp 时才有意义 -->
      <div v-if="hasAnimatable" class="compress__field compress__field--row">
        <label class="compress__label">保留动画帧</label>
        <n-tooltip :disabled="targetSupportsAnimation">
          <template #trigger>
            <n-switch
              v-model:value="config.keepAnimation"
              size="small"
              :disabled="!targetSupportsAnimation"
            />
          </template>
          目标格式不支持多帧，将只输出首帧
        </n-tooltip>
      </div>

      <!-- 按格式展开的高级选项 -->
      <n-collapse v-if="activeAdvancedFormat" class="compress__advanced">
        <n-collapse-item title="高级设置" name="advanced">
          <!-- JPEG -->
          <template v-if="activeAdvancedFormat === 'jpeg'">
            <div class="compress__field compress__field--row">
              <label class="compress__label">渐进式</label>
              <n-switch v-model:value="config.advanced.jpeg.progressive" size="small" />
            </div>
            <div class="compress__field compress__field--row">
              <label class="compress__label">mozjpeg 优化</label>
              <n-switch v-model:value="config.advanced.jpeg.mozjpeg" size="small" />
            </div>
            <div class="compress__field">
              <label class="compress__label">色度子采样</label>
              <n-select
                v-model:value="config.advanced.jpeg.chromaSubsampling"
                :options="chromaOptions"
                size="small"
              />
            </div>
          </template>

          <!-- PNG -->
          <template v-else-if="activeAdvancedFormat === 'png'">
            <div class="compress__field">
              <label class="compress__label"
                >压缩级别 {{ config.advanced.png.compressionLevel }}</label
              >
              <n-slider
                v-model:value="config.advanced.png.compressionLevel"
                :min="0"
                :max="9"
                :step="1"
              />
            </div>
            <div class="compress__field compress__field--row">
              <label class="compress__label">隔行扫描</label>
              <n-switch v-model:value="config.advanced.png.progressive" size="small" />
            </div>
            <div class="compress__field compress__field--row">
              <label class="compress__label">调色板量化</label>
              <n-switch v-model:value="config.advanced.png.palette" size="small" />
            </div>
          </template>

          <!-- WebP -->
          <template v-else-if="activeAdvancedFormat === 'webp'">
            <div class="compress__field compress__field--row">
              <label class="compress__label">无损</label>
              <n-switch v-model:value="config.advanced.webp.lossless" size="small" />
            </div>
            <div class="compress__field">
              <label class="compress__label">编码强度 {{ config.advanced.webp.effort }}</label>
              <n-slider v-model:value="config.advanced.webp.effort" :min="0" :max="6" :step="1" />
            </div>
          </template>

          <!-- AVIF -->
          <template v-else-if="activeAdvancedFormat === 'avif'">
            <div class="compress__field compress__field--row">
              <label class="compress__label">无损</label>
              <n-switch v-model:value="config.advanced.avif.lossless" size="small" />
            </div>
            <div class="compress__field">
              <label class="compress__label">编码强度 {{ config.advanced.avif.effort }}</label>
              <n-slider v-model:value="config.advanced.avif.effort" :min="0" :max="9" :step="1" />
            </div>
          </template>

          <!-- GIF -->
          <template v-else-if="activeAdvancedFormat === 'gif'">
            <div class="compress__field">
              <label class="compress__label">颜色数 {{ config.advanced.gif.colours }}</label>
              <n-slider v-model:value="config.advanced.gif.colours" :min="2" :max="256" :step="1" />
            </div>
            <div class="compress__field">
              <label class="compress__label">抖动 {{ config.advanced.gif.dither }}</label>
              <n-slider v-model:value="config.advanced.gif.dither" :min="0" :max="1" :step="0.1" />
            </div>
          </template>

          <!-- TIFF -->
          <template v-else-if="activeAdvancedFormat === 'tiff'">
            <div class="compress__field">
              <label class="compress__label">压缩算法</label>
              <n-select
                v-model:value="config.advanced.tiff.compression"
                :options="tiffCompressionOptions"
                size="small"
              />
            </div>
          </template>
        </n-collapse-item>
      </n-collapse>

      <div class="compress__field">
        <label class="compress__label">最大宽度</label>
        <n-select v-model:value="config.maxWidthPreset" :options="maxWidthOptions" size="small" />
        <n-input-number
          v-if="config.maxWidthPreset === 'custom'"
          v-model:value="config.maxWidthCustom"
          class="compress__mt"
          size="small"
          :min="1"
          placeholder="像素"
        />
      </div>

      <div class="compress__field">
        <label class="compress__label">输出目录</label>
        <div class="compress__dir">
          <n-input v-model:value="config.outputDir" size="small" placeholder="选择或粘贴输出目录" />
          <n-button size="small" :disabled="config.overwrite" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <div class="compress__field compress__field--row">
        <label class="compress__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

      <n-button
        type="primary"
        block
        class="compress__mt"
        :loading="processing"
        :disabled="!canStart"
        @click="handleStart"
      >
        {{ startLabel }}
      </n-button>
    </template>

    <!-- 底部统计 -->
    <template #footer>
      <div class="compress__footer">
        <span>已选择 {{ items.length }} 个文件</span>
        <div class="compress__footer-stats">
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>处理后 {{ formatBytes(totalCompressed) }}</span>
          <span v-if="totalRatio !== null" class="compress__footer-ratio">
            {{ totalRatio < 0 ? `体积增大 ${-totalRatio}%` : `体积减小 ${totalRatio}%` }}
          </span>
        </div>
      </div>
    </template>
  </ToolPageLayout>

  <ImagePreviewModal
    v-model:show="previewShow"
    :title="previewTitle"
    :original-url="previewOriginal"
    :compressed-url="previewCompressed"
    :result-label="previewResultLabel"
  />
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NRadio,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NSwitch,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { CloudUploadOutline, EyeOutline, FolderOpenOutline, TrashOutline } from '@vicons/ionicons5';
import type { CompressOptions, FormatAdvanced, ImageOutputFormat, PickedFile } from '@shared/types';
import type { CompressItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import ImagePreviewModal from '@/components/common/ImagePreviewModal.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickFilesApi, pickDirectoryApi } from '@/services/fs';
import { compressImageApi, getDataUrlApi, getThumbnailApi } from '@/services/image';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

// #region state
const message = useMessage();

/** 支持的图片扩展名（sharp 可解码的格式；bmp 需 magick，当前构建不支持）。 */
const ACCEPT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff', 'svg', 'heic', 'heif'];

/** 每页行数。分页把缩略图的加载量固定在一页之内，导入上千张也不会卡。 */
const PAGE_SIZE = 50;

/** 从文件夹导入的上限。 */
const MAX_FILES = 50_000;

/** 缩略图并发数：主进程逐个 sharp 解码，开太多只是互相排队还占满 CPU。 */
const THUMB_CONCURRENCY = 4;

const items = ref<CompressItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;

/** 各格式高级选项默认值。 */
const DEFAULT_ADVANCED: FormatAdvanced = {
  jpeg: { progressive: false, mozjpeg: false, chromaSubsampling: '4:2:0' },
  png: { compressionLevel: 6, progressive: false, palette: false },
  webp: { lossless: false, effort: 4 },
  avif: { lossless: false, effort: 4 },
  gif: { colours: 256, dither: 1 },
  tiff: { compression: 'lzw' },
};

/** 持久化的处理配置（记住上次使用）。 */
const { config } = useToolConfig('image-compress', {
  format: 'original' as ImageOutputFormat,
  quality: 75,
  mode: 'balanced' as 'fast' | 'balanced' | 'high',
  maxWidthPreset: 'none' as 'none' | '1920' | '1280' | 'custom',
  maxWidthCustom: 1920,
  outputDir: '',
  overwrite: false,
  keepAnimation: true,
  recursive: false,
  advanced: DEFAULT_ADVANCED,
});

/** 从文件夹添加（逻辑与裁剪/风格化/重命名四页共用）。 */
const { scanning, importFolder } = useFolderImport({
  key: 'compress',
  accept: ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择图片文件夹',
});

const formatOptions = [
  { label: '保持原格式', value: 'original' },
  { label: 'JPG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'AVIF', value: 'avif' },
  { label: 'GIF', value: 'gif' },
  { label: 'TIFF', value: 'tiff' },
];

const maxWidthOptions = [
  { label: '不调整', value: 'none' },
  { label: '1920 px', value: '1920' },
  { label: '1280 px', value: '1280' },
  { label: '自定义', value: 'custom' },
];

const chromaOptions = [
  { label: '4:2:0（更小）', value: '4:2:0' },
  { label: '4:4:4（更清晰）', value: '4:4:4' },
];

const tiffCompressionOptions = [
  { label: 'LZW（无损）', value: 'lzw' },
  { label: 'Deflate（无损，更小）', value: 'deflate' },
  { label: 'JPEG（有损，看质量）', value: 'jpeg' },
  { label: '不压缩', value: 'none' },
];

// 预览
const previewShow = ref(false);
const previewTitle = ref('');
const previewOriginal = ref('');
const previewCompressed = ref('');
/** 预览右栏标题：同格式叫「压缩后」，跨格式叫「转换后」。 */
const previewResultLabel = ref('处理后');
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => addFiles(files),
});
// #endregion

// #region getters
/** 当前生效的输出格式（original 时按“暂无法预知”处理，展开面板用）。 */
const activeAdvancedFormat = computed<Exclude<ImageOutputFormat, 'original'> | null>(() =>
  config.format === 'original' ? null : config.format,
);

/** 质量滑块是否生效：gif 是调色板格式、tiff 仅 jpeg 压缩时看质量。 */
const qualityEnabled = computed(() => {
  if (config.format === 'gif') return false;
  if (config.format === 'tiff') return config.advanced.tiff.compression === 'jpeg';
  return true;
});

/** 列表中是否有动图（gif/webp 可能多帧），用于决定是否显示保留动画开关。 */
const hasAnimatable = computed(() => items.value.some((i) => i.ext === 'gif' || i.ext === 'webp'));

/** 目标格式是否支持多帧（avif 在当前 libvips 下编码后只剩 1 帧，不算）。 */
const targetSupportsAnimation = computed(
  () => config.format === 'original' || config.format === 'gif' || config.format === 'webp',
);

const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalCompressed = computed(() =>
  items.value.reduce((s, i) => s + (i.compressedSize ?? 0), 0),
);
const totalRatio = computed(() => {
  const done = items.value.filter((i) => i.compressedSize !== undefined);
  if (!done.length) return null;
  const orig = done.reduce((s, i) => s + i.size, 0);
  const comp = done.reduce((s, i) => s + (i.compressedSize ?? 0), 0);
  // 转格式时可能变大，负数如实展示
  return orig > 0 ? Math.round((1 - comp / orig) * 100) : 0;
});
const canStart = computed(
  () => items.value.length > 0 && !processing.value && (config.overwrite || !!config.outputDir),
);

/** 开始按钮文案：有勾选时提示只处理选中数量。 */
const startLabel = computed(() =>
  checkedKeys.value.length ? `开始处理 (${checkedKeys.value.length})` : '开始处理',
);

/** 表格分页（受控，因为要知道当前页是哪些行才能只给它们加载缩略图）。 */
const pagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  showQuickJumper: true,
  prefix: ({ itemCount }: { itemCount?: number }) => `共 ${itemCount ?? 0} 张`,
});
watch(
  () => items.value.length,
  (count) => {
    pagination.itemCount = count;
    // 删到当前页没了要退回去，否则表格空白但分页器停在旧页码
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (pagination.page > pageCount) pagination.page = pageCount;
  },
  { immediate: true },
);

/**
 * 当前页的行。
 * 表格未开任何列排序，`:data` 的顺序就是渲染顺序，所以这样切片与表格内部一致。
 */
const visibleItems = computed(() =>
  items.value.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE),
);

/** 缩略图加载队列 + 已入队的 id，避免翻回上一页时重复发请求。 */
const thumbQueue = createTaskQueue(THUMB_CONCURRENCY);
const thumbRequested = new Set<string>();

/**
 * 只为当前页缺缩略图的行排队加载。
 *
 * 从前是在 addFiles 里逐个 `void getThumbnailApi()`，手挑十几个文件没问题，
 * 但文件夹导入上千张会同时打爆主进程——分页 + 限并发把这件事的规模钉在一页之内。
 */
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (row.thumbnail || thumbRequested.has(row.id)) continue;
      thumbRequested.add(row.id);
      const { id, path } = row;
      thumbQueue.push(async () => {
        const url = await getThumbnailApi(path);
        // await 期间用户可能已移除该项，按 id 回查而不是复用引用
        const target = items.value.find((i) => i.id === id);
        if (target) target.thumbnail = url;
      });
    }
  },
  { immediate: true },
);
// #endregion

// #region columns
const columns: DataTableColumns<CompressItem> = [
  { type: 'selection' },
  {
    title: '预览',
    key: 'thumbnail',
    width: 60,
    render: (row) =>
      row.thumbnail
        ? h('img', {
            src: row.thumbnail,
            style: 'width:36px;height:36px;object-fit:cover;border-radius:4px;display:block;',
          })
        : h('div', {
            style: 'width:36px;height:36px;border-radius:4px;background:var(--tb-bg-hover);',
          }),
  },
  { title: '文件名', key: 'name', ellipsis: { tooltip: true } },
  {
    title: '输出',
    key: 'outputFormat',
    width: 84,
    render: (row) => {
      if (!row.outputFormat) return '—';
      const label = row.outputFormat === 'jpeg' ? 'JPG' : row.outputFormat.toUpperCase();
      return row.animated ? `${label} · 动图` : label;
    },
  },
  { title: '原大小', key: 'size', width: 90, render: (row) => formatBytes(row.size) },
  {
    title: '处理后',
    key: 'compressedSize',
    width: 90,
    render: (row) => (row.compressedSize !== undefined ? formatBytes(row.compressedSize) : '—'),
  },
  {
    title: '体积变化',
    key: 'ratio',
    width: 88,
    // 转格式可能让体积变大，用正负号与颜色区分，不再截断为 0
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
    width: 92,
    render: (row) =>
      row.status === 'error' && row.error
        ? h(NTooltip, null, {
            trigger: () => h(StatusTag, { status: row.status }),
            default: () => row.error,
          })
        : h(StatusTag, { status: row.status }),
  },
  {
    title: '操作',
    key: 'actions',
    width: 96,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(
          NButton,
          { text: true, size: 'small', onClick: () => openPreview(row) },
          { icon: () => h(NIcon, { component: EyeOutline }) },
        ),
        h(
          NButton,
          { text: true, type: 'error', size: 'small', onClick: () => removeItem(row.id) },
          { icon: () => h(NIcon, { component: TrashOutline }) },
        ),
      ]),
  },
];
// #endregion

// #region actions
/** 追加文件（按路径去重）。缩略图不在这里加载，交给当前页的 watch 按需取。 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;

  for (const file of fresh) {
    items.value.push({ ...file, id: `img-${seq++}`, status: 'pending' });
  }
}

/** 打开文件选择。 */
async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '图片', extensions: ACCEPT }],
    title: '选择要处理的图片',
  });
  if (files.length) addFiles(files);
}

/** 从文件夹批量导入（扩展名过滤在主进程遍历时完成）。 */
async function handleAddFolder(): Promise<void> {
  const before = items.value.length;
  const files = await importFolder(config.recursive);
  if (!files.length) return;
  addFiles(files);
  const added = items.value.length - before;
  if (added) message.success(`已添加 ${added} 张图片`);
  else message.info('这些图片已在列表中');
}

/** 清空列表。 */
function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
  thumbQueue.clear();
  thumbRequested.clear();
}

/** 移除选中项。 */
function handleRemoveChecked(): void {
  const removing = new Set(checkedKeys.value);
  items.value = items.value.filter((i) => !removing.has(i.id));
  checkedKeys.value = [];
}

/** 移除单项。 */
function removeItem(id: string): void {
  items.value = items.value.filter((i) => i.id !== id);
  checkedKeys.value = checkedKeys.value.filter((k) => k !== id);
}

/** 压缩模式切换 → 设置默认质量。 */
function handleModeChange(value: 'fast' | 'balanced' | 'high'): void {
  const map = { fast: 60, balanced: 75, high: 90 };
  config.quality = map[value];
}

/** 选择输出目录。 */
async function handlePickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/** 打开预览：加载原图 data URL；若已处理则加载处理后的图。 */
async function openPreview(row: CompressItem): Promise<void> {
  previewTitle.value = row.name;
  previewOriginal.value = '';
  previewCompressed.value = '';
  // 输出扩展名与源不同即为转换，标签跟着变
  const sourceFormat = row.ext === 'jpg' ? 'jpeg' : row.ext === 'tif' ? 'tiff' : row.ext;
  previewResultLabel.value =
    row.outputFormat && row.outputFormat !== sourceFormat ? '转换后' : '压缩后';
  previewShow.value = true;
  try {
    previewOriginal.value = await getDataUrlApi(row.path);
    if (row.outputPath) {
      previewCompressed.value = await getDataUrlApi(row.outputPath);
    }
  } catch {
    // 错误提示已由 services 统一弹出，这里不重复
  }
}

/**
 * 由持久化配置解析出传给主进程的最大宽度。
 * @returns 最大宽度像素；不限制返回 undefined。
 */
function resolveMaxWidth(): number | undefined {
  if (config.maxWidthPreset === 'none') return undefined;
  if (config.maxWidthPreset === 'custom') return config.maxWidthCustom || undefined;
  return Number(config.maxWidthPreset);
}

/**
 * 组装传给主进程的处理选项（含最大宽度与高级选项）。
 * @returns 处理选项。
 */
function buildCompressOptions(): CompressOptions {
  return {
    format: config.format,
    quality: config.quality,
    maxWidth: resolveMaxWidth(),
    outputDir: config.outputDir,
    overwrite: config.overwrite,
    keepAnimation: config.keepAnimation,
    // config 是 reactive Proxy，advanced 为嵌套响应式对象，
    // 直接经 IPC 传会报 "An object could not be cloned"，需转纯对象
    advanced: JSON.parse(JSON.stringify(config.advanced)) as FormatAdvanced,
  };
}

/** 开始处理：有勾选时只处理选中项，否则处理全部。 */
async function handleStart(): Promise<void> {
  const options = buildCompressOptions();
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;
  processing.value = true;
  let ok = 0;
  let failed = 0;
  let lastError = '';
  try {
    for (const item of targets) {
      item.status = 'processing';
      try {
        const result = await compressImageApi(item.path, options);
        item.compressedSize = result.compressedSize;
        item.ratio = result.ratio;
        item.outputPath = result.outputPath;
        item.outputFormat = result.outputFormat;
        item.animated = result.animated;
        item.status = 'done';
        ok += 1;
      } catch (e) {
        item.status = 'error';
        item.error = e instanceof Error ? e.message : '处理失败';
        lastError = item.error;
        failed += 1;
      }
    }
    if (failed === 0) {
      message.success(`处理完成，共 ${ok} 个`);
    } else if (ok === 0) {
      message.error(`处理失败：${lastError}`);
    } else {
      message.warning(`完成 ${ok} 个，失败 ${failed} 个（悬停状态查看原因）`);
    }
  } finally {
    processing.value = false;
  }
}
// #endregion
</script>

<style scoped lang="scss">
.compress {
  &__list {
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

  &__table {
    height: 100%;
  }

  // 「含子文件夹」只服务于旁边的「添加文件夹」，压暗一档避免与主操作抢注意力
  &__recursive {
    font-size: 13px;
    color: var(--tb-text-secondary);
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

  &__panel-title {
    margin: 0 0 var(--tb-space-4);
    font-size: 15px;
    color: var(--tb-text-primary);
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
    line-height: 1.4;
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

  &__footer-ratio {
    color: var(--tb-color-primary);
  }
}
</style>
