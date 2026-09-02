<template>
  <ToolPageLayout title="视频工具" desc="批量压缩转码，或剪切时间段与裁剪画面" category="媒体工具">
    <template #toolbar>
      <n-tabs v-model:value="tab" type="segment" size="small" class="video__tabs">
        <n-tab name="compress">批量压缩 / 转码</n-tab>
        <n-tab name="clip">剪切 / 裁剪</n-tab>
      </n-tabs>
    </template>

    <!-- 主区：压缩=文件列表，剪切=单文件工作台 -->
    <template #main>
      <div
        v-if="tab === 'compress'"
        class="video__list"
        :class="{ 'video__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <div class="video__bar">
          <n-button size="small" type="primary" :disabled="processing" @click="handleAddFiles">
            <template #icon><n-icon :component="CloudUploadOutline" /></template>
            添加文件
          </n-button>
          <n-button
            size="small"
            :loading="scanning"
            :disabled="processing"
            @click="handleAddFolder"
          >
            <template #icon><n-icon :component="FolderOpenOutline" /></template>
            添加文件夹
          </n-button>
          <n-checkbox v-model:checked="config.recursive" class="video__dim">含子文件夹</n-checkbox>
          <n-button
            size="small"
            quaternary
            :disabled="!checkedKeys.length || processing"
            @click="handleRemoveChecked"
          >
            移除选中{{ checkedKeys.length ? `(${checkedKeys.length})` : '' }}
          </n-button>
          <n-button
            size="small"
            quaternary
            :disabled="!items.length || processing"
            @click="handleClear"
          >
            清空
          </n-button>
          <span v-if="capabilities" class="video__dim">ffmpeg {{ capabilities.version }}</span>
        </div>

        <n-data-table
          v-if="items.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="items"
          :row-key="(row: VideoItem) => row.id"
          :pagination="pagination"
          :scroll-x="TABLE_SCROLL_X"
          flex-height
          class="video__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="video__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽视频到此处，或点击「添加文件」</p>
        </div>
      </div>

      <div
        v-else
        class="video__clip"
        :class="{ 'video__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <div class="video__bar">
          <n-button size="small" type="primary" :disabled="exporting" @click="handlePickClipFile">
            <template #icon><n-icon :component="CloudUploadOutline" /></template>
            选择视频
          </n-button>
          <span v-if="clipFile" class="video__clip-name" :title="clipFile.path">
            {{ clipFile.name }}
          </span>
          <span v-if="clipMeta" class="video__dim">
            {{ formatDuration(clipMeta.duration) }} ·
            {{ clipMeta.video ? `${clipMeta.video.width}×${clipMeta.video.height}` : '无视频流' }}
            <template v-if="clipMeta.video"> · {{ clipMeta.video.codec }}</template>
            · {{ clipMeta.audio ? clipMeta.audio.codec : '无音轨' }}
          </span>
        </div>

        <div v-if="!clipMeta?.video" class="video__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>{{ clipEmptyHint }}</p>
        </div>

        <template v-else>
          <!-- 直接在播放画面上拖裁剪框：遮罩之外就是会被裁掉的部分，不必抽静帧 -->
          <div class="video__stage">
            <CropCanvas
              v-model="crop"
              :natural-width="clipMeta.video.width"
              :natural-height="clipMeta.video.height"
              :aspect="cropAspect"
              :min-size="MIN_CROP_SIZE"
              snap-even
              hint="在画面上拖拽以框选裁剪区域（宽高会向下对齐到偶数）"
            >
              <template #media>
                <video
                  ref="videoRef"
                  class="video__video"
                  preload="metadata"
                  :src="clipSrc"
                  @timeupdate="handleTimeUpdate"
                  @play="playing = true"
                  @pause="playing = false"
                />
              </template>
            </CropCanvas>
          </div>

          <WaveformSelect
            v-model="selection"
            :src="waveformUrl"
            :frames="frames"
            :duration="clipMeta.duration"
            :playhead="playhead"
            @seek="handleSeek"
          />

          <div class="video__seg">
            <div class="video__seg-row">
              <n-button size="small" @click="handleTogglePlay">
                <template #icon>
                  <n-icon :component="playing ? PauseOutline : PlayOutline" />
                </template>
                {{ playing ? '暂停' : '播放' }}
              </n-button>
              <n-button size="small" :disabled="!selection" @click="handlePlaySelection">
                试听选区
              </n-button>
              <span class="video__dim">
                {{ playhead.toFixed(2) }} / {{ clipMeta.duration.toFixed(2) }} s
              </span>
              <span v-if="!clipMeta.audio" class="video__dim">该视频无音轨，时间轴不显示波形</span>
            </div>

            <div class="video__seg-row">
              <span class="video__dim">起</span>
              <n-input-number
                :value="selection?.start ?? 0"
                size="small"
                class="video__num"
                :min="0"
                :max="clipMeta.duration"
                :step="0.1"
                :precision="3"
                @update:value="(v: number | null) => updateSelection('start', v)"
              />
              <span class="video__dim">止</span>
              <n-input-number
                :value="selection?.end ?? 0"
                size="small"
                class="video__num"
                :min="0"
                :max="clipMeta.duration"
                :step="0.1"
                :precision="3"
                @update:value="(v: number | null) => updateSelection('end', v)"
              />
              <span class="video__dim">
                时长 {{ selection ? (selection.end - selection.start).toFixed(3) : '0.000' }} s
              </span>
              <n-button size="tiny" quaternary :disabled="!selection" @click="selection = null">
                清除选区
              </n-button>
            </div>

            <p class="video__tip">{{ clipPrecisionTip }}</p>
          </div>
        </template>
      </div>
    </template>

    <!-- 参数面板：输出设置两个 tab 共用一份（同一个概念不该配两遍） -->
    <template #panel>
      <template v-if="tab === 'clip'">
        <h3 class="video__panel-title">剪切与裁剪</h3>

        <div class="video__field">
          <label class="video__label">裁剪比例</label>
          <n-select v-model:value="config.clipAspect" :options="aspectOptions" size="small" />
          <div class="video__seg-row video__mt">
            <span class="video__dim">
              裁剪区域
              {{ crop ? `${crop.width}×${crop.height} @ (${crop.left}, ${crop.top})` : '整幅画面' }}
            </span>
            <n-button size="tiny" quaternary :disabled="!crop" @click="crop = null">
              清除裁剪
            </n-button>
          </div>
          <p class="video__tip">输出画面 {{ outputSizeText }}</p>
        </div>

        <div class="video__field">
          <label class="video__label">输出名后缀</label>
          <n-input v-model:value="config.clipSuffix" size="small" placeholder="-clip" />
          <p class="video__tip">
            接在原文件名之后。留空且输出目录就是源目录、扩展名又相同时会盖掉源文件，那种组合会被拦下
          </p>
        </div>
      </template>

      <h3 class="video__panel-title">输出设置</h3>

      <div class="video__field">
        <label class="video__label">输出格式</label>
        <n-select v-model:value="config.format" :options="formatOptions" size="small" />
      </div>

      <template v-if="config.format === 'gif'">
        <div class="video__field">
          <label class="video__label">GIF 帧率 {{ config.gifFps }}</label>
          <n-slider v-model:value="config.gifFps" :min="5" :max="30" :step="1" />
        </div>
        <div class="video__field">
          <label class="video__label">GIF 宽度 {{ config.gifWidth }} px</label>
          <n-slider v-model:value="config.gifWidth" :min="120" :max="960" :step="20" />
          <p class="video__tip">GIF 无音轨，体积随帧率与宽度急剧增长</p>
        </div>
      </template>

      <template v-else>
        <div class="video__field">
          <label class="video__label">编码器</label>
          <n-select v-model:value="config.codec" :options="codecOptions" size="small" />
          <p v-if="config.codec === 'copy'" class="video__tip">
            仅换封装、不重新编码，几秒完成；此时无法缩放、降帧或裁剪
          </p>
          <p v-else-if="config.codec === 'libx265'" class="video__tip">
            体积比 H.264 小约 30%，但编码更慢、旧播放器可能不支持
          </p>
        </div>

        <template v-if="config.codec !== 'copy'">
          <div class="video__field">
            <label class="video__label">压缩模式</label>
            <n-radio-group v-model:value="config.qualityMode" size="small">
              <n-space vertical>
                <n-radio value="quality">按质量（CRF）</n-radio>
                <n-radio value="bitrate">按码率</n-radio>
                <n-radio value="targetSize">按目标大小</n-radio>
              </n-space>
            </n-radio-group>
          </div>

          <div v-if="config.qualityMode === 'quality'" class="video__field">
            <label class="video__label">CRF {{ config.crf }}（越小越清晰）</label>
            <n-slider v-model:value="config.crf" :min="0" :max="51" :step="1" />
            <p class="video__tip">常用 18–28；画质稳定，体积不可预知</p>
          </div>

          <div v-else-if="config.qualityMode === 'bitrate'" class="video__field">
            <label class="video__label">视频码率 kbps</label>
            <n-input-number
              v-model:value="config.videoBitrate"
              size="small"
              :min="64"
              :step="100"
            />
          </div>

          <div v-else class="video__field">
            <label class="video__label">目标大小 MB</label>
            <n-input-number v-model:value="config.targetSizeMb" size="small" :min="1" :step="1" />
            <p class="video__tip">
              单趟按时长（剪切后的）反算码率，不是精确控制：实测好压的画面会明显偏小、 高噪画面超出
              20%–45%
            </p>
          </div>
        </template>

        <div class="video__field">
          <label class="video__label">最大高度</label>
          <n-select v-model:value="config.maxHeight" :options="heightOptions" size="small" />
        </div>

        <div class="video__field">
          <label class="video__label">帧率上限</label>
          <n-select v-model:value="config.maxFps" :options="fpsOptions" size="small" />
        </div>

        <div class="video__field">
          <label class="video__label">音频</label>
          <n-select v-model:value="config.audioMode" :options="audioOptions" size="small" />
          <n-input-number
            v-if="config.audioMode === 'encode'"
            v-model:value="config.audioBitrate"
            class="video__mt"
            size="small"
            :min="8"
            :step="32"
            placeholder="音频码率 kbps"
          />
        </div>
      </template>

      <div class="video__field">
        <label class="video__label">输出目录</label>
        <div class="video__dir">
          <n-input v-model:value="config.outputDir" size="small" placeholder="选择或粘贴输出目录" />
          <n-button size="small" :disabled="overwriteActive" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <!-- 覆盖只在压缩 tab 给：剪一段还把源片删掉是不可逆的误操作 -->
      <div v-if="tab === 'compress'" class="video__field video__field--row">
        <label class="video__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

      <template v-if="tab === 'compress'">
        <n-button
          v-if="!processing"
          type="primary"
          block
          class="video__mt"
          :disabled="!canStart"
          @click="handleStart"
        >
          {{ startLabel }}
        </n-button>
        <n-button v-else block secondary type="error" class="video__mt" @click="handleCancel">
          取消处理
        </n-button>
      </template>
      <template v-else>
        <n-button
          v-if="!exporting"
          type="primary"
          block
          class="video__mt"
          :disabled="!canExport"
          @click="handleExportClip"
        >
          {{ exportLabel }}
        </n-button>
        <n-button v-else block secondary type="error" class="video__mt" @click="handleCancelExport">
          取消导出（{{ exportPercent }}%）
        </n-button>
      </template>
    </template>

    <template #footer>
      <div v-if="tab === 'compress'" class="video__footer">
        <span>已选择 {{ items.length }} 个文件</span>
        <div class="video__footer-stats">
          <span>总时长 {{ formatDuration(totalDuration) }}</span>
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>处理后 {{ formatBytes(totalOutput) }}</span>
          <span v-if="totalRatio !== null" class="video__footer-ratio">
            {{ totalRatio < 0 ? `体积增大 ${-totalRatio}%` : `体积减小 ${totalRatio}%` }}
          </span>
        </div>
      </div>
      <div v-else class="video__footer">
        <span v-if="clipMeta">源时长 {{ formatDuration(clipMeta.duration) }}</span>
        <span v-else>未选择文件</span>
        <div class="video__footer-stats">
          <span v-if="selection">
            将导出 {{ (selection.end - selection.start).toFixed(2) }} s
          </span>
          <span v-else-if="clipMeta?.video">将导出整段</span>
          <span v-if="clipOutputPath" class="video__footer-ratio">
            已导出 {{ clipOutputSize }}
          </span>
          <n-button
            v-if="clipOutputPath"
            size="tiny"
            quaternary
            @click="void showInFolderApi(clipOutputPath)"
          >
            打开所在文件夹
          </n-button>
        </div>
      </div>
    </template>
  </ToolPageLayout>

  <VideoPreviewModal
    v-model:show="previewShow"
    :title="previewTitle"
    :original-src="previewOriginal"
    :output-src="previewOutput"
    :poster="previewPoster"
    :result-label="previewResultLabel"
  />
