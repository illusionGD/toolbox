/// <reference lib="dom" />
import type { WebTestStep } from '../../shared/webtest';

/**
 * 优先生成稳定 CSS 定位，找不到唯一锚点时使用结构路径兜底；始终不依赖文本。
 * 函数会在网页和 iframe 内执行，不能引用模块变量。
 * @param element 被操作的元素。
 * @returns CSS 定位及其稳定性标记。
 */
export function selectorForElement(element: Element): {
  selector: string;
  fragile: boolean;
  locatorIssue?: string;
} {
  const root = element.getRootNode() as Document | ShadowRoot;
  const unique = (selector: string): boolean => {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  };
  const quote = (value: string): string => `"${CSS.escape(value)}"`;
  const dynamicToken = (value: string): boolean =>
    /\d{4,}|[a-f\d]{8}-|(?:^|[-_])[a-f\d]{6,}(?:$|[-_])|^:r|^(?:el-id|headlessui|radix|rc|v)-/i.test(
      value,
    );
  const candidatesFor = (target: Element): string[] => {
    const tag = CSS.escape(target.localName);
    const candidates: string[] = [];
    const attributes: string[] = [];
    for (const attribute of [
      'data-testid',
      'data-test-id',
      'data-test',
      'data-cy',
      'data-qa',
      'id',
      'name',
      'data-action',
      'data-field',
      'data-key',
      'data-component',
      'data-hook',
      'formcontrolname',
      'type',
      'role',
      'autocomplete',
    ]) {
      const value = target.getAttribute(attribute);
      if (!value || value.length > 200 || dynamicToken(value)) continue;
      const part = `[${attribute}=${quote(value)}]`;
      attributes.push(part);
      candidates.push(
        attribute.startsWith('data-test') || ['data-cy', 'data-qa', 'id'].includes(attribute)
          ? part
          : `${tag}${part}`,
      );
    }
    const classes = Array.from(target.classList)
      .filter(
        (name) =>
          /^[a-zA-Z_][\w-]*$/.test(name) &&
          !dynamicToken(name) &&
          !/^(?:css-|jsx-|sc-|is-|has-)|(?:^|[-_])(?:active|selected|checked|disabled|focused|focus|hover|open|closed|loading|visible|hidden|enter|leave)(?:$|[-_])/i.test(
            name,
          ),
      )
      .slice(0, 6);
    const parts = [...attributes, ...classes.map((name) => `.${CSS.escape(name)}`)];
    candidates.push(...classes.map((name) => `${tag}.${CSS.escape(name)}`));
    // 组合稳定特征，仍然不依赖 DOM 排列顺序。
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) candidates.push(`${tag}${parts[i]}${parts[j]}`);
    }
    if (classes.length > 2)
      candidates.push(`${tag}${classes.map((name) => `.${CSS.escape(name)}`).join('')}`);
    candidates.push(tag);
    return [...new Set(candidates)];
  };
  const candidates = candidatesFor(element);
  let selector = candidates.find(unique);
  // 使用后代关系，不拼父子层级；插入包装节点或调整兄弟顺序后依然有效。
  for (
    let ancestor = element.parentElement;
    !selector && ancestor;
    ancestor = ancestor.parentElement
  ) {
    for (const anchor of candidatesFor(ancestor)) {
      const anchors = root.querySelectorAll(anchor);
      if (anchors.length !== 1 || anchors[0] !== ancestor) continue;
      selector = candidates.map((candidate) => `${anchor} ${candidate}`).find(unique);
      if (selector) break;
    }
  }
  let fragile = false;
  if (!selector) {
    fragile = true;
    let path = '';
    for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement) {
      const tag = CSS.escape(cursor.localName);
      const stableCandidates = candidatesFor(cursor).filter((candidate) => candidate !== tag);
      // 必须到达唯一的稳定祖先才截断；当前唯一的裸序号会被后来挂载的列表干扰。
      if (path) {
        selector = stableCandidates
          .filter((anchor) => {
            const matches = root.querySelectorAll(anchor);
            return matches.length === 1 && matches[0] === cursor;
          })
          .map((anchor) => `${anchor} > ${path}`)
          .find(unique);
        if (selector) break;
      }
      const siblings = Array.from(cursor.parentNode?.children ?? []).filter(
        (sibling) => sibling.localName === cursor.localName,
      );
      // 结构路径也保留目标及中间节点的稳定特征，不退化为纯标签链。
      const base = stableCandidates[0] ?? tag;
      const segment =
        siblings.length > 1 ? `${base}:nth-of-type(${siblings.indexOf(cursor) + 1})` : base;
      path = path ? `${segment} > ${path}` : segment;
      // 没有稳定锚点则一直回溯至 document / ShadowRoot 根，不能只因暂时唯一而提前结束。
      if (!cursor.parentElement && unique(path)) {
        selector = path;
        break;
      }
    }
  }
  let locatorIssue = selector
    ? undefined
    : '无法生成唯一 CSS 定位，请配置 data-testid 或编辑此步骤的定位';
  selector ??= candidates[0];
  if (root instanceof ShadowRoot) {
    const parent = selectorForElement(root.host);
    selector = `${parent.selector} ${selector}`;
    fragile ||= parent.fragile;
    locatorIssue ??= parent.locatorIssue;
  }
  return { selector, fragile, ...(locatorIssue ? { locatorIssue } : {}) };
}

