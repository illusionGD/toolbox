<template>
  <ToolPageLayout
    title="Spine 预览"
    desc="拖入 atlas、png、json 素材，预览并播放 Spine 动画"
    category="媒体工具"
  >
    <template #toolbar>
      <n-space>
        <n-button type="primary" @click="triggerPick">
          <template #icon><n-icon :component="CloudUploadOutline" /></template>
          选择素材
        </n-button>
        <n-button quaternary :disabled="!loaded" @click="handleReset">
          <template #icon><n-icon :component="TrashOutline" /></template>
          清空
        </n-button>
        <input
          ref="fileInputRef"
          type="file"
          multiple
          accept=".atlas,.png,.json,.skel"
          class="spine__input"
          @change="handleInputChange"
        />
      </n-space>
    </template>

    <template #main>
      <div
        class="spine__stage"
        :class="{ 'spine__stage--drag': isDragOver }"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="handleDrop"
      >
        <div ref="containerRef" class="spine__canvas"></div>
        <div v-if="!loaded" class="spine__hint">
          <n-icon :size="40" :depth="3" :component="CloudUploadOutline" />
          <p>拖入 .atlas + .png + .json（或 .skel）</p>
          <p class="spine__hint-sub">需同一套 Spine 4.2 素材，png 可多张</p>
        </div>
      </div>
    </template>

    <template #panel>
      <h3 class="spine__panel-title">播放控制</h3>

      <div v-if="loaded">
        <div class="spine__field">
          <label class="spine__label">动画</label>
          <n-select
            :value="currentAnimation"
            :options="animationOptions"
            size="small"
            @update:value="play"
          />
        </div>

        <div class="spine__field spine__field--row">
          <label class="spine__label">循环播放</label>
          <n-switch :value="loop" size="small" @update:value="setLoop" />
        </div>

        <div class="spine__field spine__field--row">
          <label class="spine__label">显示包围盒</label>
          <n-switch :value="showBounds" size="small" @update:value="setShowBounds" />
        </div>

        <div class="spine__field">
          <label class="spine__label">播放速度 {{ speed.toFixed(2) }}x</label>
          <n-slider
            :value="speed"
            :min="0.1"
            :max="3"
            :step="0.1"
            :format-tooltip="(v: number) => `${v.toFixed(2)}x`"
            @update:value="setSpeed"
          />
        </div>

        <n-space>
          <n-button size="small" @click="togglePause">
            <template #icon>
              <n-icon :component="paused ? PlayOutline : PauseOutline" />
            </template>
            {{ paused ? '继续' : '暂停' }}
          </n-button>
          <n-button size="small" @click="replay">
            <template #icon><n-icon :component="RefreshOutline" /></template>
            重播
          </n-button>
        </n-space>
      </div>
      <p v-else class="spine__empty">导入素材后显示动画列表</p>

      <!-- 包围盒 / 骨架数据 -->
      <div v-if="showBounds && boundsInfo" class="spine__info">
        <label class="spine__label">getLocalBounds()</label>
        <div class="spine__info-grid">
          <span>x</span><span>{{ boundsInfo.bounds.x.toFixed(1) }}</span> <span>y</span
          ><span>{{ boundsInfo.bounds.y.toFixed(1) }}</span> <span>width</span
          ><span>{{ boundsInfo.bounds.width.toFixed(1) }}</span> <span>height</span
          ><span>{{ boundsInfo.bounds.height.toFixed(1) }}</span>
        </div>
        <label class="spine__label">skeleton.data</label>
        <div class="spine__info-grid">
          <span>name</span><span>{{ boundsInfo.skeleton.name ?? '—' }}</span> <span>size</span
          ><span>{{ boundsInfo.skeleton.width }} × {{ boundsInfo.skeleton.height }}</span>
          <span>offset</span><span>{{ boundsInfo.skeleton.x }}, {{ boundsInfo.skeleton.y }}</span>
          <span>fps</span><span>{{ boundsInfo.skeleton.fps }}</span>
        </div>
      </div>

      <!-- 已识别的素材清单 -->
      <div v-if="fileSummary.length" class="spine__files">
        <label class="spine__label">已加载文件</label>
        <div v-for="f in fileSummary" :key="f" class="spine__file-row">{{ f }}</div>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { NButton, NIcon, NSelect, NSlider, NSpace, NSwitch, useMessage } from 'naive-ui';
