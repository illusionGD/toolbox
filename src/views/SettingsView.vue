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

    <n-card class="settings__section" title="存储" size="small">
      <n-alert
        v-if="stateDegraded.degraded"
        type="warning"
        :bordered="false"
        class="settings__alert settings__alert--card"
      >
        设置暂时无法写入数据目录（{{ stateDegraded.reason }}），本次改动只保存在浏览器本地存储里。
      </n-alert>

      <!-- 数据缓存路径 -->
      <div class="settings__row">
        <div class="settings__label">
          <span>数据缓存路径</span>
          <span class="settings__hint">
            存放可随时丢弃的中间产物。默认在系统临时目录下，便于被系统磁盘清理一起清掉
          </span>
        </div>
        <div class="settings__control">
          <n-alert
            v-if="paths?.cacheDirFallback"
            type="warning"
            :bordered="false"
            class="settings__alert"
          >
            原定的 {{ paths.cacheDirFallback.requested }} 不可写（{{
              paths.cacheDirFallback.reason
            }}），已改用下面的位置。
          </n-alert>
          <code class="settings__path">{{ paths?.cacheDir ?? '读取中…' }}</code>
          <div class="settings__meta">
            <span>占用 {{ formatBytes(cacheUsage.bytes) }} · {{ cacheUsage.files }} 个文件</span>
            <span v-if="paths?.cacheDirCustom" class="settings__tag">自定义</span>
          </div>
          <n-space size="small">
            <n-button size="small" :loading="busy === 'cache-pick'" @click="pickDir('cache')">
              选择目录
            </n-button>
            <n-button size="small" quaternary @click="openDir('cache')">打开目录</n-button>
            <n-popconfirm @positive-click="clearCache">
              <template #trigger>
                <n-button size="small" :loading="busy === 'cache-clear'">清空缓存</n-button>
              </template>
              只删除缓存内容，不会影响已保存的数据与设置。
            </n-popconfirm>
            <n-button
              v-if="paths?.cacheDirCustom"
              size="small"
              quaternary
              :loading="busy === 'cache-reset'"
              @click="resetDir('cache')"
            >
              恢复默认
            </n-button>
          </n-space>
        </div>
      </div>

      <n-divider class="settings__divider" />

      <!-- 数据保存路径 -->
      <div class="settings__row">
        <div class="settings__label">
          <span>数据保存路径</span>
          <span class="settings__hint">
            存放主题、各工具上次使用的参数与使用统计。默认在安装目录下的 data
            文件夹，更改后现有数据会一并搬过去
          </span>
        </div>
        <div class="settings__control">
          <n-alert
            v-if="paths?.dataDirFallback"
            type="warning"
            :bordered="false"
            class="settings__alert"
          >
            {{ paths.dataDirFallback.requested }} 不可写（{{
              paths.dataDirFallback.reason
            }}），已改用下面的位置。若希望存到安装目录，请把程序装到有写入权限的位置。
          </n-alert>
          <code class="settings__path">{{ paths?.dataDir ?? '读取中…' }}</code>
          <div class="settings__meta">
            <span>占用 {{ formatBytes(dataUsage.bytes) }} · {{ dataUsage.files }} 个文件</span>
            <span v-if="paths?.dataDirCustom" class="settings__tag">自定义</span>
            <span v-if="paths?.portable" class="settings__tag">免安装版</span>
          </div>
          <n-space size="small">
            <n-button
              size="small"
              type="primary"
              :loading="busy === 'data-pick'"
              @click="pickDir('data')"
            >
              更改并迁移
            </n-button>
            <n-button size="small" quaternary @click="openDir('data')">打开目录</n-button>
            <n-button
              v-if="paths?.dataDirCustom"
              size="small"
              quaternary
              :loading="busy === 'data-reset'"
              @click="resetDir('data')"
            >
              恢复默认
            </n-button>
          </n-space>
        </div>
      </div>
    </n-card>

    <!-- AI 配置另立组件：本视图已经不短，且 AI 那块本身还会继续长 -->
    <AiSettingsCard />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NColorPicker,
  NDivider,
  NPopconfirm,
  NSpace,
  useMessage,
} from 'naive-ui';
import type { AppPathsInfo, DirUsage, StorageDirKind } from '@shared/types';
import AiSettingsCard from '@/components/ai/AiSettingsCard.vue';
import { useThemeStore } from '@/stores/theme';
import { THEME_PRESETS } from '@/constants/theme';
import { formatBytes } from '@/utils/format';
import { pickDirectoryApi } from '@/services/fs';
import {
  clearCacheApi,
  dirUsageApi,
  getStoragePathsApi,
  openStorageDirApi,
  resetStorageDirApi,
  setCacheDirApi,
  setDataDirApi,
} from '@/services/storage';
import { appStateStatus, flushAppState } from '@/services/appState';

// #region setup
const themeStore = useThemeStore();
const message = useMessage();

const paths = ref<AppPathsInfo | null>(null);
const cacheUsage = ref<DirUsage>({ bytes: 0, files: 0 });
const dataUsage = ref<DirUsage>({ bytes: 0, files: 0 });
/** 当前正在进行的操作，用于按钮 loading 与互斥。 */
const busy = ref<string>('');
const stateDegraded = appStateStatus();
// #endregion

