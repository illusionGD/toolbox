import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { PLUGIN_CHANNELS } from './electron/shared/channels';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
        },
      },
    },
  },
  preload: {
    define: { __PLUGIN_CHANNELS__: JSON.stringify(PLUGIN_CHANNELS) },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          plugin: resolve(__dirname, 'electron/preload/plugin.ts'),
        },
      },
    },
  },
  renderer: {
    root: '.',
    server: {
      watch: {
        // 验证产物含目录循环的 junction 样本；Vite 不会自动沿用 .gitignore。
        ignored: ['**/out-tbverify/**'],
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'electron/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
        },
      },
    },
    plugins: [vue()],
  },
});
