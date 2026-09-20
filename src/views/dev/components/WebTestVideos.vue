<template>
  <n-card size="small" title="录制视频">
    <template #header-extra>
      <n-button size="small" :loading="loading" :disabled="Boolean(pendingPath)" @click="refresh"
        >刷新视频</n-button
      >
    </template>
    <p class="webtest-videos__hint">
      {{ recordingHint }} 视频暂存于缓存目录
      webtest\videos，清理缓存会删除这些文件，需要保留时请点击「保存视频」。
    </p>
    <n-alert v-if="error" type="error" :show-icon="false">{{ error }}</n-alert>
    <n-empty v-else-if="!videos.length && !loading" description="暂无已保存的视频" />
    <div v-if="videos.length" class="webtest-videos__list">
      <div v-for="video in videos" :key="video.path" class="webtest-videos__item">
        <div class="webtest-videos__details" :title="video.path">
          <div>{{ formatTime(video.modifiedAt) }} · {{ formatBytes(video.size) }}</div>
          <div class="webtest-videos__name">{{ video.name }}</div>
        </div>
        <n-space :size="6">
          <n-button size="small" :disabled="Boolean(pendingPath)" @click="preview(video)"
            >播放视频</n-button
          >
          <n-button size="small" :disabled="Boolean(pendingPath)" @click="save(video)"
            >保存视频</n-button
          >
          <n-button
            size="small"
            type="error"
            secondary
            :disabled="Boolean(pendingPath)"
            @click="confirmDelete(video)"
            >删除视频</n-button
          >
          <n-button size="small" :disabled="Boolean(pendingPath)" @click="reveal(video.path)"
            >在文件夹中显示</n-button
          >
        </n-space>
      </div>
    </div>
    <n-modal :show="Boolean(selected)" @update:show="updatePreview">
      <n-card class="webtest-videos__preview" title="录制视频预览" closable @close="closePreview">
        <video
          v-if="selected"
          ref="player"
          :key="selected.path"
          class="webtest-videos__player"
          :src="selected.url"
          controls
          preload="metadata"
          @error="handlePlaybackError"
        />
        <n-alert v-if="playbackError" type="error">{{ playbackError }}</n-alert>
      </n-card>
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { NAlert, NButton, NCard, NEmpty, NModal, NSpace, useDialog, useMessage } from 'naive-ui';
import type { WebTestSnapshot, WebTestVideo } from '@shared/webtest';
import {
  deleteWebTestVideoApi,
  getWebTestVideosApi,
  saveWebTestVideoApi,
} from '@/services/webtest';
import { showInFolderApi } from '@/services/file';
import { formatBytes } from '@/utils/format';

interface Props {
  /** 会话结束后刷新磁盘列表，等待视频封装完成。 */
  mode: WebTestSnapshot['mode'];
  /** 本次录制是否开启视频。 */
  recordVideo: boolean;
}
const props = defineProps<Props>();
const dialog = useDialog();
const message = useMessage();
const videos = ref<WebTestVideo[]>([]);
const loading = ref(false);
const pendingPath = ref('');
const error = ref('');
const selected = ref<WebTestVideo | null>(null);
const player = ref<HTMLVideoElement | null>(null);
const playbackError = ref('');
let refreshVersion = 0;
const recordingHint = computed(() => {
  if (props.mode === 'recording')
    return props.recordVideo
      ? '正在录制视频，点击「结束录制」后保存并显示。'
      : '本次未开启视频录制；下次开始前打开「同时录制视频」。';
  if (props.mode === 'stopping') return '正在结束会话，视频封装及格式转换完成后会自动刷新。';
  return '录制前打开「同时录制视频」，结束录制后自动保存；每个页签单独生成一个视频。';
});
const formatTime = (value: number): string => new Date(value).toLocaleString();

/** 从磁盘读取历史视频，错误保留在视频区域，避免影响用例操作。 */
const refresh = async (): Promise<void> => {
  const version = ++refreshVersion;
  loading.value = true;
  error.value = '';
  try {
    const result = await getWebTestVideosApi();
    if (version === refreshVersion) videos.value = result;
  } catch (cause) {
    if (version === refreshVersion)
      error.value = `视频列表读取失败：${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    if (version === refreshVersion) loading.value = false;
  }
};
/** 释放播放器文件句柄和解码器。 */
const closePreview = (): void => {
  if (player.value) {
    player.value.pause();
    player.value.removeAttribute('src');
    player.value.load();
  }
  selected.value = null;
};
/** @param video 已由主进程授权播放的视频。 */
const preview = (video: WebTestVideo): void => {
  closePreview();
  playbackError.value = '';
  selected.value = video;
};
/** @param show 弹窗可见状态，关闭时释放播放器。 */
const updatePreview = (show: boolean): void => {
  if (!show) closePreview();
};
/** 视频可能被外部移动或删除，给出可恢复的错误提示。 */
const handlePlaybackError = (): void => {
  if (selected.value) playbackError.value = '视频无法播放，请刷新列表或在文件夹中检查文件。';
};
/** @param path 视频绝对路径。 */
const reveal = async (path: string): Promise<void> => {
  try {
    await showInFolderApi(path);
  } catch {
    /* service 统一显示错误。 */
  }
};
/** @param video 将视频复制到用户选择的位置，保留缓存原件。 */
const save = async (video: WebTestVideo): Promise<void> => {
  if (pendingPath.value) return;
  pendingPath.value = video.path;
  try {
    const path = await saveWebTestVideoApi(video.path);
    if (path) message.success('视频已保存');
  } catch {
    /* service 统一显示错误。 */
  } finally {
    pendingPath.value = '';
  }
};
/** @param video 用户准备删除的录制视频，确认后只删除当前文件。 */
const confirmDelete = (video: WebTestVideo): void => {
  dialog.warning({
    title: '删除录制视频',
    content: `确定删除 ${video.name}？此操作会删除列表中的原视频文件，已另存的副本不受影响。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      if (pendingPath.value) return false;
      pendingPath.value = video.path;
      try {
        if (selected.value?.path === video.path) closePreview();
        await deleteWebTestVideoApi(video.path);
        refreshVersion++;
        loading.value = false;
        videos.value = videos.value.filter((item) => item.path !== video.path);
        message.success('视频已删除');
        return true;
      } catch {
        return false;
      } finally {
        pendingPath.value = '';
      }
    },
  });
};
watch(
  () => props.mode,
  (mode, previous) => {
    if (mode === 'idle' || previous === undefined) void refresh();
  },
  { immediate: true },
);
onBeforeUnmount(closePreview);
</script>

<style scoped lang="scss">
.webtest-videos {
  &__hint {
    margin: 0 0 var(--tb-space-3);
    color: var(--tb-text-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
  &__list {
    max-height: 180px;
    overflow: auto;
  }
  &__item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
    padding: var(--tb-space-2) 0;
  }
  &__details {
    min-width: 0;
    flex: 1 1 240px;
    font-size: 12px;
  }
  &__name {
    color: var(--tb-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &__preview {
    width: 880px;
    max-width: 92vw;
  }
  &__player {
    display: block;
    width: 100%;
    max-height: 70vh;
    background: var(--tb-bg-base);
  }
}
</style>
