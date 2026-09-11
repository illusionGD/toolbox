<template>
  <div class="pet-stage" :class="{ 'pet-stage--dragging': dragging }" :style="stageStyle">
    <img class="pet-stage__img" :src="src" alt="桌宠" draggable="false" />
  </div>
</template>

<script setup lang="ts">
/**
 * 桌宠的画面：**按当前状态显示一张图**，仅此而已。
 *
 * 状态怎么变、该显示哪一张，全在 `usePetPresenter` + `@shared/pet` 里；这里只吃一个
 * 算好的 `src`。#26b 接 spine 时在这个组件里加第二个分支（`<canvas>`），外面一行不用改。
 *
 * `src` 是 data URL（或应用 logo）：走 `image:dataUrl` 那条现成的路，因为 CSP 的
 * `img-src` 里有 `data:` 与 `'self'`，**没有** `file:` 也没有 `tb-media:`，而我们不为
 * 桌宠松 CSP。
 */
import { computed } from 'vue';

// #region props
const props = defineProps<{
  /** 当前该显示的图片 src。 */
  src: string;
  /** 精灵边长（px）。 */
  size: number;
  /** 是否正在拖拽（拖着的时候给一点视觉反馈）。 */
  dragging: boolean;
}>();
// #endregion

// #region computed
const stageStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }));
// #endregion
</script>

<style scoped lang="scss">
.pet-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  // 拖拽是手写的（见 usePetPresenter），**这里绝不能用 -webkit-app-region: drag**：
  // 那个由 OS 接管，分不清点击与拖拽，也拿不到「拖拽中 / 放下」两个动画态
  cursor: grab;
  transition: opacity 0.12s ease;

  &--dragging {
    cursor: grabbing;
    // 「拿起来了」的反馈只能用**不改几何**的属性。窗口是**贴着精灵大小**的，而且
    // `overflow: hidden`：任何 scale / translate 都会把精灵顶出窗口边界被裁掉，
    // 看起来就是 review 报的那个「拖拽中图片会下移」。别再往这条规则里加 transform。
    opacity: 0.86;
  }

  &__img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    // 图片自带的原生拖拽会和我们的指针拖拽打架，必须关掉
    -webkit-user-drag: none;
    pointer-events: none;
  }
}
</style>
