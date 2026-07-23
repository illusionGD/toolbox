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
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**'],
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
