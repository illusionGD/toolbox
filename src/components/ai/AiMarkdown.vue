<script lang="ts">
/**
 * 把助手消息的原文 markdown 渲染出来。**零 `v-html`**。
 *
 * 三处有意的设计，都写进了 skill ai-markdown：
 *
 * 1. **用 `setup()` 返回渲染函数而不是 `<template>`**（对仓库「模板优先」惯例的一处例外）：
 *    markdown 是递归结构（列表套列表、引用套段落），模板里要写成 `v-for` + 十几个 `v-if`
 *    再加一个自递归组件，比这 20 行的 `walk()` 难读得多。
 * 2. **两条渲染路**：非流式（历史消息、停流后）全量 `renderMarkdown(props.text)`，这是
 *    **权威结果**；正在流的那条走 `pushMdStream` 块级增量 + 合帧节流。停流那一刻整棵树
 *    换成全量结果，是整个设计的安全绳——增量与全量万一有偏差，偏差的寿命只有那几秒。
 * 3. **定稿块交给 `MdBlock`**，靠「props 引用不变则 Vue 跳过子组件 render」把它们 memo 掉
 *    （这条实测过：改父组件其他部分五次，`MdBlock` 的 render 计数不涨；把块数组换成新引用
 *    才会重渲染）。于是每帧只 diff 尾块。
 *
 * 安全规则全在 `utils/markdown.ts`（纯函数，桩测断言得了），这里只负责把节点摆成 DOM，
 * **不做任何 `...attrs` 展开**：只有白名单里那几个键会落到元素上。
 */
import {
  computed,
  defineComponent,
  Fragment,
  h,
  onUnmounted,
  ref,
  shallowRef,
  watch,
  type PropType,
  type VNode,
} from 'vue';
import { NButton, NCode } from 'naive-ui';
import {
  createMdStream,
  pushMdStream,
  renderMarkdown,
  type MdNode,
  type MdStream,
} from '@/utils/markdown';
import { hasLanguage } from '@/utils/highlight';
import { showError, showSuccess } from '@/utils/feedback';

/**
 * 合帧节流的间隔（毫秒）。
 *
 * 探针量的数：`marked.lexer` 全量 2 KB / 8 KB / 32 KB 分别 0.32 / 0.69 / 2.43 ms，
 * 只解析 512 B 尾块 0.023 ms。解析从来不是瓶颈，**贵的是建 vnode + patch**，所以这个数
 * 是按「一秒重排十几次够顺眼、又不至于每个 delta 都动 DOM」定的（≈ 15 fps）。
 */
const FLUSH_MS = 64;

/** 允许落到 DOM 上的属性（**白名单，不做展开**）。 */
const DOM_ATTRS = ['href', 'target', 'rel', 'start', 'align'] as const;

/**
 * 挑出能落到 DOM 的属性。
 *
 * `lang` / `open` 只给 `md-code` 用，`checked` 只是给桩测和渲染前缀看的——它们**不该**
 * 变成 `<li checked="true">` 这种没有语义的属性。
 * @param node 节点。
 * @param key vnode key。
 * @returns props 对象。
 */
function domProps(node: MdNode, key?: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const attrs = node.attrs;
  if (attrs) {
    for (const name of DOM_ATTRS) {
      if (name in attrs) props[name] = attrs[name];
    }
  }
  if (key !== undefined) props.key = key;
  return props;
}

/**
 * 复制代码段。
 * @param code 代码内容。
 */
async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code);
    showSuccess('已复制');
  } catch {
    showError('复制失败，请手动选中');
  }
}

/**
 * 围栏代码块：外壳沿用 #23a 那套（边框 + 语言名 + 复制按钮）。
 *
 * `attrs.open === true`（流式还没闭合）时**不高亮也不给复制按钮**：复制半截代码没意义，
 * 而且每来一个字重高亮一整块是这条链上最贵的操作。闭合后交给 `n-code`——高亮在它内部
 * 完成，配色走 naive-ui 的主题变量，于是我们既不用写 `v-html`、也不用引 hljs 的样式表。
 * @param node `md-code` 节点。
 * @param key vnode key。
 * @returns vnode。
 */