import {
  CloudUploadOutline,
  PauseOutline,
  PlayOutline,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useSpine, type SpineFiles } from '@/composables/useSpine';

// #region setup
const message = useMessage();
const {
  containerRef,
  animations,
  currentAnimation,
  loaded,
  paused,
  loop,
  speed,
  showBounds,
  boundsInfo,
  load,
  play,
  togglePause,
  setLoop,
  setSpeed,
  setShowBounds,
  dispose,
} = useSpine();

const fileInputRef = ref<HTMLInputElement | null>(null);
const fileSummary = ref<string[]>([]);
const isDragOver = ref(false);

const animationOptions = computed(() =>
  animations.value.map((name) => ({ label: name, value: name })),
);
// #endregion

// #region actions
/** 触发隐藏的文件选择框。 */
function triggerPick(): void {
  fileInputRef.value?.click();
}

/** 原生文件选择变更。 */
function handleInputChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) void loadFiles(Array.from(input.files));
  input.value = '';
}

/** 拖拽释放：直接取原生 File。 */
function handleDrop(e: DragEvent): void {
  isDragOver.value = false;
  const files = e.dataTransfer?.files;
  if (files?.length) void loadFiles(Array.from(files));
}

/**
 * 分类并加载一组 File（原生 File，含内容，无需经 IPC）。
 * @param files File 列表。
 */
async function loadFiles(files: File[]): Promise<void> {
  const spineFiles: SpineFiles = { atlas: null, skeleton: null, images: new Map() };
  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.atlas')) spineFiles.atlas = file;
    else if (lower.endsWith('.skel')) spineFiles.skeleton = file;
    else if (lower.endsWith('.json')) spineFiles.skeleton = file;
    else if (lower.endsWith('.png')) spineFiles.images.set(file.name, file);
  }

  if (!spineFiles.atlas) {
    message.error('未找到 .atlas 文件');
    return;
  }
  if (!spineFiles.skeleton) {
    message.error('未找到 .json 或 .skel 文件');
    return;
  }
  if (!spineFiles.images.size) {
    message.error('未找到 .png 贴图');
    return;
  }

  try {
    await load(spineFiles);
    fileSummary.value = [
      spineFiles.atlas.name,
      spineFiles.skeleton.name,
      ...spineFiles.images.keys(),
    ];
    message.success('加载成功');
  } catch (err) {
    message.error(err instanceof Error ? err.message : 'Spine 加载失败');
  }
}

/** 重播当前动画。 */
function replay(): void {
  if (currentAnimation.value) play(currentAnimation.value);
}

/** 清空重置。 */
function handleReset(): void {
  dispose();
  fileSummary.value = [];
}
// #endregion

onBeforeUnmount(() => dispose());
</script>

<style scoped lang="scss">
.spine {
  &__input {
    display: none;
  }

  &__stage {
    position: relative;
    flex: 1;
    min-height: 0;
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    background: var(--tb-bg-base);
    overflow: hidden;

    &--drag {
      border-color: var(--tb-color-primary);
      background: var(--tb-color-primary-soft);
    }
  }

  &__canvas {
    width: 100%;
    height: 100%;
  }

  &__hint {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    pointer-events: none;
  }

  &__hint-sub {
    font-size: 12px;
    opacity: 0.7;
  }

  &__panel-title {
    margin: 0 0 var(--tb-space-4);
    font-size: 15px;
    color: var(--tb-text-primary);
  }

  &__field {
    margin-bottom: var(--tb-space-3);

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

  &__empty {
    color: var(--tb-text-secondary);
    font-size: 13px;
  }

  &__info {
    margin-top: var(--tb-space-4);
  }

  &__info-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px var(--tb-space-3);
    margin-bottom: var(--tb-space-3);
    padding: var(--tb-space-2) var(--tb-space-3);
    font-family: var(--tb-font-mono, monospace);
    font-size: 12px;
    background: var(--tb-bg-base);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);

    span:nth-child(odd) {
      color: var(--tb-text-secondary);
    }

    span:nth-child(even) {
      color: var(--tb-text-primary);
      text-align: right;
    }
  }

  &__files {
    margin-top: var(--tb-space-5);
  }

  &__file-row {
    font-size: 12px;
    color: var(--tb-text-secondary);
    padding: 2px 0;
    word-break: break-all;
  }
}
</style>