</template>

<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
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
  NSwitch,
  NTab,
  NTabs,
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import {
  CloudUploadOutline,
  EyeOutline,
  FolderOpenOutline,
  PauseOutline,
  PlayOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  CropRect,
  PickedFile,
  SilenceRange,
  TranscodeOptions,
  VideoAudioMode,
  VideoCapabilities,
  VideoCodec,
  VideoMeta,
  VideoOutputFormat,
  VideoQualityMode,
} from '@shared/types';
import { MIN_CROP_SIZE } from '@shared/video';
import type { VideoItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import CropCanvas from '@/components/common/CropCanvas.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import TaskProgress from '@/components/common/TaskProgress.vue';
import VideoPreviewModal from '@/components/common/VideoPreviewModal.vue';
import WaveformSelect from '@/components/common/WaveformSelect.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { getWaveformApi } from '@/services/audio';
import { showInFolderApi } from '@/services/file';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  cancelTranscodeApi,
  getVideoCapabilitiesApi,
  getVideoFrameApi,
  getVideoThumbnailApi,
  onTranscodeProgress,
  probeVideoApi,
  toMediaUrl,
  transcodeVideoApi,
} from '@/services/video';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';
import { filmstripTimes } from '@/utils/timeline';

// #region state
const message = useMessage();

