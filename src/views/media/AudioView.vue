<template>
  <ToolPageLayout
    title="音频工具"
    desc="批量转码与剪切，支持 MP3 / M4A / WAV / FLAC / OGG / Opus"
    category="媒体工具"
  >
    <template #toolbar>
      <n-tabs v-model:value="tab" type="segment" size="small" class="audio__tabs">
        <n-tab name="convert">批量转码</n-tab>
        <n-tab name="trim">剪切 / 分割</n-tab>
      </n-tabs>
    </template>

    <!-- 主区：转码=文件列表，剪切=波形工作台 -->
    <template #main>
      <div
        v-if="tab === 'convert'"
        class="audio__list"
        :class="{ 'audio__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <div class="audio__bar">
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
          <n-checkbox v-model:checked="config.recursive" class="audio__dim">含子文件夹</n-checkbox>
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
          <span v-if="capabilities" class="audio__dim">ffmpeg {{ capabilities.version }}</span>
        </div>

        <n-data-table
          v-if="items.length"
          v-model:checked-row-keys="checkedKeys"
          :columns="columns"
          :data="items"
          :row-key="(row: AudioItem) => row.id"
          :pagination="pagination"
          :scroll-x="TABLE_SCROLL_X"
          flex-height
          class="audio__table"
          @update:page="(p: number) => (pagination.page = p)"
        />
        <div v-else class="audio__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽音频（或视频）到此处，或点击「添加文件」</p>
        </div>
      </div>

      <div
        v-else
        class="audio__trim"
        :class="{ 'audio__list--drag': isDragOver }"
        v-bind="dropHandlers"
      >
        <div class="audio__bar">
          <n-button size="small" type="primary" :disabled="exporting" @click="handlePickTrimFile">
            <template #icon><n-icon :component="CloudUploadOutline" /></template>
            选择音频
          </n-button>
          <span v-if="trimFile" class="audio__trim-name" :title="trimFile.path">
            {{ trimFile.name }}
          </span>
          <span v-if="trimMeta" class="audio__dim">
            {{ formatDuration(trimMeta.duration) }} · {{ trimMeta.codec || '无音频流' }} ·
            {{ trimMeta.channels }}ch · {{ trimMeta.sampleRate }} Hz
          </span>
        </div>

        <div v-if="!trimFile" class="audio__empty">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖拽一个音频到此处，或点击「选择音频」</p>
        </div>

        <template v-else>
          <WaveformSelect
            v-model="selection"
            :src="waveformUrl"
            :duration="trimMeta?.duration ?? 0"
            :segments="segments"
            :playhead="playhead"
            @seek="handleSeek"
            @toggle-segment="handleToggleSegment"
          />

          <div class="audio__player">
            <n-button size="small" :disabled="!selection" @click="handlePlaySelection">
              <template #icon><n-icon :component="PlayOutline" /></template>
              试听选区
            </n-button>
            <!-- 原生 controls：进度/音量都是浏览器实现，自己搭一套只会更差 -->
            <audio
              ref="audioRef"
              class="audio__audio"
              controls
              preload="metadata"
              :src="trimSrc"
              @timeupdate="handleTimeUpdate"
            />
          </div>

          <div class="audio__seg">
            <n-radio-group v-model:value="segmentMode" size="small">
              <n-space>
                <n-radio value="manual">手动选区（出一段）</n-radio>
                <n-radio value="silence">按静音自动分割</n-radio>
                <n-radio value="even">平均分段</n-radio>
              </n-space>
            </n-radio-group>

            <div v-if="segmentMode === 'manual'" class="audio__seg-row">
              <span class="audio__dim">起</span>
              <n-input-number
                :value="selection?.start ?? 0"
                size="small"
                class="audio__num"
                :min="0"
                :max="trimMeta?.duration ?? 0"
                :step="0.1"
                :precision="3"
                @update:value="(v: number | null) => updateSelection('start', v)"
              />
              <span class="audio__dim">止</span>
              <n-input-number
                :value="selection?.end ?? 0"
                size="small"
                class="audio__num"
                :min="0"
                :max="trimMeta?.duration ?? 0"
                :step="0.1"
                :precision="3"
                @update:value="(v: number | null) => updateSelection('end', v)"
              />
              <span class="audio__dim">
                时长 {{ selection ? (selection.end - selection.start).toFixed(3) : '0.000' }} s
              </span>
              <n-button size="tiny" quaternary :disabled="!selection" @click="selection = null">
                清除选区
              </n-button>
            </div>

            <div v-else-if="segmentMode === 'silence'" class="audio__seg-row">
              <span class="audio__dim">静音阈值 dB</span>
              <n-input-number
                v-model:value="config.noiseDb"
                size="small"
                class="audio__num"
                :min="-90"
                :max="-10"
                :step="5"
              />
              <span class="audio__dim">最短静音 s</span>
              <n-input-number
                v-model:value="config.minSilence"
                size="small"
                class="audio__num"
                :min="0.1"
                :max="10"
                :step="0.1"
              />
              <n-button size="small" :loading="detecting" @click="handleDetectSilence">
                检测并分段
              </n-button>
              <span v-if="segments.length" class="audio__dim">
                共 {{ segments.length }} 段，已选 {{ enabledSegments.length }} 段
              </span>
            </div>

            <div v-else class="audio__seg-row">
              <span class="audio__dim">每段秒数</span>
              <n-input-number
                v-model:value="config.evenSeconds"
                size="small"
                class="audio__num"
                :min="1"
                :step="10"
              />
              <n-button size="small" @click="handleEvenSplit">生成分段</n-button>
              <span v-if="segments.length" class="audio__dim">
                共 {{ segments.length }} 段，已选 {{ enabledSegments.length }} 段
              </span>
            </div>

            <p class="audio__tip">
              剪切精度：WAV 等未压缩格式精确到毫秒；MP3 / AAC 受帧对齐限制约有 +0.03 s 误差
            </p>
          </div>
        </template>
      </div>
    </template>

    <!-- 参数面板：输出设置两个 tab 共用一份（同一个概念不该配两遍） -->
    <template #panel>
      <h3 class="audio__panel-title">输出设置</h3>

      <div class="audio__field">
        <label class="audio__label">输出格式</label>
        <n-select v-model:value="config.format" :options="formatOptions" size="small" />
        <p v-if="config.format === 'original'" class="audio__tip">
          保持源容器；列表里容器与所选编码器不匹配的文件会在该行报错
        </p>
      </div>

      <div class="audio__field">
        <label class="audio__label">编码器</label>
        <n-select v-model:value="config.codec" :options="codecOptions" size="small" />
        <p v-if="config.codec === 'copy'" class="audio__tip">
          仅换封装、不重新编码，瞬间完成；此时无法调音量、响度、淡入淡出、声道与采样率
        </p>
      </div>

      <template v-if="config.codec !== 'copy'">
        <div class="audio__field">
          <label class="audio__label">码率模式</label>
          <n-radio-group v-model:value="config.rateMode" size="small">
            <n-space vertical>
              <n-radio v-for="opt in rateModeOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <div v-if="config.rateMode === 'cbr'" class="audio__field">
          <label class="audio__label">码率 kbps</label>
          <n-select v-model:value="config.bitrate" :options="bitrateOptions" size="small" />
        </div>

        <div v-else-if="config.rateMode === 'vbr'" class="audio__field">
          <label class="audio__label">质量 {{ config.quality }}（{{ vbrHint }}）</label>
          <n-slider v-model:value="config.quality" :min="0" :max="9" :step="1" />
        </div>

        <div v-else-if="config.codec === 'flac'" class="audio__field">
          <label class="audio__label">压缩等级 {{ config.compressionLevel }}</label>
          <n-slider v-model:value="config.compressionLevel" :min="0" :max="12" :step="1" />
          <p class="audio__tip">实测 12 比 5 慢约 48%，只多省 1.5% 体积，默认 5 足够</p>
        </div>

        <div class="audio__field">
          <label class="audio__label">声道</label>
          <n-select v-model:value="config.channels" :options="channelOptions" size="small" />
        </div>

        <div class="audio__field">
          <label class="audio__label">采样率</label>
          <n-select v-model:value="config.sampleRate" :options="sampleRateOptions" size="small" />
          <p v-if="config.codec === 'libopus'" class="audio__tip">
            Opus 只支持 48000 Hz，其余源会自动重采样
          </p>
        </div>

        <div class="audio__field">
          <label class="audio__label"
            >音量增益 {{ config.volumeDb > 0 ? '+' : '' }}{{ config.volumeDb }} dB</label
          >
          <n-slider v-model:value="config.volumeDb" :min="-20" :max="20" :step="1" />
        </div>

        <div class="audio__field audio__field--row">
          <label class="audio__label">响度归一</label>
          <n-switch v-model:value="config.loudness" size="small" />
        </div>
        <div v-if="config.loudness" class="audio__field">
          <label class="audio__label">目标 {{ config.loudnessTarget }} LUFS</label>
          <n-slider v-model:value="config.loudnessTarget" :min="-30" :max="-8" :step="1" />
          <p class="audio__tip">流媒体常用 -16 ~ -14；单趟处理实测即可落在目标 ±0.1 内</p>
        </div>

        <div class="audio__field">
          <label class="audio__label">淡入 / 淡出 秒</label>
          <div class="audio__pair">
            <n-input-number v-model:value="config.fadeIn" size="small" :min="0" :step="0.5" />
            <n-input-number v-model:value="config.fadeOut" size="small" :min="0" :step="0.5" />
          </div>
        </div>

        <div class="audio__field audio__field--row">
          <label class="audio__label">保留元数据标签</label>
          <n-switch v-model:value="config.keepMetadata" size="small" />
        </div>
      </template>

      <div v-if="tab === 'trim' && segmentMode !== 'manual'" class="audio__field">
        <label class="audio__label">输出名模板</label>
        <n-input v-model:value="config.nameTemplate" size="small" placeholder="{name}-{n}" />
        <p class="audio__tip">{name} 为原文件名，{n} 为序号（按总段数自动补零）</p>
      </div>

      <div class="audio__field">
        <label class="audio__label">输出目录</label>
        <div class="audio__dir">
          <n-input v-model:value="config.outputDir" size="small" placeholder="选择或粘贴输出目录" />
          <n-button size="small" :disabled="overwriteActive" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <div v-if="tab === 'convert'" class="audio__field audio__field--row">
        <label class="audio__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

      <template v-if="tab === 'convert'">
        <n-button
          v-if="!processing"
          type="primary"
          block
          class="audio__mt"
          :disabled="!canStart"
          @click="handleStart"
        >
          {{ startLabel }}
        </n-button>
        <n-button v-else block secondary type="error" class="audio__mt" @click="handleCancel">
          取消处理（{{ runningIds.size }} 个进行中）
        </n-button>
      </template>
      <template v-else>
        <n-button
          v-if="!exporting"
          type="primary"
          block
          class="audio__mt"
          :disabled="!canExport"
          @click="handleExport"
        >
          {{ exportLabel }}
        </n-button>
        <n-button v-else block secondary type="error" class="audio__mt" @click="handleCancelExport">
          取消导出（{{ exportPercent }}%）
        </n-button>
      </template>
    </template>

    <template #footer>
      <div v-if="tab === 'convert'" class="audio__footer">
        <span>已选择 {{ items.length }} 个文件</span>
        <div class="audio__footer-stats">
          <span>总时长 {{ formatDuration(totalDuration) }}</span>
          <span>原总大小 {{ formatBytes(totalOriginal) }}</span>
          <span>处理后 {{ formatBytes(totalOutput) }}</span>
          <span v-if="totalRatio !== null" class="audio__footer-ratio">
            {{ totalRatio < 0 ? `体积增大 ${-totalRatio}%` : `体积减小 ${totalRatio}%` }}
          </span>
        </div>
      </div>
      <div v-else class="audio__footer">
        <span v-if="trimMeta">源时长 {{ formatDuration(trimMeta.duration) }}</span>
        <span v-else>未选择文件</span>
        <div class="audio__footer-stats">
          <span v-if="segmentMode === 'manual' && selection">
            将导出 1 段，共 {{ (selection.end - selection.start).toFixed(2) }} s
          </span>
          <span v-else-if="segmentMode !== 'manual'">
            将导出 {{ enabledSegments.length }} 段，共 {{ enabledDuration.toFixed(2) }} s
          </span>
        </div>
      </div>
    </template>
  </ToolPageLayout>
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
  FolderOpenOutline,
  PlayOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import type {
  AudioCodec,
  AudioConvertOptions,
  AudioFormat,
  AudioMeta,
  AudioRateMode,
  PickedFile,
  SilenceRange,
  VideoCapabilities,
} from '@shared/types';
import {
  LOSSLESS_ENCODERS,
  OPUS_SAMPLE_RATE,
  VBR_ENCODERS,
  codecFitsContainer,
} from '@shared/audio';
import type { AudioItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import TaskProgress from '@/components/common/TaskProgress.vue';
import WaveformSelect, { type WaveformSegment } from '@/components/common/WaveformSelect.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { showInFolderApi } from '@/services/file';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  cancelAudioApi,
  convertAudioApi,
  detectSilenceApi,
  getWaveformApi,
  onAudioProgress,
  probeAudioApi,
  splitAudioApi,
} from '@/services/audio';
import { getVideoCapabilitiesApi, toMediaUrl } from '@/services/video';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

