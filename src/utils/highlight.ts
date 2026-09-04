/**
 * 给 `n-code` 用的 highlight.js 实例（**按需注册语言**）。
 *
 * 两件事值得记住：
 * - `highlight.js` 本来就在依赖树里（`naive-ui` 的直接依赖），但 naive-ui 自己**不打进产物**，
 *   要由使用方经 `n-config-provider :hljs` 注入。所以 package.json 里把它显式声明了一份：
 *   靠 `.npmrc` 的 `shamefully-hoist` 拿到手是运气，不是约定。
 * - **不要 `highlight.js/lib/common`**（全量常用语言，体积翻几倍），只挑对话里真会出现的。
 *   走 `n-code` 的额外好处是配色由 naive-ui 的主题变量给，**不用引 hljs 的样式表**，
 *   也不用我们自己写一行 `v-html`。
 */

import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('java', java);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
// xml 覆盖 html / vue / svg / xml 这一族（hljs 里 html 是 xml 的别名）
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);

/**
 * 这个语言标注认不认得（含 hljs 自带的别名，如 `ts` / `js` / `html` / `sh` / `yml`）。
 * @param lang 围栏上写的语言名。
 * @returns 认得则为 true。
 */
export function hasLanguage(lang: string): boolean {
  if (!lang) return false;
  return Boolean(hljs.getLanguage(lang));
}

export { hljs };