/** 支持的视频扩展名。 */
const ACCEPT = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts'];

/** 每页行数。同图片各页：把缩略图加载量固定在一页之内。 */
const PAGE_SIZE = 50;

/** 从文件夹导入的上限。 */
const MAX_FILES = 20_000;

/**
 * 表格横向滚动宽度。
 *
 * 固定列（操作列 `fixed: 'right'`）**只在表格出现横向滚动时才浮起来**，
 * 所以必须给一个大于各列宽度之和的 scroll-x；不给就退化成普通列，
 * 窗口窄一点操作按钮就被挤出可视区。
 */
const TABLE_SCROLL_X = 1180;

/**
 * 元信息 / 缩略图的并发数。
 *
 * 比图片那边的 4 更保守：每一条都是一次真实的 ffprobe / ffmpeg 子进程，
 * 进程创建本身的开销远大于 sharp 的一次解码，开多了只是互相抢 CPU。
 */
const PROBE_CONCURRENCY = 2;

/** 胶片条格子数。12 格已能认出场景切换，再多每格就窄到看不清了。 */
const FILMSTRIP_COUNT = 12;

/** 胶片条单帧宽度 px（高度由 ffmpeg 按比例算）。 */
const FILMSTRIP_WIDTH = 160;

/**
 * 胶片条抽帧并发数。
 *
 * 实测 120 s 720p 取 12 帧：串行 1523 ms，并发 4 只要 550 ms（3× 加速），
 * 而且逐帧 seek 的成本与视频时长无关。这与转码「一个进程就吃满所有核心」不同——
 * 单帧 seek 的时间大头是进程创建与解码启动，并行确实有效。
 */
const FRAME_CONCURRENCY = 4;

/** 波形图尺寸：与胶片条上下叠，比音频页矮一半就够。 */
const WAVEFORM_SIZE = { width: 1600, height: 48 };

/** 波形颜色用中性灰：波形是内容，主色留给用户正在拖的选区。 */
const WAVEFORM_COLOR = '#9b9ba4';

const tab = ref<'compress' | 'clip'>('compress');

// 压缩 tab
const items = ref<VideoItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
const capabilities = ref<VideoCapabilities | null>(null);
let seq = 0;

/** 正在跑的任务 id；取消与进度过滤都靠它。 */
const currentTaskId = ref('');

/** 用户已点过取消：批量中途取消要停下整个队列，而不只是当前这一个。 */
let canceledByUser = false;

