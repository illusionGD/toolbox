<template>
  <ToolPageLayout
    title="网页分包"
    desc="把大字体切成多个 unicode-range 分包 + CSS，供网站按需加载"
    category="字体工具"
  >
    <template #main>
      <div class="split__main" :class="{ 'split__main--drag': isDragOver }" v-bind="dropHandlers">
        <!-- 未选字体 -->
        <div v-if="!source" class="split__empty">
          <n-icon :size="40" :depth="3" :component="TextOutline" />
          <p>拖拽字体到此处，或点击选择（TTF / OTF / WOFF / WOFF2）</p>
          <n-button size="small" @click="handlePickFont">选择字体</n-button>
        </div>

        <!-- 已选字体 -->
        <div v-else class="split__body">
          <div class="split__source">
            <div class="split__source-info">
              <div class="split__source-name">{{ source.name }}</div>
              <div class="split__source-sub">
                <template v-if="sourceMeta?.familyName">{{ sourceMeta.familyName }} · </template
                >{{ formatBytes(source.size)
                }}<template v-if="sourceMeta"> · {{ sourceMeta.glyphCount }} 字形</template>
              </div>
            </div>
            <n-button size="small" @click="handlePickFont">更换字体</n-button>
          </div>

          <!-- 分包结果 -->
          <div v-if="result" class="split__result">
            <div class="split__result-head">
              <span>分包完成</span>
              <n-button size="small" @click="openResultDir">
                <template #icon><n-icon :component="FolderOpenOutline" /></template>
                打开输出目录
              </n-button>
            </div>
            <div class="split__result-stats">
              <span>分包 {{ result.chunkCount }} 个</span>
              <span>产物 {{ result.fileCount }} 个文件</span>
              <span>总大小 {{ formatBytes(result.totalSize) }}</span>
              <span v-if="result.cssPath">含 CSS</span>
            </div>
            <p class="split__result-dir">{{ result.outDir }}</p>
          </div>
          <div v-else class="split__hint">在右侧设置参数后点「开始分包」</div>
        </div>
      </div>
    </template>

    <template #panel>
      <h3 class="split__ptitle">分包参数</h3>
      <div class="split__field">
        <label class="split__label"
          >单包目标大小 {{ Math.round(config.chunkSize / 1024) }} KB</label
        >
        <n-slider
          v-model:value="config.chunkSize"
          :min="20 * 1024"
          :max="300 * 1024"
          :step="10 * 1024"
        />
        <p class="split__tip">越小分包越多、单包加载越快；默认 70KB</p>
      </div>
      <div class="split__field">
        <label class="split__label">输出格式（可多选）</label>
        <n-checkbox-group v-model:value="config.formats">
          <n-space size="small">
            <n-checkbox v-for="f in formatOptions" :key="f.value" :value="f.value">
              {{ f.label }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
        <p class="split__tip">
          woff/ttf 由 woff2 逐包转换；CSS 的 src 按所选格式 woff2→woff→ttf 回退
        </p>
      </div>
      <div class="split__field split__field--row">
        <label class="split__label">保留原格式</label>
        <n-switch v-model:value="config.keepOriginal" size="small" />
      </div>
      <div class="split__field">
        <label class="split__label">分包文件名模板（留空用默认）</label>
        <n-input
          v-model:value="config.chunkName"
          size="small"
          placeholder="如 chunk-[index] 或 [hash]"
        />
        <p class="split__tip">[index] 序号、[hash] 哈希；扩展名自动补</p>
      </div>
      <div class="split__field">
        <label class="split__label">CSS font-family（留空用字体名）</label>
        <n-input v-model:value="config.cssFontFamily" size="small" placeholder="如 MyFont" />
      </div>
      <div class="split__field">
        <label class="split__label">额外样式表</label>
        <n-checkbox-group v-model:value="config.extraStyles">
          <n-space size="small">
            <n-checkbox v-for="s in styleOptions" :key="s.value" :value="s.value">
              {{ s.label }}
            </n-checkbox>
          </n-space>
        </n-checkbox-group>
        <p class="split__tip">在 CSS 之外额外生成同内容的 less / scss</p>
      </div>

      <h3 class="split__ptitle split__ptitle--sub">高级</h3>
      <div class="split__field split__field--row">
        <label class="split__label">CSS 保留 unicode 注释</label>
        <n-switch v-model:value="config.cssComment" size="small" />
      </div>
      <div class="split__field split__field--row">
        <label class="split__label">生成测试 HTML</label>
        <n-switch v-model:value="config.testHtml" size="small" />
      </div>
      <div class="split__field split__field--row">
        <label class="split__label">保留 OpenType 特性</label>
        <n-switch v-model:value="config.fontFeature" size="small" />
      </div>
      <div class="split__field split__field--row">
        <label class="split__label">按语言分区</label>
        <n-switch v-model:value="config.languageArea" size="small" />
      </div>

      <h3 class="split__ptitle split__ptitle--sub">输出</h3>
      <div class="split__field">
        <label class="split__label">输出目录</label>
        <div class="split__dir">
          <n-input v-model:value="config.outputDir" size="small" placeholder="选择或粘贴输出目录" />
          <n-button size="small" @click="pickOutputDir">
            <n-icon :component="FolderOpenOutline" />
          </n-button>
        </div>
        <p class="split__tip">产物会放到 输出目录/字体名/ 子目录下</p>
      </div>

      <n-button
        type="primary"
        block
        class="split__mt"
        :loading="processing"
        :disabled="!canStart"
        @click="handleStart"
      >
        {{ processing ? '分包中…' : '开始分包' }}
      </n-button>
    </template>

    <template #footer>
      <div class="split__footer">
        <span v-if="!source">未选择字体</span>
        <span v-else>{{ source.name }}</span>
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NCheckboxGroup,
  NIcon,
  NInput,
  NSlider,
  NSpace,
  NSwitch,
  useMessage,
} from 'naive-ui';
import { FolderOpenOutline, TextOutline } from '@vicons/ionicons5';
import type { FontMeta, FontSplitFormat, PickedFile } from '@shared/types';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useFileDrop } from '@/composables/useFileDrop';
import { useToolConfig } from '@/composables/useToolConfig';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { showInFolderApi } from '@/services/file';
import { probeFontApi, splitFontApi } from '@/services/font';
import { formatBytes } from '@/utils/format';
import type { FontSplitResult } from '@shared/types';

