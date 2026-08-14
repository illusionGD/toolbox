<template>
  <div ref="containerRef" class="region-canvas">
    <div
      v-if="stage.width > 0"
      class="region-canvas__stage"
      :style="{ width: `${stage.width}px`, height: `${stage.height}px` }"
      @pointerdown="handleStagePointerDown"
    >
      <img :src="src" class="region-canvas__img" alt="区域预览" draggable="false" />

      <div
        v-for="(item, index) in displayRects"
        :key="index"
        class="region-canvas__rect"
        :class="{ 'region-canvas__rect--active': index === activeIndex }"
        :style="rectStyle(item)"
        @pointerdown.stop="(e: PointerEvent) => handleMovePointerDown(e, index)"
      >
        <span class="region-canvas__index">{{ index + 1 }}</span>
        <button
          type="button"
          class="region-canvas__remove"
          title="删除该区域"
          @pointerdown.stop
          @click.stop="removeAt(index)"
        >
          ✕
        </button>
        <span
          v-for="handle in HANDLES"
          :key="handle"
          class="region-canvas__handle"
          :class="`region-canvas__handle--${handle}`"
          @pointerdown.stop="(e: PointerEvent) => handleResizePointerDown(e, index, handle)"
        />
      </div>

      <p v-if="displayRects.length === 0" class="region-canvas__hint">
        在图片上拖拽以框选区域，可框选多个
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CropRect } from '@shared/types';

/**
 * 多区域框选画布（局部马赛克 / 模糊用）。
 *
 * 与 CropCanvas 的差异：这里是**多个**矩形、不遮挡画面（局部效果要看清区域外的原图，
 * 遮罩反而碍事），也没有宽高比约束。坐标约定沿用 CropCanvas：对外与内部**一律用
 * 图片原始像素**，只在渲染时乘 scale；存显示像素会在窗口缩放时累积舍入漂移。
 */

