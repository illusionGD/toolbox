const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'out-tbverify/skills-review.mjs');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    path.join(root, 'scripts/tbverify/skills-review.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node20',
    `--outfile=${output}`,
    `--alias:electron=${path.join(root, 'scripts/tbverify/stub-electron.ts')}`,
    '--external:cn-font-split',
    '--external:subset-font',
    '--external:fontverter',
    '--external:@ffmpeg-installer/ffmpeg',
    '--external:@ffprobe-installer/ffprobe',
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(process.execPath, [output], { cwd: root, stdio: 'inherit' });
const pythonOutput = path.join(root, 'out-tbverify/skills-python-review.mjs');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    path.join(root, 'scripts/tbverify/skills-python-review.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node20',
    `--outfile=${pythonOutput}`,
    `--alias:electron=${path.join(root, 'scripts/tbverify/stub-electron.ts')}`,
    '--external:cn-font-split',
    '--external:subset-font',
    '--external:fontverter',
    '--external:@ffmpeg-installer/ffmpeg',
    '--external:@ffprobe-installer/ffprobe',
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    '--log-level=warning',
  ],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(process.execPath, [pythonOutput], { cwd: root, stdio: 'inherit' });
