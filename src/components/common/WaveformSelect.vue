<template>
  <div class="waveform">
    <div
      ref="stripRef"
      class="waveform__strip"
      :class="{ 'waveform__strip--stacked': frames.length > 0 }"
      @pointerdown="handleStripPointerDown"
    >
      <!-- 缩略图胶片条：视频剪切用，等宽平铺，未取到的格子留底色不显示破图 -->
      <div v-if="frames.length" class="waveform__frames">
        <span
          v-for="(frame, index) in frames"
          :key="index"
          class="waveform__frame"
          :style="frame ? { backgroundImage: `url(${frame})` } : undefined"
        />
      </div>

      <div v-if="src || !frames.length" class="waveform__wave">
        <img v-if="src" :src="src" class="waveform__img" alt="波形" draggable="false" />
        <!-- 有胶片条却没波形图时不显示这句：那是无音轨的视频，说「生成中」是谎报，
             由页面在别处说明 -->
        <div v-else class="waveform__ph">波形生成中…</div>
      </div>

      <!-- 分段标记：按静音分割 / 平均分段产出的候选段，点一下可启用/停用 -->
      <div
        v-for="(seg, index) in segments"
        :key="index"
        class="waveform__seg"
        :class="{ 'waveform__seg--off': !seg.enabled }"
        :style="bandStyle(seg)"
        :title="`第 ${index + 1} 段 ${format(seg.start)} → ${format(seg.end)}（点击${seg.enabled ? '排除' : '加入'}）`"
        @pointerdown.stop
        @click="emit('toggleSegment', index)"
      >
        <span class="waveform__seg-index">{{ index + 1 }}</span>
      </div>

      <!-- 手动选区 -->
      <div
        v-if="display"
        class="waveform__sel"
        :style="bandStyle(display)"
        @pointerdown.stop="handleMovePointerDown"
      >
        <span
          class="waveform__handle waveform__handle--l"
          @pointerdown.stop="(e: PointerEvent) => handleResizePointerDown(e, 'start')"
        />
        <span
          class="waveform__handle waveform__handle--r"
          @pointerdown.stop="(e: PointerEvent) => handleResizePointerDown(e, 'end')"
        />
      </div>

      <!-- 播放头 -->
      <div v-if="playhead > 0" class="waveform__playhead" :style="{ left: pct(playhead) }" />

      <p v-if="!display && !segments.length" class="waveform__hint">在波形上拖拽以选取区间</p>
    </div>

    <div class="waveform__ruler">
      <span v-for="tick in TICKS" :key="tick">{{ format(duration * tick) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SilenceRange } from '@shared/types';

/**
 * 波形区间选择条。
 *
 * 与 CropCanvas / RegionCanvas 的坐标约定**同源但单位不同**：那两个存图片原始像素、
 * 渲染时乘 scale；这里存**秒**、渲染时换成百分比。原因是波形图不是「有原始尺寸的
 * 图片」——它由 ffmpeg 按任意宽度现画再横向拉满容器，没有一个「原始像素」可锚定，
 * 百分比才是唯一不会随容器宽度漂移的表示。
 *
 * 传了 `frames` 就变成「胶片条 + 波形」上下两层的视频时间轴。选区、候选段、播放头
 * 都是 `top:0;bottom:0`，**自然跨满两层**，拖拽那套逻辑一行都不用改——这也正是不
 * 另写一个视频时间轴组件的原因：重写只会有两份要同步的拖拽代码。
 */

/** 一个带启用标记的候选片段。 */
export interface WaveformSegment extends SilenceRange {
  /** 是否参与导出。 */
  enabled: boolean;
}

interface Props {
  /** 波形图 data URL；为空时显示占位（`frames` 非空时不显示占位）。 */
  src: string;
  /** 音频总时长秒。 */
  duration: number;
  /** 手动选区（秒）；null 表示没有选区。 */
  modelValue: SilenceRange | null;
  /** 候选片段标记（只读展示 + 点击切换）。 */
  segments?: WaveformSegment[];
  /** 播放头位置秒；0 表示不显示。 */
  playhead?: number;
  /**
   * 等时间间隔的缩略图 data URL 列表（视频时间轴用）。
   *
   * 允许含空串占位：抽帧是逐帧异步回来的，先摆好格子再逐个填，条的宽度不会跳。
   */
  frames?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  segments: () => [],
  playhead: 0,
  frames: () => [],
});

const emit = defineEmits<{
  'update:modelValue': [value: SilenceRange | null];
  /** 点击（非拖拽）波形：请求跳转到该时间点。 */
  seek: [seconds: number];
  /** 点击某个候选片段：请求切换其启用状态。 */
  toggleSegment: [index: number];
}>();