function codeBlock(node: MdNode, key?: string): VNode {
  const code = node.text ?? '';
  const lang = String(node.attrs?.lang ?? '');
  const open = node.attrs?.open === true;
  return h('div', { class: 'ai-md__code', key }, [
    h('div', { class: 'ai-md__code-bar' }, [
      h('span', { class: 'ai-md__code-lang' }, lang || 'code'),
      open
        ? null
        : h(
            NButton,
            { size: 'tiny', quaternary: true, onClick: () => void copyCode(code) },
            () => '复制',
          ),
    ]),
    open
      ? h('pre', { class: 'ai-md__code-body' }, h('code', null, code))
      : h(
          'div',
          { class: 'ai-md__code-body' },
          // 语言认不出就不传 language，n-code 会当纯文本渲染（不抛错）
          h(NCode, { code, ...(hasLanguage(lang) ? { language: lang } : {}) }),
        ),
  ]);
}

/**
 * 图片退化成的那一行（**永不产出 `img`**）。
 *
 * CSP 的 `img-src 'self' data: blob:` 本来就会拦掉远端图，但那是第二道防线；这里是第一道。
 * 地址不安全（`file:` / `javascript:` 之类）时连链接都不给——不留「诱导用户点开本机任意
 * 文件」这条路。
 * @param node `md-image` 节点。
 * @param key vnode key。
 * @returns vnode。
 */
function imageRow(node: MdNode, key?: string): VNode {
  const label = node.text ?? '';
  const href = node.attrs?.href;
  return h('div', { class: 'ai-md__image', key }, [
    '🖼 图片：',
    typeof href === 'string'
      ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label)
      : label,
  ]);
}

/**
 * 节点 → vnode。
 * @param node 节点。
 * @param key vnode key。
 * @returns vnode 或字符串（文本叶子）。
 */
function walk(node: MdNode, key?: string): VNode | string {
  if (node.tag === 'text') return node.text ?? '';
  if (node.tag === 'md-code') return codeBlock(node, key);
  if (node.tag === 'md-image') return imageRow(node, key);
  const children = node.children?.map((child, index) => walk(child, `${index}`));
  return h(node.tag, domProps(node, key), children);
}

/**
 * 一个定稿块。**props 引用不变时它整个不重渲染**，这是块级增量省下开销的地方
 * （探针量过：Vue 在子组件 props 引用未变时确实跳过它的 render）。
 *
 * 它必须和 `AiMarkdown` 同文件：`walk()` 与那套 `<style scoped>` 都在这儿，
 * 拆出去只会多一个文件加一份 import，`vue/one-component-per-file` 这条为此关掉。
 */
// eslint-disable-next-line vue/one-component-per-file
const MdBlock = defineComponent({
  name: 'MdBlock',
  props: {
    /** 这一块的节点数组（引用稳定）。 */
    nodes: { type: Array as PropType<MdNode[]>, required: true },
  },
  setup(props) {
    return () =>
      h(
        Fragment,
        props.nodes.map((node, index) => walk(node, `${index}`)),
      );
  },
});

// eslint-disable-next-line vue/one-component-per-file
export default defineComponent({
  name: 'AiMarkdown',
  props: {
    /** 原文 markdown。 */
    text: { type: String, required: true },
    /** 这条消息是否正在流式生成。 */
    streaming: { type: Boolean, default: false },
  },
  setup(props) {
    // #region setup
    /** 非流式那条路要渲染的文本（流结束后就是权威全文）。 */
    const fullText = ref(props.text);
    /** 增量状态。**非流式消息一份都不该有**，所以懒创建、停流即丢。 */
    const stream = shallowRef<MdStream | null>(null);
    /** trailing 定时器。 */
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** 上一次 flush 的时刻。 */
    let lastFlush = 0;

    const nodes = computed(() => renderMarkdown(fullText.value));

    /** 把 `props.text` 真正推到渲染上。 */
    const flush = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastFlush = Date.now();
      if (props.streaming) {
        stream.value = pushMdStream(stream.value ?? createMdStream(), props.text);
      } else {
        // 停流：丢掉增量状态，切回全量（权威结果）
        stream.value = null;
        fullText.value = props.text;
      }
    };

    watch([() => props.text, () => props.streaming], () => {
      // 非流式必须无条件立刻出：历史消息不许因为节流延迟半帧才出现，
      // `streaming` 由 true 变 false（正常结束 / 取消 / 报错）也不许被节流吞掉
      if (!props.streaming) {
        flush();
        return;
      }
      const since = Date.now() - lastFlush;
      if (since >= FLUSH_MS) {
        flush();
        return;
      }
      // trailing flush 漏了就是「模型话没说完」：最后一批增量永远停在屏幕外
      if (!timer) timer = setTimeout(flush, FLUSH_MS - since);
    });

    // 生成中切会话会卸载这个组件，遗留的 setTimeout 会打到已卸载组件上
    onUnmounted(() => {
      if (timer) clearTimeout(timer);
      timer = null;
    });
    // #endregion

    return () => {
      const current = props.streaming ? stream.value : null;
      if (current) {
        return h('div', { class: 'ai-md' }, [
          // 定稿块：key 与索引绑定，且 nodes 引用不变 → Vue 跳过它们的 render
          ...current.blocks.map((block, index) => h(MdBlock, { key: `b${index}`, nodes: block })),
          // 尾块：每帧重渲染，成本与尾块大小同阶（不随整条消息变长而增长）
          ...current.tail.map((node, index) => walk(node, `t${index}`)),
        ]);
      }
      return h(
        'div',
        { class: 'ai-md' },
        nodes.value.map((node, index) => walk(node, `n${index}`)),
      );
    };
  },
});
</script>

