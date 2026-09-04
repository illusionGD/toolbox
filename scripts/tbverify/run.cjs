/**
 * 桩测的构建 + 运行。
 *
 * 用 esbuild 把**真实生产代码**打成单个 bundle，只把 `electron` 换成桩，node 直跑。
 * 三条上一轮踩过的坑（照抄能省时间）：
 * 1. **必须单一入口**：主进程模块有模块级状态（`keys.ts` 的 cache、`paths.ts` 的 dataDir），
 *    分文件各打一份就成了互不相通的两份状态。
 * 2. **ESM 输出要补 `createRequire` banner**：依赖链上的 CJS 包会运行时 `require('path')`。
 * 3. **banner 有引号分号，不能经 shell 传**——所以这个脚本是 .cjs，用 execFileSync 传 argv。
 * 4. **`cn-font-split` 必须 external**：23b 起主进程入口经 `ai/tools/registry.ts` 连上了
 *    `ipc/font.ts`，而它链上的 `koffi` 里躺着十几个 `.node` 二进制、还 `require('bun:ffi')`，
 *    打包直接失败。它只在字体转换里被动态 import，桩测碰不到，留成 external 最省事。
 *    （sharp / exceljs / fontkit / @ffmpeg-installer 都打得进去，不用管。）
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
/** 要跑的两组：主进程 / 渲染进程。 */
const targets = [
  { entry: 'scripts/tbverify/main-ai-review.ts', out: 'out-tbverify/main-ai-review.mjs' },
  { entry: 'scripts/tbverify/renderer-ai-review.ts', out: 'out-tbverify/renderer-ai-review.mjs' },
];

for (const target of targets) {
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/esbuild/bin/esbuild'),
      path.join(root, target.entry),
      '--bundle',
      '--platform=node',
      '--format=esm',
      '--target=node20',
      `--outfile=${path.join(root, target.out)}`,
      `--alias:electron=${path.join(root, 'scripts/tbverify/stub-electron.ts')}`,
      `--alias:@shared=${path.join(root, 'electron/shared')}`,
      // 这两条必须比 `@` 更具体：esbuild 先试完整路径再逐段退到更短的前缀，所以精确路径优先
      `--alias:@/services/appState=${path.join(root, 'scripts/tbverify/stub-app-state.ts')}`,
      `--alias:@/services/ai=${path.join(root, 'scripts/tbverify/stub-services-ai.ts')}`,
      `--alias:@=${path.join(root, 'src')}`,
      // 见文件头第 4 条：koffi 的 .node 与 bun:ffi 打不进 bundle，它也只在字体转换里用
      '--external:cn-font-split',
      // 同理：subset-font / fontverter 链上的 wawoff2 是 emscripten 产物，模块级就用
      // __dirname 找 wasm，而 ESM bundle 里没有 __dirname。两个都是 font.ts 的顶层 import，
      // 少标一个都会在 import 期炸
      '--external:subset-font',
      '--external:fontverter',
      // 这两个包用 __dirname 现算二进制路径，打进 ESM bundle 会 ERR_AMBIGUOUS_MODULE_SYNTAX；
      // 留成 external 由 node 按 CJS 原样加载，`ffmpegInstaller.path` 照样拿得到
      '--external:@ffmpeg-installer/ffmpeg',
      '--external:@ffprobe-installer/ffprobe',
      // CJS 依赖会运行时 require('path')，不补 banner 就是 Dynamic require not supported
      '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
      '--log-level=warning',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}

let failed = false;
for (const target of targets) {
  try {
    execFileSync(process.execPath, [path.join(root, target.out)], { cwd: root, stdio: 'inherit' });
  } catch {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
