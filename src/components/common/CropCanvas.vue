<template>
  <div ref="containerRef" class="crop-canvas">
    <div
      v-if="stage.width > 0"
      class="crop-canvas__stage"
      :style="{ width: `${stage.width}px`, height: `${stage.height}px` }"
      @pointerdown="handleStagePointerDown"
    >
      <slot name="media">
        <img :src="src" class="crop-canvas__img" alt="裁剪预览" draggable="false" />
      </slot>

      <div
        v-if="rect"
        class="crop-canvas__sel"
        :style="selStyle"
        @pointerdown.stop="handleMovePointerDown"
      >
        <span class="crop-canvas__grid" />
        <span
          v-for="handle in HANDLES"
          :key="handle"
          class="crop-canvas__handle"
          :class="`crop-canvas__handle--${handle}`"
          @pointerdown.stop="(e: PointerEvent) => handleResizePointerDown(e, handle)"
        />
      </div>

      <p v-else class="crop-canvas__hint">{{ hint }}</p>
    </div>

    <p v-if="rect" class="crop-canvas__readout">
      {{ Math.round(rect.width) }} × {{ Math.round(rect.height) }} px @ ({{
        Math.round(rect.left)
      }}, {{ Math.round(rect.top) }})
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CropRect } from '@shared/types';
import { snapCropEven } from '@shared/video';

/**
 * 交互式裁剪画布。
 *
 * 坐标约定：对外与内部**一律使用图片原始像素**，只在渲染时乘 `scale` 换成显示像素。
 * 反过来（存显示像素、用时换算回去）会在窗口缩放时累积舍入漂移，框会越拖越偏。
 *
 * 被裁的东西由 `media` 插槽决定：默认是 `<img :src>`（图片裁剪 / 风格化页），
 * 视频剪切页往里塞 `<video>`，于是能**边播边在动画面上拖框**、不必抽静帧。
 */

interface Props {
  /** 图片 data URL。用 `media` 插槽自带内容时可留空。 */
  src?: string;
  /** 图片原始宽度 px。 */
  naturalWidth: number;
  /** 图片原始高度 px。 */
  naturalHeight: number;
  /** 裁剪框（原始像素坐标）；未框选为 null。 */
  modelValue: CropRect | null;
  /** 宽高比约束（宽 / 高）；自由裁剪为 null。 */
  aspect?: number | null;
  /** 裁剪框最小边长（原始像素）。 */
  minSize?: number;
  /**
   * 是否把提交出去的矩形偶数对齐。
   *
   * 视频要开：yuv420p 要求偶数宽高，ffmpeg 会**静默**把奇数值下调，不对齐就会
   * 出现「面板写 641、产物是 640」（见 shared/video.ts）。图片走 sharp extract，
   * 任意整数都精确，不必对齐。
   */
  snapEven?: boolean;
  /** 未框选时的提示文案。 */
  hint?: string;
}

const props = withDefaults(defineProps<Props>(), {
  src: '',
  aspect: null,
  minSize: 4,
  snapEven: false,
  hint: '在图片上拖拽以框选裁剪区域',
});

const emit = defineEmits<{
  'update:modelValue': [value: CropRect | null];
}>();

/** 八个缩放手柄的方位。 */
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

const containerRef = ref<HTMLElement | null>(null);
/** 容器可用尺寸，由 ResizeObserver 维护。 */
const box = ref({ width: 0, height: 0 });

/** 拖拽过程中的本地矩形，避免每帧都往父组件回传。 */
const local = ref<CropRect | null>(null);

/** 当前生效的矩形：拖拽中用本地值，否则用 v-model。 */
const rect = computed(() => local.value ?? props.modelValue);

/** 图片按 contain 铺入容器后的实际显示尺寸与缩放比。 */
const stage = computed(() => {
  const { naturalWidth: nw, naturalHeight: nh } = props;
  if (!nw || !nh || !box.value.width || !box.value.height) {
    return { width: 0, height: 0, scale: 1 };
  }
  const scale = Math.min(box.value.width / nw, box.value.height / nh);
  return { width: nw * scale, height: nh * scale, scale };
});

const selStyle = computed(() => {
  const r = rect.value;
  if (!r) return {};
  const s = stage.value.scale;
  return {
    left: `${r.left * s}px`,
    top: `${r.top * s}px`,
    width: `${r.width * s}px`,
    height: `${r.height * s}px`,
  };
});

/**
 * 把矩形钳制进图片边界：先限尺寸再平移，不改变已合法的宽高。
 * @param r 待钳制的矩形。
 * @returns 合法矩形。
 */
