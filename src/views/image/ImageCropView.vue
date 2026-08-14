<template>
  <ToolPageLayout
    title="图片裁剪"
    desc="自动去除透明 / 纯色边缘，或手动框选裁剪区域"
    category="图片工具"
  >
    <!-- 操作栏 -->
    <template #toolbar>
      <n-space>
        <n-button type="primary" @click="handleAddFiles">
          <template #icon><n-icon :component="CloudUploadOutline" /></template>
          添加文件
        </n-button>
        <n-button @click="handleAddFolder">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          添加文件夹
        </n-button>
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
      <div class="crop__list" :class="{ 'crop__list--drag': isDragOver }" v-bind="dropHandlers">
        <n-data-table
          v-if="items.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="items"
          :row-key="(row: CropItem) => row.id"
          flex-height
          class="crop__table"
        />
        <div v-else class="crop__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽图片到此处，或点击「添加文件」</p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <h3 class="crop__panel-title">裁剪设置</h3>

      <div class="crop__field">
        <label class="crop__label">裁剪模式</label>
        <n-radio-group v-model:value="config.mode" size="small">
          <n-space vertical>
            <n-radio value="auto">自动去边</n-radio>
            <n-radio value="manual">手动框选</n-radio>
          </n-space>
        </n-radio-group>
      </div>

      <!-- 自动模式 -->
      <template v-if="config.mode === 'auto'">
        <div class="crop__field">
          <label class="crop__label">去边颜色</label>
          <n-select v-model:value="config.bgMode" :options="bgOptions" size="small" />
          <n-color-picker
            v-if="config.bgMode === 'custom'"
            v-model:value="config.bgColor"
            class="crop__mt"
            size="small"
            :show-alpha="false"
          />
          <p class="crop__tip">
            {{
              config.bgMode === 'auto'
                ? '取左上角像素色作为背景，适合纯色 / 透明底'
                : '去掉与所选颜色接近的边缘'
            }}
          </p>
        </div>

        <div class="crop__field">
          <label class="crop__label">阈值 {{ config.threshold }}</label>
          <n-slider v-model:value="config.threshold" :min="0" :max="100" :step="1" />
          <p class="crop__tip">与背景色的允许差值，越大裁得越狠</p>
        </div>

        <div class="crop__field">
          <label class="crop__label">保留边距</label>
          <n-input-number v-model:value="config.margin" size="small" :min="0" :max="500" />
        </div>

        <div class="crop__field crop__field--row">
          <label class="crop__label">线稿模式</label>
          <n-tooltip>
            <template #trigger>
              <n-switch v-model:value="config.lineArt" size="small" />
            </template>
            对线条图 / 矢量图的边缘判定更准
          </n-tooltip>
        </div>
      </template>

      <!-- 手动模式 -->
      <template v-else>
        <div class="crop__field">
          <label class="crop__label">宽高比</label>
          <n-select v-model:value="config.aspect" :options="aspectOptions" size="small" />
        </div>
        <div class="crop__field">
          <n-button size="small" block :disabled="!activeRectRow" @click="handleApplyToAll">
            将当前裁剪框应用到全部
          </n-button>
          <p class="crop__tip">
            {{
              activeRectRow
                ? `以「${activeRectRow.name}」的框为准，超出各图边界的部分自动钳制`
                : '先为任意一张图设置裁剪框'
            }}
          </p>
        </div>
      </template>

      <div class="crop__field crop__field--row">
        <label class="crop__label">统一输出尺寸</label>
        <n-switch v-model:value="config.unifySize" size="small" />
      </div>
      <p v-if="config.unifySize" class="crop__tip crop__tip--pull">
        取所有结果的最大宽高作画布，各图居中放入、四周补透明边（{{ unifyHint }}）
      </p>

      <h3 class="crop__panel-title crop__panel-title--sub">输出设置</h3>

      <div class="crop__field">
        <label class="crop__label">输出格式</label>
        <n-select v-model:value="config.format" :options="formatOptions" size="small" />
        <p v-if="config.unifySize && !alphaSafe" class="crop__tip">
          {{ config.format === 'original' ? '原格式' : formatLabel }} 不支持透明，补边会变成黑色
        </p>
      </div>

      <div class="crop__field">
        <label class="crop__label">图片质量 {{ config.quality }}%</label>
        <n-slider
          v-model:value="config.quality"
          :min="1"
          :max="100"
          :step="1"
          :disabled="config.format === 'gif'"
        />
      </div>

      <div class="crop__field">
        <label class="crop__label">输出目录</label>
        <div class="crop__dir">
          <n-input :value="config.outputDir" size="small" readonly placeholder="选择输出目录" />
          <n-button size="small" :disabled="config.overwrite" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <div class="crop__field crop__field--row">
        <label class="crop__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

      <p v-if="hasAnimated" class="crop__tip crop__tip--warn">列表中含动图，裁剪只处理首帧</p>

      <n-button
        type="primary"
        block
        class="crop__mt"
        :loading="processing"
        :disabled="!canStart"
        @click="handleStart"
      >
        {{ startLabel }}
      </n-button>
    </template>

    <!-- 底部统计 -->
    <template #footer>
      <div class="crop__footer">
        <span>已选择 {{ items.length }} 个文件</span>
        <div class="crop__footer-stats">
          <span>已处理 {{ doneCount }} / {{ items.length }}</span>
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>输出 {{ formatBytes(totalCropped) }}</span>
        </div>
      </div>
    </template>
  </ToolPageLayout>

  <!-- 裁剪弹窗 -->
  <n-modal v-model:show="cropperShow">
    <n-card class="crop__modal" :title="cropperTitle" size="small" closable @close="closeCropper">
      <div class="crop__modal-body">
        <CropCanvas
          v-if="cropperUrl && cropperRow"
          v-model="cropperRect"
          :src="cropperUrl"
          :natural-width="cropperRow.naturalWidth ?? 0"
          :natural-height="cropperRow.naturalHeight ?? 0"
          :aspect="aspectValue"
        />
        <n-spin v-else />
      </div>
      <template #footer>
        <div class="crop__modal-footer">
          <n-button size="small" @click="cropperRect = null">重置</n-button>
          <n-space :size="8">
            <n-button size="small" @click="closeCropper">取消</n-button>
            <n-button size="small" type="primary" :disabled="!cropperRect" @click="confirmCropper">
              确定
            </n-button>
          </n-space>
        </div>
      </template>
    </n-card>
  </n-modal>

  <ImagePreviewModal
    v-model:show="previewShow"
    :title="previewTitle"
    :original-url="previewOriginal"
    :compressed-url="previewCropped"
    result-label="裁剪后"
  />