<style scoped lang="scss">
/**
 * 后代选择器一律用 `:deep()`（编译成 `.ai-md[data-v-x] xxx`）。
 *
 * 别改成裸选择器：定稿块是同文件里那个 `MdBlock` 渲染的，scoped 的 `data-v` 只会落到
 * **本组件**产出的元素上（也就是根 div 和尾块），`MdBlock` 里那些元素一个都没有。
 * 窄窗口（面板 320~380 px）是所有尺寸的前提：标题不许放大成网页尺寸，长 URL 必须断行。
 */
.ai-md {
  color: var(--tb-text-primary);
  font-size: 14px;
  line-height: 1.7;
  word-break: break-word;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  :deep(p) {
    margin: 0 0 0.5em;
  }

  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 0.8em 0 0.4em;
    font-weight: 600;
    line-height: 1.4;
  }

  // 面板只有 380 px 宽，标题只加粗不放大
  :deep(h1) {
    font-size: 17px;
  }

  :deep(h2) {
    font-size: 16px;
  }

  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    font-size: 15px;
  }

  :deep(ul),
  :deep(ol) {
    margin: 0.3em 0 0.5em;
    padding-left: 1.4em;
  }

  :deep(li) {
    margin: 0.15em 0;
  }

  :deep(li > p) {
    margin: 0 0 0.3em;
  }

  :deep(a) {
    color: var(--tb-color-primary);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  :deep(strong) {
    font-weight: 600;
  }

  :deep(blockquote) {
    margin: 0.5em 0;
    padding: 0 0 0 var(--tb-space-3);
    border-left: 2px solid var(--tb-border-strong);
    color: var(--tb-text-secondary);
  }

  :deep(hr) {
    margin: 0.8em 0;
    border: 0;
    border-top: 1px solid var(--tb-border);
  }

  // 行内代码
  :deep(:not(pre) > code) {
    padding: 1px 4px;
    border-radius: var(--tb-radius-sm);
    background: var(--tb-bg-elevated);
    font-size: 13px;
    font-family: var(--tb-font-mono, monospace);
    word-break: break-all;
  }

  // 表格：窄窗口里自己横向滚动，不把气泡顶宽
  :deep(table) {
    display: block;
    max-width: 100%;
    margin: 0.5em 0;
    border-collapse: collapse;
    overflow-x: auto;
    font-size: 13px;
  }

  :deep(th),
  :deep(td) {
    padding: 4px var(--tb-space-2);
    border: 1px solid var(--tb-border);
    text-align: left;
  }

  :deep(th) {
    background: var(--tb-bg-elevated);
    font-weight: 600;
  }

  :deep(td[align='center']),
  :deep(th[align='center']) {
    text-align: center;
  }

  :deep(td[align='right']),
  :deep(th[align='right']) {
    text-align: right;
  }

  // 代码块外壳：逐字沿用 #23a 的样式，只换了类名前缀
  :deep(.ai-md__code) {
    margin: var(--tb-space-2) 0;
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);
    overflow: hidden;
  }

  :deep(.ai-md__code-bar) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px var(--tb-space-2);
    background: var(--tb-bg-elevated);
  }

  :deep(.ai-md__code-lang) {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  :deep(.ai-md__code-body) {
    margin: 0;
    padding: var(--tb-space-3);
    background: var(--tb-bg-base);
    color: var(--tb-text-primary);
    font-size: 13px;
    line-height: 1.6;
    overflow-x: auto;
  }

  // n-code 自己带一层 pre
  :deep(.ai-md__code-body pre) {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
  }

  :deep(.ai-md__image) {
    margin: 0.3em 0;
    color: var(--tb-text-secondary);
    font-size: 13px;
  }
}
</style>
