<template>
  <ToolPageLayout
    title="二维码"
    desc="批量生成二维码，或批量解析图片中的二维码"
    category="图片工具"
  >
    <template #toolbar>
      <n-tabs v-model:value="tab" type="segment" size="small" class="qr__tabs">
        <n-tab name="generate">生成二维码</n-tab>
        <n-tab name="decode">解析二维码</n-tab>
      </n-tabs>
    </template>

    <!-- 主区 -->
    <template #main>
      <!-- 生成：左输入 + 右预览网格 -->
      <div v-if="tab === 'generate'" class="qr__split">
        <div class="qr__split-left">
          <label class="qr__label">内容（每行一条，生成多个二维码）</label>
          <n-input
            v-model:value="genText"
            type="textarea"
            class="qr__textarea"
            :input-props="{ spellcheck: 'false' }"
            placeholder="每行一条内容，例如：&#10;https://example.com&#10;hello world"
          />
          <p class="qr__tip">共 {{ genLines.length }} 条</p>
        </div>
        <div class="qr__split-right">
          <div class="qr__preview-head">
            <span class="qr__dim">预览</span>
          </div>
          <div class="qr__preview-body">
            <div v-if="genItems.length" class="qr__grid">
              <figure
                v-for="(item, i) in genItems"
                :key="i"
                class="qr__cell"
                :class="{ 'qr__cell--invalid': !isValid(item.text) }"
              >
                <img
                  v-if="item.preview"
                  :src="item.preview"
                  class="qr__cell-img"
                  :alt="item.text"
                  title="点击放大预览"
                  @click="openPreview(item)"
                />
                <div v-else class="qr__cell-ph"><n-spin :size="16" /></div>
                <n-input
                  v-model:value="item.name"
                  size="tiny"
                  class="qr__cell-name"
                  :placeholder="`名称`"
                />
                <figcaption class="qr__cell-text" :title="item.text">
                  <span v-if="!isValid(item.text)" class="qr__cell-badge">校验不符</span
                  >{{ item.text }}
                </figcaption>
              </figure>
            </div>
            <div v-else class="qr__empty">
              <n-icon :size="40" :depth="3" :component="QrCodeOutline" />
              <p>在左侧输入内容，右侧实时预览</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 解析：分页文件列表 -->
      <div v-else class="qr__list" :class="{ 'qr__list--drag': isDragOver }" v-bind="dropHandlers">
        <div class="qr__bar">
          <n-button size="small" type="primary" @click="handleAddFiles">
            <template #icon><n-icon :component="CloudUploadOutline" /></template>
            添加文件
          </n-button>
          <n-button size="small" :loading="scanning" @click="handleAddFolder">
            <template #icon><n-icon :component="FolderOpenOutline" /></template>
            添加文件夹
          </n-button>
          <n-checkbox v-model:checked="decodeRecursive" class="qr__dim">含子文件夹</n-checkbox>
          <n-button
            size="small"
            quaternary
            :disabled="!decodeChecked.length"
            @click="handleRemoveChecked"
          >
            移除选中{{ decodeChecked.length ? `(${decodeChecked.length})` : '' }}
          </n-button>
          <n-button
            size="small"
            quaternary
            :disabled="!decodeItems.length"
            @click="handleClearDecode"
          >
            清空
          </n-button>
        </div>
        <n-data-table
          v-if="decodeItems.length"
          v-model:checked-row-keys="decodeChecked"
          :columns="decodeColumns"
          :data="decodeItems"
          :row-key="(row: QrDecodeItem) => row.id"
          :pagination="pagination"
          flex-height
          class="qr__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="qr__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽二维码图片到此处，或点击「添加文件」</p>
        </div>
      </div>
    </template>

    <!-- 参数面板 -->
    <template #panel>
      <template v-if="tab === 'generate'">
        <h3 class="qr__ptitle">生成参数</h3>
        <div class="qr__field">
          <label class="qr__label">输出名模板</label>
          <n-input v-model:value="genConfig.nameTemplate" size="small" placeholder="qr_{n}" />
          <p class="qr__tip">{n} 为序号、{text} 为内容；单个二维码下方也可手动改名</p>
        </div>
        <div class="qr__field">
          <label class="qr__label">尺寸 px</label>
          <n-input-number
            v-model:value="genConfig.size"
            size="small"
            :min="64"
            :max="4096"
            :step="16"
            class="qr__full"
          />
        </div>
        <div class="qr__field">
          <label class="qr__label">边距（模块数）</label>
          <n-input-number
            v-model:value="genConfig.margin"
            size="small"
            :min="0"
            :max="32"
            :step="1"
            class="qr__full"
          />
        </div>
        <div class="qr__field">
          <label class="qr__label">容错级别</label>
          <n-select v-model:value="genConfig.level" :options="levelOptions" size="small" />
        </div>
        <div class="qr__field">
          <label class="qr__label">前景色 / 背景色</label>
          <div class="qr__pair">
            <n-color-picker
              v-model:value="genConfig.dark"
              size="small"
              :show-alpha="false"
              :modes="['hex']"
            />
            <n-color-picker
              v-model:value="genConfig.light"
              size="small"
              :show-alpha="false"
              :modes="['hex']"
            />
          </div>
        </div>
        <div class="qr__field">
          <label class="qr__label">输出格式</label>
          <n-select v-model:value="genConfig.format" :options="formatOptions" size="small" />
        </div>
        <div class="qr__field">
          <label class="qr__label">内容校验（可选）</label>
          <n-select v-model:value="genConfig.validate" :options="validateOptions" size="small" />
          <n-input
            v-if="genConfig.validate === 'regex'"
            v-model:value="genConfig.validateRegex"
            size="small"
            class="qr__mt"
            placeholder="自定义正则，如 ^\\d{6}$"
          />
          <p v-if="invalidCount > 0" class="qr__tip qr__tip--warn">
            {{ invalidCount }} 条不符合校验，将跳过不生成
          </p>
        </div>
        <div class="qr__field">
          <label class="qr__label">输出目录</label>
          <div class="qr__dir">
            <n-input
              v-model:value="genConfig.outputDir"
              size="small"
              placeholder="粘贴或选择输出目录"
              :status="outputDirStatus"
            />
            <n-button size="small" @click="pickGenDir"
              ><n-icon :component="FolderOpenOutline"
            /></n-button>
          </div>
          <p v-if="outputDirStatus === 'error'" class="qr__tip qr__tip--warn">
            路径格式不正确（需为绝对路径，如 C:\output 或 /home/user/out）
          </p>
        </div>
        <n-button
          type="primary"
          block
          class="qr__mt"
          :loading="generating"
          :disabled="!canGenerate"
          @click="handleGenerate"
        >
          生成 ({{ validItems.length }})
        </n-button>
      </template>

      <template v-else>
        <h3 class="qr__ptitle">解析</h3>
        <p class="qr__tip qr__tip--pull">导入含二维码的图片，点「开始解析」批量识别</p>
        <div class="qr__field">
          <n-button block :loading="decoding" :disabled="!decodeItems.length" @click="handleDecode">
            {{ decodeChecked.length ? `解析选中 (${decodeChecked.length})` : '开始解析' }}
          </n-button>
        </div>
        <div class="qr__field">
          <label class="qr__label">复制格式</label>
          <n-select v-model:value="copyFormat" :options="copyFormatOptions" size="small" />
          <n-input
            v-if="copyFormat === 'custom'"
            v-model:value="copyTemplate"
            size="small"
            class="qr__mt"
            placeholder="{name}: {result}"
          />
          <p v-if="copyFormat === 'custom'" class="qr__tip">{name} 为文件名、{result} 为解析结果</p>
        </div>
        <div class="qr__field">
          <n-button size="small" block :disabled="!hasResults" @click="handleCopyAll">
            复制全部结果
          </n-button>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="qr__footer">
        <span v-if="tab === 'generate'">共 {{ genItems.length }} 条内容</span>
        <span v-else>已选择 {{ decodeItems.length }} 张 · 已识别 {{ decodedOkCount }}</span>
      </div>
    </template>
  </ToolPageLayout>

  <!-- 二维码放大预览（多张可左右切换） -->
  <n-modal v-model:show="previewShow">
    <n-card
      class="qr__modal"
      :title="previewTitle"
      size="small"
      closable
      @close="previewShow = false"
    >
      <div class="qr__modal-body">
        <n-button
          v-if="genItems.length > 1"
          class="qr__modal-nav qr__modal-nav--prev"
          circle
          secondary
          @click="stepPreview(-1)"
        >
          <template #icon><n-icon :component="ChevronBackOutline" /></template>
        </n-button>
        <img v-if="previewSrc" :src="previewSrc" class="qr__modal-img" alt="二维码预览" />
        <n-button
          v-if="genItems.length > 1"
          class="qr__modal-nav qr__modal-nav--next"
          circle
          secondary
          @click="stepPreview(1)"
        >
          <template #icon><n-icon :component="ChevronForwardOutline" /></template>
        </n-button>
      </div>
      <template #footer>
        <div class="qr__modal-foot">
          <span class="qr__modal-text">{{ previewContent }}</span>
          <span v-if="genItems.length > 1" class="qr__modal-count">
            {{ previewIndex + 1 }} / {{ genItems.length }}
          </span>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { computed, h, reactive, ref, watch } from 'vue';
