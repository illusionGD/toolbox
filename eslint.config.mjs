import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  {
    name: 'app/files-to-ignore',
    // scripts/tbverify 是 node 直跑的桩测脚本，横跨主进程与渲染进程两套 tsconfig，
    // 不属于任何一个 project，交给 eslint 只会得到 parsing error；out-tbverify 是它的产物。
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/out-tbverify/**',
      '**/node_modules/**',
      'scripts/tbverify/**',
    ],
  },

  {
    name: 'app/languageOptions',
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,

  {
    name: 'app/rules',
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'vue/multi-word-component-names': 'off',
    },
  },

  // 关闭与 Prettier 冲突的格式化规则，须放最后
  skipFormatting,
);
