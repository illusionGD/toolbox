<template>
  <n-modal :show="show" @update:show="(v: boolean) => emit('update:show', v)">
    <n-card class="preview" :title="title" size="small" closable @close="handleClose">
      <div class="preview__body">
        <div class="preview__col">
          <p class="preview__label">原图</p>
          <div class="preview__img-wrap">
            <img v-if="originalUrl" :src="originalUrl" class="preview__img" alt="原图" />
            <n-spin v-else />
          </div>
        </div>
        <div class="preview__col">
          <p class="preview__label">压缩后</p>
          <div class="preview__img-wrap">
            <img v-if="compressedUrl" :src="compressedUrl" class="preview__img" alt="压缩后" />
            <div v-else class="preview__placeholder">尚未压缩</div>
          </div>
        </div>
      </div>
    </n-card>
  </n-modal>
</template>

<script setup lang="ts">
import { NCard, NModal, NSpin } from 'naive-ui';

interface Props {
  /** 是否显示。 */
  show: boolean;
  /** 标题。 */
  title?: string;
  /** 原图 data URL。 */
  originalUrl?: string;
  /** 压缩后 data URL；无则显示占位。 */
  compressedUrl?: string;
}

withDefaults(defineProps<Props>(), {
  title: '预览对比',
  originalUrl: '',
  compressedUrl: '',
});

const emit = defineEmits<{
  'update:show': [value: boolean];
}>();

/** 关闭弹窗。 */
function handleClose(): void {
  emit('update:show', false);
}
</script>

<style scoped lang="scss">
.preview {
  width: 720px;
  max-width: 90vw;
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

  &__img-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 360px;
    background: var(--tb-bg-base);
    border-radius: var(--tb-radius-sm);
    overflow: hidden;
  }

  &__img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  &__placeholder {
    color: var(--tb-text-secondary);
    font-size: 13px;
  }
}
</style>