// #region state
const message = useMessage();

/**
 * 接受的扩展名：音频容器 + 常见视频容器。
 *
 * 收视频不是凑数——「从视频里提音频」是这页最常被用到的场景之一，主进程一律加
 * `-vn`，视频流不会跟进产物。
 */
const ACCEPT = [
  'mp3',
  'm4a',
  'wav',
  'flac',
  'ogg',
  'opus',
  'aac',
  'wma',
  'aiff',
  'aif',
  'mka',
  'ape',
  'alac',
  'mp4',
  'mkv',
  'mov',
  'webm',
  'avi',
  'ts',
  'flv',
  'm4v',
];

/** 每页行数。同视频页。 */
const PAGE_SIZE = 50;

/** 从文件夹导入的上限。 */
const MAX_FILES = 20_000;

/** 表格横向滚动宽度（须大于各列宽度之和，否则右侧固定列不会浮起）。 */
const TABLE_SCROLL_X = 1280;

/** 元信息探测并发（每条都是一次 ffprobe 子进程）。 */
const PROBE_CONCURRENCY = 2;

/**
 * 转码并发数。
 *
 * **与视频页的严格串行相反，这是实测结论**：音频编码是单进程单线程（同一个十分钟
 * 文件 `-threads 1` 与 `-threads 8` 耗时完全相同），所以四个进程并行实测拿到
 * 3.74× 加速（10 分钟 mp3 320k：串行 44.7s → 并行 12.0s）。视频那边「一个 ffmpeg
 * 就吃满所有核心」对音频不成立。
 */