</template>

<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NColorPicker,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NRadio,
  NRadioGroup,
  NSelect,
  NSlider,
  NSpace,
  NSpin,
  NSwitch,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  CloudUploadOutline,
  CropOutline,
  EyeOutline,
  FolderOpenOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  AutoCropOptions,
  CropCanvas as CropCanvasSize,
  CropMode,
  CropOptions,
  CropRect,
  ImageOutputFormat,
  PickedFile,
} from '@shared/types';
import type { CropItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import CropCanvas from '@/components/common/CropCanvas.vue';
import ImagePreviewModal from '@/components/common/ImagePreviewModal.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { cropImageApi, getDataUrlApi, getThumbnailApi, probeCropApi } from '@/services/image';
import { formatBytes } from '@/utils/format';

// #region state
const message = useMessage();

/** 支持的图片扩展名（与压缩页一致，均为 sharp 可解码格式）。 */
const ACCEPT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff', 'svg', 'heic', 'heif'];

/** 探测节流延时 ms：探测虽不写盘但仍是全图解码，不能每次滑动都打。 */
const PROBE_DEBOUNCE = 300;

const items = ref<CropItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;

/** 持久化的裁剪配置（记住上次使用）。 */
const { config } = useToolConfig('image-crop', {
  mode: 'auto' as CropMode,
  threshold: 10,
  margin: 0,
  lineArt: false,
  bgMode: 'auto' as 'auto' | 'custom',
  bgColor: '#ffffff',
  aspect: 'free' as 'free' | '1:1' | '4:3' | '3:4' | '16:9',
  unifySize: false,
  format: 'original' as ImageOutputFormat,
  quality: 90,
  outputDir: '',
  overwrite: false,
});

const bgOptions = [
  { label: '自动识别（左上角）', value: 'auto' },
  { label: '指定颜色', value: 'custom' },
];

const aspectOptions = [
  { label: '自由', value: 'free' },
  { label: '1 : 1', value: '1:1' },
  { label: '4 : 3', value: '4:3' },
  { label: '3 : 4', value: '3:4' },
  { label: '16 : 9', value: '16:9' },
];

const formatOptions = [
  { label: '保持原格式', value: 'original' },
  { label: 'JPG', value: 'jpeg' },
  { label: 'PNG', value: 'png' },
  { label: 'WebP', value: 'webp' },
  { label: 'AVIF', value: 'avif' },
  { label: 'GIF', value: 'gif' },
  { label: 'TIFF', value: 'tiff' },
];

// 裁剪弹窗
const cropperShow = ref(false);
const cropperRow = ref<CropItem | null>(null);
const cropperUrl = ref('');
const cropperRect = ref<CropRect | null>(null);
const cropperTitle = computed(() => cropperRow.value?.name ?? '裁剪');

// 预览
const previewShow = ref(false);
const previewTitle = ref('');
const previewOriginal = ref('');
const previewCropped = ref('');
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => addFiles(files),
});
// #endregion

