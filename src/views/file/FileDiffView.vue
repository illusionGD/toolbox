<template>
  <ToolPageLayout
    title="批量文件 Diff"
    category="文件工具"
    desc="比较两个文件或文件夹的内容，按相对路径查看新增、缺失和修改。"
  >
    <template #main>
      <div class="file-diff">
        <n-card size="small">
          <div class="file-diff__paths">
            <n-form-item label="左侧路径">
              <n-space vertical class="file-diff__field">
                <n-input
                  v-model:value="config.leftPath"
                  :disabled="busy"
                  placeholder="输入左侧文件或文件夹的绝对路径"
                  :input-props="{ 'aria-label': '左侧路径' }"
                />
                <n-space
                  ><n-button size="small" :disabled="busy" @click="pick('leftPath', 'file')"
                    >选择文件</n-button
                  ><n-button size="small" :disabled="busy" @click="pick('leftPath', 'directory')"
                    >选择文件夹</n-button
                  ></n-space
                >
              </n-space>
            </n-form-item>
            <n-form-item label="右侧路径">
              <n-space vertical class="file-diff__field">
                <n-input
                  v-model:value="config.rightPath"
                  :disabled="busy"
                  placeholder="输入右侧文件或文件夹的绝对路径"
                  :input-props="{ 'aria-label': '右侧路径' }"
                />
                <n-space
                  ><n-button size="small" :disabled="busy" @click="pick('rightPath', 'file')"
                    >选择文件</n-button
                  ><n-button size="small" :disabled="busy" @click="pick('rightPath', 'directory')"
                    >选择文件夹</n-button
                  ></n-space
                >
              </n-space>
            </n-form-item>
            <n-form-item label="包含文件类型">
              <n-input
                v-model:value="config.include"
                :disabled="busy"
                placeholder="留空表示全部，例如 ts, vue, json"
                :input-props="{ 'aria-label': '包含文件类型' }"
              />
            </n-form-item>
            <n-form-item label="排除文件类型">
              <n-input
                v-model:value="config.exclude"
                :disabled="busy"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 4 }"
                placeholder="留空表示不排除"
                :input-props="{ 'aria-label': '排除文件类型' }"
              />
            </n-form-item>
          </div>
          <p class="file-diff__hint">
            支持 ts、.ts、*.ts，用逗号或空格分隔；排除优先。(无扩展名)
            可匹配无后缀文件。默认排除常见图片、视频和音频，修改规则后重新对比。
          </p>
          <n-space>
            <n-button
              type="primary"
              :disabled="
                busy || detailLoading || !config.leftPath.trim() || !config.rightPath.trim()
              "
              @click="compare"
              >开始对比</n-button
            >
            <n-button v-if="busy" :loading="canceling" @click="cancel">取消对比</n-button>
            <n-button :disabled="busy" @click="swap">交换左右</n-button>
            <n-button quaternary :disabled="busy" @click="resetMedia">恢复媒体排除</n-button>
          </n-space>
        </n-card>
        <n-alert v-if="error" type="error">{{ error }}</n-alert>
        <n-alert v-if="busy" type="info" :show-icon="false">
          <span v-if="!progress">正在准备对比…</span>
          <span v-else>{{
            progress.phase === 'scanning'
              ? `正在扫描 · ${progress.scanned} 个条目`
              : `正在比较 · ${progress.compared} / ${progress.total}`
          }}</span>
          <div v-if="progress?.currentPath" class="file-diff__current">
            {{ progress.currentPath }}
          </div>
        </n-alert>
        <template v-if="result">
          <n-alert v-if="result.canceled || result.truncated || result.errorCount" type="warning">
            <span v-if="result.canceled">对比已取消，当前为部分结果。</span>
            <span v-if="result.truncated">扫描或结果达到 50000 条上限，当前为部分结果。</span>
            <span v-if="result.errorCount"
              >存在 {{ result.errorCount }} 个读取或比较错误，不能判定整体一致。</span
            >
            <details v-if="result.errors.length">
              <summary>查看错误</summary>
              <div
                v-for="(message, index) in result.errors"
                :key="index"
                class="file-diff__current"
              >
                {{ message }}
              </div>
            </details>
          </n-alert>
          <n-alert v-if="staleConfig" type="info" :show-icon="false"
            >路径或过滤规则已修改，以下仍为上次对比结果，请重新对比。</n-alert
          >
          <n-card size="small" title="对比结果">
            <p class="file-diff__hint file-diff__current">
              左侧：{{ result.leftPath }}<br />右侧：{{ result.rightPath }}
            </p>
            <n-space class="file-diff__summary"
              ><n-tag v-for="(count, status) in counts" :key="status" size="small" :bordered="false"
                >{{ FILE_DIFF_STATUS_LABELS[status] }} {{ count }}</n-tag
              ></n-space
            >
            <div class="file-diff__filters">
              <n-select
                v-model:value="config.statusFilter"
                :options="FILE_DIFF_STATUS_OPTIONS"
                aria-label="状态筛选"
              />
              <n-input
                v-model:value="search"
                clearable
                placeholder="搜索相对路径"
                :input-props="{ 'aria-label': '搜索相对路径' }"
              />
            </div>
            <FileDiffTable
              v-if="entries.length"
              :entries="entries"
              :detail-loading="detailLoading"
              @detail="showDetail"
            />
            <n-empty v-else :description="emptyText" />
            <p class="file-diff__hint">
              已比较 {{ result.entries.length }} 项 · 过滤 {{ result.filtered }} 项 ·
              跳过链接/特殊文件 {{ result.skippedLinks }} 项 ·
              {{ (result.elapsed / 1000).toFixed(1) }} 秒
            </p>
          </n-card>
        </template>
        <n-empty
          v-else-if="!busy && !error"
          description="输入两个文件路径或两个文件夹路径，开始对比"
        />
        <FileDiffDetail
          v-if="selected"
          :show="detailOpen"
          :entry="selected"
          :detail="detail"
          :loading="detailLoading"
          :error="detailError"
          @close="closeDetail"
        />
      </div>
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NButton, NCard, NEmpty, NFormItem, NInput, NSelect, NSpace, NTag } from 'naive-ui';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useFileDiff } from '@/composables/useFileDiff';
import { FILE_DIFF_STATUS_LABELS, FILE_DIFF_STATUS_OPTIONS } from '@/constants/fileDiff';
import FileDiffTable from './components/FileDiffTable.vue';
import FileDiffDetail from './components/FileDiffDetail.vue';