import {
  NButton,
  NCard,
  NCheckbox,
  NColorPicker,
  NDataTable,
  NIcon,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpin,
  NTab,
  NTabs,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  ChevronBackOutline,
  ChevronForwardOutline,
  CloudUploadOutline,
  CopyOutline,
  FolderOpenOutline,
  QrCodeOutline,
} from '@vicons/ionicons5';
import type { PickedFile, QrErrorLevel, QrGenerateItem, QrOutputFormat } from '@shared/types';
import type { QrDecodeItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { decodeQrApi, generateQrApi, getThumbnailApi, qrPreviewApi } from '@/services/image';
import { createTaskQueue } from '@/utils/taskQueue';

const message = useMessage();

const ACCEPT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff'];
const PAGE_SIZE = 50;
const MAX_FILES = 10_000;
const PREVIEW_DEBOUNCE = 300;

const tab = ref<'generate' | 'decode'>('generate');

const levelOptions = [
  { label: 'L（低，7%）', value: 'L' },
  { label: 'M（中，15%）', value: 'M' },
  { label: 'Q（较高，25%）', value: 'Q' },
  { label: 'H（高，30%）', value: 'H' },
];
const formatOptions = [
  { label: 'PNG', value: 'png' },
  { label: 'JPG', value: 'jpg' },
  { label: 'SVG（矢量）', value: 'svg' },
];
const validateOptions = [
  { label: '不校验', value: 'none' },
  { label: 'URL 格式', value: 'url' },
  { label: '自定义正则', value: 'regex' },
];
const copyFormatOptions = [
  { label: '名称 + 解析结果', value: 'nameResult' },
  { label: 'JSON（名称: 结果）', value: 'json' },
  { label: '纯结果', value: 'result' },
  { label: '自定义模板', value: 'custom' },
];

// ── drop：生成 tab 不收文件，解析 tab 收图片 ──
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => {
    if (tab.value === 'decode') addFiles(files);
  },
});

