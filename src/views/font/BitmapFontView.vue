<template>
  <ToolPageLayout
    title="位图字体"
    desc="字体或字符图片烘成 PNG 图集 + BMFont 描述文件，供游戏引擎直接渲染文字"
    category="字体工具"
  >
    <template #toolbar>
      <n-tabs v-model:value="tab" type="segment" size="small" class="bmf__tabs">
        <n-tab name="font">字体 → 位图</n-tab>
        <n-tab name="images">图片 → 位图</n-tab>
      </n-tabs>
    </template>

    <!-- 主区：字体 tab = 字符集 + 图集预览；图片 tab = 图片列表 -->
    <template #main>
      <div
        v-if="tab === 'font'"
        class="bmf__split"
        :class="{ bmf__drag: isFontDragOver }"
        v-bind="fontDropHandlers"
      >
        <!-- 左：字体来源 + 字符集 -->
        <div class="bmf__split-left">
          <div v-if="!source" class="bmf__empty">
            <n-icon :size="40" :depth="3" :component="TextOutline" />
            <p>拖拽字体到此处，或点击选择（TTF / OTF / WOFF / WOFF2）</p>
            <n-button size="small" @click="handlePickFont">选择字体</n-button>
          </div>
          <template v-else>
            <div class="bmf__source">
              <div class="bmf__source-info">
                <div class="bmf__source-name">{{ source.name }}</div>
                <div class="bmf__source-sub">
                  <template v-if="sourceMeta?.familyName">{{ sourceMeta.familyName }} · </template
                  >{{ formatBytes(source.size)
                  }}<template v-if="sourceMeta"> · {{ sourceMeta.glyphCount }} 字形</template>
                </div>
              </div>
              <n-button size="small" @click="handlePickFont">更换字体</n-button>
            </div>

            <div class="bmf__field">
              <label class="bmf__label">手动输入字符</label>
              <n-input
                v-model:value="manualChars"
                type="textarea"
                :rows="3"
                :input-props="{ spellcheck: 'false' }"
                placeholder="输入要生成的字符，如 你好世界ABC123"
              />
            </div>
            <div class="bmf__field">
              <label class="bmf__label">从文件提取（可多选 txt / json）</label>
              <div class="bmf__file-row">
                <n-input
                  :value="charFileNames.join('、')"
                  size="small"
                  readonly
                  placeholder="选择 txt / json，可多选"
                />
                <n-button size="small" @click="pickCharFile">
                  <n-icon :component="DocumentTextOutline" />
                </n-button>
                <n-button v-if="fileChars" size="small" quaternary @click="clearCharFile">
                  清除
                </n-button>
              </div>
              <n-checkbox v-model:checked="jsonValueOnly" class="bmf__mt-sm">
                JSON 只提取 value 值（忽略 key）
              </n-checkbox>
            </div>
            <div class="bmf__field">
              <label class="bmf__label">预设字符集</label>
              <n-checkbox-group v-model:value="checkedPresets">
                <n-space vertical size="small">
                  <n-checkbox v-for="p in CHARSET_PRESETS" :key="p.key" :value="p.key">
                    {{ p.label }}
                  </n-checkbox>
                </n-space>
              </n-checkbox-group>
            </div>
            <p class="bmf__count">
              共 {{ charCount }} 个字符（已去重）
              <span v-if="charCount > KERNING_LIMIT" class="bmf__warn">
                · 超过 {{ KERNING_LIMIT }} 个，字距对不再提取
              </span>
            </p>
            <p v-if="missingChars" class="bmf__warn bmf__warn--block">
              这个字体里没有 {{ [...missingChars].length }} 个字符，已跳过：{{
                missingChars.slice(0, 60)
              }}{{ [...missingChars].length > 60 ? '…' : '' }}
            </p>
          </template>
        </div>

        <!-- 右：图集预览 -->
        <div class="bmf__split-right">
          <div class="bmf__preview-head">
            <span class="bmf__dim">图集预览</span>
            <n-button
              size="small"
              :loading="previewing"
              :disabled="!canPreview"
              @click="handlePreview"
            >
              <template #icon><n-icon :component="RefreshOutline" /></template>
              刷新
            </n-button>
          </div>
          <div class="bmf__preview-body">
            <div v-if="previewPages.length" class="bmf__preview-pages">
              <figure v-for="(p, i) in previewPages" :key="i" class="bmf__preview-figure">
                <img :src="p.dataUrl" class="bmf__preview-img" :alt="`图集 ${i + 1}`" />
                <figcaption class="bmf__preview-cap">
                  第 {{ i + 1 }} 页：{{ p.width }} × {{ p.height }}，{{ p.charCount }} 字
                </figcaption>
              </figure>
            </div>
            <n-spin v-else-if="previewing" />
            <div v-else class="bmf__preview-empty">
              <n-icon :size="32" :depth="3" :component="GridOutline" />
              <p>点「刷新」按当前参数预览图集</p>
            </div>
          </div>
          <p v-if="previewPages.length" class="bmf__preview-info">
            共 {{ previewPages.length }} 页、{{ previewCharCount }} 字，空间占用率
            {{ previewOccupancy }}%
            <span v-if="previewStale" class="bmf__warn">· 参数已改，点刷新重算</span>
          </p>
        </div>
      </div>

      <!-- 图片 tab -->
      <div v-else class="bmf__main" :class="{ bmf__drag: isImgDragOver }" v-bind="imgDropHandlers">
        <div class="bmf__bar">
          <n-button size="small" type="primary" @click="handleAddImages">
            <template #icon><n-icon :component="CloudUploadOutline" /></template>
            添加图片
          </n-button>
          <n-button size="small" :loading="scanning" @click="handleAddImageFolder">
            <template #icon><n-icon :component="FolderOpenOutline" /></template>
            添加文件夹
          </n-button>
          <n-checkbox v-model:checked="imgConfig.recursive" class="bmf__dim">
            含子文件夹
          </n-checkbox>
          <n-button size="small" quaternary :disabled="!glyphItems.length" @click="autoFillChars">
            按文件名填字符
          </n-button>
          <n-button size="small" quaternary :disabled="!imgChecked.length" @click="removeChecked">
            移除选中{{ imgChecked.length ? `(${imgChecked.length})` : '' }}
          </n-button>
          <n-button size="small" quaternary :disabled="!glyphItems.length" @click="clearImages">
            清空
          </n-button>
        </div>
        <n-data-table
          v-if="glyphItems.length"
          v-model:checked-row-keys="imgChecked"
          :columns="imgColumns"
          :data="glyphItems"
          :row-key="(row: BitmapGlyphItem) => row.id"
          :pagination="pagination"
          flex-height
          class="bmf__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="bmf__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽字符图片到此处，或点击「添加图片」（一张图 = 一个字符）</p>
        </div>
      </div>
    </template>

    <!-- 参数面板：两 tab 各一套 -->
    <template #panel>
      <template v-if="tab === 'font'">
        <h3 class="bmf__ptitle">字形</h3>
        <div class="bmf__field">
          <label class="bmf__label">字号 {{ fontConfig.fontSize }} px</label>
          <n-slider v-model:value="fontConfig.fontSize" :min="8" :max="256" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">填充色 / 描边色</label>
          <div class="bmf__pair">
            <n-color-picker
              v-model:value="fontConfig.fill"
              size="small"
              :show-alpha="false"
              :modes="['hex']"
            />
            <n-color-picker
              v-model:value="fontConfig.outlineColor"
              size="small"
              :show-alpha="false"
              :modes="['hex']"
            />
          </div>
        </div>
        <div class="bmf__field">
          <label class="bmf__label">描边宽度 {{ fontConfig.outlineWidth }} px</label>
          <n-slider v-model:value="fontConfig.outlineWidth" :min="0" :max="16" />
          <p class="bmf__tip">描边画在填充下方，向外扩张，字形位图会相应变大。0 = 不描边。</p>
        </div>

        <h3 class="bmf__ptitle bmf__ptitle--sub">图集</h3>
        <div class="bmf__field">
          <label class="bmf__label">字形间距 {{ fontConfig.spacing }} px</label>
          <n-slider v-model:value="fontConfig.spacing" :min="0" :max="32" />
          <p class="bmf__tip">留白防止引擎线性采样时相邻字形渗色，建议至少 1。</p>
        </div>
        <div class="bmf__field">
          <label class="bmf__label">外边距 {{ fontConfig.padding }} px</label>
          <n-slider v-model:value="fontConfig.padding" :min="0" :max="32" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">单页最大边长</label>
          <n-select v-model:value="fontConfig.pageSize" :options="PAGE_SIZE_OPTIONS" size="small" />
          <p class="bmf__tip">装不下会自动分页；各页统一尺寸（BMFont 的 scaleW/H 是全局字段）。</p>
        </div>
        <div class="bmf__field bmf__field--row">
          <label class="bmf__label">提取字距对（kerning）</label>
          <n-switch
            v-model:value="fontConfig.kerning"
            size="small"
            :disabled="charCount > KERNING_LIMIT"
          />
        </div>
        <p v-if="charCount > KERNING_LIMIT" class="bmf__tip">
          字符数超过 {{ KERNING_LIMIT }} 时不提取：这是 n² 次排版试算，3755 汉字要算 1400
          万对，且中日韩文字本身几乎没有字距调整。
        </p>

        <h3 class="bmf__ptitle bmf__ptitle--sub">输出</h3>
        <div class="bmf__field">
          <label class="bmf__label">描述文件格式（可多选）</label>
          <n-checkbox-group v-model:value="fontConfig.dataFormats">
            <n-space size="small">
              <n-checkbox v-for="f in DATA_FORMAT_OPTIONS" :key="f.value" :value="f.value">
                {{ f.label }}
              </n-checkbox>
            </n-space>
          </n-checkbox-group>
          <p class="bmf__tip">
            三者数据完全相同，只是语法不同：.fnt 给 Cocos/Unity/LibGDX，.xml 给 Pixi，.json 给
            Phaser 与自研引擎。
          </p>
        </div>
        <div class="bmf__field">
          <label class="bmf__label">产物基名</label>
          <n-input
            v-model:value="fontConfig.baseName"
            size="small"
            placeholder="留空用字体文件名"
          />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">输出目录</label>
          <div class="bmf__dir">
            <n-input v-model:value="fontConfig.outputDir" size="small" placeholder="选择输出目录" />
            <n-button size="small" @click="pickFontOutputDir">
              <n-icon :component="FolderOpenOutline" />
            </n-button>
          </div>
        </div>

        <n-button
          type="primary"
          block
          class="bmf__mt"
          :loading="processing"
          :disabled="!canGenerate"
          @click="handleGenerate"
        >
          {{ fontStartLabel }}
        </n-button>
        <n-button v-if="processing" block quaternary class="bmf__mt" @click="handleCancel">
          取消
        </n-button>
      </template>

      <template v-else>
        <h3 class="bmf__ptitle">度量</h3>
        <p class="bmf__tip">
          图片没有字体的 ascent/descent 信息，行高与基线只能由你给定，引擎按它们排版。
        </p>
        <div class="bmf__field">
          <label class="bmf__label">行高 {{ imgConfig.lineHeight }} px</label>
          <n-slider v-model:value="imgConfig.lineHeight" :min="1" :max="256" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">基线到行顶 {{ imgConfig.base }} px</label>
          <n-slider v-model:value="imgConfig.base" :min="0" :max="256" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">前进量补偿 {{ imgConfig.advanceAdjust }} px</label>
          <n-slider v-model:value="imgConfig.advanceAdjust" :min="-32" :max="32" />
          <p class="bmf__tip">每个字符的前进量 = 图片宽度 + 该值，用来整体收紧或放宽字间距。</p>
        </div>

        <h3 class="bmf__ptitle bmf__ptitle--sub">图集</h3>
        <div class="bmf__field bmf__field--row">
          <label class="bmf__label">剔除透明边</label>
          <n-switch v-model:value="imgConfig.trim" size="small" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">字形间距 {{ imgConfig.spacing }} px</label>
          <n-slider v-model:value="imgConfig.spacing" :min="0" :max="32" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">外边距 {{ imgConfig.padding }} px</label>
          <n-slider v-model:value="imgConfig.padding" :min="0" :max="32" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">单页最大边长</label>
          <n-select v-model:value="imgConfig.pageSize" :options="PAGE_SIZE_OPTIONS" size="small" />
        </div>

        <h3 class="bmf__ptitle bmf__ptitle--sub">输出</h3>
        <div class="bmf__field">
          <label class="bmf__label">描述文件格式（可多选）</label>
          <n-checkbox-group v-model:value="imgConfig.dataFormats">
            <n-space size="small">
              <n-checkbox v-for="f in DATA_FORMAT_OPTIONS" :key="f.value" :value="f.value">
                {{ f.label }}
              </n-checkbox>
            </n-space>
          </n-checkbox-group>
        </div>
        <div class="bmf__field">
          <label class="bmf__label">产物基名</label>
          <n-input v-model:value="imgConfig.baseName" size="small" placeholder="bitmapfont" />
        </div>
        <div class="bmf__field">
          <label class="bmf__label">输出目录</label>
          <div class="bmf__dir">
            <n-input v-model:value="imgConfig.outputDir" size="small" placeholder="选择输出目录" />
            <n-button size="small" @click="pickImgOutputDir">
              <n-icon :component="FolderOpenOutline" />
            </n-button>
          </div>
        </div>

        <n-button
          type="primary"
          block
          class="bmf__mt"
          :loading="processing"
          :disabled="!canPack"
          @click="handlePack"
        >
          {{ imgStartLabel }}
        </n-button>
        <n-button v-if="processing" block quaternary class="bmf__mt" @click="handleCancel">
          取消
        </n-button>
      </template>
    </template>

    <template #footer>
      <div class="bmf__footer">
        <span v-if="tab === 'font'">
          {{ source ? `${source.name} · ${charCount} 个字符` : '未选择字体' }}
        </span>
        <span v-else> {{ glyphItems.length }} 张图片，已填字符 {{ filledCount }} 个 </span>
        <div class="bmf__footer-stats">
          <span v-if="progressLabel">{{ progressLabel }}</span>
          <template v-if="result">
            <span>{{ result.pagePaths.length }} 页图集</span>
            <span>{{ result.charCount }} 个字符</span>
            <span v-if="result.kerningCount">{{ result.kerningCount }} 对字距</span>
            <span v-if="result.skippedCount">跳过 {{ result.skippedCount }}</span>
            <n-button text type="primary" @click="openResultDir">打开输出目录</n-button>
          </template>
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
  NColorPicker,
  NDataTable,
  NIcon,
  NInput,
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
  DocumentTextOutline,
  FolderOpenOutline,
  GridOutline,
  RefreshOutline,
  TextOutline,
} from '@vicons/ionicons5';
import type {
  BitmapFontDataFormat,
  BitmapFontOptions,
  BitmapFontPagePreview,
  BitmapFontProgress,
  BitmapFontResult,
  FontMeta,
  PickedFile,
} from '@shared/types';
import type { BitmapGlyphItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { readTextApi, showInFolderApi } from '@/services/file';
import { probeFontApi } from '@/services/font';
import { getThumbnailApi } from '@/services/image';
import {
  cancelBitmapFontApi,
  generateBitmapFontApi,
  onBitmapFontProgress,
  packBitmapFontApi,
  previewBitmapFontApi,
} from '@/services/bitmapFont';
import { CHARSET_PRESETS } from '@/constants/charset';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

const message = useMessage();

const FONT_ACCEPT = ['ttf', 'otf', 'woff', 'woff2'];
const IMG_ACCEPT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const PAGE_SIZE = 50;
const MAX_FILES = 5_000;

/**
 * 字距对提取的字符数上限。
 *
 * 与主进程 `KERNING_CHAR_LIMIT` 必须一致：这里只是提前禁用开关并说明原因，
 * 真正的兜底在主进程（用户改 localStorage 也不会让它算几分钟）。
 */
const KERNING_LIMIT = 200;

/** 单页尺寸选项：都是 2 的幂，非 POT 尺寸在部分老引擎/移动 GPU 上有兼容问题。 */
const PAGE_SIZE_OPTIONS = [
  { label: '512 × 512', value: 512 },
  { label: '1024 × 1024', value: 1024 },
  { label: '2048 × 2048', value: 2048 },
  { label: '4096 × 4096', value: 4096 },
];

/** 描述文件格式选项。 */
const DATA_FORMAT_OPTIONS: { label: string; value: BitmapFontDataFormat }[] = [
  { label: '.fnt（文本）', value: 'fnt' },
  { label: '.xml', value: 'xml' },
  { label: '.json', value: 'json' },
];

const tab = ref<'font' | 'images'>('font');
const processing = ref(false);
const result = ref<BitmapFontResult | null>(null);
let seq = 0;

// 两 tab 各自一份配置（同精灵图的 merge/slice），互不干扰
const { config: fontConfig } = useToolConfig('font-bitmap-font', {
  fontSize: 48,
  spacing: 2,
  padding: 2,
  pageSize: 1024,
  fill: '#FFFFFF',
  outlineWidth: 0,
  outlineColor: '#000000',
  kerning: true,
  dataFormats: ['fnt'] as BitmapFontDataFormat[],
  outputDir: '',
  baseName: '',
});

const { config: imgConfig } = useToolConfig('font-bitmap-images', {
  lineHeight: 64,
  base: 52,
  advanceAdjust: 0,
  spacing: 2,
  padding: 2,
  pageSize: 1024,
  trim: false,
  dataFormats: ['fnt'] as BitmapFontDataFormat[],
  outputDir: '',
  baseName: 'bitmapfont',
  recursive: false,
});

// #region tab A：字体来源
const source = ref<PickedFile | null>(null);
const sourceMeta = ref<FontMeta | null>(null);

const { isDragOver: isFontDragOver, handlers: fontDropHandlers } = useFileDrop({
  accept: FONT_ACCEPT,
  onDrop: (files) => {
    if (files.length) void setSource(files[0]);
  },
});

/**
 * 选定字体并探测元信息。
 * @param file 字体文件。
 */
async function setSource(file: PickedFile): Promise<void> {
  source.value = file;
  sourceMeta.value = null;
  result.value = null;
  previewPages.value = [];
  missingChars.value = '';
  sourceMeta.value = await probeFontApi(file.path).catch(() => null);
}

/** 选择字体文件。 */
async function handlePickFont(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '字体', extensions: FONT_ACCEPT }],
    title: '选择字体',
  });
  if (files.length) await setSource(files[0]);
}
// #endregion