/** 刻度位置（占总时长的比例）。 */
const TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

/** 选区最短时长秒：比这更短的选区没有意义，且 ffmpeg 会出零长文件。 */
const MIN_DURATION = 0.05;

/** 判定「这是一次点击而非拖拽」的位移阈值 px。 */
const CLICK_SLOP = 3;

const stripRef = ref<HTMLElement | null>(null);

/** 拖拽中的本地选区，避免每帧都往父组件回传。 */
const local = ref<SilenceRange | null>(null);

/** 实际渲染的选区：拖拽中优先用本地值。 */
const display = computed(() => local.value ?? props.modelValue);

/**
 * 秒 → 百分比字符串。
 * @param seconds 秒。
 * @returns CSS 百分比。
 */
function pct(seconds: number): string {
  if (props.duration <= 0) return '0%';
  return `${Math.min(100, Math.max(0, (seconds / props.duration) * 100))}%`;
}

/**
 * 区间 → 定位样式。
 * @param range 区间（秒）。
 * @returns 内联样式。
 */
function bandStyle(range: SilenceRange): Record<string, string> {
  return { left: pct(range.start), width: pct(range.end - range.start) };
}

/**
 * 把秒数格式化为 `m:ss.s`。
 * @param seconds 秒。
 * @returns 时间文本。
 */
function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/**
 * 指针位置 → 秒（钳进 [0, duration]）。
 * @param event 指针事件。
 * @returns 秒。
 */
function toSeconds(event: PointerEvent): number {
  const el = stripRef.value;
  if (!el || props.duration <= 0) return 0;
  const bounds = el.getBoundingClientRect();
  if (bounds.width <= 0) return 0;
  const ratio = (event.clientX - bounds.left) / bounds.width;
  return Math.min(props.duration, Math.max(0, ratio * props.duration));
}

/** 毫秒级取整：剪切精度本来就到毫秒，早点取整免得面板里显示一长串小数。 */
function roundMs(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}

/**
 * 钳制区间：保证有序、不短于最小时长、不越界。
 * @param range 待钳制的区间。
 * @returns 合法区间。
 */
function clamp(range: SilenceRange): SilenceRange {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  return {
    start: roundMs(Math.max(0, Math.min(start, props.duration - MIN_DURATION))),
    end: roundMs(Math.min(props.duration, Math.max(end, start + MIN_DURATION))),
  };
}

/** 一次拖拽的上下文。 */
interface DragState {
  mode: 'create' | 'move' | 'resize';
  edge?: 'start' | 'end';
  /** 按下点（秒）与按下时的屏幕横坐标（用于区分点击与拖拽）。 */
  anchor: number;
  clientX: number;
  /** 按下时的选区快照。 */
  origin: SilenceRange;
  /** 是否已经动过（超过 CLICK_SLOP）。 */
  moved: boolean;
}
let drag: DragState | null = null;

/**
 * 拖拽中：按模式更新本地选区。
 * @param event 指针事件。
 */
function handlePointerMove(event: PointerEvent): void {
  if (!drag) return;
  if (Math.abs(event.clientX - drag.clientX) > CLICK_SLOP) drag.moved = true;
  const seconds = toSeconds(event);

  if (drag.mode === 'move') {
    const span = drag.origin.end - drag.origin.start;
    // 整体平移：先按位移算起点，再钳进边界，保持长度不变
    const start = Math.min(
      Math.max(0, drag.origin.start + (seconds - drag.anchor)),
      props.duration - span,
    );
    local.value = { start: roundMs(start), end: roundMs(start + span) };
    return;
  }
  if (drag.mode === 'resize') {
    local.value = clamp(
      drag.edge === 'start'
        ? { start: seconds, end: drag.origin.end }
        : { start: drag.origin.start, end: seconds },
    );
    return;
  }
  local.value = clamp({ start: drag.anchor, end: seconds });
}

/** 结束拖拽：把本地选区写回父组件；没动过则视为点击 → 跳播。 */
function endDrag(): void {
  const state = drag;
  drag = null;
  const value = local.value;
  local.value = null;
  if (!state) return;

  if (!state.moved) {
    // 只是点了一下：新建模式下不该凭空多一个看不见的选区，改成跳播
    if (state.mode === 'create') emit('seek', roundMs(state.anchor));
    return;
  }
  if (value) emit('update:modelValue', value);
}

/**
 * 接管本次指针直到抬起。
 * @param event 指针事件。
 */