const CONVERT_CONCURRENCY = 4;

/** 波形图尺寸：横向会被拉满容器，给个足够的采样宽度即可。 */
const WAVEFORM_SIZE = { width: 1600, height: 96 };

/** 波形颜色用中性灰：波形是内容，主色留给用户正在拖的选区。 */
const WAVEFORM_COLOR = '#9b9ba4';

const tab = ref<'convert' | 'trim'>('convert');
const capabilities = ref<VideoCapabilities | null>(null);

// 转码 tab
const items = ref<AudioItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
let seq = 0;
/** 正在跑的 taskId 集合。并发 4 时同时有多行在处理，不能只记一个「当前任务」。 */
const runningIds = ref(new Set<string>());
/** 用户已点过取消：要停下整个队列，而不只是当前这几个。 */
let canceledByUser = false;

// 剪切 tab
const trimFile = ref<PickedFile | null>(null);
const trimMeta = ref<AudioMeta | null>(null);
const waveformUrl = ref('');
const selection = ref<SilenceRange | null>(null);
const segments = ref<WaveformSegment[]>([]);
const segmentMode = ref<'manual' | 'silence' | 'even'>('manual');
const detecting = ref(false);
const exporting = ref(false);
const exportPercent = ref(0);
const exportTaskId = ref('');
const audioRef = ref<HTMLAudioElement | null>(null);
const playhead = ref(0);
/** 「试听选区」启动的播放：到选区末尾自动停，普通播放不受限。 */
const limitToSelection = ref(false);

