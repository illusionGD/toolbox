<template>
  <ToolPageLayout
    title="视频压缩 / 转码"
    desc="批量压缩与格式转换，支持 MP4 / WebM / MKV / GIF"
    category="媒体工具"
  >
    <!-- 操作栏 -->
    <template #toolbar>
      <n-space align="center">
        <n-button type="primary" :disabled="processing" @click="handleAddFiles">
          <template #icon><n-icon :component="CloudUploadOutline" /></template>
          添加文件
        </n-button>
        <n-button :loading="scanning" :disabled="processing" @click="handleAddFolder">
          <template #icon><n-icon :component="FolderOpenOutline" /></template>
          添加文件夹
        </n-button>
        <n-checkbox v-model:checked="config.recursive" class="video__recursive">
          含子文件夹
        </n-checkbox>
        <n-button
          quaternary
          :disabled="!checkedKeys.length || processing"
          @click="handleRemoveChecked"
        >
          <template #icon><n-icon :component="TrashOutline" /></template>
          移除选中{{ checkedKeys.length ? `(${checkedKeys.length})` : '' }}
        </n-button>
        <n-button quaternary :disabled="!items.length || processing" @click="handleClear">
          <template #icon><n-icon :component="TrashOutline" /></template>
          清空列表
        </n-button>
        <span v-if="capabilities" class="video__version">ffmpeg {{ capabilities.version }}</span>
      </n-space>
    </template>

    <!-- 文件列表 -->
    <template #main>
      <div class="video__list" :class="{ 'video__list--drag': isDragOver }" v-bind="dropHandlers">
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
    </template>

    <!-- 参数面板 -->
    <template #panel>
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
            <p class="video__tip">单趟按时长反算码率，实际误差约 ±10%</p>
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
          <n-input :value="config.outputDir" size="small" placeholder="选择输出目录" />
          <n-button size="small" :disabled="config.overwrite" @click="handlePickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
      </div>

      <div class="video__field video__field--row">
        <label class="video__label">覆盖原文件</label>
        <n-switch v-model:value="config.overwrite" size="small" />
      </div>

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

    <!-- 底部统计 -->
    <template #footer>
      <div class="video__footer">
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
  NTooltip,
  useMessage,
  type DataTableColumns,
} from 'naive-ui';
import { CloudUploadOutline, EyeOutline, FolderOpenOutline, TrashOutline } from '@vicons/ionicons5';
import type {
  PickedFile,
  TranscodeOptions,
  VideoAudioMode,
  VideoCapabilities,
  VideoCodec,
  VideoOutputFormat,
  VideoQualityMode,
} from '@shared/types';
import type { VideoItem } from './types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import StatusTag from '@/components/common/StatusTag.vue';
import TaskProgress from '@/components/common/TaskProgress.vue';
import VideoPreviewModal from '@/components/common/VideoPreviewModal.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useFolderImport } from '@/composables/useFolderImport';
import { useToolConfig } from '@/composables/useToolConfig';
import { showInFolderApi } from '@/services/file';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import {
  cancelTranscodeApi,
  getVideoCapabilitiesApi,
  getVideoThumbnailApi,
  onTranscodeProgress,
  probeVideoApi,
  toMediaUrl,
  transcodeVideoApi,
} from '@/services/video';
import { formatBytes } from '@/utils/format';
import { createTaskQueue } from '@/utils/taskQueue';

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

const items = ref<VideoItem[]>([]);
const checkedKeys = ref<string[]>([]);
const processing = ref(false);
const capabilities = ref<VideoCapabilities | null>(null);
let seq = 0;

/** 正在跑的任务 id；取消与进度过滤都靠它。 */
const currentTaskId = ref('');

/** 用户已点过取消：批量中途取消要停下整个队列，而不只是当前这一个。 */
let canceledByUser = false;

/** 持久化的处理配置（记住上次使用）。 */
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
  onDrop: (files) => addFiles(files),
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
  // 页面被切走时正在跑的 ffmpeg 必须杀掉，否则它在后台继续吃满 CPU
  if (currentTaskId.value) void cancelTranscodeApi(currentTaskId.value);
});
// #endregion

// #region actions
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
 * 组装传给主进程的转码选项。
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
</script>

<style scoped lang="scss">
.video {
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

  // 版本号只是排查问题时的线索，压到最暗一档
  &__version {
    font-size: 12px;
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
    gap: var(--tb-space-4);
  }

  &__footer-ratio {
    color: var(--tb-color-primary);
  }
}
</style>