// 剪切 tab
const clipFile = ref<PickedFile | null>(null);
const clipMeta = ref<VideoMeta | null>(null);
const waveformUrl = ref('');
/** 胶片条各格的 data URL；先摆好空格子再逐个填，条宽不会跳。 */
const frames = ref<string[]>([]);
const selection = ref<SilenceRange | null>(null);
const crop = ref<CropRect | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const playhead = ref(0);
const playing = ref(false);
/** 「试听选区」启动的播放：到选区末尾自动停，普通播放不受限。 */
const limitToSelection = ref(false);
const exporting = ref(false);
const exportPercent = ref(0);
const exportTaskId = ref('');
const clipOutputPath = ref('');
const clipOutputSize = ref('');

/** 持久化的处理配置（两个 tab 共用，输出设置是同一个概念）。 */
const { config } = useToolConfig('media-video', {
  format: 'mp4' as VideoOutputFormat,
  codec: 'libx264' as VideoCodec,
  qualityMode: 'quality' as VideoQualityMode,
  crf: 23,
  videoBitrate: 2000,
  targetSizeMb: 20,
  maxHeight: 0,
  maxFps: 0,
  audioMode: 'encode' as VideoAudioMode,
  audioBitrate: 128,
  gifFps: 12,
  gifWidth: 480,
  outputDir: '',
  overwrite: false,
  recursive: false,
  // 剪切默认带后缀：把 a.mp4 剪一段还存回原目录是最自然的操作，没有后缀就会撞上源文件
  clipSuffix: '-clip',
  /** 裁剪比例（宽/高）；0 表示自由裁剪。 */
  clipAspect: 0,
});

/** 从文件夹添加（与图片四页共用同一实现）。 */
const { scanning, importFolder } = useFolderImport({
  key: 'video',
  accept: ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择视频文件夹',
});

const formatOptions = [
  { label: '保持原容器', value: 'original' },
  { label: 'MP4', value: 'mp4' },
  { label: 'WebM', value: 'webm' },
  { label: 'MKV', value: 'mkv' },
  { label: 'GIF', value: 'gif' },
];

const heightOptions = [
  { label: '不限', value: 0 },
  { label: '1080p', value: 1080 },
  { label: '720p', value: 720 },
  { label: '480p', value: 480 },
  { label: '360p', value: 360 },
];

const fpsOptions = [
  { label: '保持原帧率', value: 0 },
  { label: '60', value: 60 },
  { label: '30', value: 30 },
  { label: '24', value: 24 },
  { label: '15', value: 15 },
];

const audioOptions = [
  { label: '重新编码', value: 'encode' },
  { label: '保持原音轨', value: 'copy' },
  { label: '移除音轨', value: 'remove' },
];

const aspectOptions = [
  { label: '自由', value: 0 },
  { label: '16 : 9', value: 16 / 9 },
  { label: '9 : 16', value: 9 / 16 },
  { label: '4 : 3', value: 4 / 3 },
  { label: '1 : 1', value: 1 },
];

// 预览
const previewShow = ref(false);
const previewTitle = ref('');
const previewOriginal = ref('');
const previewOutput = ref('');
const previewPoster = ref('');
/** 预览右栏标题：换封装与重编码是两件事，标签跟着变。 */
const previewResultLabel = ref('处理后');
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => {
    if (tab.value === 'compress') addFiles(files);
    else if (files[0]) void loadClipFile(files[0]);
  },
});
// #endregion

// #region getters
/**
 * 编码器下拉项。
 *
 * **只列探测到的编码器**：打包的 ffmpeg 是 2018 年的构建，文档列的不等于它有，
 * 开发机上的系统 ffmpeg 又更新得多。给一个点下去必然报错的选项比不给更糟。
 * copy 不是编码器，任何构建都支持，永远保留。
 */
const codecOptions = computed(() => {
  const available = capabilities.value?.videoEncoders ?? [];
  const candidates: { label: string; value: VideoCodec }[] = [
    { label: 'H.264（通用）', value: 'libx264' },
    { label: 'H.265（更小）', value: 'libx265' },
    { label: 'VP9（WebM）', value: 'libvpx-vp9' },
  ];
  const options = candidates.filter((c) => available.includes(c.value));
  options.push({ label: '不重新编码（快速换封装）', value: 'copy' });
  return options;
});

const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalOutput = computed(() => items.value.reduce((s, i) => s + (i.outputSize ?? 0), 0));
const totalDuration = computed(() => items.value.reduce((s, i) => s + (i.duration ?? 0), 0));
const totalRatio = computed(() => {
  const done = items.value.filter((i) => i.outputSize !== undefined);
  if (!done.length) return null;
  const orig = done.reduce((s, i) => s + i.size, 0);
  const out = done.reduce((s, i) => s + (i.outputSize ?? 0), 0);
  // 转码常常变大（提码率、转 gif），负数如实展示
  return orig > 0 ? Math.round((1 - out / orig) * 100) : 0;
});

const canStart = computed(
  () => items.value.length > 0 && !processing.value && (config.overwrite || !!config.outputDir),
);

/** 开始按钮文案：有勾选时提示只处理选中数量。 */
const startLabel = computed(() =>
  checkedKeys.value.length ? `开始处理 (${checkedKeys.value.length})` : '开始处理',
);

/** 覆盖模式只在压缩 tab 生效，剪切 tab 的输出目录按钮不该被它禁用。 */
const overwriteActive = computed(() => tab.value === 'compress' && config.overwrite);

/** 播放源：走 tb-media 协议，路径已在 probe 时登记白名单。 */
const clipSrc = computed(() => (clipFile.value ? toMediaUrl(clipFile.value.path) : ''));

/** 裁剪比例：0 表示自由裁剪，CropCanvas 要的是 null。 */
const cropAspect = computed(() => (config.clipAspect > 0 ? config.clipAspect : null));