// #region tab A：字符集（三来源合并，同字体裁剪页）
const manualChars = ref('');
const fileChars = ref('');
const charFileNames = ref<string[]>([]);
const rawFiles = ref<{ name: string; text: string }[]>([]);
const jsonValueOnly = ref(true);
const checkedPresets = ref<string[]>([]);

/**
 * 递归收集 JSON 里所有字符串「值」（不含对象 key）。
 * @param node 任意 JSON 节点。
 * @param acc 累加字符串数组。
 */
function collectJsonValues(node: unknown, acc: string[]): void {
  if (typeof node === 'string') acc.push(node);
  else if (Array.isArray(node)) node.forEach((v) => collectJsonValues(v, acc));
  else if (node && typeof node === 'object')
    Object.values(node).forEach((v) => collectJsonValues(v, acc));
}

/**
 * 从一个文件的文本内容提取字符。
 * @param name 文件名（判断扩展名）。
 * @param text 文件内容。
 * @returns 提取出的文本。
 */
function extractChars(name: string, text: string): string {
  if (name.toLowerCase().endsWith('.json') && jsonValueOnly.value) {
    try {
      const values: string[] = [];
      collectJsonValues(JSON.parse(text), values);
      return values.join('');
    } catch {
      // JSON 不合法时退回全文，不阻断
      return text;
    }
  }
  return text;
}