/* ═══════════════ 生成 ═══════════════ */

interface GenItem extends QrGenerateItem {
  /** 预览 data URL（异步）。 */
  preview?: string;
}

const genText = ref('');
const genItems = ref<GenItem[]>([]);
const generating = ref(false);

// 放大预览弹窗（按 genItems 索引，可左右切换）
const previewShow = ref(false);
const previewSrc = ref('');
const previewIndex = ref(0);
const previewTitle = computed(() => genItems.value[previewIndex.value]?.name || '二维码预览');
const previewContent = computed(() => genItems.value[previewIndex.value]?.text ?? '');

const { config: genConfig } = useToolConfig('image-qrcode-gen', {
  nameTemplate: 'qr_{n}',
  size: 320,
  margin: 2,
  level: 'M' as QrErrorLevel,
  dark: '#000000',
  light: '#ffffff',
  format: 'png' as QrOutputFormat,
  validate: 'none' as 'none' | 'url' | 'regex',
  validateRegex: '',
  outputDir: '',
});

/** 文本按行拆分（去空行、去首尾空白）。 */
const genLines = computed(() =>
  genText.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0),
);

/** 当前正则（仅 regex 模式且能编译时有效），编译失败按「不拦」处理。 */
const compiledRegex = computed<RegExp | null>(() => {
  if (genConfig.validate !== 'regex' || !genConfig.validateRegex) return null;
  try {
    return new RegExp(genConfig.validateRegex);
  } catch {
    return null;
  }
});