/** 空态提示：区分「还没选」「读取中」「没有视频流」三种。 */
const clipEmptyHint = computed(() => {
  if (!clipFile.value) return '拖拽一个视频到此处，或点击「选择视频」';
  if (!clipMeta.value) return '正在读取视频信息…';
  return '该文件没有视频流，请用音频工具处理';
});

/**
 * 输出画面尺寸说明。
 *
 * 只报**能算准的部分**：裁剪后的尺寸是确定的（已偶数对齐），而缩放宽度由
 * ffmpeg 的 `-2` 取整决定，这里不替它算一个可能差 1–2 px 的数字。
 */
const outputSizeText = computed(() => {
  const video = clipMeta.value?.video;
  if (!video) return '—';
  const width = crop.value?.width ?? video.width;
  const height = crop.value?.height ?? video.height;
  const base = `${width}×${height}`;
  if (config.format === 'gif') return `${base}，再缩到宽 ${config.gifWidth}`;
  if (config.maxHeight > 0 && height > config.maxHeight) {
    return `${base}，再缩到高 ${config.maxHeight}`;
  }
  return base;
});

/** 剪切精度提示：copy 与重编码是两种完全不同的行为，按实测数字写。 */
// 文案里的数字都是实测的（12s 640×360、关键帧每 5s、请求 6.5→9.5 s）：
// 两种模式下**视频流都精确到 3.000 s / 90 帧**，容器时长却报 3.020 s——多出来的
// 20ms 是 aac 音频帧（1024 样本 @44.1kHz ≈ 23ms）切不开而向上对齐的结果，与
// copy / 重新编码无关，移除音轨后两者都是精确的 3.000 s。所以这里不把「多一点」
// 说成是 copy 的锅，copy 真正的代价只有「起点必须落在关键帧上」这一条。
const clipPrecisionTip = computed(() => {
  if (config.format === 'gif') return 'GIF 无音轨；剪切精确到毫秒，画面裁剪在转 GIF 前完成';
  if (config.codec === 'copy') {
    return '「不重新编码」只能按关键帧整包切，且无法裁剪画面：输出 MP4 时起点仍与源同一帧（实测逐像素一致），其他容器会让起点退到上一个关键帧，已被拦下';
  }
  return '重新编码时剪切精确到帧（实测请求 3.000 s 得 90 帧 / 3.000 s 视频流，首帧与源同一帧）；带音轨时容器时长会向上对齐到音频帧，约多 0.02 s';
});

const canExport = computed(() => {
  if (!clipMeta.value?.video || exporting.value || !config.outputDir) return false;
  // 既不剪也不裁就只是整片重编码，那是压缩 tab 的事
  return selection.value !== null || crop.value !== null;
});

const exportLabel = computed(() => {
  if (selection.value && crop.value) return '导出选区（含裁剪）';
  if (crop.value) return '导出裁剪';
  return '导出选区';
});

/** 表格分页（受控，因为要知道当前页是哪些行才能只为它们探测元信息）。 */
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

/** 元信息 / 缩略图队列 + 已入队的 id，避免翻回上一页时重复发请求。 */
const probeQueue = createTaskQueue(PROBE_CONCURRENCY);
const probeRequested = new Set<string>();

/**
 * 只为当前页的行排队探测元信息与缩略图。
 *
 * 每行要两次子进程（ffprobe 取元信息、ffmpeg 抽帧），比图片那边贵得多，
 * 所以严格限制在当前页 + 限并发；导入上千个文件也不会把主进程压死。
 */
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (probeRequested.has(row.id)) continue;
      probeRequested.add(row.id);
      const { id, path } = row;
      probeQueue.push(async () => {
        const meta = await probeVideoApi(path).catch(() => null);
        // await 期间用户可能已移除该项，按 id 回查而不是复用引用
        const target = items.value.find((i) => i.id === id);
        if (!target) return;
        if (meta) {
          target.duration = meta.duration;
          target.width = meta.video?.width ?? 0;
          target.height = meta.video?.height ?? 0;
          target.videoCodec = meta.video?.codec ?? '';
          target.audioCodec = meta.audio?.codec ?? '';
          target.fps = meta.video?.fps ?? 0;
        }
        target.probed = true;
      });
      probeQueue.push(async () => {
        const url = await getVideoThumbnailApi(path).catch(() => '');
        const target = items.value.find((i) => i.id === id);
        if (target && url) target.thumbnail = url;
      });
    }
  },
  { immediate: true },
);

/**
 * 离开剪切 tab 时停下播放。
 *
 * watch 默认 pre-flush，此时 `v-if` 还没把 `<video>` 摘掉，videoRef 仍有效；
 * 放到 post 就只剩一个已卸载的元素，解码器与文件句柄都收不回来。
 */
watch(tab, (value) => {
  if (value !== 'clip') stopVideo();
});
// #endregion

// #region helpers
/**
 * 把秒数格式化为 `mm:ss` 或 `h:mm:ss`。
 * @param seconds 秒数。
 * @returns 时长文本；无效或未知返回 '—'。
 */
function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}
// #endregion