/** 持久化配置。两个 tab 共用一份：输出格式/编码器是同一个概念，配两遍只会互相打脸。 */
const { config } = useToolConfig('media-audio', {
  format: 'mp3' as AudioFormat,
  codec: 'libmp3lame' as AudioCodec,
  rateMode: 'cbr' as AudioRateMode,
  bitrate: 192,
  quality: 4,
  compressionLevel: 5,
  channels: 0,
  sampleRate: 0,
  volumeDb: 0,
  loudness: false,
  loudnessTarget: -16,
  fadeIn: 0,
  fadeOut: 0,
  keepMetadata: true,
  outputDir: '',
  overwrite: false,
  recursive: false,
  nameTemplate: '{name}-{n}',
  noiseDb: -35,
  minSilence: 0.5,
  evenSeconds: 30,
});

const { scanning, importFolder } = useFolderImport({
  key: 'audio',
  accept: ACCEPT,
  maxFiles: MAX_FILES,
  title: '选择音频文件夹',
});

const formatOptions = [
  { label: '保持原容器', value: 'original' },
  { label: 'MP3', value: 'mp3' },
  { label: 'M4A（AAC / ALAC）', value: 'm4a' },
  { label: 'WAV', value: 'wav' },
  { label: 'FLAC', value: 'flac' },
  { label: 'OGG', value: 'ogg' },
  { label: 'Opus', value: 'opus' },
  { label: 'AAC', value: 'aac' },
];

const bitrateOptions = [64, 96, 128, 160, 192, 256, 320].map((v) => ({
  label: `${v} kbps`,
  value: v,
}));

const channelOptions = [
  { label: '保持源', value: 0 },
  { label: '单声道', value: 1 },
  { label: '立体声', value: 2 },
];

/** 全部编码器候选（label 里带上取舍，省得用户回头查）。 */
const CODEC_CANDIDATES: { label: string; value: Exclude<AudioCodec, 'copy'> }[] = [
  { label: 'MP3（libmp3lame，通用）', value: 'libmp3lame' },
  { label: 'AAC（同码率音质优于 MP3）', value: 'aac' },
  { label: 'Opus（低码率最佳）', value: 'libopus' },
  { label: 'Vorbis（OGG 传统编码）', value: 'libvorbis' },
  { label: 'FLAC（无损压缩）', value: 'flac' },
  { label: 'ALAC（Apple 无损）', value: 'alac' },
  { label: 'PCM 16bit（未压缩）', value: 'pcm_s16le' },
];
// #endregion

// #region drop
const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => {
    if (tab.value === 'convert') addFiles(files);
    else if (files[0]) void loadTrimFile(files[0]);
  },
});
// #endregion

// #region getters
/**
 * 编码器下拉项。
 *
 * 两层过滤，都是为了「选得到的就一定跑得通」：**只列探测到的编码器**（打包的
 * ffmpeg 是 2018 年构建，文档列的不等于它有），且**只列装得进当前容器的**
 * （矩阵在 shared/audio.ts，与主进程 pre-flight 同一份）。
 * copy 不是编码器，任何构建都有，永远保留。
 */
const codecOptions = computed(() => {
  const available = capabilities.value?.audioEncoders ?? [];
  const container = config.format === 'original' ? null : config.format;
  const options = CODEC_CANDIDATES.filter(
    (c) => available.includes(c.value) && (!container || codecFitsContainer(c.value, container)),
  ).map((c) => ({ label: c.label, value: c.value as AudioCodec }));
  options.push({ label: '不重新编码（快速换封装）', value: 'copy' as AudioCodec });
  return options;
});

/** 码率模式选项：按编码器能力给，避免出现「选了 VBR 却被静默退回 CBR」。 */
const rateModeOptions = computed<{ label: string; value: AudioRateMode }[]>(() => {
  if (LOSSLESS_ENCODERS.includes(config.codec)) return [{ label: '无损', value: 'lossless' }];
  const list: { label: string; value: AudioRateMode }[] = [
    { label: '固定码率（CBR）', value: 'cbr' },
  ];
  if (VBR_ENCODERS.includes(config.codec)) list.push({ label: '可变码率（VBR）', value: 'vbr' });
  return list;
});