const {
  config,
  result,
  progress,
  busy,
  canceling,
  error,
  search,
  entries,
  counts,
  staleConfig,
  detail,
  selected,
  detailOpen,
  detailLoading,
  detailError,
  pick,
  showDetail,
  closeDetail,
  compare,
  cancel,
  resetMedia,
  swap,
} = useFileDiff();
const emptyText = computed(() => {
  if (!result.value?.entries.length) return '没有可显示的比较结果，请检查过滤规则或扫描提示';
  if (search.value || !['all', 'differences'].includes(config.statusFilter))
    return '没有符合状态或路径筛选条件的文件';
  if (result.value.canceled || result.value.truncated || result.value.errorCount)
    return '当前已完成部分没有可显示的差异，请查看上方提示';
  return '已比较的文件内容相同';
});
</script>

<style scoped lang="scss">
.file-diff {
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-3);
  min-width: 0;
  height: 100%;
  overflow: auto;
  padding-right: var(--tb-space-2);
  container-type: inline-size;
  &__paths {
    display: grid;
    align-items: start;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 var(--tb-space-4);
  }
  &__field {
    width: 100%;
  }
  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
  &__current {
    overflow-wrap: anywhere;
    max-height: 140px;
    overflow: auto;
  }
  &__summary {
    margin-bottom: var(--tb-space-3);
  }
  &__filters {
    display: grid;
    grid-template-columns: 180px minmax(0, 1fr);
    gap: var(--tb-space-3);
    margin-bottom: var(--tb-space-3);
  }
}
@container (max-width: 560px) {
  .file-diff__paths,
  .file-diff__filters {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
