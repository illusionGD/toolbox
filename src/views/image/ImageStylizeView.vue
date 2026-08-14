<template>
  <ToolPageLayout
    title="图片风格化"
    desc="马赛克、模糊、调色与滤镜，可叠加多种效果，支持局部打码"
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

    <!-- 左：文件列表；右：实时预览 -->
    <template #main>
      <div class="stylize__main">
        <div
          class="stylize__list"
          :class="{ 'stylize__list--drag': isDragOver }"
          v-bind="dropHandlers"
        >
          <n-data-table
            v-if="items.length"
            v-model:checked-row-keys="checkedKeys"
            :columns="columns"
            :data="items"
            :row-key="(row: StylizeItem) => row.id"
            flex-height
            class="stylize__table"
          />
          <div v-else class="stylize__empty">
            <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
            <p>拖拽图片到此处，或点击「添加文件」</p>
          </div>
        </div>

        <div class="stylize__preview">
          <div class="stylize__preview-head">
            <span class="stylize__preview-title">实时预览</span>
            <span v-if="previewRow" class="stylize__preview-name">{{ previewRow.name }}</span>
          </div>
          <div class="stylize__preview-body">
            <img v-if="previewUrl" :src="previewUrl" class="stylize__preview-img" alt="效果预览" />
            <p v-else class="stylize__preview-tip">{{ previewTip }}</p>
            <div v-if="previewLoading" class="stylize__preview-mask"><n-spin size="small" /></div>
          </div>
          <p class="stylize__preview-foot">
            {{ enabledCount ? `已启用 ${enabledCount} 项效果` : '未启用任何效果，显示原图' }}
          </p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <div class="stylize__panel-head">
        <h3 class="stylize__panel-title">效果</h3>
        <n-button size="tiny" quaternary :disabled="!enabledCount" @click="handleDisableAll">
          全部关闭
        </n-button>
      </div>

      <n-collapse :default-expanded-names="[]" accordion>
        <n-collapse-item v-for="e in EFFECT_METAS" :key="e.key" :name="e.key">
          <template #header>
            <span class="stylize__eff-name">{{ e.label }}</span>
          </template>
          <template #header-extra>
            <!-- 阻止冒泡，否则点开关会连带展开/收起该项 -->
            <n-switch
              :value="config.effects[e.key].enabled"
              size="small"
              @click.stop
              @update:value="(v: boolean) => (config.effects[e.key].enabled = v)"
            />
          </template>

          <div class="stylize__eff-body">
            <template v-if="e.key === 'mosaic'">
              <label class="stylize__label">块大小 {{ config.effects.mosaic.block }} px</label>
              <n-slider v-model:value="config.effects.mosaic.block" :min="2" :max="64" :step="1" />
            </template>

            <template v-else-if="e.key === 'blur'">
              <label class="stylize__label">模糊半径 {{ config.effects.blur.sigma }}</label>
              <n-slider
                v-model:value="config.effects.blur.sigma"
                :min="0.3"
                :max="50"
                :step="0.1"
              />
            </template>

            <template v-else-if="e.key === 'median'">
              <label class="stylize__label">窗口 {{ config.effects.median.size }} px</label>
              <!-- 只给奇数：libvips 的 median 窗口必须是正奇数 -->
              <n-slider v-model:value="config.effects.median.size" :min="1" :max="15" :step="2" />
              <p class="stylize__tip">去噪 / 油画感，越大越慢</p>
            </template>

            <template v-else-if="e.key === 'sharpen'">
              <label class="stylize__label">锐化强度 {{ config.effects.sharpen.sigma }}</label>
              <n-slider
                v-model:value="config.effects.sharpen.sigma"
                :min="0.3"
                :max="10"
                :step="0.1"
              />
            </template>

            <template v-else-if="e.key === 'tint'">
              <label class="stylize__label">叠加色</label>
              <n-color-picker
                v-model:value="config.effects.tint.color"
                size="small"
                :show-alpha="false"
              />
            </template>

            <template v-else-if="e.key === 'modulate'">
              <label class="stylize__label">亮度 {{ config.effects.modulate.brightness }}×</label>
              <n-slider
                v-model:value="config.effects.modulate.brightness"
                :min="0.5"
                :max="2"
                :step="0.05"
              />
              <label class="stylize__label stylize__label--mt">
                饱和度 {{ config.effects.modulate.saturation }}×
              </label>
              <n-slider
                v-model:value="config.effects.modulate.saturation"
                :min="0"
                :max="3"
                :step="0.05"
              />
              <label class="stylize__label stylize__label--mt">
                色相 {{ config.effects.modulate.hue }}°
              </label>
              <n-slider
                v-model:value="config.effects.modulate.hue"
                :min="-180"
                :max="180"
                :step="1"
              />
            </template>

            <template v-else-if="e.key === 'contrast'">
              <label class="stylize__label">对比度 {{ config.effects.contrast.amount }}×</label>
              <n-slider
                v-model:value="config.effects.contrast.amount"
                :min="0.2"
                :max="3"
                :step="0.05"
              />
            </template>

            <template v-else-if="e.key === 'threshold'">
              <label class="stylize__label">阈值 {{ config.effects.threshold.value }}</label>
              <n-slider
                v-model:value="config.effects.threshold.value"
                :min="0"
                :max="255"
                :step="1"
              />
              <div class="stylize__row stylize__label--mt">
                <label class="stylize__label">先转灰度</label>
                <n-switch v-model:value="config.effects.threshold.grayscale" size="small" />
              </div>
              <p class="stylize__tip">关闭则各通道独立二值化，出彩色块</p>
            </template>

            <p v-else class="stylize__tip">{{ e.hint }}</p>
          </div>
        </n-collapse-item>
      </n-collapse>

      <p class="stylize__tip stylize__tip--pull">
        多个效果按面板顺序依次施加：马赛克 → 模糊 → 中值 → 锐化 → 调色 → 二值化
      </p>

      <h3 class="stylize__panel-title stylize__panel-title--sub">局部处理</h3>

      <div class="stylize__field">
        <label class="stylize__label">局部效果</label>
        <n-radio-group v-model:value="config.region.kind" size="small">
          <n-space>
            <n-radio value="mosaic">马赛克</n-radio>
            <n-radio value="blur">模糊</n-radio>
          </n-space>
        </n-radio-group>
      </div>

      <div class="stylize__field">
        <label class="stylize__label">
          强度 {{ config.region.strength }}{{ config.region.kind === 'mosaic' ? ' px' : '' }}
        </label>
        <n-slider
          v-model:value="config.region.strength"
          :min="config.region.kind === 'mosaic' ? 2 : 1"
          :max="config.region.kind === 'mosaic' ? 64 : 50"
          :step="1"
        />
      </div>

      <div class="stylize__field stylize__field--row">
        <label class="stylize__label">作用于区域外</label>
        <n-tooltip>
          <template #trigger>
            <n-switch v-model:value="config.region.invert" size="small" />
          </template>
          开启后区域内保持原样、区域外被处理，用于背景虚化
        </n-tooltip>
      </div>

      <p class="stylize__tip stylize__tip--pull">
        {{ regionHint }}
      </p>

      <h3 class="stylize__panel-title stylize__panel-title--sub">输出设置</h3>

      <div class="stylize__field">
        <label class="stylize__label">输出格式</label>
        <n-select v-model:value="config.format" :options="formatOptions" size="small" />
      </div>

      <div class="stylize__field">
        <label class="stylize__label">图片质量 {{ config.quality }}%</label>
        <n-slider
          v-model:value="config.quality"
          :min="1"
          :max="100"
          :step="1"
          :disabled="config.format === 'gif'"
        />
      </div>

      <div class="stylize__field">
        <label class="stylize__label">输出目录</label>
        <div class="stylize__dir">
          <n-input :value="config.outputDir" size="small" readonly placeholder="选择输出目录" />
          <n-button size="small" :disabled="config.overwrite" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <div class="stylize__field stylize__field--row">
        <label class="stylize__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

      <p v-if="hasAnimated" class="stylize__tip stylize__tip--warn">
        列表中含动图，风格化只处理首帧
      </p>

      <n-button
        type="primary"
        block
        class="stylize__mt"
        :loading="processing"
        :disabled="!canStart"
        @click="handleStart"
      >
        {{ startLabel }}
      </n-button>
    </template>

    <!-- 底部统计 -->
    <template #footer>
      <div class="stylize__footer">
        <span>已选择 {{ items.length }} 个文件</span>
        <div class="stylize__footer-stats">
          <span>已处理 {{ doneCount }} / {{ items.length }}</span>
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>输出 {{ formatBytes(totalStylized) }}</span>
        </div>
      </div>
    </template>
  </ToolPageLayout>

  <!-- 局部区域弹窗 -->
  <n-modal v-model:show="regionShow">
    <n-card class="stylize__modal" :title="regionTitle" size="small" closable @close="closeRegion">
      <div class="stylize__modal-body">
        <RegionCanvas
          v-if="regionUrl && regionRow?.naturalWidth"
          v-model="regionRects"
          :src="regionUrl"
          :natural-width="regionRow.naturalWidth"
          :natural-height="regionRow.naturalHeight ?? 0"
        />
        <n-spin v-else />
      </div>
      <template #footer>
        <div class="stylize__modal-footer">
          <n-space :size="8" align="center">
            <n-button size="small" :disabled="!regionRects.length" @click="regionRects = []">
              清空区域
            </n-button>
            <span class="stylize__modal-count">已框选 {{ regionRects.length }} 个</span>
          </n-space>
          <n-space :size="8">
            <n-button size="small" @click="closeRegion">取消</n-button>
            <n-button size="small" type="primary" @click="confirmRegion">确定</n-button>
          </n-space>
        </div>
      </template>
    </n-card>
  </n-modal>

  <ImagePreviewModal
    v-model:show="previewShow"
    :title="previewModalTitle"
    :original-url="previewOriginal"
    :compressed-url="previewStylized"
    result-label="风格化后"
  />
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NColorPicker,
  NDataTable,
  NIcon,
  NInput,
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
  BrushOutline,
  CloudUploadOutline,
  EyeOutline,
  FolderOpenOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  CropRect,
  ImageOutputFormat,
  PickedFile,
  StylizeEffect,
  StylizeEffects,
  StylizeOptions,
} from '@shared/types';
import type { StylizeItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import ImagePreviewModal from '@/components/common/ImagePreviewModal.vue';
import RegionCanvas from '@/components/common/RegionCanvas.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  getDataUrlApi,
  getThumbnailApi,
  stylizeImageApi,
  stylizePreviewApi,
} from '@/services/image';
import { formatBytes } from '@/utils/format';