/** 由已读入的原始文件重新算出提取字符。 */
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
  for (const file of files) {
    try {
      raw.push({ name: file.name, text: await readTextApi(file.path) });
    } catch {
      // 单个文件读失败跳过，提示已由 service 弹出
    }
  }
  if (!raw.length) return;
  rawFiles.value = raw;
  charFileNames.value = raw.map((f) => f.name);
  recomputeFileChars();
}

/** 清除文件字符。 */
function clearCharFile(): void {
  fileChars.value = '';
  charFileNames.value = [];
  rawFiles.value = [];
}

watch(jsonValueOnly, () => {
  if (rawFiles.value.length) recomputeFileChars();
});

/** 最终字符集 = 手输 + 文件 + 勾选预设，合并去重去换行。 */
const finalChars = computed(() => {
  let all = manualChars.value + fileChars.value;
  for (const key of checkedPresets.value) {
    const preset = CHARSET_PRESETS.find((p) => p.key === key);
    if (preset) all += preset.chars;
  }
  // spread 迭代按码点切分，`split('')` 会把 emoji 这类代理对切成两个半字符
  return [...new Set([...all])].filter((c) => c !== '\n' && c !== '\r').join('');
});

const charCount = computed(() => [...finalChars.value].length);

// 字符数超限时把开关关掉：留着「开着但不生效」比直接关掉更容易让人误解
watch(charCount, (count) => {
  if (count > KERNING_LIMIT) fontConfig.kerning = false;
});
// #endregion