// #region columns
const columns: DataTableColumns<VideoItem> = [
  { type: 'selection' },
  {
    title: '预览',
    key: 'thumbnail',
    width: 76,
    render: (row) =>
      row.thumbnail
        ? h('img', {
            src: row.thumbnail,
            style: 'width:56px;height:32px;object-fit:cover;border-radius:4px;display:block;',
          })
        : h('div', {
            style: 'width:56px;height:32px;border-radius:4px;background:var(--tb-bg-hover);',
          }),
  },
  { title: '文件名', key: 'name', minWidth: 200, ellipsis: { tooltip: true } },
  {
    title: '分辨率',
    key: 'resolution',
    width: 100,
    render: (row) => (row.width && row.height ? `${row.width}×${row.height}` : '—'),
  },
  { title: '时长', key: 'duration', width: 80, render: (row) => formatDuration(row.duration) },
  {
    title: '编码',
    key: 'codec',
    width: 128,
    // probed 才能区分「没有音轨」与「还没探测」，否则未探测会被显示成无音轨
    render: (row) => {
      if (!row.probed) return '—';
      if (!row.videoCodec) return '无视频流';
      return row.audioCodec
        ? `${row.videoCodec} / ${row.audioCodec}`
        : `${row.videoCodec} / 无音轨`;
    },
  },
  { title: '原大小', key: 'size', width: 90, render: (row) => formatBytes(row.size) },
  {
    title: '处理后',
    key: 'outputSize',
    width: 90,
    render: (row) => (row.outputSize !== undefined ? formatBytes(row.outputSize) : '—'),
  },
  {
    title: '体积变化',
    key: 'ratio',
    width: 88,
    // 转码常常变大，用正负号与颜色区分，不截断为 0
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
    width: 140,
    render: (row) => {
      if (row.status === 'processing') {
        // 源时长未知时主进程推 percent=-1：算不出百分比就别假装有，改显示已处理时间
        if (row.percent === undefined || row.percent < 0) {
          return h('span', { class: 'video__outtime' }, `已处理 ${formatDuration(row.outTime)}`);
        }
        return h(TaskProgress, { percentage: row.percent, status: 'processing', height: 6 });
      }
      return row.status === 'error' && row.error
        ? h(NTooltip, null, {
            trigger: () => h(StatusTag, { status: row.status }),
            default: () => row.error,
          })
        : h(StatusTag, { status: row.status });
    },
  },
  {
    title: '操作',
    key: 'actions',
    width: 120,
    // 列多、横向可滚，操作列钉在右侧常驻——不然想删一行得先横向滚到底
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
        h(
          NButton,
          { text: true, size: 'small', onClick: () => void openPreview(row) },
          { icon: () => h(NIcon, { component: EyeOutline }) },
        ),
        h(
          NButton,
          {
            text: true,
            size: 'small',
            disabled: !row.outputPath,
            onClick: () => void showInFolderApi(row.outputPath ?? row.path),
          },
          { icon: () => h(NIcon, { component: FolderOpenOutline }) },
        ),
        h(
          NButton,
          {
            text: true,
            type: 'error',
            size: 'small',
            disabled: processing.value,
            onClick: () => removeItem(row.id),
          },
          { icon: () => h(NIcon, { component: TrashOutline }) },
        ),
      ]),
  },
];
// #endregion

// #region lifecycle
let stopProgress: (() => void) | null = null;

onMounted(() => {
  void getVideoCapabilitiesApi()
    .then((caps) => {
      capabilities.value = caps;
      // 记住的编码器可能在这台机器的构建里不存在，回落到可用项
      if (config.codec !== 'copy' && !caps.videoEncoders.includes(config.codec)) {
        config.codec = caps.videoEncoders.includes('libx264') ? 'libx264' : 'copy';
      }
    })
    .catch(() => {
      // 提示已由 services 统一弹出；探测失败时下拉只剩 copy，页面仍可用
    });

  stopProgress = onTranscodeProgress((progress) => {
    if (progress.taskId === exportTaskId.value) {
      exportPercent.value = Math.max(0, Math.round(progress.percent));
      return;
    }
    // 按 taskId 过滤：上一个任务取消后仍可能有一条滞后推送到达，不过滤
    // 就会写到新任务的行上（同 file-stats 的 scanId 过滤）
    if (progress.taskId !== currentTaskId.value) return;
    const target = items.value.find((i) => i.taskId === progress.taskId);
    if (!target) return;
    target.percent = progress.percent;
    target.outTime = progress.outTime;
    target.speed = progress.speed;
  });
});

onUnmounted(() => {
  stopProgress?.();
  stopVideo();
  frameQueue.clear();
  // 页面被切走时正在跑的 ffmpeg 必须杀掉，否则它在后台继续吃满 CPU
  if (currentTaskId.value) void cancelTranscodeApi(currentTaskId.value);
  if (exportTaskId.value) void cancelTranscodeApi(exportTaskId.value);
});
// #endregion

// #region actions（压缩 tab）
/** 追加文件（按路径去重）。元信息不在这里探测，交给当前页的 watch 按需取。 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  if (!fresh.length) return;

  for (const file of fresh) {
    items.value.push({ ...file, id: `vid-${seq++}`, status: 'pending' });
  }
}

/** 打开文件选择。 */
async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '视频', extensions: ACCEPT }],
    title: '选择要处理的视频',
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
  if (added) message.success(`已添加 ${added} 个视频`);
  else message.info('这些视频已在列表中');
}

