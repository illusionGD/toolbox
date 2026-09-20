const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
execFileSync(
  process.execPath,
  [
    path.join(root, 'node_modules/esbuild/bin/esbuild'),
    path.join(root, 'scripts/tbverify/webtest-review.ts'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--target=node20',
    '--external:playwright-core',
    '--external:esbuild',
    '--external:@ffmpeg-installer/ffmpeg',
    '--external:@ffprobe-installer/ffprobe',
    `--alias:electron=${path.join(root, 'scripts/tbverify/stub-electron.ts')}`,
    `--outfile=${path.join(root, 'out-tbverify/webtest-review.mjs')}`,
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  ],
  { cwd: root, stdio: 'inherit' },
);
execFileSync(process.execPath, [path.join(root, 'out-tbverify/webtest-review.mjs')], {
  cwd: root,
  stdio: 'inherit',
});
require('esbuild')
  .build({
    entryPoints: [path.join(root, 'scripts/tbverify/webtest-runtime-review.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['playwright-core', '@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe'],
    outfile: path.join(root, 'out-tbverify/webtest-runtime-review.mjs'),
    banner: {
      js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    },
    plugins: [
      {
        name: 'test-storage',
        setup(build) {
          build.onResolve({ filter: /storage\/paths$/ }, () => ({
            path: path.join(root, 'scripts/tbverify/stub-webtest-paths.ts'),
          }));
        },
      },
    ],
  })
  .then(() => {
    execFileSync(process.execPath, [path.join(root, 'out-tbverify/webtest-runtime-review.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