const message = useMessage();

const ACCEPT = ['ttf', 'otf', 'woff', 'woff2'];

const styleOptions: { label: string; value: 'less' | 'scss' }[] = [
  { label: 'LESS', value: 'less' },
  { label: 'SCSS', value: 'scss' },
];
// 分包输出格式，均可选（woff2 由 cn-font-split 直接出，其余由 woff2 转）
const formatOptions: { label: string; value: FontSplitFormat }[] = [
  { label: 'WOFF2', value: 'woff2' },
  { label: 'WOFF', value: 'woff' },
  { label: 'TTF', value: 'ttf' },
];

const source = ref<PickedFile | null>(null);
const sourceMeta = ref<FontMeta | null>(null);
const result = ref<FontSplitResult | null>(null);
const processing = ref(false);

const { config } = useToolConfig('font-split', {
  chunkSize: 70 * 1024,
  formats: ['woff2'] as FontSplitFormat[],
  keepOriginal: false,
  cssFontFamily: '',
  cssComment: false,
  extraStyles: [] as ('less' | 'scss')[],
  chunkName: '',
  testHtml: true,
  fontFeature: true,
  languageArea: false,
  outputDir: '',
});

const canStart = computed(
  () =>
    !!source.value &&
    !processing.value &&
    !!config.outputDir &&
    (config.formats.length > 0 || config.keepOriginal),
);

const { isDragOver, handlers: dropHandlers } = useFileDrop({
  accept: ACCEPT,
  onDrop: (files) => {
    if (files[0]) void loadSource(files[0]);
  },
});