/** 清空列表。 */
function handleClear(): void {
  items.value = [];
  checkedKeys.value = [];
  probeQueue.clear();
  probeRequested.clear();
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
 * 打开预览。
 *
 * 播放走 tb-media 协议，路径必须先经 probe 登记进白名单；还没探测完的行
 * 先补一次 probe，否则协议会以 403 拒掉，表现是「点了预览播不了」。
 * @param row 目标行。
 */
async function openPreview(row: VideoItem): Promise<void> {
  previewTitle.value = row.name;
  previewPoster.value = row.thumbnail ?? '';
  previewResultLabel.value = row.streamCopy ? '换封装后' : '处理后';
  previewOriginal.value = '';
  previewOutput.value = '';
  if (!row.probed) await probeVideoApi(row.path).catch(() => null);
  previewOriginal.value = toMediaUrl(row.path);
  if (row.outputPath) previewOutput.value = toMediaUrl(row.outputPath);
  previewShow.value = true;
}

/**
 * 组装传给主进程的转码选项（两个 tab 共用）。
 * @param taskId 本次任务 id。
 * @returns 转码选项。
 */
function buildOptions(taskId: string): TranscodeOptions {
  return {
    taskId,
    format: config.format,
    // GIF 由主进程走两趟调色板流程，编码器字段用不上，但不能是 copy（会被 pre-flight 拦）
    codec: config.format === 'gif' ? 'libx264' : config.codec,
    qualityMode: config.qualityMode,
    crf: config.crf,
    videoBitrate: config.videoBitrate,
    targetSizeMb: config.targetSizeMb,
    maxHeight: config.maxHeight,
    maxFps: config.maxFps,
    audioMode: config.audioMode,
    audioBitrate: config.audioBitrate,
    gifFps: config.gifFps,
    gifWidth: config.gifWidth,
    outputDir: config.outputDir,
    overwrite: config.overwrite,
  };
}

/**
 * 开始处理：有勾选时只处理选中项，否则处理全部。
 *
 * **严格串行**：单个 ffmpeg 进程就会吃满所有核心，并发只是互相抢 CPU
 * 还让内存翻倍——这与图片那边「串行更稳」的偏好不同，是硬约束。
 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : items.value;
  processing.value = true;
  canceledByUser = false;
  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let lastError = '';

  try {
    for (const item of targets) {
      // 取消停在当前文件：剩下的整队都不再启动，已完成的结果保留
      if (canceledByUser) {
        skipped += 1;
        continue;
      }
      const taskId = `${item.id}-${Date.now()}`;
      item.taskId = taskId;
      item.status = 'processing';
      item.percent = 0;
      item.outTime = 0;
      currentTaskId.value = taskId;
      try {
        const result = await transcodeVideoApi(item.path, buildOptions(taskId));
        if (result.canceled) {
          // 取消不是错误：退回 pending，用户可以改参数重跑
          item.status = 'pending';
          item.percent = undefined;
          skipped += 1;
        } else {
          item.outputSize = result.outputSize;
          item.ratio = result.ratio;
          item.outputPath = result.outputPath;
          item.streamCopy = result.streamCopy;
          item.percent = 100;
          item.status = 'done';
          ok += 1;
        }
      } catch (e) {
        item.status = 'error';
        item.error = e instanceof Error ? e.message : '转码失败';
        lastError = item.error;
        item.percent = undefined;
        failed += 1;
      } finally {
        currentTaskId.value = '';
      }
    }

    if (canceledByUser) message.info(`已取消，完成 ${ok} 个，${skipped} 个未处理`);
    else if (failed === 0) message.success(`处理完成，共 ${ok} 个`);
    else if (ok === 0) message.error(`处理失败：${lastError}`);
    else message.warning(`完成 ${ok} 个，失败 ${failed} 个（悬停状态查看原因）`);
  } finally {
    processing.value = false;
  }
}

/** 取消处理：杀掉当前 ffmpeg 并停下整个队列。 */
async function handleCancel(): Promise<void> {
  canceledByUser = true;
  if (currentTaskId.value) await cancelTranscodeApi(currentTaskId.value);
}
// #endregion

// #region actions（剪切 tab）
/** 胶片条抽帧队列。 */
const frameQueue = createTaskQueue(FRAME_CONCURRENCY);

/** 换文件就 +1，用来丢弃上一个文件迟到的帧。 */
let frameToken = 0;

/**
 * 停止播放并交还文件句柄。
 *
 * **必须清 src 再 load()**：只 pause() 的话解码器仍占着这个文件，
 * 「覆盖原文件」写入会失败（VideoPreviewModal 的 stopPlayback 已记过这一条）。
 */
function stopVideo(): void {
  playing.value = false;
  limitToSelection.value = false;
  const el = videoRef.value;
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

/**
 * 排队抽取胶片条各帧。
 * @param path 视频路径。
 * @param duration 总时长秒。
 */
function loadFilmstrip(path: string, duration: number): void {
  const times = filmstripTimes(duration, FILMSTRIP_COUNT);
  if (!times.length) return;
  // 先摆好空格子：抽帧是逐个回来的，先占位条宽就不会跳
  frames.value = times.map(() => '');
  const token = frameToken;
  times.forEach((at, index) => {
    frameQueue.push(async () => {
      if (token !== frameToken) return;
      const url = await getVideoFrameApi(path, at, FILMSTRIP_WIDTH).catch(() => '');
      // 回来时用户可能已换文件，token 不符就丢弃，否则新片的胶片条里会混进旧帧
      if (token !== frameToken || !url) return;
      frames.value[index] = url;
    });
  });
}

/**
 * 载入待剪切的视频：探元信息 + 抽胶片条 + 画波形。
 * @param file 目标文件。
 */
async function loadClipFile(file: PickedFile): Promise<void> {
  stopVideo();
  frameToken += 1;
  frameQueue.clear();
  clipFile.value = file;
  clipMeta.value = null;
  waveformUrl.value = '';
  frames.value = [];
  selection.value = null;
  crop.value = null;
  playhead.value = 0;
  clipOutputPath.value = '';
  clipOutputSize.value = '';

  // probe 顺带把路径登记进 tb-media 白名单，播放才不会被协议以 403 拒掉
  const meta = await probeVideoApi(file.path).catch(() => null);
  if (!meta) {
    message.error('读取视频信息失败');
    return;
  }
  clipMeta.value = meta;
  if (!meta.video) {
    message.error('该文件没有视频流，请用音频工具处理');
    return;
  }

  loadFilmstrip(file.path, meta.duration);
  // 无音轨时不发这次请求：showwavespic 找不到音频流会直接退 1，
  // 拿一次注定失败的调用去换一个空波形没有意义（时间轴那边也不会显示「生成中」）
  if (meta.audio) {
    waveformUrl.value = await getWaveformApi(file.path, {
      ...WAVEFORM_SIZE,
      color: WAVEFORM_COLOR,
    }).catch(() => '');
  }
}

/** 选择待剪切的视频。 */
async function handlePickClipFile(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '视频', extensions: ACCEPT }],
    title: '选择要剪切的视频',
  });
  if (files[0]) await loadClipFile(files[0]);
}