/** 网页内部仅允许上报结构化操作；不会获得任何 Electron 或文件系统能力。 */
type RecorderWindow = Window & {
  __toolboxRecord: (step: Partial<WebTestStep> & { recordedAt: number }) => Promise<void>;
  __toolboxRecorder?: { flush: () => Promise<void>; stop: () => Promise<void> };
};

/** 在每个 document 中安装捕获监听器；由录制模块注入，回放绝不调用。 */
function installRecorder(): void {
  const host = window as unknown as RecorderWindow;
  if (host.__toolboxRecorder) return;
  let stopped = false;
  let pendingInput: Element | null = null;
  let inputRecordedAt = 0;
  let inputTimer = 0;
  let keyboardActivation = 0;
  const scrollTimers = new Map<Element | Document, number>();
  const scrollRecordedAt = new Map<Element | Document, number>();
  const pending = new Set<Promise<void>>();
  const send = (step: Partial<WebTestStep>, recordedAt = Date.now()): void => {
    if (stopped) return;
    const promise = host
      .__toolboxRecord({ ...step, recordedAt })
      .catch((error: unknown) => console.error('[Toolbox recorder]', error));
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
  };
  const targetOf = (event: Event): Element | null => {
    const target = event.composedPath()[0];
    return target instanceof Element ? target : null;
  };
  const editable = (element: Element): Element =>
    element.closest('[contenteditable="true"], [contenteditable=""]') ?? element;
  const flushInput = (): void => {
    clearTimeout(inputTimer);
    if (!pendingInput) return;
    const element = pendingInput;
    pendingInput = null;
    const value =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : (element.textContent ?? '');
    send({ action: 'fill', ...selectorForElement(element), value }, inputRecordedAt);
  };
  const flushScroll = (target: Element | Document): void => {
    clearTimeout(scrollTimers.get(target));
    scrollTimers.delete(target);
    const recordedAt = scrollRecordedAt.get(target) ?? Date.now();
    scrollRecordedAt.delete(target);
    if (target instanceof Document)
      send({ action: 'scroll', x: window.scrollX, y: window.scrollY }, recordedAt);
    else
      send(
        {
          action: 'scroll',
          ...selectorForElement(target),
          x: target.scrollLeft,
          y: target.scrollTop,
        },
        recordedAt,
      );
  };
  document.addEventListener(
    'input',
    (event) => {
      const target = targetOf(event);
      if (
        !target ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(target.type))
      )
        return;
      const element = editable(target);
      if (pendingInput && pendingInput !== element) flushInput();
      pendingInput = element;
      inputRecordedAt = Date.now();
      clearTimeout(inputTimer);
      inputTimer = window.setTimeout(flushInput, 250);
    },
    true,
  );
  document.addEventListener(
    'change',
    (event) => {
      const element = targetOf(event);
      if (!element) return;
      flushInput();
      if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type))
        send({ action: 'check', ...selectorForElement(element), checked: element.checked });
      else if (element instanceof HTMLSelectElement)
        send({
          action: 'select',
          ...selectorForElement(element),
          values: Array.from(element.selectedOptions, (option) => option.value),
        });
      else if (element instanceof HTMLInputElement && element.type === 'file')
        send({
          action: 'unsupported',
          value: '文件上传需要环境内的文件映射，请在用例中补充上传逻辑后再运行',
        });
    },
    true,
  );
  const click = (event: MouseEvent): void => {
    // Enter / Space 产生的合成 click 由 press 还原，不能再录一遍提交。
    if (!event.isTrusted || (event.detail === 0 && Date.now() - keyboardActivation < 1000)) return;
    let element = targetOf(event);
    if (!element) return;
    flushInput();
    for (const target of scrollTimers.keys()) flushScroll(target);
    if (element instanceof HTMLCanvasElement) {
      send({ action: 'unsupported', value: 'Canvas 内操作需要坐标或业务定位，此版本无法可靠还原' });
      return;
    }
    element =
      element.closest(
        'button, a, input, select, textarea, label, [role="button"], [role="checkbox"], [role="radio"]',
      ) ?? element;
    if (
      element instanceof HTMLSelectElement ||
      (element instanceof HTMLLabelElement && element.control)
    )
      return;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(element.type))
      return;
    if (event.type === 'click' && event.detail > 1) return;
    const modifiers: NonNullable<WebTestStep['modifiers']> = [];
    if (event.altKey) modifiers.push('Alt');
    if (event.ctrlKey) modifiers.push('Control');
    if (event.metaKey) modifiers.push('Meta');
    if (event.shiftKey) modifiers.push('Shift');
    send({
      action: event.type === 'dblclick' ? 'dblclick' : 'click',
      ...selectorForElement(element),
      button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
      modifiers,
    });
  };
  document.addEventListener('click', click, true);
  document.addEventListener('dblclick', click, true);
  document.addEventListener('contextmenu', click, true);
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.isComposing || event.repeat) return;
      const element = targetOf(event);
      if (!element || element instanceof HTMLSelectElement) return;
      if (event.key === 'Enter' || event.key === ' ') keyboardActivation = Date.now();
      if (
        event.key === ' ' &&
        (element instanceof HTMLButtonElement || element.getAttribute('role') === 'button')
      ) {
        flushInput();
        send({ action: 'press', ...selectorForElement(element), value: 'Space' });
        return;
      }
      const special = [
        'Enter',
        'Tab',
        'Escape',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ];
      if (
        !special.includes(event.key) &&
        !(
          (event.ctrlKey || event.metaKey || event.altKey) &&
          !['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)
        )
      )
        return;
      // 剪贴板、全选和撤销由最终 input 值还原，避免重复删除或依赖回放机器的剪贴板。
      if (
        (event.ctrlKey || event.metaKey) &&
        ['a', 'c', 'v', 'x', 'z', 'y'].includes(event.key.toLowerCase())
      )
        return;
      flushInput();
      const keys = [
        event.ctrlKey ? 'Control' : '',
        event.metaKey ? 'Meta' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        event.key,
      ].filter(Boolean);
      send({ action: 'press', ...selectorForElement(editable(element)), value: keys.join('+') });
    },
    true,
  );
  document.addEventListener(
    'scroll',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element || target instanceof Document)) return;
      clearTimeout(scrollTimers.get(target));
      scrollRecordedAt.set(target, Date.now());
      scrollTimers.set(
        target,
        window.setTimeout(() => flushScroll(target), 200),
      );
    },
    true,
  );
  document.addEventListener(
    'dragstart',
    () =>
      send({ action: 'unsupported', value: '检测到拖拽操作，此版本无法可靠还原拖拽，请调整用例' }),
    true,
  );
  window.addEventListener('pagehide', flushInput);
  host.__toolboxRecorder = {
    flush: async () => {
      flushInput();
      for (const target of scrollTimers.keys()) flushScroll(target);
      await Promise.all([...pending]);
    },
    stop: async () => {
      await host.__toolboxRecorder!.flush();
      stopped = true;
    },
  };
}

/**
 * 生成自包含脚本，绕过打包器重命名对函数外部引用的影响。
 * @returns 仅用于 BrowserContext.addInitScript 的代码。
 */
export function recorderSource(): string {
  return `(() => { const selectorForElement = ${selectorForElement.toString()}; (${installRecorder.toString()})(); })();`;
}