// #region state
const message = useMessage();

/** 支持的图片扩展名（与压缩/裁剪页一致，均为 sharp 可解码格式）。 */
const ACCEPT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff', 'svg', 'heic', 'heif'];

/**
 * 预览节流延时 ms。
 * 比裁剪页探测的 300ms 长：这里是全套效果多趟处理，单次成本更高。
 */
const PREVIEW_DEBOUNCE = 400;

/** 预览长边上限 px。 */
const PREVIEW_MAX_SIZE = 900;

/** 面板上的效果顺序，与主进程 EFFECT_ORDER 一致（顺序即执行顺序）。 */
const EFFECT_METAS: Array<{ key: StylizeEffect; label: string; hint?: string }> = [
  { key: 'mosaic', label: '马赛克' },
  { key: 'blur', label: '高斯模糊' },
  { key: 'median', label: '中值滤波' },
  { key: 'sharpen', label: '锐化' },
  { key: 'grayscale', label: '灰度', hint: '去除全部色彩信息' },
  { key: 'sepia', label: '复古', hint: '经典 sepia 色调' },
  { key: 'tint', label: '色调叠加' },
  { key: 'modulate', label: '亮度 / 饱和度 / 色相' },
  { key: 'contrast', label: '对比度' },
  { key: 'negate', label: '反色', hint: '反转 RGB，不影响透明度' },
  { key: 'threshold', label: '阈值二值化' },
];

