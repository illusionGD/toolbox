<template>
  <section class="diff-sides" aria-label="左右文件对比">
    <div class="diff-sides__headings"><span>左侧 · 原文件</span><span>右侧 · 对比文件</span></div>
    <!-- 只注入 diff2html 转义并生成的 HTML；原文件文本不能直接进入 v-html。 -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div ref="container" class="diff-sides__content" v-html="markup" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { FileDiffLine } from '@shared/fileDiff';
import { renderFileDiff } from '@/utils/fileDiff';
import 'diff2html/bundles/css/diff2html.min.css';

interface Props {
  /** 已裁剪的差异预览，包含原始行号和换行信息。 */
  lines: FileDiffLine[];
}
const props = defineProps<Props>();
const container = ref<HTMLElement | null>(null);
const markup = computed(() => renderFileDiff(props.lines));

watchEffect(
  (onCleanup) => {
    if (!container.value) return;
    const panes = [...container.value.querySelectorAll<HTMLElement>('.d2h-file-side-diff')];
    const endings = [new Map<number, string>(), new Map<number, string>()];
    for (const line of props.lines) {
      if (line.kind !== 'removed' && line.kind !== 'added') continue;
      const side = line.kind === 'removed' ? 0 : 1;
      const number = side === 0 ? line.leftLine : line.rightLine;
      if (number !== null && line.ending)
        endings[side].set(number, line.ending === 'none' ? '无末尾换行' : line.ending);
    }
    panes.forEach((pane, side) => {
      pane.setAttribute('aria-label', side === 0 ? '左侧文件内容' : '右侧文件内容');
      pane.setAttribute('tabindex', '0');
      pane.querySelectorAll('.diff-sides__ending').forEach((badge) => badge.remove());
      for (const row of pane.querySelectorAll('tr')) {
        const number = Number(row.querySelector('.d2h-code-side-linenumber')?.textContent?.trim());
        const ending = endings[side].get(number);
        const content = row.querySelector('.d2h-code-line-ctn');
        if (!ending || !content) continue;
        const badge = document.createElement('span');
        badge.className = 'diff-sides__ending';
        badge.textContent = ending;
        content.append(badge);
      }
    });
    // 纵向共用容器；横向按相同偏移同步，短侧到边界后不反向拉回长侧。
    const syncScroll = (event: Event): void => {
      const source = event.target as HTMLElement;
      const offset = expected.get(source);
      expected.delete(source);
      if (source.scrollLeft === offset) return;
      for (const pane of panes) {
        if (pane === source) continue;
        const offset = Math.min(source.scrollLeft, pane.scrollWidth - pane.clientWidth);
        expected.set(pane, offset);
        pane.scrollLeft = offset;
      }
    };
    const expected = new Map<HTMLElement, number>();
    panes.forEach((pane) => pane.addEventListener('scroll', syncScroll, { passive: true }));
    onCleanup(() => panes.forEach((pane) => pane.removeEventListener('scroll', syncScroll)));
  },
  { flush: 'post' },
);
</script>

<style scoped lang="scss">
.diff-sides {
  min-width: 0;
  margin-top: var(--tb-space-3);
  border: 1px solid var(--tb-border-strong);
  border-radius: var(--tb-radius-sm);
  overflow: hidden;
  --d2h-dark-color: var(--tb-text-primary);
  --d2h-dark-bg-color: var(--tb-bg-base);
  --d2h-dark-border-color: var(--tb-border);
  --d2h-dark-line-border-color: var(--tb-border);
  --d2h-dark-dim-color: var(--tb-text-secondary);
  --d2h-dark-info-bg-color: var(--tb-bg-elevated);
  --d2h-dark-info-border-color: var(--tb-border);
  --d2h-dark-empty-placeholder-bg-color: var(--tb-bg-surface);
  --d2h-dark-empty-placeholder-border-color: var(--tb-border);
  --d2h-dark-del-bg-color: var(--tb-bg-hover);
  --d2h-dark-del-border-color: var(--tb-border-strong);
  --d2h-dark-del-highlight-bg-color: color-mix(in srgb, var(--tb-text-secondary) 35%, transparent);
  --d2h-dark-ins-bg-color: var(--tb-color-primary-soft);
  --d2h-dark-ins-border-color: var(--tb-border-strong);
  --d2h-dark-ins-highlight-bg-color: color-mix(in srgb, var(--tb-color-primary) 40%, transparent);

  &__headings {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    background: var(--tb-bg-elevated);
    span {
      padding: var(--tb-space-2) var(--tb-space-3);
    }
  }
  &__content {
    max-height: min(480px, 55vh);
    overflow-y: auto;
  }
  :deep(.d2h-file-header) {
    display: none;
  }
  :deep(.d2h-file-wrapper) {
    border: 0;
    margin: 0;
  }
  :deep(.d2h-file-side-diff) {
    // 库的行号为绝对定位，必须以面板为包含块，才能被各层滚动容器裁剪。
    position: relative;
    min-width: 0;
    scrollbar-gutter: stable;
    &:first-child {
      border-right: 1px solid var(--tb-border-strong);
    }
  }
  :deep(.d2h-code-line-ctn) {
    white-space: pre;
    tab-size: 4;
  }
  :deep(.d2h-diff-table) {
    font-size: 12px;
    line-height: 22px;
  }
  :deep(.diff-sides__ending) {
    margin-left: var(--tb-space-4);
    color: var(--tb-text-secondary);
    font-size: 10px;
    user-select: none;
  }
}
</style>