function clamp(r: CropRect): CropRect {
  const width = Math.min(Math.max(r.width, props.minSize), props.naturalWidth);
  const height = Math.min(Math.max(r.height, props.minSize), props.naturalHeight);
  return {
    width,
    height,
    left: Math.min(Math.max(r.left, 0), props.naturalWidth - width),
    top: Math.min(Math.max(r.top, 0), props.naturalHeight - height),
  };
}

/**
 * 把鼠标事件换算成图片原始像素坐标。
 * @param event 指针事件。
 * @returns 原始像素坐标。
 */
function toImagePoint(event: PointerEvent): { x: number; y: number } {
  const stageEl = (event.currentTarget as HTMLElement).closest(
    '.crop-canvas__stage',
  ) as HTMLElement | null;
  if (!stageEl) return { x: 0, y: 0 };
  const bounds = stageEl.getBoundingClientRect();
  const s = stage.value.scale || 1;
  return { x: (event.clientX - bounds.left) / s, y: (event.clientY - bounds.top) / s };
}

/** 一次拖拽的上下文。 */
interface DragState {
  mode: 'create' | 'move' | 'resize';
  handle?: Handle;
  /** 起点（原始像素）。create 模式下同时是锚点。 */
  startX: number;
  startY: number;
  /** 按下时的矩形快照。 */
  origin: CropRect;
}
let drag: DragState | null = null;

/**
 * 按宽高比修正矩形，锚定不动的那条边/角。
 * @param r 自由拖拽得到的矩形。
 * @param aspect 宽高比。
 * @param handle 正在拖的手柄；create 模式传 'se'。
 * @param origin 按下时的矩形（边手柄需要它的中心线）。
 * @returns 符合比例的矩形。
 */
function applyAspect(r: CropRect, aspect: number, handle: Handle, origin: CropRect): CropRect {
  const horizontal = handle === 'e' || handle === 'w';
  const vertical = handle === 'n' || handle === 's';

  let width = r.width;
  let height = r.height;
  if (horizontal) height = width / aspect;
  else if (vertical) width = height * aspect;
  // 角手柄取变化更大的那一维，跟手感更自然
  else if (width / aspect >= height) height = width / aspect;
  else width = height * aspect;

  // 拖西/北边时右/下边不动，反之左/上边不动
  let left = handle.includes('w') ? r.left + r.width - width : r.left;
  let top = handle.includes('n') ? r.top + r.height - height : r.top;
  // 纯水平/垂直手柄没有对角锚点，改为绕原中心线展开
  if (horizontal) top = origin.top + origin.height / 2 - height / 2;
  if (vertical) left = origin.left + origin.width / 2 - width / 2;

  return { left, top, width, height };
}

/**
 * 由手柄拖拽计算新矩形。
 * @param origin 按下时的矩形。
 * @param handle 手柄方位。
 * @param dx 水平位移（原始像素）。
 * @param dy 垂直位移（原始像素）。
 * @returns 新矩形。
 */
function resizeRect(origin: CropRect, handle: Handle, dx: number, dy: number): CropRect {
  let left = origin.left;
  let top = origin.top;
  let right = origin.left + origin.width;
  let bottom = origin.top + origin.height;

  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  // 拖过头会让边翻转，先归一化再算宽高
  let r: CropRect = {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };

  // 先钳进画布再套比例：反过来的话钳制会破坏刚算好的比例
  r = {
    left: Math.max(r.left, 0),
    top: Math.max(r.top, 0),
    width: Math.min(r.width, props.naturalWidth - Math.max(r.left, 0)),
    height: Math.min(r.height, props.naturalHeight - Math.max(r.top, 0)),
  };
  if (props.aspect) r = applyAspect(r, props.aspect, handle, origin);

  return clamp(r);
}

/**
 * 提交矩形给父组件。
 *
 * 取整在这里做而不是拖拽途中：主进程 extract / ffmpeg crop 只接受整数，早点取整
 * 免得列表与实际结果对不上。`snapEven` 时再向下对齐到偶数——**对齐放在提交这一步**，
 * 于是 v-model 里存的、面板上显示的、下发给 ffmpeg 的是同一个值，不会互相打脸。
 * 代价是开了比例约束时对齐可能让比例差出 1–2 px，这比读数不实要好。
 * @param r 待提交的矩形。
 */