const items = ref<StylizeItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;

/**
 * 持久化的风格化配置。
 * 只存参数，不存 regions —— 那是逐图数据，属于列表状态。
 */
const { config } = useToolConfig('image-stylize', {
  effects: {
    mosaic: { enabled: false, block: 12 },
    blur: { enabled: false, sigma: 5 },
    median: { enabled: false, size: 3 },
    sharpen: { enabled: false, sigma: 1 },
    grayscale: { enabled: false },
    sepia: { enabled: false },
    tint: { enabled: false, color: '#ff8800' },
    modulate: { enabled: false, brightness: 1, saturation: 1, hue: 0 },
    contrast: { enabled: false, amount: 1.2 },
    negate: { enabled: false },
    threshold: { enabled: false, value: 128, grayscale: true },
  },
  region: { kind: 'mosaic' as 'mosaic' | 'blur', strength: 16, invert: false },
  format: 'original' as ImageOutputFormat,
  quality: 90,
  outputDir: '',
  overwrite: false,
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

// 局部区域弹窗
const regionShow = ref(false);
const regionRow = ref<StylizeItem | null>(null);
const regionUrl = ref('');
const regionRects = ref<CropRect[]>([]);
const regionTitle = computed(() => regionRow.value?.name ?? '局部区域');

// 实时预览
const previewUrl = ref('');
const previewLoading = ref(false);
const previewError = ref('');

// 对比预览弹窗
const previewShow = ref(false);
const previewModalTitle = ref('');
const previewOriginal = ref('');
const previewStylized = ref('');
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => addFiles(files),
});
// #endregion