/** 载入源字体：记录 + 探测元信息，清掉上次结果。 */
async function loadSource(file: PickedFile): Promise<void> {
  if (!ACCEPT.includes(file.ext)) return;
  source.value = file;
  sourceMeta.value = null;
  result.value = null;
  sourceMeta.value = await probeFontApi(file.path).catch(() => null);
}

async function handlePickFont(): Promise<void> {
  const files = await pickFilesApi({
    multiple: false,
    filters: [{ name: '字体', extensions: ACCEPT }],
    title: '选择要分包的字体',
  });
  if (files[0]) await loadSource(files[0]);
}

async function pickOutputDir(): Promise<void> {
  const dir = await pickDirectoryApi('选择输出目录');
  if (dir) config.outputDir = dir;
}

/** 打开产物目录。 */
function openResultDir(): void {
  if (result.value?.cssPath) void showInFolderApi(result.value.cssPath);
  else if (result.value) void showInFolderApi(result.value.outDir);
}

async function handleStart(): Promise<void> {
  if (!source.value) return;
  processing.value = true;
  result.value = null;
  try {
    result.value = await splitFontApi(source.value.path, {
      chunkSize: config.chunkSize,
      formats: [...config.formats],
      keepOriginal: config.keepOriginal,
      testHtml: config.testHtml,
      fontFeature: config.fontFeature,
      languageArea: config.languageArea,
      cssComment: config.cssComment,
      extraStyles: [...config.extraStyles],
      chunkName: config.chunkName,
      cssFontFamily: config.cssFontFamily,
      outputDir: config.outputDir,
    });
    message.success(`分包完成，共 ${result.value.chunkCount} 个分包`);
  } catch {
    // 错误已由 service 弹出
  } finally {
    processing.value = false;
  }
}

// 换字体后清结果（loadSource 已处理，这里兜底参数变化不清）
watch(source, () => {
  result.value = null;
});
</script>

<style scoped lang="scss">
.split {
  &__main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    border: 1px dashed transparent;
    border-radius: var(--tb-radius-md);
    transition: border-color 0.15s;

    &--drag {
      border-color: var(--tb-color-primary);
      background: var(--tb-color-primary-soft);
    }
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: var(--tb-space-2);
    color: var(--tb-text-secondary);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__body {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-4);
    padding: var(--tb-space-2);
  }

  &__source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--tb-space-3);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-md);
  }

  &__source-name {
    font-size: 15px;
    color: var(--tb-text-primary);
  }

  &__source-sub {
    margin-top: 2px;
    font-size: 12px;
    color: var(--tb-text-secondary);
  }

  &__result {
    padding: var(--tb-space-3);
    border: 1px solid var(--tb-color-primary);
    border-radius: var(--tb-radius-md);
    background: var(--tb-color-primary-soft);
  }

  &__result-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--tb-space-2);
    font-size: 14px;
    color: var(--tb-text-primary);
  }

  &__result-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-3);
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__result-dir {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    color: var(--tb-text-secondary);
    word-break: break-all;
  }

  &__hint {
    padding: var(--tb-space-4);
    text-align: center;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__ptitle {
    margin: 0 0 var(--tb-space-4);
    font-size: 15px;
    color: var(--tb-text-primary);

    &--sub {
      margin-top: var(--tb-space-5);
      padding-top: var(--tb-space-4);
      border-top: 1px solid var(--tb-border);
    }
  }

  &__field {
    margin-bottom: var(--tb-space-4);

    &--row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
  }

  &__label {
    display: block;
    margin-bottom: var(--tb-space-2);
    font-size: 13px;
    color: var(--tb-text-secondary);
  }

  &__field--row &__label {
    margin-bottom: 0;
  }

  &__tip {
    margin: var(--tb-space-2) 0 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--tb-text-secondary);
  }

  &__dir {
    display: flex;
    gap: var(--tb-space-2);
  }

  &__mt {
    margin-top: var(--tb-space-2);
  }

  &__footer {
    display: flex;
    align-items: center;
    font-size: 13px;
    color: var(--tb-text-secondary);
  }
}
</style>