/**
 * 内容是否通过校验。none 恒真；url 用 URL 构造判定；regex 用编译后的正则。
 * @param text 内容。
 * @returns 是否有效。
 */
function isValid(text: string): boolean {
  if (genConfig.validate === 'none') return true;
  if (genConfig.validate === 'url') {
    try {
      // 只认带协议的绝对 URL，避免把普通文本误判为合法
      const u = new URL(text);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }
  // regex：正则为空或编译失败时不拦（视为通过）
  return compiledRegex.value ? compiledRegex.value.test(text) : true;
}

/** 通过校验、将真正生成的条目。 */
const validItems = computed(() => genItems.value.filter((i) => isValid(i.text)));
/** 未通过校验的条数。 */
const invalidCount = computed(() => genItems.value.length - validItems.value.length);

/**
 * 输出目录格式是否正确：空为默认态；绝对路径（Windows `X:\...` 或 POSIX `/...`）为成功，否则错误。
 */
const outputDirStatus = computed<'error' | undefined>(() => {
  const dir = genConfig.outputDir.trim();
  if (!dir) return undefined;
  const ok = /^[a-zA-Z]:[\\/]/.test(dir) || dir.startsWith('/') || dir.startsWith('\\\\');
  return ok ? undefined : 'error';
});

const canGenerate = computed(
  () =>
    validItems.value.length > 0 &&
    !generating.value &&
    !!genConfig.outputDir.trim() &&
    outputDirStatus.value !== 'error',
);

/**
 * 按模板算出某条的默认文件名。
 * @param text 内容。
 * @param index 序号（从 0）。
 * @returns 文件名（不含扩展名）。
 */
function nameFor(text: string, index: number): string {
  const tpl = genConfig.nameTemplate || 'qr_{n}';
  // {text} 里的非法文件名字符替换掉，避免落盘失败
  const safeText = text.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  return tpl.replace(/\{n\}/g, String(index + 1)).replace(/\{text\}/g, safeText);
}

const previewQueue = createTaskQueue(4);

/**
 * 文本或参数变化时重建条目列表并排队预览。
 * 保留用户对已有条目的手改名（按索引对齐，内容变了才重置名）。
 */
function rebuildGenItems(): void {
  previewQueue.clear();
  const prev = genItems.value;
  genItems.value = genLines.value.map((text, i) => {
    const old = prev[i];
    // 同一行内容没变则沿用旧名与旧预览，否则用模板名、清预览
    const keepName = old && old.text === text ? old.name : nameFor(text, i);
    return { text, name: keepName, preview: old && old.text === text ? old.preview : undefined };
  });
  // 为缺预览的条目排队生成
  genItems.value.forEach((item, i) => {
    if (item.preview) return;
    const { text } = item;
    previewQueue.push(async () => {
      const url = await qrPreviewApi({
        text,
        size: 240,
        margin: genConfig.margin,
        level: genConfig.level,
        dark: genConfig.dark,
        light: genConfig.light,
      }).catch(() => '');
      // 内容可能已变，按当前索引核对文本再写回
      const target = genItems.value[i];
      if (target && target.text === text && url) target.preview = url;
    });
  });
}

let previewTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRebuild(): void {
  if (previewTimer) clearTimeout(previewTimer);
  previewTimer = setTimeout(rebuildGenItems, PREVIEW_DEBOUNCE);
}

// 文本变化重建条目；影响预览外观的参数变化则清预览重排（不动名字）
watch(genText, scheduleRebuild);
watch(
  () => [genConfig.margin, genConfig.level, genConfig.dark, genConfig.light],
  () => {
    for (const item of genItems.value) item.preview = undefined;
    scheduleRebuild();
  },
);
// 模板变化：只重算未被手改的名字——这里简单全量按模板重置，手改会丢，故仅在无手改语义下用
watch(
  () => genConfig.nameTemplate,
  () => {
    genItems.value.forEach((item, i) => (item.name = nameFor(item.text, i)));
  },
);

async function pickGenDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) genConfig.outputDir = dir;
}