function commit(r: CropRect): void {
  const rounded: CropRect = {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
  emit('update:modelValue', props.snapEven ? snapCropEven(rounded) : rounded);
}

/** 结束拖拽：把本地矩形提交给父组件。 */
function endDrag(): void {
  if (!drag) return;
  drag = null;
  if (!local.value) return;
  commit(local.value);
  local.value = null;
}

/**
 * 拖拽中：按模式更新本地矩形。
 * @param event 指针事件。
 */
function handlePointerMove(event: PointerEvent): void {
  if (!drag) return;
  const { x, y } = toImagePoint(event);
  const dx = x - drag.startX;
  const dy = y - drag.startY;

  if (drag.mode === 'move') {
    local.value = clamp({ ...drag.origin, left: drag.origin.left + dx, top: drag.origin.top + dy });
    return;
  }
  if (drag.mode === 'resize' && drag.handle) {
    local.value = resizeRect(drag.origin, drag.handle, dx, dy);
    return;
  }
  // create：以按下点为锚，向任意方向拉；等价于从 origin 的东南角拖
  local.value = resizeRect(
    { left: drag.startX, top: drag.startY, width: 0, height: 0 },
    'se',
    dx,
    dy,
  );
}

/**
 * 在元素上接管本次指针，直到抬起。
 * @param event 指针事件。
 */
function capture(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement;
  // setPointerCapture 后事件仍派发到该元素，拖出窗口也不丢，比往 window 挂 mousemove 干净
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
 * 在空白处按下：新建裁剪框。
 * @param event 指针事件。
 */
function handleStagePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  drag = {
    mode: 'create',
    startX: x,
    startY: y,
    origin: { left: x, top: y, width: 0, height: 0 },
  };
  local.value = null;
  capture(event);
}

/**
 * 在选区内按下：整体移动。
 * @param event 指针事件。
 */
function handleMovePointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !rect.value) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  drag = { mode: 'move', startX: x, startY: y, origin: { ...rect.value } };
  capture(event);
}

/**
 * 在手柄上按下：缩放。
 * @param event 指针事件。
 * @param handle 手柄方位。
 */
function handleResizePointerDown(event: PointerEvent, handle: Handle): void {
  if (event.button !== 0 || !rect.value) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  drag = { mode: 'resize', handle, startX: x, startY: y, origin: { ...rect.value } };
  capture(event);
}

// 比例切换后，把已有框就地修成新比例，而不是让用户重新拉一遍
watch(
  () => props.aspect,
  (aspect) => {
    if (!aspect || !props.modelValue) return;
    const r = props.modelValue;
    commit(clamp(applyAspect(r, aspect, 'se', r)));
  },
);

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!containerRef.value) return;
  observer = new ResizeObserver(([entry]) => {
    box.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  observer.observe(containerRef.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style scoped lang="scss">
.crop-canvas {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--tb-space-2);
  width: 100%;
  height: 100%;

  &__stage {
    position: relative;
    flex: none;
    user-select: none;
    touch-action: none;
    cursor: crosshair;
    // 透明图的棋盘底，方便看清透明边界
    background:
      linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
      linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
    background-color: #1e1e1e;
    background-size: 16px 16px;
    background-position:
      0 0,
      0 8px,
      8px -8px,
      -8px 0;
  }

  &__img {
    display: block;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  &__sel {
    position: absolute;
    cursor: move;
    border: 1px solid var(--tb-color-primary);
    // 用超大外扩阴影当遮罩，比拼四块 div 省事且不会有缝
    box-shadow: 0 0 0 9999px rgb(0 0 0 / 55%);
  }

  &__grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgb(255 255 255 / 25%) 1px, transparent 1px),
      linear-gradient(to bottom, rgb(255 255 255 / 25%) 1px, transparent 1px);
    background-size: 33.33% 33.33%;
  }

  &__handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--tb-color-primary);
    border-radius: 2px;

    &--nw {
      top: -5px;
      left: -5px;
      cursor: nwse-resize;
    }

    &--n {
      top: -5px;
      left: calc(50% - 5px);
      cursor: ns-resize;
    }

    &--ne {
      top: -5px;
      right: -5px;
      cursor: nesw-resize;
    }

    &--e {
      top: calc(50% - 5px);
      right: -5px;
      cursor: ew-resize;
    }

    &--se {
      right: -5px;
      bottom: -5px;
      cursor: nwse-resize;
    }

    &--s {
      bottom: -5px;
      left: calc(50% - 5px);
      cursor: ns-resize;
    }

    &--sw {
      bottom: -5px;
      left: -5px;
      cursor: nesw-resize;
    }

    &--w {
      top: calc(50% - 5px);
      left: -5px;
      cursor: ew-resize;
    }
  }

  &__hint {
    position: absolute;
    inset: auto 0 var(--tb-space-3);
    margin: 0;
    font-size: 12px;
    text-align: center;
    color: var(--tb-text-secondary);
    pointer-events: none;
  }

  &__readout {
    margin: 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
    font-variant-numeric: tabular-nums;
  }
}
</style>