// #region getters
/** 已启用的全局效果数。 */
const enabledCount = computed(
  () => EFFECT_METAS.filter((e) => config.effects[e.key].enabled).length,
);

/** 预览目标行：优先第一个勾选项，否则列表第一项。 */
const previewRow = computed<StylizeItem | null>(() => {
  const selected = new Set(checkedKeys.value);
  return items.value.find((i) => selected.has(i.id)) ?? items.value[0] ?? null;
});

/** 预览区没有图时的提示文案。 */
const previewTip = computed(() => {
  if (previewError.value) return previewError.value;
  if (!items.value.length) return '添加图片后可在此实时预览效果';
  return previewLoading.value ? '生成预览中…' : '预览生成失败';
});

/** 局部区域的说明文案。 */
const regionHint = computed(() => {
  const total = items.value.reduce((s, i) => s + (i.regions?.length ?? 0), 0);
  if (!total) return '在列表中点画笔图标为单张图框选区域，未框选时只施加全局效果';
  return `共 ${total} 个区域；${config.region.invert ? '区域外' : '区域内'}会被${
    config.region.kind === 'mosaic' ? '打码' : '模糊'
  }`;
});

/** 列表中是否有动图（只处理首帧，需提示）。 */
const hasAnimated = computed(() => items.value.some((i) => i.ext === 'gif' || i.ext === 'webp'));

const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length);
const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalStylized = computed(() => items.value.reduce((s, i) => s + (i.stylizedSize ?? 0), 0));

const canStart = computed(
  () => items.value.length > 0 && !processing.value && (config.overwrite || !!config.outputDir),
);

const startLabel = computed(() =>
  checkedKeys.value.length ? `开始处理 (${checkedKeys.value.length})` : '开始处理',
);
// #endregion

// #region columns
const columns: DataTableColumns<StylizeItem> = [
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
    title: '局部区域',
    key: 'regions',
    width: 84,
    render: (row) =>
      row.regions?.length
        ? `${row.regions.length} 个`
        : h('span', { style: 'color:var(--tb-text-secondary)' }, '无'),
  },
  {
    title: '大小',
    key: 'stylizedSize',
    width: 96,
    render: (row) =>
      row.stylizedSize !== undefined ? formatBytes(row.stylizedSize) : formatBytes(row.size),
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
          { text: true, size: 'small', onClick: () => openRegion(row) },
          { icon: () => h(NIcon, { component: BrushOutline }) },
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

// #region live preview
/**
 * 组装全局效果（纯对象，可安全过 IPC）。
 * 未启用的效果不传，主进程按缺省处理。
 * @returns 效果集合。
 */
function buildEffects(): StylizeEffects {
  const e = config.effects;
  return {
    ...(e.mosaic.enabled ? { mosaic: { ...e.mosaic } } : {}),
    ...(e.blur.enabled ? { blur: { ...e.blur } } : {}),
    ...(e.median.enabled ? { median: { ...e.median } } : {}),
    ...(e.sharpen.enabled ? { sharpen: { ...e.sharpen } } : {}),
    ...(e.grayscale.enabled ? { grayscale: { ...e.grayscale } } : {}),
    ...(e.sepia.enabled ? { sepia: { ...e.sepia } } : {}),
    ...(e.tint.enabled ? { tint: { ...e.tint } } : {}),
    ...(e.modulate.enabled ? { modulate: { ...e.modulate } } : {}),
    ...(e.contrast.enabled ? { contrast: { ...e.contrast } } : {}),
    ...(e.negate.enabled ? { negate: { ...e.negate } } : {}),
    ...(e.threshold.enabled ? { threshold: { ...e.threshold } } : {}),
  };
}

/**
 * 每次预览请求的序号。
 * 滑动滑块时必然有多个请求在飞，慢的后到会盖掉新结果，故只认最新一号。
 */
let previewSeq = 0;

/** 拉取当前预览。 */
async function refreshPreview(): Promise<void> {
  const row = previewRow.value;
  if (!row) {
    previewUrl.value = '';
    previewError.value = '';
    return;
  }

  const reqId = ++previewSeq;
  previewLoading.value = true;
  try {
    const url = await stylizePreviewApi(row.path, {
      effects: buildEffects(),
      regions: (row.regions ?? []).map((r) => ({ ...r })),
      region: { ...config.region },
      maxSize: PREVIEW_MAX_SIZE,
    });
    // 过期请求直接丢弃，别覆盖更新的结果
    if (reqId !== previewSeq) return;
    previewUrl.value = url;
    previewError.value = '';
  } catch (e) {
    if (reqId !== previewSeq) return;
    previewUrl.value = '';
    previewError.value = e instanceof Error ? e.message : '预览生成失败';
  } finally {
    if (reqId === previewSeq) previewLoading.value = false;
  }
}

let previewTimer: ReturnType<typeof setTimeout> | null = null;
/** 节流触发预览刷新。 */
function schedulePreview(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshPreview(), PREVIEW_DEBOUNCE);
}