/**
 * 载入指定索引的高清预览：先用列表里的小图秒开，再按输出尺寸重生成替换。
 * @param index genItems 下标。
 */
async function loadPreview(index: number): Promise<void> {
  const item = genItems.value[index];
  if (!item) return;
  previewIndex.value = index;
  previewSrc.value = item.preview ?? '';
  // 列表缩略图只有 240px，弹窗按输出尺寸重生成更清晰
  const { text } = item;
  const url = await qrPreviewApi({
    text,
    size: genConfig.size,
    margin: genConfig.margin,
    level: genConfig.level,
    dark: genConfig.dark,
    light: genConfig.light,
  }).catch(() => '');
  // 期间用户可能已关窗或切到别的码，核对索引与内容再替换
  if (
    previewShow.value &&
    previewIndex.value === index &&
    genItems.value[index]?.text === text &&
    url
  ) {
    previewSrc.value = url;
  }
}

/**
 * 打开放大预览。
 * @param item 被点击的条目。
 */
function openPreview(item: GenItem): void {
  const index = genItems.value.indexOf(item);
  if (index < 0) return;
  previewShow.value = true;
  void loadPreview(index);
}

/**
 * 左右切换预览（循环）。
 * @param delta -1 上一张 / 1 下一张。
 */
function stepPreview(delta: number): void {
  const n = genItems.value.length;
  if (n <= 1) return;
  void loadPreview((previewIndex.value + delta + n) % n);
}

async function handleGenerate(): Promise<void> {
  generating.value = true;
  try {
    // 只提交通过校验的条目；不合规的已在预览里标出并从计数排除
    const result = await generateQrApi({
      items: validItems.value.map((i) => ({ text: i.text, name: i.name || 'qr' })),
      size: genConfig.size,
      margin: genConfig.margin,
      level: genConfig.level,
      dark: genConfig.dark,
      light: genConfig.light,
      format: genConfig.format,
      outputDir: genConfig.outputDir.trim(),
    });
    const okCount = result.outputPaths.length;
    const skipped = invalidCount.value;
    const parts = [`已生成 ${okCount} 个`];
    if (result.failed) parts.push(`${result.failed} 个失败（内容可能超出容量）`);
    if (skipped) parts.push(`${skipped} 条校验不符已跳过`);
    if (result.failed || skipped) message.warning(parts.join('，'));
    else message.success(`已生成 ${okCount} 个二维码`);
  } catch {
    // 错误已由 service 弹出
  } finally {
    generating.value = false;
  }
}