// #region tab A：预览
const previewing = ref(false);
const previewPages = ref<BitmapFontPagePreview[]>([]);
const previewCharCount = ref(0);
const previewOccupancy = ref(0);
const previewStale = ref(false);
const missingChars = ref('');

const canPreview = computed(() => !!source.value && charCount.value > 0 && !processing.value);

/**
 * 生成选项。预览与落盘共用，保证所见即所得。
 * @param taskId 任务 id。
 * @returns 生成选项。
 */
function buildFontOptions(taskId: string): BitmapFontOptions {
  const name = source.value?.name ?? 'bitmapfont';
  return {
    taskId,
    sourcePath: source.value?.path ?? '',
    chars: finalChars.value,
    fontSize: fontConfig.fontSize,
    spacing: fontConfig.spacing,
    padding: fontConfig.padding,
    pageSize: fontConfig.pageSize,
    fill: fontConfig.fill,
    outlineWidth: fontConfig.outlineWidth,
    outlineColor: fontConfig.outlineColor,
    kerning: fontConfig.kerning && charCount.value <= KERNING_LIMIT,
    dataFormats: [...fontConfig.dataFormats],
    outputDir: fontConfig.outputDir,
    baseName: fontConfig.baseName || name.replace(/\.[^.]+$/, ''),
  };
}

