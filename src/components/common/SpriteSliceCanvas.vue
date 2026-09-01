<template>
  <div ref="containerRef" class="slice-canvas">
    <div
      v-if="stage.width > 0"
      ref="stageRef"
      class="slice-canvas__stage"
      :style="{ width: `${stage.width}px`, height: `${stage.height}px` }"
      @dblclick="handleDblClick"
    >
      <img :src="src" class="slice-canvas__img" alt="精灵表" draggable="false" />
      <canvas
        ref="canvasRef"
        class="slice-canvas__overlay"
        :width="stage.width"
        :height="stage.height"
      />

      <!-- 手动切割线：可拖，双击删除 -->
      <template v-if="editable">
        <div
          v-for="(x, i) in displayColumns"
          :key="`c${i}`"
          class="slice-canvas__vline"
          :class="{ 'slice-canvas__vline--active': drag?.kind === 'col' && drag.index === i }"
          :style="{ left: `${x * stage.scale}px` }"
          @pointerdown.stop="(e: PointerEvent) => startDragLine(e, 'col', i)"
          @dblclick.stop="removeLine('col', i)"
        />
        <div
          v-for="(y, i) in displayRows"
          :key="`r${i}`"
          class="slice-canvas__hline"
          :class="{ 'slice-canvas__hline--active': drag?.kind === 'row' && drag.index === i }"
          :style="{ top: `${y * stage.scale}px` }"
          @pointerdown.stop="(e: PointerEvent) => startDragLine(e, 'row', i)"
          @dblclick.stop="removeLine('row', i)"
        />
      </template>

      <p v-if="editable" class="slice-canvas__hint">双击画面加十字切割线，拖动线调整，双击线删除</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SpriteCell } from '@shared/types';

/**
 * 精灵表切割画布。
 *
 * 与 CropCanvas/RegionCanvas 不同，切割要同时画**几百个** cell 框，用 DOM div 逐个
 * 渲染会卡；故 cell 框走真实 `<canvas>` 一次性绘制。手动切割线数量少、需要拖，
 * 用 DOM 元素叠在上面。坐标约定沿用两个 canvas 组件：对外一律**图片原始像素**，
 * 只在渲染时乘 scale。
 */

interface Props {
  /** 精灵表图片 URL。 */
  src: string;
  /** 表原始宽度 px。 */
  naturalWidth: number;
  /** 表原始高度 px。 */
  naturalHeight: number;
  /** 要画出的切割单元（父组件按当前方式探测得到）。 */
  cells: SpriteCell[];
  /** 手动切割线的纵向 x 坐标（method=lines 时用，v-model）。 */
  columns: number[];
  /** 手动切割线的横向 y 坐标。 */
  rows: number[];
  /** 是否允许编辑切割线（仅 method=lines）。 */
  editable: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:columns': [value: number[]];
  'update:rows': [value: number[]];
}>();

const containerRef = ref<HTMLElement | null>(null);
const stageRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const box = ref({ width: 0, height: 0 });

/** 正在拖拽的切割线：拖动中只更新本地 `value`，不逐帧 emit（见 startDragLine）。 */
const drag = ref<{ kind: 'col' | 'row'; index: number; value: number } | null>(null);

/** 渲染用的纵线：拖动中的那条用本地值，其余用 props。 */
const displayColumns = computed(() => {
  const d = drag.value;
  if (d?.kind !== 'col') return props.columns;
  return props.columns.map((v, i) => (i === d.index ? d.value : v));
});

/** 渲染用的横线：同 displayColumns。 */
const displayRows = computed(() => {
  const d = drag.value;
  if (d?.kind !== 'row') return props.rows;
  return props.rows.map((v, i) => (i === d.index ? d.value : v));
});

/**
 * 渲染用的 cell 框。
 *
 * **手动切割线模式（editable）一律按本地线位置就地算**，不用父组件的 `props.cells`：
 * 父组件是防抖后才重探测的，若依赖它，拖完松手到新结果回来之间（约 300ms）画的还是
 * 旧线位置的 cell 边界，看起来就是「线放下了、原位置还留着一条线」。本地算则零延迟、
 * 无残影。其余方式（grid/auto/import）用父组件探测好的 props.cells。
 */
const displayCells = computed<SpriteCell[]>(() => {
  if (!props.editable) return props.cells;
  const xs = [...new Set([0, ...displayColumns.value, props.naturalWidth])].sort((a, b) => a - b);
  const ys = [...new Set([0, ...displayRows.value, props.naturalHeight])].sort((a, b) => a - b);
  const list: SpriteCell[] = [];
  let n = 0;
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      const w = xs[c + 1] - xs[c];
      const h = ys[r + 1] - ys[r];
      if (w < 1 || h < 1) continue;
      list.push({ rect: { left: xs[c], top: ys[r], width: w, height: h }, name: `s${n++}` });
    }
  }
  return list;
});

/** 图片按 contain 铺入容器后的显示尺寸与缩放比。 */
const stage = computed(() => {
  const { naturalWidth: nw, naturalHeight: nh } = props;
  if (!nw || !nh || !box.value.width || !box.value.height) {
    return { width: 0, height: 0, scale: 1 };
  }
  const scale = Math.min(box.value.width / nw, box.value.height / nh);
  return { width: nw * scale, height: nh * scale, scale };
});