interface Props {
  /** 图片 data URL。 */
  src: string;
  /** 图片原始宽度 px。 */
  naturalWidth: number;
  /** 图片原始高度 px。 */
  naturalHeight: number;
  /** 区域列表（原始像素坐标）。 */
  modelValue: CropRect[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:modelValue': [value: CropRect[]];
}>();

/** 八个缩放手柄的方位。 */
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

/** 区域最小边长（原始像素）。 */
const MIN_SIZE = 8;

const containerRef = ref<HTMLElement | null>(null);
/** 容器可用尺寸，由 ResizeObserver 维护。 */
const box = ref({ width: 0, height: 0 });

/** 拖拽过程中的本地矩形，避免每帧都往父组件回传。 */
const local = ref<CropRect | null>(null);
/** 正在操作的区域下标；新建时为 modelValue.length（尚未落库）。 */
const activeIndex = ref(-1);

/** 图片按 contain 铺入容器后的实际显示尺寸与缩放比。 */
const stage = computed(() => {
  const { naturalWidth: nw, naturalHeight: nh } = props;
  if (!nw || !nh || !box.value.width || !box.value.height) {
    return { width: 0, height: 0, scale: 1 };
  }
  const scale = Math.min(box.value.width / nw, box.value.height / nh);
  return { width: nw * scale, height: nh * scale, scale };
});

/** 用于渲染的矩形列表：拖拽中的那个用本地值，新建的临时追加在末尾。 */
const displayRects = computed<CropRect[]>(() => {
  const list = [...props.modelValue];
  if (local.value) {
    if (activeIndex.value >= 0 && activeIndex.value < list.length) {
      list[activeIndex.value] = local.value;
    } else {
      list.push(local.value);
    }
  }
  return list;
});

/**
 * 把原始像素矩形换算成显示样式。
 * @param r 矩形（原始像素）。
 * @returns 内联样式。
 */
function rectStyle(r: CropRect): Record<string, string> {
  const s = stage.value.scale;
  return {
    left: `${r.left * s}px`,
    top: `${r.top * s}px`,
    width: `${r.width * s}px`,
    height: `${r.height * s}px`,
  };
}

/**
 * 把矩形钳制进图片边界：先限尺寸再平移，不改变已合法的宽高。
 * @param r 待钳制的矩形。
 * @returns 合法矩形。
 */
function clamp(r: CropRect): CropRect {
  const width = Math.min(Math.max(r.width, MIN_SIZE), props.naturalWidth);
  const height = Math.min(Math.max(r.height, MIN_SIZE), props.naturalHeight);
  return {
    width,
    height,
    left: Math.min(Math.max(r.left, 0), props.naturalWidth - width),
    top: Math.min(Math.max(r.top, 0), props.naturalHeight - height),
  };
}

/**
 * 取整矩形（主进程按整数像素做行拷贝，早点取整免得显示与结果对不上）。
 * @param r 矩形。
 * @returns 整数矩形。
 */
function round(r: CropRect): CropRect {
  return {
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  };
}

/**
 * 把鼠标事件换算成图片原始像素坐标。
 * @param event 指针事件。
 * @returns 原始像素坐标。
 */
function toImagePoint(event: PointerEvent): { x: number; y: number } {
  const stageEl = (event.currentTarget as HTMLElement).closest(
    '.region-canvas__stage',
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
  /** 起点（原始像素）。 */
  startX: number;
  startY: number;
  /** 按下时的矩形快照。 */
  origin: CropRect;
}
let drag: DragState | null = null;

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
  const normalized: CropRect = {
    left: Math.max(Math.min(left, right), 0),
    top: Math.max(Math.min(top, bottom), 0),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  };
  return clamp({
    ...normalized,
    width: Math.min(normalized.width, props.naturalWidth - normalized.left),
    height: Math.min(normalized.height, props.naturalHeight - normalized.top),
  });
}

/** 结束拖拽：把本地矩形写回列表。 */
function endDrag(): void {
  const creating = drag?.mode === 'create';
  drag = null;
  const r = local.value;
  local.value = null;
  if (!r) return;

  const list = [...props.modelValue];
  if (creating) {
    // 太小的拖拽当误触，不新增（否则点一下画面就多一个看不见的框）
    if (r.width < MIN_SIZE * 2 || r.height < MIN_SIZE * 2) {
      activeIndex.value = -1;
      return;
    }
    list.push(round(r));
    activeIndex.value = list.length - 1;
  } else if (activeIndex.value >= 0 && activeIndex.value < list.length) {
    list[activeIndex.value] = round(r);
  }
  emit('update:modelValue', list);
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
  // create：以按下点为锚向任意方向拉，等价于从零宽高矩形拖东南角
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
 * 在空白处按下：新增一个区域（不是覆盖已有的）。
 * @param event 指针事件。
 */
function handleStagePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  drag = { mode: 'create', startX: x, startY: y, origin: { left: x, top: y, width: 0, height: 0 } };
  activeIndex.value = props.modelValue.length;
  local.value = null;
  capture(event);
}

/**
 * 在区域内按下：整体移动。
 * @param event 指针事件。
 * @param index 区域下标。
 */
function handleMovePointerDown(event: PointerEvent, index: number): void {
  const target = props.modelValue[index];
  if (event.button !== 0 || !target) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  activeIndex.value = index;
  drag = { mode: 'move', startX: x, startY: y, origin: { ...target } };
  capture(event);
}

/**
 * 在手柄上按下：缩放。
 * @param event 指针事件。
 * @param index 区域下标。
 * @param handle 手柄方位。
 */
function handleResizePointerDown(event: PointerEvent, index: number, handle: Handle): void {
  const target = props.modelValue[index];
  if (event.button !== 0 || !target) return;
  event.preventDefault();
  const { x, y } = toImagePoint(event);
  activeIndex.value = index;
  drag = { mode: 'resize', handle, startX: x, startY: y, origin: { ...target } };
  capture(event);
}

/**
 * 删除指定区域。
 * @param index 区域下标。
 */
function removeAt(index: number): void {
  const list = props.modelValue.filter((_, i) => i !== index);
  activeIndex.value = -1;
  emit('update:modelValue', list);
}

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
.region-canvas {
  display: flex;
  align-items: center;
  justify-content: center;
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

  &__rect {
    position: absolute;
    cursor: move;
    // 不做遮罩：局部效果需要同时看清区域内外，遮住反而看不出差别
    border: 1px solid var(--tb-color-primary);
    background: rgb(124 92 255 / 18%);

    &--active {
      background: rgb(124 92 255 / 28%);
      box-shadow: 0 0 0 1px var(--tb-color-primary);
    }
  }

  &__index {
    position: absolute;
    top: 2px;
    left: 4px;
    font-size: 11px;
    line-height: 1;
    color: #fff;
    pointer-events: none;
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
  }

  &__remove {
    position: absolute;
    top: -9px;
    right: -9px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    font-size: 11px;
    line-height: 1;
    color: #fff;
    cursor: pointer;
    background: rgb(0 0 0 / 70%);
    border: 1px solid var(--tb-color-primary);
    border-radius: 50%;

    &:hover {
      background: var(--tb-color-primary);
    }
  }

  &__handle {
    position: absolute;
    width: 8px;
    height: 8px;
    background: var(--tb-color-primary);
    border-radius: 2px;

    &--nw {
      top: -4px;
      left: -4px;
      cursor: nwse-resize;
    }

    &--n {
      top: -4px;
      left: calc(50% - 4px);
      cursor: ns-resize;
    }

    &--ne {
      top: -4px;
      right: -4px;
      cursor: nesw-resize;
    }

    &--e {
      top: calc(50% - 4px);
      right: -4px;
      cursor: ew-resize;
    }

    &--se {
      right: -4px;
      bottom: -4px;
      cursor: nwse-resize;
    }

    &--s {
      bottom: -4px;
      left: calc(50% - 4px);
      cursor: ns-resize;
    }

    &--sw {
      bottom: -4px;
      left: -4px;
      cursor: nesw-resize;
    }

    &--w {
      top: calc(50% - 4px);
      left: -4px;
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
}
</style>