// 参数一改就置 stale 而不是自动重算：3755 汉字一次预览要秒级，跟着滑块跑会卡死
watch(
  [finalChars, () => JSON.stringify(fontConfig), source],
  () => {
    if (previewPages.value.length) previewStale.value = true;
  },
  { deep: false },
);

/** 手动刷新预览。 */
async function handlePreview(): Promise<void> {
  if (!canPreview.value) return;
  previewing.value = true;
  try {
    const preview = await previewBitmapFontApi(buildFontOptions(`bmf-preview-${seq++}`));
    previewPages.value = preview.pages;
    previewCharCount.value = preview.charCount;
    previewOccupancy.value = preview.occupancy;
    missingChars.value = preview.missingChars;
    previewStale.value = false;
  } catch (e) {
    previewPages.value = [];
    message.error(e instanceof Error ? e.message : '预览失败');
  } finally {
    previewing.value = false;
  }
}
// #endregion

// #region tab B：图片列表
const glyphItems = ref<BitmapGlyphItem[]>([]);
const imgChecked = ref<string[]>([]);
const thumbQueue = createTaskQueue(4);
const thumbRequested = new Set<string>();

const { scanning, importFolder } = useFolderImport({
  key: 'bitmap-glyph',
  accept: IMG_ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择字符图片文件夹',
});