/** VBR 质量的方向：mp3 越小越好、vorbis 越大越好，两者相反，必须写清楚。 */
const vbrHint = computed(() =>
  config.codec === 'libmp3lame' ? '0 最好，9 最小' : '数值越大质量越好',
);

/** 采样率选项：libopus 只接受 48kHz，别的值直接不给选。 */
const sampleRateOptions = computed(() => {
  const base = [
    { label: '保持源', value: 0 },
    { label: '48000 Hz', value: 48_000 },
    { label: '44100 Hz', value: 44_100 },
    { label: '32000 Hz', value: 32_000 },
    { label: '22050 Hz', value: 22_050 },
    { label: '16000 Hz', value: 16_000 },
  ];
  if (config.codec === 'libopus') {
    return base.filter((o) => o.value === 0 || o.value === OPUS_SAMPLE_RATE);
  }
  return base;
});

/** 覆盖模式只在转码 tab 生效：剪切要出多段，原地覆盖没有意义。 */
const overwriteActive = computed(() => tab.value === 'convert' && config.overwrite);

const totalOriginal = computed(() => items.value.reduce((s, i) => s + i.size, 0));
const totalOutput = computed(() => items.value.reduce((s, i) => s + (i.outputSize ?? 0), 0));
const totalDuration = computed(() => items.value.reduce((s, i) => s + (i.duration ?? 0), 0));
const totalRatio = computed(() => {
  const done = items.value.filter((i) => i.outputSize !== undefined);
  if (!done.length) return null;
  const orig = done.reduce((s, i) => s + i.size, 0);
  const out = done.reduce((s, i) => s + (i.outputSize ?? 0), 0);
  // 音频转码常常变大（wav 转 flac 只省 6%、提码率会更大），负数如实展示
  return orig > 0 ? Math.round((1 - out / orig) * 100) : 0;
});

const canStart = computed(
  () => items.value.length > 0 && !processing.value && (config.overwrite || !!config.outputDir),
);
const startLabel = computed(() =>
  checkedKeys.value.length ? `开始处理 (${checkedKeys.value.length})` : '开始处理',
);

const enabledSegments = computed(() => segments.value.filter((s) => s.enabled));
const enabledDuration = computed(() =>
  enabledSegments.value.reduce((s, r) => s + (r.end - r.start), 0),
);

const canExport = computed(() => {
  if (!trimFile.value || exporting.value || !config.outputDir) return false;
  return segmentMode.value === 'manual'
    ? selection.value !== null
    : enabledSegments.value.length > 0;
});
const exportLabel = computed(() =>
  segmentMode.value === 'manual' ? '导出选区' : `导出 ${enabledSegments.value.length} 段`,
);

/** 播放源：走 tb-media 协议，路径已在 probe 时登记白名单。 */
const trimSrc = computed(() => (trimFile.value ? toMediaUrl(trimFile.value.path) : ''));

/** 表格分页（受控：要知道当前页是哪些行，才能只为它们探测元信息）。 */
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

const probeQueue = createTaskQueue(PROBE_CONCURRENCY);
const probeRequested = new Set<string>();

/** 只为当前页的行排队探测元信息（每条都是一次 ffprobe 子进程，不能一次全发）。 */
watch(
  visibleItems,
  (rows) => {
    for (const row of rows) {
      if (probeRequested.has(row.id)) continue;
      probeRequested.add(row.id);
      const { id, path } = row;
      probeQueue.push(async () => {
        const meta = await probeAudioApi(path).catch(() => null);
        // await 期间用户可能已移除该项，按 id 回查而不是复用引用
        const target = items.value.find((i) => i.id === id);
        if (!target) return;
        if (meta) {
          target.duration = meta.duration;
          target.codec = meta.codec;
          target.channels = meta.channels;
          target.sampleRate = meta.sampleRate;
          target.bitrate = meta.bitrate;
          target.hasVideo = meta.hasVideo;
        }
        target.probed = true;
      });
    }
  },
  { immediate: true },
);

/**
 * 选中的编码器不在可用项里时回落。
 *
 * 两种情况都会发生：换了输出格式导致原编码器装不进新容器，或换了台机器（记住的
 * 编码器在这个 ffmpeg 构建里不存在）。不回落的话下拉会显示一个空值。
 */
watch(codecOptions, (options) => {
  if (options.some((o) => o.value === config.codec)) return;
  config.codec = options[0]?.value ?? 'copy';
});

/** 编码器变了要同步修正码率模式与采样率，否则会留下该编码器不支持的组合。 */
watch(
  () => config.codec,
  () => {
    if (!rateModeOptions.value.some((o) => o.value === config.rateMode)) {
      config.rateMode = rateModeOptions.value[0]?.value ?? 'cbr';
    }
    if (!sampleRateOptions.value.some((o) => o.value === config.sampleRate)) {
      config.sampleRate = 0;
    }
  },
  { immediate: true },
);