/* ═══════════════ 解析 ═══════════════ */

const decodeItems = ref<QrDecodeItem[]>([]);
const decodeChecked = ref<string[]>([]);
const decoding = ref(false);
const decodeRecursive = ref(false);
/** 复制格式与自定义模板（持久化）。 */
const { config: copyConfig } = useToolConfig('image-qrcode-copy', {
  format: 'nameResult' as 'nameResult' | 'json' | 'result' | 'custom',
  template: '{name}: {result}',
});
const copyFormat = computed({
  get: () => copyConfig.format,
  set: (v) => (copyConfig.format = v),
});
const copyTemplate = computed({
  get: () => copyConfig.template,
  set: (v) => (copyConfig.template = v),
});
let seq = 0;

const { scanning, importFolder } = useFolderImport({
  key: 'qrcode',
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
  () => decodeItems.value.length,
  (count) => {
    pagination.itemCount = count;
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (pagination.page > pageCount) pagination.page = pageCount;
  },
  { immediate: true },
);

const visibleItems = computed(() =>
  decodeItems.value.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE),
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
        const target = decodeItems.value.find((i) => i.id === id);
        if (target) target.thumbnail = url;
      });
    }
  },
  { immediate: true },
);

const decodedOkCount = computed(() => decodeItems.value.filter((i) => i.result).length);
const hasResults = computed(() => decodeItems.value.some((i) => i.result));

const decodeColumns: DataTableColumns<QrDecodeItem> = [
  { type: 'selection' },
  {
    title: '预览',
    key: 'thumbnail',
    width: 60,
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
  { title: '文件名', key: 'name', width: 180, ellipsis: { tooltip: true } },
  {
    title: '解析结果',
    key: 'result',
    ellipsis: { tooltip: true },
    render: (row) => {
      if (!row.decoded) return h('span', { style: 'color:var(--tb-text-secondary)' }, '—');
      if (!row.result)
        return h('span', { style: 'color:var(--tb-text-secondary)' }, '未识别到二维码');
      return row.result;
    },
  },
  {
    title: '状态',
    key: 'status',
    width: 80,
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
    width: 56,
    render: (row) =>
      h(
        NButton,
        {
          text: true,
          size: 'small',
          disabled: !row.result,
          onClick: () => copyText(row.result ?? ''),
        },
        { icon: () => h(NIcon, { component: CopyOutline }) },
      ),
  },
];

function addFiles(files: PickedFile[]): void {
  const existing = new Set(decodeItems.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;
  for (const file of fresh) {
    decodeItems.value.push({ ...file, id: `qr-${seq++}`, status: 'pending' });
  }
}

async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '图片', extensions: ACCEPT }],
    title: '选择二维码图片',
  });
  if (files.length) addFiles(files);
}

async function handleAddFolder(): Promise<void> {
  const before = decodeItems.value.length;
  const files = await importFolder(decodeRecursive.value);
  if (!files.length) return;
  addFiles(files);
  const added = decodeItems.value.length - before;
  if (added) message.success(`已添加 ${added} 张图片`);
  else message.info('这些图片已在列表中');
}

function handleClearDecode(): void {
  decodeItems.value = [];
  decodeChecked.value = [];
  thumbQueue.clear();
  thumbRequested.clear();
}

function handleRemoveChecked(): void {
  const removing = new Set(decodeChecked.value);
  decodeItems.value = decodeItems.value.filter((i) => !removing.has(i.id));
  decodeChecked.value = [];
}

/** 复制文本到剪贴板。 */
function copyText(text: string): void {
  if (!text) return;
  void navigator.clipboard.writeText(text).then(
    () => message.success('已复制'),
    () => message.error('复制失败'),
  );
}