/**
 * 从数字输入框改选区端点。
 * @param edge 改的是哪一端。
 * @param value 新值秒。
 */
function updateSelection(edge: 'start' | 'end', value: number | null): void {
  const duration = clipMeta.value?.duration ?? 0;
  if (value === null || duration <= 0) return;
  const current = selection.value ?? { start: 0, end: duration };
  const next = { ...current, [edge]: Math.min(Math.max(0, value), duration) };
  // 输入过头会让起止翻转，归一化而不是拒绝输入
  selection.value = { start: Math.min(next.start, next.end), end: Math.max(next.start, next.end) };
}

/**
 * 时间轴上点击：跳播到该时间点。
 * @param seconds 目标时间秒。
 */
function handleSeek(seconds: number): void {
  playhead.value = seconds;
  limitToSelection.value = false;
  const el = videoRef.value;
  if (el) el.currentTime = seconds;
}

/** 播放头跟随；「试听选区」时到选区末尾自动停。 */
function handleTimeUpdate(): void {
  const el = videoRef.value;
  if (!el) return;
  playhead.value = el.currentTime;
  const range = selection.value;
  if (limitToSelection.value && range && el.currentTime >= range.end) {
    el.pause();
    limitToSelection.value = false;
  }
}

/** 播放 / 暂停。原生 controls 用不了（画面上盖着裁剪框，指针事件都归它）。 */
function handleTogglePlay(): void {
  const el = videoRef.value;
  if (!el) return;
  if (el.paused) {
    limitToSelection.value = false;
    void el.play().catch(() => {
      // 播放失败（协议未授权 / 浏览器不支持该编码）时静默：剪切与导出仍可用
    });
  } else {
    el.pause();
  }
}

/** 从选区开头播到选区末尾（接缝处画面与声音是否连贯只能靠看/听）。 */
function handlePlaySelection(): void {
  const el = videoRef.value;
  const range = selection.value;
  if (!el || !range) return;
  el.currentTime = range.start;
  limitToSelection.value = true;
  void el.play().catch(() => {
    limitToSelection.value = false;
  });
}

/** 导出：把选区与裁剪框随 transcode 一起下发。 */
async function handleExportClip(): Promise<void> {
  const file = clipFile.value;
  if (!file) return;
  const range = selection.value;
  const rect = crop.value;
  const taskId = `clip-${Date.now()}`;
  exporting.value = true;
  exportPercent.value = 0;
  exportTaskId.value = taskId;
  clipOutputPath.value = '';
  clipOutputSize.value = '';

  try {
    const result = await transcodeVideoApi(file.path, {
      ...buildOptions(taskId),
      // 剪一段还把源片删掉是不可逆的误操作，这个 tab 一律不覆盖
      overwrite: false,
      nameSuffix: config.clipSuffix.trim(),
      // 必须重建纯对象：selection / crop 都在 ref 里，是**深层响应式 Proxy**，
      // 直接经 IPC 传会报 "An object could not be cloned"（同 AudioView 的 trim、
      // ImageCompressView 的 advanced、FileStatsView 的 ignoreDirs）
      ...(range ? { trim: { start: range.start, end: range.end } } : {}),
      ...(rect
        ? { crop: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
        : {}),
    });
    if (result.canceled) {
      message.info('已取消导出');
      return;
    }
    clipOutputPath.value = result.outputPath;
    clipOutputSize.value = formatBytes(result.outputSize);
    message.success(`已导出 ${formatBytes(result.outputSize)}`);
  } catch (e) {
    // transcodeVideoApi 是静默的（为批量准备），单文件导出这条路必须自己报错
    message.error(e instanceof Error ? e.message : '导出失败');
  } finally {
    exporting.value = false;
    exportTaskId.value = '';
    exportPercent.value = 0;
  }
}

/** 取消导出。 */
async function handleCancelExport(): Promise<void> {
  if (exportTaskId.value) await cancelTranscodeApi(exportTaskId.value);
}
// #endregion
</script>

<style scoped lang="scss">
.video {
  &__tabs {
    max-width: 320px;
  }

  &__list,
  &__clip {
    display: flex;
    flex: 1;
    flex-direction: column;
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

  // 辅助信息统一压暗一档，避免与主操作抢注意力
  &__dim {
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__clip-name {
    max-width: 320px;
    overflow: hidden;
    font-size: 13px;
    color: var(--tb-text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  // 画面区吃掉剩余高度，时间轴与控制条固定在下方
  &__stage {
    flex: 1;
    min-height: 120px;
  }

  &__video {
    display: block;
    width: 100%;
    height: 100%;
    // 指针事件全归裁剪框：原生 controls 在这里既盖不住也点不着，已由自绘按钮替代
    pointer-events: none;
  }

  &__seg {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-2);
    padding: var(--tb-space-3);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__seg-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tb-space-2);
  }

  &__num {
    width: 104px;
  }

  &__empty {
    display: flex;
    flex: 1;
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

  &__outtime {
    font-size: 12px;
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
    align-items: center;
    gap: var(--tb-space-4);
  }

  &__footer-ratio {
    color: var(--tb-color-primary);
  }
}
</style>