/** 切换分段方式时清掉上一种方式留下的段，否则会导出到看不见的旧分段。 */
watch(segmentMode, () => {
  segments.value = [];
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

/**
 * 组装传给主进程的转码选项（两个 tab 共用）。
 * @param taskId 本次任务 id。
 * @param trim 剪切区间；不给则整条。
 * @param overwrite 是否覆盖原文件。
 * @returns 转码选项。
 */
function buildOptions(taskId: string, trim?: SilenceRange, overwrite = false): AudioConvertOptions {
  return {
    taskId,
    format: config.format,
    codec: config.codec,
    rateMode: config.rateMode,
    bitrate: config.bitrate,
    quality: config.quality,
    compressionLevel: config.compressionLevel,
    channels: config.channels,
    sampleRate: config.sampleRate,
    volumeDb: config.volumeDb,
    // 开关关掉时必须传 null 而不是留着上次的数值，否则归一会照跑
    loudnessTarget: config.loudness ? config.loudnessTarget : null,
    fadeIn: config.fadeIn,
    fadeOut: config.fadeOut,
    keepMetadata: config.keepMetadata,
    // 必须重建一个纯对象：调用方传进来的多半是 `selection.value`，而 ref 里的对象
    // 是**深层响应式 Proxy**，直接经 IPC 传会报 "An object could not be cloned"
    // （同 ImageCompressView 的 advanced、FileStatsView 的 ignoreDirs）
    ...(trim ? { trim: { start: trim.start, end: trim.end } } : {}),
    outputDir: config.outputDir,
    overwrite,
  };
}
// #endregion

// #region columns
const columns: DataTableColumns<AudioItem> = [
  { type: 'selection' },
  { title: '文件名', key: 'name', minWidth: 200, ellipsis: { tooltip: true } },
  { title: '时长', key: 'duration', width: 82, render: (row) => formatDuration(row.duration) },
  {
    title: '编码',
    key: 'codec',
    width: 130,
    // probed 才能区分「没有音频流」与「还没探测」
    render: (row) => {
      if (!row.probed) return '—';
      if (!row.codec) return '无音频流';
      return row.hasVideo ? `${row.codec}（含视频）` : row.codec;
    },
  },
  {
    title: '声道',
    key: 'channels',
    width: 66,
    render: (row) => (row.channels ? String(row.channels) : '—'),
  },
  {
    title: '采样率',
    key: 'sampleRate',
    width: 92,
    render: (row) => (row.sampleRate ? `${row.sampleRate} Hz` : '—'),
  },
  {
    title: '码率',
    key: 'bitrate',
    width: 90,
    render: (row) => (row.bitrate ? `${Math.round(row.bitrate / 1000)} kbps` : '—'),
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
    // 音频转码常常变大，用正负号与颜色区分，不截断为 0
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
        return h(TaskProgress, {
          percentage: Math.max(0, row.percent ?? 0),
          status: 'processing',
          height: 6,
        });
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
    width: 96,
    // 列多、横向可滚，操作列钉在右侧常驻
    fixed: 'right',
    render: (row) =>
      h(NSpace, { size: 4, wrap: false }, () => [
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
    })
    .catch(() => {
      // 提示已由 services 统一弹出；探测失败时下拉只剩 copy，页面仍可用
    });

  stopProgress = onAudioProgress((progress) => {
    if (progress.taskId === exportTaskId.value) {
      exportPercent.value = Math.max(0, progress.percent);
      return;
    }
    // 并发时只按 taskId 对行，但要先确认这个 id 仍在跑：取消后可能还有一条滞后
    // 推送到达，不过滤就会写到已经退回 pending 的行上
    if (!runningIds.value.has(progress.taskId)) return;
    const target = items.value.find((i) => i.taskId === progress.taskId);
    if (!target) return;
    target.percent = progress.percent;
    target.speed = progress.speed;
  });
});

onUnmounted(() => {
  stopProgress?.();
  // 页面被切走时在跑的 ffmpeg 必须全部杀掉，否则它们在后台继续吃 CPU
  for (const id of runningIds.value) void cancelAudioApi(id);
  if (exportTaskId.value) void cancelAudioApi(exportTaskId.value);
});
// #endregion

// #region actions（转码 tab）
/** 追加文件（按路径去重）。元信息交给当前页的 watch 按需探测。 */
function addFiles(files: PickedFile[]): void {
  const existing = new Set(items.value.map((i) => i.path));
  const fresh = files.filter((f) => !existing.has(f.path) && ACCEPT.includes(f.ext));
  for (const file of fresh) {
    items.value.push({ ...file, id: `aud-${seq++}`, status: 'pending' });
  }
}

/** 打开文件选择。 */
async function handleAddFiles(): Promise<void> {
  const files = await pickFilesApi({
    multiple: true,
    filters: [{ name: '音频 / 视频', extensions: ACCEPT }],
    title: '选择要处理的音频',
  });
  if (files.length) addFiles(files);
}

/** 从文件夹批量导入。 */
async function handleAddFolder(): Promise<void> {
  const before = items.value.length;
  const files = await importFolder(config.recursive);
  if (!files.length) return;
  addFiles(files);
  const added = items.value.length - before;
  if (added) message.success(`已添加 ${added} 个文件`);
  else message.info('这些文件已在列表中');
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

/** 一次转码的结果计数。 */
interface RunTally {
  ok: number;
  failed: number;
  skipped: number;
  lastError: string;
}

/**
 * 转码一个文件并把结果写回该行。
 * @param item 目标行。
 * @param tally 结果计数。
 */
async function convertItem(item: AudioItem, tally: RunTally): Promise<void> {
  const taskId = `${item.id}-${Date.now()}`;
  item.taskId = taskId;
  item.status = 'processing';
  item.percent = 0;
  runningIds.value.add(taskId);
  try {
    const result = await convertAudioApi(
      item.path,
      buildOptions(taskId, undefined, config.overwrite),
    );
    if (result.canceled) {
      // 取消不是错误：退回 pending，用户可以改参数重跑
      item.status = 'pending';
      item.percent = undefined;
      tally.skipped += 1;
    } else {
      item.outputSize = result.outputSize;
      item.ratio = result.ratio;
      item.outputPath = result.outputPath;
      item.streamCopy = result.streamCopy;
      item.percent = 100;
      item.status = 'done';
      tally.ok += 1;
    }
  } catch (e) {
    item.status = 'error';
    item.error = e instanceof Error ? e.message : '转码失败';
    tally.lastError = item.error;
    item.percent = undefined;
    tally.failed += 1;
  } finally {
    runningIds.value.delete(taskId);
  }
}

/**
 * 开始处理：有勾选时只处理选中项，否则处理全部。
 *
 * **并发 4**（见 CONVERT_CONCURRENCY 的实测数据）。用固定数量的 worker 轮取任务，
 * 而不是一次 Promise.all 全发：后者在上千个文件时会同时开上千个 ffmpeg。
 */
async function handleStart(): Promise<void> {
  const selected = new Set(checkedKeys.value);
  const targets = selected.size ? items.value.filter((i) => selected.has(i.id)) : [...items.value];
  processing.value = true;
  canceledByUser = false;
  const tally: RunTally = { ok: 0, failed: 0, skipped: 0, lastError: '' };

  try {
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(CONVERT_CONCURRENCY, targets.length) },
      async () => {
        while (cursor < targets.length) {
          const item = targets[cursor++];
          if (!item) break;
          // 取消后剩下的整队都不再启动，已完成的结果保留
          if (canceledByUser) {
            tally.skipped += 1;
            continue;
          }
          await convertItem(item, tally);
        }
      },
    );
    await Promise.all(workers);

    if (canceledByUser) message.info(`已取消，完成 ${tally.ok} 个，${tally.skipped} 个未处理`);
    else if (tally.failed === 0) message.success(`处理完成，共 ${tally.ok} 个`);
    else if (tally.ok === 0) message.error(`处理失败：${tally.lastError}`);
    else message.warning(`完成 ${tally.ok} 个，失败 ${tally.failed} 个（悬停状态查看原因）`);
  } finally {
    processing.value = false;
  }
}

/** 取消处理：杀掉**所有**在跑的 ffmpeg 并停下整个队列。 */
async function handleCancel(): Promise<void> {
  canceledByUser = true;
  await Promise.all([...runningIds.value].map((id) => cancelAudioApi(id)));
}
// #endregion

// #region actions（剪切 tab）
/**
 * 载入待剪切的文件：探元信息 + 画波形。
 * @param file 目标文件。
 */
async function loadTrimFile(file: PickedFile): Promise<void> {
  trimFile.value = file;
  trimMeta.value = null;
  waveformUrl.value = '';
  selection.value = null;
  segments.value = [];
  playhead.value = 0;

  // probe 顺带把路径登记进 tb-media 白名单，播放才不会被协议以 403 拒掉
  const meta = await probeAudioApi(file.path).catch(() => null);
  if (!meta) {
    message.error('读取音频信息失败');
    return;
  }
  trimMeta.value = meta;
  if (!meta.codec) {
    message.warning('该文件没有音频流');
    return;
  }
  waveformUrl.value = await getWaveformApi(file.path, {
    ...WAVEFORM_SIZE,
    color: WAVEFORM_COLOR,
  }).catch(() => '');
}

/** 选择待剪切的文件。 */
async function handlePickTrimFile(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '音频 / 视频', extensions: ACCEPT }],
    title: '选择要剪切的音频',
  });
  if (files[0]) await loadTrimFile(files[0]);
}