function capture(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement;
  // setPointerCapture 后拖出窗口也不丢事件，比往 window 挂 mousemove 干净
  el.setPointerCapture(event.pointerId);
  el.addEventListener('pointermove', handlePointerMove);
  el.addEventListener(
    'pointerup',
    () => {
      el.removeEventListener('pointermove', handlePointerMove);
      endDrag();
    },
    { once: true },
  );
}

/**
 * 在波形空白处按下：拖拽=新建选区，单击=跳播。
 * @param event 指针事件。
 */
function handleStripPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || props.duration <= 0) return;
  event.preventDefault();
  const anchor = toSeconds(event);
  drag = {
    mode: 'create',
    anchor,
    clientX: event.clientX,
    origin: { start: anchor, end: anchor },
    moved: false,
  };
  capture(event);
}

/**
 * 在选区内按下：整体平移。
 * @param event 指针事件。
 */
function handleMovePointerDown(event: PointerEvent): void {
  const current = props.modelValue;
  if (event.button !== 0 || !current) return;
  event.preventDefault();
  drag = {
    mode: 'move',
    anchor: toSeconds(event),
    clientX: event.clientX,
    origin: { ...current },
    moved: false,
  };
  capture(event);
}

/**
 * 在边缘手柄上按下：拉伸该侧。
 * @param event 指针事件。
 * @param edge 哪一侧。
 */
function handleResizePointerDown(event: PointerEvent, edge: 'start' | 'end'): void {
  const current = props.modelValue;
  if (event.button !== 0 || !current) return;
  event.preventDefault();
  drag = {
    mode: 'resize',
    edge,
    anchor: toSeconds(event),
    clientX: event.clientX,
    origin: { ...current },
    // 手柄很窄，用户按上去就是要拉，不必再判 slop
    moved: true,
  };
  capture(event);
}
</script>

<style scoped lang="scss">
.waveform {
  &__strip {
    position: relative;
    height: 96px;
    overflow: hidden;
    cursor: crosshair;
    background: var(--tb-bg-hover);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
    touch-action: none;
    user-select: none;

    // 胶片条模式：高度改由内容决定（胶片行 + 波形行上下叠）
    &--stacked {
      height: auto;
    }
  }

  &__frames {
    display: flex;
    height: 54px;
  }

  &__frame {
    flex: 1 1 0;
    // 不给 min-width:0 的话 flex 项会被内容撑开，最后几格挤出容器
    min-width: 0;
    background-position: center;
    background-size: cover;
    border-right: 1px solid var(--tb-bg-base);

    &:last-child {
      border-right: none;
    }
  }

  // 与胶片条同在时波形矮一些；单独出现时仍占满 96px 的条高
  &__wave {
    position: relative;
    height: 100%;

    .waveform__strip--stacked & {
      height: 48px;
      border-top: 1px solid var(--tb-border);
    }
  }

  &__img {
    display: block;
    width: 100%;
    height: 100%;
    // 波形图按容器宽度横向拉满：时间轴与容器一一对应，选区才能用百分比定位
    object-fit: fill;
    pointer-events: none;
  }

  &__ph,
  &__hint {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
    pointer-events: none;
  }

  &__seg {
    position: absolute;
    top: 0;
    bottom: 0;
    cursor: pointer;
    // 候选段用中性灰、只有手动选区用主色：主色是「你正在操作的这一个」的标记
    background: rgb(255 255 255 / 6%);
    border-inline: 1px solid var(--tb-border-strong);

    &--off {
      // 停用的段只留描边：既看得见它还在，也一眼看出不会被导出
      background: transparent;
      border-inline-style: dashed;
      opacity: 0.5;
    }
  }

  &__seg-index {
    position: absolute;
    top: 2px;
    left: 3px;
    font-size: 10px;
    color: var(--tb-text-secondary);
  }

  &__sel {
    position: absolute;
    top: 0;
    bottom: 0;
    cursor: move;
    background: var(--tb-color-primary-soft);
    border-inline: 2px solid var(--tb-color-primary);
  }

  &__handle {
    position: absolute;
    top: 0;
    bottom: 0;
    // 手柄比视觉宽度更宽，光标不必对得那么准
    width: 10px;
    cursor: ew-resize;

    &--l {
      left: -6px;
    }

    &--r {
      right: -6px;
    }
  }

  &__playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--tb-text-primary);
    pointer-events: none;
  }

  &__ruler {
    display: flex;
    justify-content: space-between;
    margin-top: var(--tb-space-1);
    font-size: 11px;
    color: var(--tb-text-secondary);
  }
}
</style>
