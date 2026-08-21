<template>
  <n-modal :show="show" @update:show="handleUpdateShow">
    <n-card class="vpreview" :title="title" size="small" closable @close="handleClose">
      <div class="vpreview__body">
        <div class="vpreview__col">
          <p class="vpreview__label">原视频</p>
          <div class="vpreview__stage">
            <video
              v-if="originalSrc"
              ref="originalRef"
              class="vpreview__video"
              :src="originalSrc"
              :poster="poster"
              controls
              preload="metadata"
            />
            <div v-else class="vpreview__placeholder">无法播放</div>
          </div>
        </div>
        <div class="vpreview__col">
          <p class="vpreview__label">{{ resultLabel }}</p>
          <div class="vpreview__stage">
            <video
              v-if="outputSrc"
              ref="outputRef"
              class="vpreview__video"
              :src="outputSrc"
              controls
              preload="metadata"
            />
            <div v-else class="vpreview__placeholder">尚未处理</div>
          </div>
        </div>
      </div>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { NCard, NModal } from 'naive-ui';

/**
 * 视频前后对比预览。
 *
 * 不复用 ImagePreviewModal：那个组件的语义是「两张 img」，塞 video 进去要同时
 * 改它的 props、播放控制与两个图片页的调用方，反而把三处都搞乱。
 * src 走 tb-media 自定义协议——file:// 在开发环境（renderer 是 http://localhost）
 * 会被 Chromium 直接拦掉，且没有 Range 支持就拖不动进度条。
 */

interface Props {
  /** 是否显示。 */
  show: boolean;
  /** 标题。 */
  title?: string;
  /** 原视频 tb-media URL。 */
  originalSrc?: string;
  /** 输出视频 tb-media URL；无则显示占位。 */
  outputSrc?: string;
  /** 封面图 data URL（复用列表里已抽好的缩略图，省一次抽帧）。 */
  poster?: string;
  /** 右侧一栏的标签。 */
  resultLabel?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '视频预览',
  originalSrc: '',
  outputSrc: '',
  poster: '',
  resultLabel: '处理后',
});

const emit = defineEmits<{
  'update:show': [value: boolean];
}>();

const originalRef = ref<HTMLVideoElement | null>(null);
const outputRef = ref<HTMLVideoElement | null>(null);

/**
 * 停止播放并断开数据源。
 *
 * 只 pause 不清 src 的话，隐藏的 video 仍持有解码器与文件句柄：CPU 一直有占用，
 * 而且句柄没释放会让「覆盖原文件」再处理同一个文件时写入失败。
 */
function stopPlayback(): void {
  for (const el of [originalRef.value, outputRef.value]) {
    if (!el) continue;
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
}

watch(
  () => props.show,
  (visible) => {
    if (!visible) stopPlayback();
  },
);

/** 关闭弹窗。 */
function handleClose(): void {
  stopPlayback();
  emit('update:show', false);
}

/**
 * 同步显示状态（点遮罩关闭也要停播）。
 * @param value 新的显示状态。
 */
function handleUpdateShow(value: boolean): void {
  if (!value) stopPlayback();
  emit('update:show', value);
}
</script>

<style scoped lang="scss">
.vpreview {
  width: 880px;
  max-width: 92vw;
  background: var(--tb-bg-surface);
  border: 1px solid var(--tb-border);

  &__body {
    display: flex;
    gap: var(--tb-space-4);
  }

  &__col {
    flex: 1;
    min-width: 0;
  }

  &__label {
    margin: 0 0 var(--tb-space-2);
    color: var(--tb-text-secondary);
    font-size: 13px;
  }

  &__stage {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 320px;
    background: var(--tb-bg-base);
    border-radius: var(--tb-radius-sm);
    overflow: hidden;
  }

  &__video {
    max-width: 100%;
    max-height: 100%;
  }

  &__placeholder {
    color: var(--tb-text-secondary);
    font-size: 13px;
  }
}
</style>