/** 在 canvas 上重绘所有 cell 框。 */
function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const s = stage.value.scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // cell 多时（网格几百格）标号会糊成一团，只在数量适中时画序号
  const list = displayCells.value;
  const withIndex = list.length <= 80;

  list.forEach((cell, i) => {
    const { left, top, width, height } = cell.rect;
    const x = left * s;
    const y = top * s;
    const w = width * s;
    const h = height * s;

    // 两趟描边：先暗色垫底再亮色主线，保证在亮/暗/花底上都看得清包围盒
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(124,92,255,1)';
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);

    if (!withIndex) return;
    // 左上角序号：暗底 + 白字，不遮挡精灵主体
    const label = String(i + 1);
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(124,92,255,0.92)';
    ctx.fillRect(x, y, tw + 6, 14);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 3, y + 2);
  });
}

// cells / 拖动中的本地框 / 缩放变化都要重绘
watch([displayCells, stage], () => draw(), { deep: true, flush: 'post' });

/** 把指针的客户端坐标换算成图片原始像素坐标（基于 stage 元素，不依赖事件目标）。 */
function pointToImage(clientX: number, clientY: number): { x: number; y: number } {
  const stageEl = stageRef.value;
  if (!stageEl) return { x: 0, y: 0 };
  const bounds = stageEl.getBoundingClientRect();
  const s = stage.value.scale || 1;
  return { x: (clientX - bounds.left) / s, y: (clientY - bounds.top) / s };
}

/** 双击画面：在该处加一条纵向 + 一条横向切割线。 */
function handleDblClick(event: MouseEvent): void {
  if (!props.editable) return;
  const { x, y } = pointToImage(event.clientX, event.clientY);
  emit(
    'update:columns',
    [...props.columns, Math.round(x)].sort((a, b) => a - b),
  );
  emit(
    'update:rows',
    [...props.rows, Math.round(y)].sort((a, b) => a - b),
  );
}

/**
 * 开始拖拽切割线。
 *
 * **拖动中只改本地 `drag.value`，不逐帧 emit**：每次 emit 都会让父组件回传 +
 * 触发 deep watch/防抖探测/canvas 重绘，churn 到拖拽跟不上手（照抄 RegionCanvas
 * 的 local 值模式）。松手才 emit 最终坐标。监听挂 window，拖出画布也不丢。
 */
function startDragLine(event: PointerEvent, kind: 'col' | 'row', index: number): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const start = kind === 'col' ? props.columns[index] : props.rows[index];
  drag.value = { kind, index, value: start };
  const move = (e: PointerEvent): void => {
    const d = drag.value;
    if (!d) return;
    const { x, y } = pointToImage(e.clientX, e.clientY);
    const value =
      d.kind === 'col'
        ? Math.min(Math.max(Math.round(x), 0), props.naturalWidth)
        : Math.min(Math.max(Math.round(y), 0), props.naturalHeight);
    drag.value = { ...d, value };
  };
  const up = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    const d = drag.value;
    drag.value = null;
    if (!d) return;
    // 松手时写回并排序（拖动中越过邻线也不怕，索引在这一刻才与坐标顺序对齐）
    if (d.kind === 'col') {
      const next = [...props.columns];
      next[d.index] = d.value;
      emit(
        'update:columns',
        next.sort((a, b) => a - b),
      );
    } else {
      const next = [...props.rows];
      next[d.index] = d.value;
      emit(
        'update:rows',
        next.sort((a, b) => a - b),
      );
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  // 不处理 pointercancel 的话，浏览器一旦把这次按压判成手势就静默中断，表现为「拖一下就停」
  window.addEventListener('pointercancel', up);
}

/** 删除切割线。 */
function removeLine(kind: 'col' | 'row', index: number): void {
  if (kind === 'col')
    emit(
      'update:columns',
      props.columns.filter((_, i) => i !== index),
    );
  else
    emit(
      'update:rows',
      props.rows.filter((_, i) => i !== index),
    );
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
.slice-canvas {
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
    // 透明图的棋盘底，看清透明边界
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

  &__overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  &__vline {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 11px;
    margin-left: -5px;
    cursor: ew-resize;
    touch-action: none;
    background: linear-gradient(
      to right,
      transparent 5px,
      var(--tb-color-primary) 5px,
      var(--tb-color-primary) 6px,
      transparent 6px
    );

    &:hover,
    &--active {
      background: linear-gradient(
        to right,
        transparent 4px,
        var(--tb-color-primary) 4px,
        var(--tb-color-primary) 7px,
        transparent 7px
      );
    }
  }

  &__hline {
    position: absolute;
    right: 0;
    left: 0;
    height: 11px;
    margin-top: -5px;
    cursor: ns-resize;
    touch-action: none;
    background: linear-gradient(
      to bottom,
      transparent 5px,
      var(--tb-color-primary) 5px,
      var(--tb-color-primary) 6px,
      transparent 6px
    );

    &:hover,
    &--active {
      background: linear-gradient(
        to bottom,
        transparent 4px,
        var(--tb-color-primary) 4px,
        var(--tb-color-primary) 7px,
        transparent 7px
      );
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
    text-shadow: 0 1px 2px rgb(0 0 0 / 60%);
  }
}
</style>