// #region getters
/** 宽高比数值；自由裁剪为 null。 */
const aspectValue = computed(() => {
  if (config.aspect === 'free') return null;
  const [w, h] = config.aspect.split(':').map(Number);
  return w / h;
});

/** 输出格式展示名。 */
const formatLabel = computed(() =>
  config.format === 'jpeg' ? 'JPG' : config.format.toUpperCase(),
);

/** 输出格式是否支持透明（统一尺寸补边时相关）。 */
const alphaSafe = computed(() => config.format !== 'jpeg');

/** 列表中是否有动图（裁剪只取首帧，需提示）。 */
const hasAnimated = computed(() => items.value.some((i) => i.ext === 'gif' || i.ext === 'webp'));

/** 手动模式下作为「应用到全部」样板的行：优先勾选项，否则第一个有框的。 */
const activeRectRow = computed(() => {
  const selected = new Set(checkedKeys.value);
  return (
    items.value.find((i) => selected.has(i.id) && i.rect) ?? items.value.find((i) => i.rect) ?? null
  );
});

/** 统一尺寸的画布提示（已知各图结果时给出具体数值）。 */
const unifyHint = computed(() => {
  const canvas = computeCanvas();
  return canvas ? `${canvas.width} × ${canvas.height}` : '待处理时计算';
});

const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length);
const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalCropped = computed(() => items.value.reduce((s, i) => s + (i.croppedSize ?? 0), 0));

const canStart = computed(
  () => items.value.length > 0 && !processing.value && (config.overwrite || !!config.outputDir),
);

const startLabel = computed(() =>
  checkedKeys.value.length ? `开始裁剪 (${checkedKeys.value.length})` : '开始裁剪',
);
// #endregion