/**
 * 从数字输入框改选区端点。
 * @param edge 改的是哪一端。
 * @param value 新值秒。
 */
function updateSelection(edge: 'start' | 'end', value: number | null): void {
  const duration = trimMeta.value?.duration ?? 0;
  if (value === null || duration <= 0) return;
  const current = selection.value ?? { start: 0, end: duration };
  const next = { ...current, [edge]: Math.min(Math.max(0, value), duration) };
  // 拖过头会让起止翻转，归一化而不是拒绝输入
  selection.value = { start: Math.min(next.start, next.end), end: Math.max(next.start, next.end) };
}

/**
 * 波形上点击：跳播到该时间点。
 * @param seconds 目标时间秒。
 */
function handleSeek(seconds: number): void {
  playhead.value = seconds;
  limitToSelection.value = false;
  const el = audioRef.value;
  if (el) el.currentTime = seconds;
}

/**
 * 切换某个候选段是否参与导出。
 * @param index 段下标。
 */
function handleToggleSegment(index: number): void {
  const target = segments.value[index];
  if (target) target.enabled = !target.enabled;
}

/** 播放头跟随；「试听选区」时到选区末尾自动停。 */
function handleTimeUpdate(): void {
  const el = audioRef.value;
  if (!el) return;
  playhead.value = el.currentTime;
  const range = selection.value;
  if (limitToSelection.value && range && el.currentTime >= range.end) {
    el.pause();
    limitToSelection.value = false;
  }
}