// #region actions
/** 重新拉取路径与两个目录的占用。 */
async function refresh(): Promise<void> {
  paths.value = await getStoragePathsApi();
  const [cache, data] = await Promise.all([dirUsageApi('cache'), dirUsageApi('data')]);
  cacheUsage.value = cache;
  dataUsage.value = data;
}

/**
 * 选目录并切换。数据目录会连带迁移，缓存目录只切换并清掉旧的。
 * @param kind 目录种类。
 */
async function pickDir(kind: StorageDirKind): Promise<void> {
  const title = kind === 'cache' ? '选择数据缓存文件夹' : '选择数据保存文件夹';
  const target = await pickDirectoryApi(title);
  if (!target) return;

  busy.value = `${kind}-pick`;
  try {
    if (kind === 'data') {
      // 防抖中的写入必须先落盘，否则会写进正在被搬走的旧目录
      await flushAppState();
      const result = await setDataDirApi(target);
      message.success(
        result.movedEntries > 0
          ? `已迁移 ${result.movedEntries} 项（${formatBytes(result.movedBytes)}）到新位置`
          : '已切换数据保存位置',
      );
    } else {
      const freed = await setCacheDirApi(target);
      message.success(freed > 0 ? `已切换，旧缓存释放 ${formatBytes(freed)}` : '已切换缓存位置');
    }
    await refresh();
  } catch {
    // unwrap 已经提示过具体原因，这里只需恢复按钮状态
  } finally {
    busy.value = '';
  }
}

/**
 * 恢复某个目录为默认值。
 * @param kind 目录种类。
 */
async function resetDir(kind: StorageDirKind): Promise<void> {
  busy.value = `${kind}-reset`;
  try {
    if (kind === 'data') await flushAppState();
    await resetStorageDirApi(kind);
    message.success('已恢复默认位置');
    await refresh();
  } catch {
    // 同上
  } finally {
    busy.value = '';
  }
}

/** 清空缓存目录内容。 */
async function clearCache(): Promise<void> {
  busy.value = 'cache-clear';
  try {
    const result = await clearCacheApi();
    if (result.failed.length > 0) {
      message.warning(
        `已释放 ${formatBytes(result.freedBytes)}，${result.failed.length} 项被占用未能删除`,
      );
    } else {
      message.success(
        result.deleted > 0 ? `已清空，释放 ${formatBytes(result.freedBytes)}` : '缓存本来就是空的',
      );
    }
    await refresh();
  } catch {
    // 同上
  } finally {
    busy.value = '';
  }
}

/**
 * 在系统文件管理器中打开目录。
 * @param kind 目录种类。
 */
async function openDir(kind: StorageDirKind): Promise<void> {
  try {
    await openStorageDirApi(kind);
  } catch {
    // 同上
  }
}
// #endregion

onMounted(() => {
  void refresh();
});
</script>

<style scoped lang="scss">
.settings {
  padding: var(--tb-space-5);
  // 卡片内的两列布局要按「内容区宽度」而不是窗口宽度来切：侧栏占了 200px，
  // 用媒体查询会在窄窗口下判断错。容器查询的参照就是这个盒子本身。
  container: settings / inline-size;

  &__title {
    margin: 0 0 var(--tb-space-4);
    color: var(--tb-text-primary);
  }

  &__section {
    // 不设固定宽度：卡片跟着内容区宽度走，窄窗口不横向溢出、宽窗口不空一大片。
    // 行内部改成两列（见下方容器查询），所以铺满也不会出现被拉长的孤零零控件
    width: 100%;
    background: var(--tb-bg-surface);
    border: 1px solid var(--tb-border);

    & + & {
      margin-top: var(--tb-space-4);
    }
  }

  &__alert {
    width: 100%;

    // 卡片级提示（不在某一行里），下方要自己留间距
    &--card {
      margin-bottom: var(--tb-space-3);
    }
  }

  &__divider {
    margin: var(--tb-space-4) 0;
  }

  &__path {
    display: block;
    width: 100%;
    padding: var(--tb-space-2) var(--tb-space-3);
    font-family: var(--tb-font-mono, monospace);
    font-size: 12px;
    color: var(--tb-text-primary);
    background: var(--tb-bg-base);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);
    // 路径可能很长，允许选中复制并换行显示
    user-select: text;
    word-break: break-all;
  }

  &__meta {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__tag {
    padding: 0 6px;
    color: var(--tb-color-primary);
    background: var(--tb-color-primary-soft);
    border-radius: var(--tb-radius-sm);
  }

  &__row {
    display: grid;
    gap: var(--tb-space-3);
  }

  &__label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    // 上下堆叠时说明文字不要横着拉满一整屏，读起来更像一句话
    max-width: 64ch;
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

  // 宽到放得下两列就把「说明」挪到左边、控件靠右，卡片铺满也不会一行只有一个小控件；
  // 门槛按内容区宽度算：默认 1120 窗口下这里约 870px 走两列，窗口拖到最小（900）
  // 约 650px 自动退回上下堆叠
  @container settings (min-width: 720px) {
    &__row {
      grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
      column-gap: var(--tb-space-5);
      align-items: start;
    }
  }
}
</style>