// #region columns
const columns: DataTableColumns<CropItem> = [
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
    title: '原尺寸',
    key: 'natural',
    width: 96,
    render: (row) => (row.naturalWidth ? `${row.naturalWidth} × ${row.naturalHeight}` : '—'),
  },
  {
    title: '裁剪框',
    key: 'rect',
    width: 150,
    render: (row) => {
      if (!row.rect) return h('span', { style: 'color:var(--tb-text-secondary)' }, '未设置');
      const r = row.rect;
      // 与原图等大说明没有可裁的边，直接说清楚而不是显示一串等于原尺寸的数字
      if (r.width === row.naturalWidth && r.height === row.naturalHeight) {
        return h('span', { style: 'color:var(--tb-text-secondary)' }, '无可裁边缘');
      }
      return `${r.width} × ${r.height} @ ${r.left},${r.top}`;
    },
  },
  {
    title: '输出尺寸',
    key: 'output',
    width: 96,
    render: (row) => (row.outputWidth ? `${row.outputWidth} × ${row.outputHeight}` : '—'),
  },
  {
    title: '大小',
    key: 'croppedSize',
    width: 96,
    render: (row) =>
      row.croppedSize !== undefined ? `${formatBytes(row.croppedSize)}` : formatBytes(row.size),
  },
  {
    title: '状态',
    key: 'status',
    width: 92,
    render: (row) => {
      if (row.status === 'error' && row.error) {
        return h(NTooltip, null, {
          trigger: () => h(StatusTag, { status: row.status }),
          default: () => row.error,
        });
      }
      if (row.status === 'done' && row.skipped) {
        return h(NTooltip, null, {
          trigger: () => h(StatusTag, { status: row.status }),
          default: () => '没有可裁的边缘，已按输出设置重新编码',
        });
      }
      return h(StatusTag, { status: row.status });
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 116,
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(
          NButton,
          {
            text: true,
            size: 'small',
            disabled: config.mode === 'auto',
            onClick: () => openCropper(row),
          },
          { icon: () => h(NIcon, { component: CropOutline }) },
        ),
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

// #region auto probe
/**
 * 组装自动裁剪参数（纯对象，可安全过 IPC）。
 * @returns 自动裁剪参数。
 */
function buildAutoOptions(): AutoCropOptions {
  return {
    threshold: config.threshold,
    margin: config.margin,
    lineArt: config.lineArt,
    ...(config.bgMode === 'custom' ? { background: config.bgColor } : {}),
  };
}

/**
 * 探测单项的自动裁剪包围盒，写回列表。
 * @param id 列表项 id。
 */
async function probeItem(id: string): Promise<void> {
  const target = items.value.find((i) => i.id === id);
  if (!target) return;
  try {
    const probe = await probeCropApi(target.path, buildAutoOptions());
    // await 期间用户可能已移除该项，重新回查而不是复用上面的引用
    const current = items.value.find((i) => i.id === id);
    if (!current) return;
    current.naturalWidth = probe.width;
    current.naturalHeight = probe.height;
    current.rect = probe.rect ?? undefined;
  } catch {
    // 探测只影响预览列，失败静默
  }
}

/** 重新探测所有项（自动模式参数变更时）。 */
function probeAll(): void {
  if (config.mode !== 'auto') return;
  for (const item of items.value) void probeItem(item.id);
}

let probeTimer: ReturnType<typeof setTimeout> | null = null;
/** 节流触发全量重新探测。 */
function schedueProbeAll(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(probeAll, PROBE_DEBOUNCE);
}

// 自动模式的任一参数变化都会改变包围盒，节流后整表重算
watch(
  () => [
    config.mode,
    config.threshold,
    config.margin,
    config.lineArt,
    config.bgMode,
    config.bgColor,
  ],
  () => {
    if (config.mode === 'auto') schedueProbeAll();
  },
);
// #endregion

// #region actions
/** 追加文件（按路径去重），异步加载缩略图并探测包围盒。 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;

  for (const file of fresh) {
    const id = `crop-${seq++}`;
    items.value.push({ ...file, id, status: 'pending' });
    void getThumbnailApi(file.path)
      .then((url) => {
        const target = items.value.find((i) => i.id === id);
        if (target) target.thumbnail = url;
      })
      .catch(() => {});
    // 无论哪种模式都探测一次：自动模式要显示包围盒，手动模式要拿原图尺寸给画布
    void probeItem(id);
  }
}

/** 打开文件选择。 */
async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '图片', extensions: ACCEPT }],
    title: '选择要裁剪的图片',
  });
  if (files.length) addFiles(files);
}

/** 选择文件夹（批量导入待后续版本）。 */
async function handleAddFolder(): Promise<void> {
  const dir = await pickDirectoryApi('选择图片文件夹');
  if (dir) message.info(`文件夹批量导入将在后续版本支持：${dir}`);
}

/** 清空列表。 */
function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
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

/** 选择输出目录。 */
async function handlePickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/**
 * 打开裁剪弹窗：加载原图并带入已有框。
 * @param row 目标行。
 */
async function openCropper(row: CropItem): Promise<void> {
  cropperRow.value = row;
  cropperRect.value = row.rect ? { ...row.rect } : null;
  cropperUrl.value = '';
  cropperShow.value = true;
  try {
    cropperUrl.value = await getDataUrlApi(row.path);
  } catch {
    // 错误提示由 services 统一弹出
    cropperShow.value = false;
  }
}

/** 关闭裁剪弹窗，丢弃未确认的框。 */
function closeCropper(): void {
  cropperShow.value = false;
  cropperRow.value = null;
  cropperUrl.value = '';
}

/** 确认裁剪框，写回对应行。 */
function confirmCropper(): void {
  const row = cropperRow.value;
  if (row && cropperRect.value) {
    const target = items.value.find((i) => i.id === row.id);
    if (target) target.rect = { ...cropperRect.value };
  }
  closeCropper();
}

/**
 * 把矩形钳制进指定尺寸（应用到全部时各图尺寸不同，需各自钳制）。
 * @param rect 源矩形。
 * @param width 图片宽度。
 * @param height 图片高度。
 * @returns 钳制后的矩形。
 */