const { isDragOver: isImgDragOver, handlers: imgDropHandlers } = useFileDrop({
  accept: IMG_ACCEPT,
  onDrop: (files) => addImages(files),
});

const pagination = reactive({
  page: 1,
  pageSize: PAGE_SIZE,
  itemCount: 0,
  showQuickJumper: true,
  prefix: ({ itemCount }: { itemCount?: number }) => `共 ${itemCount ?? 0} 个`,
});
watch(
  () => glyphItems.value.length,
  (count) => {
    pagination.itemCount = count;
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
    if (pagination.page > pageCount) pagination.page = pageCount;
  },
  { immediate: true },
);

const visibleItems = computed(() =>
  glyphItems.value.slice((pagination.page - 1) * PAGE_SIZE, pagination.page * PAGE_SIZE),
);

// 只为当前页加载缩略图（文件夹导入可能上千张，全量解码会卡死）
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (row.thumb || thumbRequested.has(row.id)) continue;
      thumbRequested.add(row.id);
      const { id, path } = row;
      thumbQueue.push(async () => {
        const thumb = await getThumbnailApi(path).catch(() => '');
        // await 期间用户可能已移除该行，按 id 重查
        const target = glyphItems.value.find((i) => i.id === id);
        if (target && thumb) target.thumb = thumb;
      });
    }
  },
  { immediate: true },
);

/**
 * 从文件名猜字符：`a.png`→a、`U+4E2D.png`/`0x4E2D.png`→中、`中.png`→中。
 *
 * 纯字符串运算不走 IPC（同重命名页预览的做法），改一次名不该往主进程跑一趟。
 * @param name 文件名（含扩展名）。
 * @returns 猜出的字符，猜不出返回空串。
 */
function charFromName(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '');
  const hex = /^(?:U\+|0x|uni)([0-9a-f]{4,6})$/i.exec(stem);
  if (hex) {
    const cp = parseInt(hex[1], 16);
    // 码点必须在 unicode 有效范围内且不是代理区，否则 fromCodePoint 会抛
    if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff))
      return String.fromCodePoint(cp);
    return '';
  }
  const chars = [...stem];
  return chars.length === 1 ? chars[0] : '';
}

/**
 * 添加图片。
 * @param files 选中的图片。
 */
function addImages(files: PickedFile[]): void {
  const existing = new Set(glyphItems.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && IMG_ACCEPT.includes(f.ext));
  if (!fresh.length) return;
  for (const file of fresh) {
    glyphItems.value.push({
      ...file,
      id: `bg-${seq++}`,
      status: 'pending',
      char: charFromName(file.name),
    });
  }
}

/** 选择图片。 */
async function handleAddImages(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '图片', extensions: IMG_ACCEPT }],
    title: '选择字符图片',
  });
  if (files.length) addImages(files);
}

/** 导入文件夹。 */
async function handleAddImageFolder(): Promise<void> {
  const before = glyphItems.value.length;
  const files = await importFolder(imgConfig.recursive);
  if (!files.length) return;
  addImages(files);
  const added = glyphItems.value.length - before;
  if (added) message.success(`已添加 ${added} 张图片`);
  else message.info('这些图片已在列表中');
}

/** 按文件名重填所有行的字符（覆盖已手改的值，属于显式动作）。 */
function autoFillChars(): void {
  let filled = 0;
  for (const item of glyphItems.value) {
    const guess = charFromName(item.name);
    if (!guess) continue;
    item.char = guess;
    filled += 1;
  }
  message.info(filled ? `已按文件名填入 ${filled} 个字符` : '没有能从文件名推出字符的行');
}