// 预览目标、任一效果参数、局部参数与区域变化都要重画
watch(
  () => [previewRow.value?.id, previewRow.value?.regions, config.effects, config.region],
  schedulePreview,
  { deep: true },
);

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer);
});
// #endregion

// #region actions
/** 追加文件（按路径去重），异步加载缩略图。 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;

  for (const file of fresh) {
    const id = `stylize-${seq++}`;
    items.value.push({ ...file, id, status: 'pending' });
    void getThumbnailApi(file.path)
      .then((url) => {
        // 异步回来时要按 id 回查响应式项，不能改 push 前的原始对象
        const target = items.value.find((i) => i.id === id);
        if (target) target.thumbnail = url;
      })
      .catch(() => {});
  }
  schedulePreview();
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

/** 选择文件夹（批量导入待后续版本）。 */
async function handleAddFolder(): Promise<void> {
  const dir = await pickDirectoryApi('选择图片文件夹');
  if (dir) message.info(`文件夹批量导入将在后续版本支持：${dir}`);
}

/** 清空列表。 */
function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
  previewUrl.value = '';
}

/** 移除选中项。 */
function handleRemoveChecked(): void {
  const removing = new Set(checkedKeys.value);
  items.value = items.value.filter((i) => !removing.has(i.id));
  checkedKeys.value = [];
  schedulePreview();
}

/** 移除单项。 */
function removeItem(id: string): void {
  items.value = items.value.filter((i) => i.id !== id);
  checkedKeys.value = checkedKeys.value.filter((k) => k !== id);
  schedulePreview();
}

/** 关闭全部效果。 */
function handleDisableAll(): void {
  for (const e of EFFECT_METAS) config.effects[e.key].enabled = false;
}

/** 选择输出目录。 */
async function handlePickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/**
 * 打开局部区域弹窗：加载原图并读出原始尺寸。
 *
 * 原始尺寸不额外走一次 IPC：直接从已加载的 data URL 建 Image 读 naturalWidth/Height，
 * 而且只在真正需要框选时才读。
 * @param row 目标行。
 */
async function openRegion(row: StylizeItem): Promise<void> {
  regionRow.value = row;
  regionRects.value = (row.regions ?? []).map((r) => ({ ...r }));
  regionUrl.value = '';
  regionShow.value = true;
  try {
    const url = await getDataUrlApi(row.path);
    const size = await readNaturalSize(url);
    const target = items.value.find((i) => i.id === row.id);
    if (target) {
      target.naturalWidth = size.width;
      target.naturalHeight = size.height;
      regionRow.value = target;
    }
    regionUrl.value = url;
  } catch {
    // 错误提示由 services 统一弹出
    regionShow.value = false;
  }
}

/**
 * 读取 data URL 的原始像素尺寸。
 * @param url 图片 data URL。
 * @returns 原始宽高。
 */
function readNaturalSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('图片解析失败'));
    img.src = url;
  });
}