/** 从选区开头播放到选区末尾（接缝爆音只能靠听）。 */
function handlePlaySelection(): void {
  const el = audioRef.value;
  const range = selection.value;
  if (!el || !range) return;
  el.currentTime = range.start;
  limitToSelection.value = true;
  void el.play().catch(() => {
    // 播放失败（协议未授权 / 编码不受支持）时静默：波形与导出仍可用
    limitToSelection.value = false;
  });
}

/**
 * 检测静音并把**非静音区间**转成候选段。
 *
 * 用户要的是「说话的那几段」，所以取静音区间的补集，而不是静音本身。
 */
async function handleDetectSilence(): Promise<void> {
  const file = trimFile.value;
  if (!file) return;
  detecting.value = true;
  try {
    const result = await detectSilenceApi(file.path, {
      noiseDb: config.noiseDb,
      minDuration: config.minSilence,
    });
    const list: WaveformSegment[] = [];
    let cursor = 0;
    for (const gap of result.silences) {
      if (gap.start - cursor > MIN_SEGMENT)
        list.push({ start: cursor, end: gap.start, enabled: true });
      cursor = gap.end;
    }
    if (result.duration - cursor > MIN_SEGMENT) {
      list.push({ start: cursor, end: result.duration, enabled: true });
    }
    segments.value = list;
    if (!list.length) message.warning('没有检出可用片段，试着放宽静音阈值或缩短最短静音');
    else message.success(`检出 ${result.silences.length} 段静音，切出 ${list.length} 段有声片段`);
  } catch {
    // 提示已由 services 统一弹出
  } finally {
    detecting.value = false;
  }
}

/** 最短片段秒：比这更短的不值得单独出一个文件。 */
const MIN_SEGMENT = 0.2;

/** 按固定秒数平均分段。 */
function handleEvenSplit(): void {
  const duration = trimMeta.value?.duration ?? 0;
  const step = Math.max(1, config.evenSeconds);
  if (duration <= 0) return;
  const list: WaveformSegment[] = [];
  for (let start = 0; start < duration; start += step) {
    const end = Math.min(duration, start + step);
    if (end - start > MIN_SEGMENT) list.push({ start, end, enabled: true });
  }
  segments.value = list;
  message.success(`已生成 ${list.length} 段`);
}

/** 导出：手动选区走 convert（出一个同名文件），分段走 split（按模板编号）。 */
async function handleExport(): Promise<void> {
  const file = trimFile.value;
  if (!file) return;
  const taskId = `trim-${Date.now()}`;
  exporting.value = true;
  exportPercent.value = 0;
  exportTaskId.value = taskId;

  try {
    if (segmentMode.value === 'manual') {
      const range = selection.value;
      if (!range) return;
      const result = await convertAudioApi(file.path, buildOptions(taskId, range));
      if (result.canceled) message.info('已取消导出');
      else {
        // 剪切精度如实回报：压缩格式有帧对齐误差，不假装精确
        message.success(`已导出，时长 ${result.duration.toFixed(3)} s`);
      }
    } else {
      const result = await splitAudioApi(file.path, {
        ...buildOptions(taskId),
        segments: enabledSegments.value.map((s) => ({ start: s.start, end: s.end })),
        nameTemplate: config.nameTemplate || '{name}-{n}',
      });
      if (result.canceled) message.info('已取消导出');
      else
        message.success(
          `已导出 ${result.outputPaths.length} 段，共 ${formatBytes(result.outputSize)}`,
        );
    }
  } catch (e) {
    // convertAudioApi 是静默的（为批量准备），单文件导出这条路必须自己报错；
    // splitAudioApi 带 errorPrefix，services 已经弹过，不重复弹
    if (segmentMode.value === 'manual') {
      message.error(e instanceof Error ? e.message : '导出失败');
    }
  } finally {
    exporting.value = false;
    exportTaskId.value = '';
    exportPercent.value = 0;
  }
}

/** 取消导出。 */
async function handleCancelExport(): Promise<void> {
  if (exportTaskId.value) await cancelAudioApi(exportTaskId.value);
}
// #endregion
</script>

<style scoped lang="scss">
.audio {
  &__tabs {
    max-width: 320px;
  }

  &__list,
  &__trim {
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

  &__trim-name {
    max-width: 320px;
    overflow: hidden;
    font-size: 13px;
    color: var(--tb-text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__player {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
  }

  &__audio {
    flex: 1;
    height: 32px;
  }

  &__seg {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
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

  &__pair {
    display: flex;
    gap: var(--tb-space-2);
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