/** 移除选中行。 */
function removeChecked(): void {
  const removing = new Set(imgChecked.value);
  glyphItems.value = glyphItems.value.filter((i) => !removing.has(i.id));
  imgChecked.value = [];
}

/** 清空列表。 */
function clearImages(): void {
  glyphItems.value = [];
  imgChecked.value = [];
  thumbQueue.clear();
  thumbRequested.clear();
  result.value = null;
}

const filledCount = computed(() => glyphItems.value.filter((i) => i.char).length);

const imgColumns: DataTableColumns<BitmapGlyphItem> = [
  { type: 'selection' },
  {
    title: '预览',
    key: 'thumb',
    width: 64,
    render: (row) =>
      row.thumb
        ? h('img', { src: row.thumb, class: 'bmf__thumb', alt: row.name })
        : h('div', { class: 'bmf__thumb bmf__thumb--empty' }),
  },
  { title: '文件名', key: 'name', minWidth: 160, ellipsis: { tooltip: true } },
  { title: '大小', key: 'size', width: 90, render: (row) => formatBytes(row.size) },
  {
    title: '字符',
    key: 'char',
    width: 110,
    render: (row) =>
      h(NInput, {
        value: row.char ?? '',
        size: 'small',
        placeholder: '如 A',
        // 只留第一个码点：一行一个字符是 BMFont 的硬约束，粘进一串就取头一个
        'onUpdate:value': (v: string) => {
          const first = [...v][0];
          row.char = first ?? '';
        },
      }),
  },
];
// #endregion

// #region 进度与取消
const currentTaskId = ref('');
const progressLabel = ref('');
let stopProgress: (() => void) | null = null;

/** 进度阶段的中文名。 */
const STAGE_LABEL: Record<BitmapFontProgress['stage'], string> = {
  render: '读取字形',
  pack: '装箱与字距',
  write: '生成图集',
};

onMounted(() => {
  stopProgress = onBitmapFontProgress((p) => {
    if (p.taskId !== currentTaskId.value) return;
    progressLabel.value = `${STAGE_LABEL[p.stage]} ${p.done}/${p.total}`;
  });
});

onBeforeUnmount(() => {
  stopProgress?.();
  stopProgress = null;
  // 离开页面时把在跑的任务标记取消，否则主进程会继续把所有页出完
  if (processing.value && currentTaskId.value) void cancelBitmapFontApi(currentTaskId.value);
});

/** 取消：当前页栅格化完成后生效。 */
async function handleCancel(): Promise<void> {
  if (currentTaskId.value) await cancelBitmapFontApi(currentTaskId.value);
  message.info('已请求取消，当前页生成完成后停止');
}
// #endregion

// #region 生成
const canGenerate = computed(
  () =>
    !!source.value &&
    charCount.value > 0 &&
    fontConfig.dataFormats.length > 0 &&
    !!fontConfig.outputDir &&
    !processing.value,
);

const fontStartLabel = computed(() => {
  if (!source.value) return '请先选择字体';
  if (!charCount.value) return '请输入要生成的字符';
  if (!fontConfig.dataFormats.length) return '请选择描述文件格式';
  if (!fontConfig.outputDir) return '请选择输出目录';
  return '生成位图字体';
});

const canPack = computed(
  () =>
    filledCount.value > 0 &&
    imgConfig.dataFormats.length > 0 &&
    !!imgConfig.outputDir &&
    !processing.value,
);

const imgStartLabel = computed(() => {
  if (!glyphItems.value.length) return '请先添加图片';
  if (!filledCount.value) return '请为图片填写字符';
  if (!imgConfig.dataFormats.length) return '请选择描述文件格式';
  if (!imgConfig.outputDir) return '请选择输出目录';
  return `打包 ${filledCount.value} 个字符`;
});

/** 选字体 tab 的输出目录。 */
async function pickFontOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) fontConfig.outputDir = dir;
}

/** 选图片 tab 的输出目录。 */
async function pickImgOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) imgConfig.outputDir = dir;
}

/** 打开产物所在目录。 */
function openResultDir(): void {
  const first = result.value?.pagePaths[0] ?? result.value?.dataPaths[0];
  if (first) void showInFolderApi(first);
}

/** 从字体生成。 */
async function handleGenerate(): Promise<void> {
  if (!canGenerate.value) return;
  const taskId = `bmf-${Date.now()}-${seq++}`;
  currentTaskId.value = taskId;
  processing.value = true;
  result.value = null;
  progressLabel.value = '';
  try {
    const res = await generateBitmapFontApi(buildFontOptions(taskId));
    if (res.canceled) {
      message.info('已取消，未产出文件');
      return;
    }
    result.value = res;
    missingChars.value = res.missingChars;
    const parts = [`${res.pagePaths.length} 页图集`, `${res.charCount} 个字符`];
    if (res.kerningCount) parts.push(`${res.kerningCount} 对字距`);
    message.success(`生成完成：${parts.join('、')}`);
    if (res.missingChars) {
      message.warning(`有 ${[...res.missingChars].length} 个字符这个字体里没有，已跳过`);
    }
  } catch {
    // 提示已由 service 弹出
  } finally {
    processing.value = false;
    currentTaskId.value = '';
    progressLabel.value = '';
  }
}