function handleCopyAll(): void {
  const done = decodeItems.value.filter((i) => i.result);
  if (!done.length) return;

  // 复制时名称不带扩展名（最后一个点之前的部分）
  const baseName = (name: string): string => name.replace(/\.[^./\\]+$/, '');

  let text: string;
  switch (copyConfig.format) {
    case 'json':
      // 名称→结果的对象；同名后者覆盖，够用
      text = JSON.stringify(
        Object.fromEntries(done.map((i) => [baseName(i.name), i.result])),
        null,
        2,
      );
      break;
    case 'result':
      text = done.map((i) => i.result).join('\n');
      break;
    case 'custom': {
      const tpl = copyConfig.template || '{name}: {result}';
      text = done
        .map((i) =>
          tpl.replace(/\{name\}/g, baseName(i.name)).replace(/\{result\}/g, i.result ?? ''),
        )
        .join('\n');
      break;
    }
    default:
      // nameResult：名称 + tab + 结果
      text = done.map((i) => `${baseName(i.name)}\t${i.result}`).join('\n');
  }
  copyText(text);
}

async function handleDecode(): Promise<void> {
  const selected = new Set(decodeChecked.value);
  const targets = selected.size
    ? decodeItems.value.filter((i) => selected.has(i.id))
    : decodeItems.value;
  decoding.value = true;
  let ok = 0;
  try {
    for (const item of targets) {
      item.status = 'processing';
      try {
        const res = await decodeQrApi(item.path);
        item.result = res.text ?? '';
        item.decoded = true;
        item.status = 'done';
        if (res.ok) ok += 1;
      } catch (e) {
        item.status = 'error';
        item.error = e instanceof Error ? e.message : '解析失败';
      }
    }
    message.success(`解析完成，识别到 ${ok} / ${targets.length} 个`);
  } finally {
    decoding.value = false;
  }
}
</script>

<style scoped lang="scss">
.qr {
  &__tabs {
    max-width: 260px;
  }

  &__dim {
    font-size: 13px;
    color: var(--tb-text-secondary);
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
    flex: 1;
    min-width: 0;
    border-left: 1px solid var(--tb-border);
    padding-left: var(--tb-space-3);
  }

  &__textarea {
    flex: 1;
    min-height: 0;
  }

  &__preview-head {
    margin-bottom: var(--tb-space-2);
  }

  &__preview-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--tb-space-3);
  }

  &__cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: var(--tb-space-2);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);

    &--invalid {
      border-color: var(--tb-color-warning, #e0a030);
      opacity: 0.7;
    }
  }

  &__cell-badge {
    display: inline-block;
    margin-right: 4px;
    padding: 0 4px;
    font-size: 10px;
    color: #fff;
    background: var(--tb-color-warning, #e0a030);
    border-radius: 3px;
  }

  &__cell-img,
  &__cell-ph {
    width: 100%;
    aspect-ratio: 1;
    object-fit: contain;
    border-radius: var(--tb-radius-sm);
  }

  &__cell-img {
    cursor: zoom-in;
  }

  &__cell-ph {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tb-bg-hover);
  }

  &__cell-text {
    font-size: 11px;
    color: var(--tb-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__list {
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

  &__bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-3);
    align-items: center;
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
  }

  &__field {
    margin-bottom: var(--tb-space-4);
  }

  &__label {
    display: block;
    margin-bottom: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);
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

    &--warn {
      color: var(--tb-color-warning, #e0a030);
    }
  }

  &__full {
    width: 100%;
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

  &__modal {
    width: 480px;
    max-width: 92vw;
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
  }

  &__modal-body {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--tb-space-3);
  }

  &__modal-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 1;

    &--prev {
      left: 0;
    }

    &--next {
      right: 0;
    }
  }

  &__modal-img {
    max-width: 100%;
    max-height: 60vh;
    object-fit: contain;
  }

  &__modal-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tb-space-3);
  }

  &__modal-text {
    font-size: 13px;
    color: var(--tb-text-secondary);
    word-break: break-all;
  }

  &__modal-count {
    flex: none;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }
}
</style>