function clampToImage(rect: CropRect, width: number, height: number): CropRect {
  const w = Math.min(rect.width, width);
  const h = Math.min(rect.height, height);
  return {
    left: Math.min(Math.max(rect.left, 0), width - w),
    top: Math.min(Math.max(rect.top, 0), height - h),
    width: w,
    height: h,
  };
}

/** 把样板行的裁剪框复制给所有行（各自钳制进边界）。 */
function handleApplyToAll(): void {
  const source = activeRectRow.value?.rect;
  if (!source) return;
  let applied = 0;
  for (const item of items.value) {
    if (!item.naturalWidth || !item.naturalHeight) continue;
    item.rect = clampToImage(source, item.naturalWidth, item.naturalHeight);
    applied += 1;
  }
  message.success(`已应用到 ${applied} 张图片`);
}

/**
 * 打开预览：加载原图；已裁剪则一并加载结果。
 * @param row 目标行。
 */
async function openPreview(row: CropItem): Promise<void> {
  previewTitle.value = row.name;
  previewOriginal.value = '';
  previewCropped.value = '';
  previewShow.value = true;
  try {
    previewOriginal.value = await getDataUrlApi(row.path);
    if (row.outputPath) previewCropped.value = await getDataUrlApi(row.outputPath);
  } catch {
    // 错误提示由 services 统一弹出
  }
}
// #endregion

// #region process
/**
 * 计算统一输出画布：取所有已知裁剪结果的最大宽高。
 * 自动模式用探测出的包围盒，手动模式用各自的框；尺寸未知的项不参与。
 * @returns 画布尺寸；无可用数据时为 null。
 */
function computeCanvas(): CropCanvasSize | null {
  if (!config.unifySize) return null;
  let width = 0;
  let height = 0;
  for (const item of items.value) {
    // 没有框的项按原图尺寸算，否则统一画布会小于它的实际输出
    const w = item.rect?.width ?? item.naturalWidth ?? 0;
    const h = item.rect?.height ?? item.naturalHeight ?? 0;
    width = Math.max(width, w);
    height = Math.max(height, h);
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * 组装单项的裁剪选项。
 * @param item 列表项。
 * @param canvas 统一画布尺寸（可为 null）。
 * @returns 裁剪选项。
 */
function buildCropOptions(item: CropItem, canvas: CropCanvasSize | null): CropOptions {
  return {
    mode: config.mode,
    auto: buildAutoOptions(),
    // rect 来自响应式列表，展开成纯对象再过 IPC（Proxy 无法结构化克隆）
    ...(config.mode === 'manual' && item.rect ? { rect: { ...item.rect } } : {}),
    ...(canvas ? { canvas: { ...canvas } } : {}),
    format: config.format,
    quality: config.quality,
    outputDir: config.outputDir,
    overwrite: config.overwrite,
  };
}

/** 开始裁剪：有勾选时只处理选中项，否则处理全部。 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;

  if (config.mode === 'manual' && targets.some((i) => !i.rect)) {
    message.warning('手动模式下每张图都需要先设置裁剪框');
    return;
  }

  // 统一尺寸：先按已探测/已设置的框算出公共画布，再带着它逐张处理
  const canvas = computeCanvas();
  if (config.unifySize && !canvas) {
    message.warning('尺寸尚未探测完成，请稍候重试');
    return;
  }

  processing.value = true;
  let ok = 0;
  let failed = 0;
  let lastError = '';
  try {
    for (const item of targets) {
      item.status = 'processing';
      try {
        const result = await cropImageApi(item.path, buildCropOptions(item, canvas));
        item.croppedSize = result.croppedSize;
        item.outputWidth = result.width;
        item.outputHeight = result.height;
        item.outputPath = result.outputPath;
        item.skipped = result.skipped;
        item.status = 'done';
        ok += 1;
      } catch (e) {
        item.status = 'error';
        item.error = e instanceof Error ? e.message : '裁剪失败';
        lastError = item.error;
        failed += 1;
      }
    }
    if (failed === 0) {
      message.success(`裁剪完成，共 ${ok} 个`);
    } else if (ok === 0) {
      message.error(`裁剪失败：${lastError}`);
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
.crop {
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
    line-height: 1.4;
    color: var(--tb-text-secondary);

    &--pull {
      margin-top: calc(var(--tb-space-2) * -1);
      margin-bottom: var(--tb-space-4);
    }

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

  &__modal {
    width: 860px;
    max-width: 92vw;
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
  }

  &__modal-body {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 460px;
  }

  &__modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