/** 关闭局部区域弹窗，丢弃未确认的改动。 */
function closeRegion(): void {
  regionShow.value = false;
  regionRow.value = null;
  regionUrl.value = '';
  regionRects.value = [];
}

/** 确认局部区域，写回对应行。 */
function confirmRegion(): void {
  const row = regionRow.value;
  if (row) {
    const target = items.value.find((i) => i.id === row.id);
    if (target) target.regions = regionRects.value.map((r) => ({ ...r }));
  }
  closeRegion();
  schedulePreview();
}

/**
 * 打开对比预览：加载原图；已处理则一并加载结果。
 * @param row 目标行。
 */
async function openPreview(row: StylizeItem): Promise<void> {
  previewModalTitle.value = row.name;
  previewOriginal.value = '';
  previewStylized.value = '';
  previewShow.value = true;
  try {
    previewOriginal.value = await getDataUrlApi(row.path);
    if (row.outputPath) previewStylized.value = await getDataUrlApi(row.outputPath);
  } catch {
    // 错误提示由 services 统一弹出
  }
}
// #endregion

// #region process
/**
 * 组装单项的风格化选项。
 * @param item 列表项。
 * @returns 风格化选项。
 */
function buildStylizeOptions(item: StylizeItem): StylizeOptions {
  return {
    effects: buildEffects(),
    // 展开成纯对象再过 IPC（reactive Proxy 无法结构化克隆）
    regions: (item.regions ?? []).map((r) => ({ ...r })),
    region: { ...config.region },
    format: config.format,
    quality: config.quality,
    outputDir: config.outputDir,
    overwrite: config.overwrite,
  };
}

/** 开始处理：有勾选时只处理选中项，否则处理全部。 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;

  const hasRegion = targets.some((i) => i.regions?.length);
  if (!enabledCount.value && !hasRegion) {
    message.warning('请先启用至少一种效果，或为图片框选局部区域');
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
        const result = await stylizeImageApi(item.path, buildStylizeOptions(item));
        item.stylizedSize = result.stylizedSize;
        item.outputPath = result.outputPath;
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
.stylize {
  &__main {
    display: flex;
    flex: 1;
    min-height: 0;
    gap: var(--tb-space-4);
  }

  &__list {
    flex: 1;
    min-width: 0;
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

  &__preview {
    display: flex;
    flex: none;
    flex-direction: column;
    width: 320px;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    overflow: hidden;
  }

  &__preview-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--tb-space-2);
    padding: var(--tb-space-2) var(--tb-space-3);
    border-bottom: 1px solid var(--tb-border);
  }

  &__preview-title {
    font-size: 13px;
    color: var(--tb-text-primary);
  }

  &__preview-name {
    overflow: hidden;
    font-size: 12px;
    color: var(--tb-text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__preview-body {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: var(--tb-space-3);
    // 透明图的棋盘底
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

  &__preview-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  &__preview-tip {
    margin: 0;
    padding: 0 var(--tb-space-4);
    font-size: 12px;
    text-align: center;
    color: var(--tb-text-secondary);
  }

  &__preview-mask {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(0 0 0 / 35%);
  }

  &__preview-foot {
    margin: 0;
    padding: var(--tb-space-2) var(--tb-space-3);
    font-size: 12px;
    color: var(--tb-text-secondary);
    border-top: 1px solid var(--tb-border);
  }

  &__panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--tb-space-3);
  }

  &__panel-title {
    margin: 0;
    font-size: 15px;
    color: var(--tb-text-primary);

    &--sub {
      margin-top: var(--tb-space-5);
      margin-bottom: var(--tb-space-4);
      padding-top: var(--tb-space-4);
      border-top: 1px solid var(--tb-border);
    }
  }

  &__eff-name {
    font-size: 13px;
  }

  &__eff-body {
    padding-bottom: var(--tb-space-2);
  }

  &__field {
    margin-bottom: var(--tb-space-4);

    &--row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
  }

  &__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    display: block;
    margin-bottom: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);

    &--mt {
      margin-top: var(--tb-space-3);
    }
  }

  &__field--row &__label,
  &__row &__label {
    margin-bottom: 0;
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--tb-text-secondary);

    &--pull {
      margin-bottom: var(--tb-space-2);
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

  &__modal-count {
    font-size: 12px;
    color: var(--tb-text-secondary);
  }
}
</style>