/** 从图片打包。 */
async function handlePack(): Promise<void> {
  if (!canPack.value) return;
  const taskId = `bmf-${Date.now()}-${seq++}`;
  currentTaskId.value = taskId;
  processing.value = true;
  result.value = null;
  progressLabel.value = '';
  try {
    const res = await packBitmapFontApi({
      taskId,
      glyphs: glyphItems.value.map((i) => ({ path: i.path, char: i.char ?? '' })),
      lineHeight: imgConfig.lineHeight,
      base: imgConfig.base,
      advanceAdjust: imgConfig.advanceAdjust,
      spacing: imgConfig.spacing,
      padding: imgConfig.padding,
      pageSize: imgConfig.pageSize,
      trim: imgConfig.trim,
      dataFormats: [...imgConfig.dataFormats],
      outputDir: imgConfig.outputDir,
      baseName: imgConfig.baseName || 'bitmapfont',
    });
    if (res.canceled) {
      message.info('已取消，未产出文件');
      return;
    }
    result.value = res;
    message.success(`打包完成：${res.pagePaths.length} 页图集、${res.charCount} 个字符`);
    if (res.skippedCount)
      message.warning(`跳过 ${res.skippedCount} 张（未填字符/字符重复/无法解码）`);
  } catch {
    // 提示已由 service 弹出
  } finally {
    processing.value = false;
    currentTaskId.value = '';
    progressLabel.value = '';
  }
}
// #endregion
</script>

<style scoped lang="scss">
.bmf {
  &__tabs {
    max-width: 320px;
  }

  &__dim {
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__main,
  &__split {
    display: flex;
    flex: 1;
    min-height: 0;
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    transition: border-color 0.15s;
  }

  &__main {
    flex-direction: column;
    gap: var(--tb-space-3);
  }

  &__split {
    gap: var(--tb-space-4);
  }

  &__drag {
    border-color: var(--tb-color-primary);
    background: var(--tb-color-primary-soft);
  }

  &__split-left,
  &__split-right {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
  }

  &__bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tb-space-2);
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

  &__source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tb-space-3);
    margin-bottom: var(--tb-space-4);
    padding: var(--tb-space-3);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__source-info {
    min-width: 0;
  }

  &__source-name {
    overflow: hidden;
    font-size: 14px;
    color: var(--tb-text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__source-sub {
    margin-top: 2px;
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

  &__file-row,
  &__dir {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__pair {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__mt-sm {
    margin-top: var(--tb-space-2);
    font-size: 13px;
  }

  &__count {
    margin: 0 0 var(--tb-space-3);
    font-size: 13px;
    color: var(--tb-text-primary);
  }

  &__warn {
    color: var(--tb-color-warning, #e8a33d);

    &--block {
      margin: 0;
      font-size: 12px;
      line-height: 1.6;
      word-break: break-all;
    }
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.6;
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
    align-items: center;
    justify-content: center;
    flex: 1;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__preview-pages {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
    width: 100%;
    padding: var(--tb-space-3);
  }

  &__preview-figure {
    margin: 0;
  }

  &__preview-img {
    display: block;
    max-width: 100%;
    /* 棋盘格底：位图字体多为白字透明底，纯色底会看不出边界 */
    background-image:
      linear-gradient(45deg, #2a2a2e 25%, transparent 25%),
      linear-gradient(-45deg, #2a2a2e 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #2a2a2e 75%),
      linear-gradient(-45deg, transparent 75%, #2a2a2e 75%);
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
    background-size: 16px 16px;
    border: 1px solid var(--tb-border);
  }

  &__preview-cap {
    margin-top: var(--tb-space-1);
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__preview-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__preview-info {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
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
    align-items: center;
    gap: var(--tb-space-4);
  }
}
</style>

<style lang="scss">
/* 表格单元格里的缩略图由 render 函数生成，不在 scoped 作用域内 */
.bmf__thumb {
  display: block;
  width: 32px;
  height: 32px;
  object-fit: contain;
  background: var(--tb-bg-elevated, #1f1f23);
  border-radius: var(--tb-radius-sm);

  &--empty {
    border: 1px dashed var(--tb-border);
  }
}
</style>
