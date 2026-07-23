<template>
  <div class="settings">
    <h1 class="settings__title">设置</h1>

    <n-card class="settings__section" title="外观" size="small">
      <div class="settings__row">
        <div class="settings__label">
          <span>主题主色</span>
          <span class="settings__hint">用于强调元素，背景保持中性深色</span>
        </div>
        <div class="settings__control">
          <div class="settings__presets">
            <button
              v-for="preset in THEME_PRESETS"
              :key="preset.key"
              class="settings__swatch"
              :class="{ 'is-active': themeStore.primaryColor === preset.color }"
              :style="{ background: preset.color }"
              :title="preset.label"
              @click="themeStore.setPrimaryColor(preset.color)"
            />
          </div>
          <div class="settings__picker-row">
            <div class="settings__picker">
              <n-color-picker
                :value="themeStore.primaryColor"
                :show-alpha="false"
                :modes="['hex']"
                @update:value="themeStore.setPrimaryColor"
              />
            </div>
            <n-button
              class="settings__reset"
              quaternary
              size="small"
              @click="themeStore.resetPrimaryColor"
            >
              恢复默认
            </n-button>
          </div>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { NButton, NCard, NColorPicker } from 'naive-ui';
import { useThemeStore } from '@/stores/theme';
import { THEME_PRESETS } from '@/constants/theme';

// #region setup
const themeStore = useThemeStore();
// #endregion
</script>

<style scoped lang="scss">
.settings {
  padding: var(--tb-space-5);

  &__title {
    margin: 0 0 var(--tb-space-4);
    color: var(--tb-text-primary);
  }

  &__section {
    max-width: 640px;
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);
  }

  &__row {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
  }

  &__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--tb-text-primary);
  }

  &__hint {
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__control {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
    align-items: flex-start;
  }

  &__presets {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__swatch {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--tb-radius-sm);
    cursor: pointer;
    transition: transform 0.15s;

    &:hover {
      transform: scale(1.1);
    }

    &.is-active {
      border-color: var(--tb-text-primary);
    }
  }

  &__picker-row {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
  }

  &__picker {
    width: 180px;
    flex-shrink: 0;
  }

  &__reset {
    flex-shrink: 0;
  }
}
</style>
