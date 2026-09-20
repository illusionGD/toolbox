<template>
  <ToolPageLayout
    title="网页自动化测试"
    category="开发工具"
    desc="录制一次操作，切换环境反复验证。支持 JSON / TypeScript / JavaScript 导入导出。"
  >
    <template #main>
      <div class="webtest">
        <n-card size="small">
          <n-tabs v-model:value="tab" type="line" :animated="false">
            <n-tab-pane name="record" tab="录制用例">
              <div class="webtest__fields">
                <n-form-item label="用例名称">
                  <n-input
                    v-model:value="config.name"
                    :disabled="busy"
                    maxlength="120"
                    placeholder="例如：登录与创建订单"
                  />
                </n-form-item>
                <n-form-item label="浏览器">
                  <n-select
                    v-model:value="config.browser"
                    :disabled="busy"
                    :options="browserOptions"
                  />
                </n-form-item>
                <n-form-item label="浏览器宽度（px）">
                  <n-input-number
                    v-model:value="config.viewportWidth"
                    :disabled="busy"
                    :min="WEBTEST_VIEWPORT_LIMITS.width.min"
                    :max="WEBTEST_VIEWPORT_LIMITS.width.max"
                    :precision="0"
                    :input-props="{ 'aria-label': '录制浏览器宽度' }"
                  />
                </n-form-item>
                <n-form-item label="浏览器高度（px）">
                  <n-input-number
                    v-model:value="config.viewportHeight"
                    :disabled="busy"
                    :min="WEBTEST_VIEWPORT_LIMITS.height.min"
                    :max="WEBTEST_VIEWPORT_LIMITS.height.max"
                    :precision="0"
                    :input-props="{ 'aria-label': '录制浏览器高度' }"
                  />
                </n-form-item>
                <n-form-item class="webtest__wide" label="录制入口 URL">
                  <n-input
                    :value="config.startUrl"
                    :disabled="busy"
                    placeholder="https://test.example.com/app/login"
                    @update:value="setStartUrl"
                  />
                </n-form-item>
                <n-form-item class="webtest__wide" label="录制环境根地址">
                  <n-input
                    v-model:value="config.recordBaseUrl"
                    :disabled="busy"
                    placeholder="https://test.example.com/app/"
                  />
                </n-form-item>
                <n-form-item v-if="config.recordVideo" label="视频格式">
                  <n-select
                    v-model:value="config.videoFormat"
                    :disabled="busy"
                    :options="videoFormatOptions"
                  />
                </n-form-item>
              </div>
              <n-space align="center" justify="space-between">
                <n-space align="center">
                  <n-switch
                    v-model:value="config.recordVideo"
                    :disabled="busy"
                    aria-label="同时录制视频"
                  />
                  <span>同时录制视频</span>
                </n-space>
                <n-button
                  type="primary"
                  :disabled="busy || !canRecord"
                  :loading="loading && snapshot.mode === 'starting'"
                  @click="startRecord"
                  >开始新录制</n-button
                >
              </n-space>
              <p class="webtest__hint">
                宽高为页面可视区域，不含地址栏和窗口边框，默认 1280 ×
                720。开启视频后，结束录制会按所选格式保存，MP4 需等待转换完成。
              </p>
            </n-tab-pane>
            <n-tab-pane name="replay" tab="回放测试">
              <div class="webtest__fields">
                <n-form-item class="webtest__wide" label="回放环境根地址">
                  <n-input
                    v-model:value="config.replayBaseUrl"
                    :disabled="busy"
                    placeholder="https://staging.example.com/another-app/"
                  />
                </n-form-item>
                <n-form-item label="浏览器">
                  <n-select
                    v-model:value="config.browser"
                    :disabled="busy"
                    :options="browserOptions"
                  />
                </n-form-item>
                <n-form-item label="单步超时（毫秒）">
                  <n-input-number
                    v-model:value="config.timeout"
                    :disabled="busy"
                    :min="100"
                    :max="120000"
                    :step="1000"
                  />
                </n-form-item>
              </div>
              <n-space align="center">
                <n-switch
                  v-model:value="config.useRecordedViewport"
                  :disabled="busy"
                  aria-label="使用用例尺寸"
                />
                <span
                  >使用用例尺寸<span v-if="snapshot.flow"
                    >（{{ snapshot.flow.viewport.width }} ×
                    {{ snapshot.flow.viewport.height }}）</span
                  ></span
                >
              </n-space>
              <div v-if="!config.useRecordedViewport" class="webtest__fields">
                <n-form-item label="浏览器宽度（px）">
                  <n-input-number
                    v-model:value="config.replayWidth"
                    :disabled="busy"
                    :min="WEBTEST_VIEWPORT_LIMITS.width.min"
                    :max="WEBTEST_VIEWPORT_LIMITS.width.max"
                    :precision="0"
                    :input-props="{ 'aria-label': '回放浏览器宽度' }"
                  />
                </n-form-item>
                <n-form-item label="浏览器高度（px）">
                  <n-input-number
                    v-model:value="config.replayHeight"
                    :disabled="busy"
                    :min="WEBTEST_VIEWPORT_LIMITS.height.min"
                    :max="WEBTEST_VIEWPORT_LIMITS.height.max"
                    :precision="0"
                    :input-props="{ 'aria-label': '回放浏览器高度' }"
                  />
                </n-form-item>
              </div>
              <n-space align="center" justify="space-between">
                <span class="webtest__hint">{{ snapshot.flow?.name || '请先录制或导入用例' }}</span>
                <n-button
                  type="primary"
                  :disabled="
                    busy ||
                    !validReplaySize ||
                    !snapshot.flow?.steps.length ||
                    !config.replayBaseUrl.trim()
                  "
                  @click="replay"
                  >开始回放</n-button
                >
              </n-space>
              <p class="webtest__hint">
                替换根地址即可复用用例，例如 ./login 会映射到当前环境目录下的
                login。回放独立运行，不录制操作或视频。
              </p>
            </n-tab-pane>
          </n-tabs>
        </n-card>
        <n-alert v-if="snapshot.mode !== 'idle'" type="info" :show-icon="false">
          <n-space align="center" justify="space-between">
            <span
              >{{ modeText }} · 已录制 {{ snapshot.flow?.steps.length ?? 0 }} 步<span
                v-if="snapshot.mode === 'replaying'"
                >，已通过 {{ passed }} 步</span
              >
            </span>
            <n-button
              size="small"
              :disabled="loading || snapshot.mode === 'starting' || snapshot.mode === 'stopping'"
              @click="stop"
              >{{ snapshot.mode === 'recording' ? '结束录制' : '停止' }}</n-button
            >
          </n-space>
        </n-alert>
        <n-alert
          v-if="snapshot.mode === 'recording' && snapshot.pausedPageIds?.length"
          type="info"
          :show-icon="false"
        >
          页签
          {{ snapshot.pausedPageIds.join('、') }}
          已离开录制范围，暂不记录其中的操作；返回录制环境后自动继续，其余页签不受影响。
        </n-alert>
        <n-alert v-if="snapshot.error" type="error" title="测试已停止 / 需要处理">
          <pre class="webtest__error">{{ snapshot.error }}</pre>
        </n-alert>
        <n-alert v-else-if="snapshot.outcome === 'passed'" type="success"
          >全部 {{ passed }} 步通过。</n-alert
        >
        <n-alert v-else-if="snapshot.outcome === 'recorded'" type="success"
          >录制已结束，用例已自动保存。可编辑步骤、添加检查点或切换到回放测试。</n-alert
        >
        <n-alert v-else-if="snapshot.outcome === 'canceled'" type="warning"
          >回放已取消，后续步骤未执行。</n-alert
        >
        <WebTestVideos :mode="snapshot.mode" :record-video="config.recordVideo" />
        <n-card
          size="small"
          :title="
            snapshot.flow ? `${snapshot.flow.name} · ${snapshot.flow.steps.length} 步` : '测试步骤'
          "
        >
          <template #header-extra>
            <n-space :size="6">
              <n-button
                size="small"
                :disabled="busy || !snapshot.flow?.steps.length"
                @click="confirmClearSteps"
                >清空步骤</n-button
              >
              <n-button size="small" :disabled="busy" @click="importFile">导入用例</n-button>
              <n-dropdown
                :options="exportOptions"
                :disabled="busy || !snapshot.flow"
                @select="selectExport"
              >
                <n-button size="small" :disabled="busy || !snapshot.flow">导出</n-button>
              </n-dropdown>
            </n-space>
          </template>
          <n-empty
            v-if="!snapshot.flow?.steps.length"
            description="输入 URL 录制操作，或导入本工具导出的 JSON / TS / JS 用例"
          />
          <template v-else>
            <n-space class="webtest__step-toolbar" justify="space-between" align="center">
              <span class="webtest__hint">{{
                selectedIndex >= 0
                  ? `在第 ${selectedIndex + 1} 步后插入检查点`
                  : '点击步骤选择检查点插入位置'
              }}</span>
              <n-button size="small" :disabled="busy" @click="addCheckpoint">添加检查点</n-button>
            </n-space>
            <WebTestSteps
              :steps="snapshot.flow.steps"
              :results="snapshot.results"
              :active-step-id="snapshot.activeStepId"
              :selected-id="selectedId"
              :disabled="busy"
              @edit="editStep"
              @remove="deleteStep"
              @select="selectStep"
            />
            <p class="webtest__hint">
              自动定位优先使用测试属性、稳定 ID、类名和祖先锚点，没有唯一定位时使用结构路径兜底。
              标记“待补充定位”的步骤需编辑 CSS 或为元素配置 data-testid 后重新录制。
              检查点用于验证可见性、输入值、勾选状态及页面地址。
            </p>
          </template>
        </n-card>
        <n-card v-if="otherArtifacts.length" size="small" title="测试报告与截图">
          <n-space vertical>
            <n-button
              v-for="path in otherArtifacts"
              :key="path"
              text
              class="webtest__artifact"
              @click="revealArtifact(path)"
              >{{ artifactName(path) }} · 在文件夹中显示</n-button
            >
          </n-space>
        </n-card>
        <n-collapse>
          <n-collapse-item title="用例复用与使用说明" name="help">
            <div class="webtest__help">
              <p>
                1.
                录制入口是当前要打开的页面，环境根地址是该应用的部署目录。用例仅保存根目录内的相对路径，保留查询参数和
                hash。
              </p>
              <p>
                2.
                回放使用独立浏览器会话。需登录的流程请从登录页开始录制；输入值会保存在用例中，建议使用测试账号。
              </p>
              <p>
                3. TS / JS 导出是可执行 Playwright 脚本。安装 playwright-core 后，通过 node 用例.js
                环境根地址 或 npx tsx 用例.ts 环境根地址
                运行。重新导入仅读取脚本数据区；额外手写代码不参与导入。
              </p>
              <p>
                4.
                遇到文件上传、拖拽、原生对话框等无法可靠还原的操作，会保留“需手工处理”步骤并在该处停止。
                跳出环境根目录时仅暂停对应页签的操作录制，返回后继续；外部页面不写入用例，视频仍连续录制。
              </p>
            </div>
          </n-collapse-item>
        </n-collapse>
      </div>
      <WebTestStepEditor
        :show="editorVisible"
        :step="editingStep"
        :page-id="checkpointPageId"
        :loading="loading"
        @close="closeEditor"
        @save="saveEditedStep"
      />
    </template>
  </ToolPageLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDropdown,
  NEmpty,
  NFormItem,
  NInput,
  NInputNumber,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  useDialog,
} from 'naive-ui';
import type { WebTestFormat, WebTestStep } from '@shared/webtest';
import { WEBTEST_VIEWPORT_LIMITS } from '@shared/webtest';
import ToolPageLayout from '@/components/layout/ToolPageLayout.vue';
import { useWebTest } from '@/composables/useWebTest';
import { showInFolderApi } from '@/services/file';
import WebTestSteps from './components/WebTestSteps.vue';
import WebTestStepEditor from './components/WebTestStepEditor.vue';
import WebTestVideos from './components/WebTestVideos.vue';

const {
  config,
  snapshot,
  loading,
  busy,
  validRecordSize,
  validReplaySize,
  passed,
  setStartUrl,
  record,
  replay,
  stop,
  importFile,
  exportFile,
  saveStep,
  removeStep,
  clearSteps,
} = useWebTest();
const dialog = useDialog();
const otherArtifacts = computed(() =>
  snapshot.value.artifacts.filter((path) => !/\.(webm|mp4)$/i.test(path)),
);
const tab = ref('record');
const selectedId = ref<string | null>(null);
const editorVisible = ref(false);
const editingStep = ref<WebTestStep | null>(null);
const selectedIndex = computed(
  () => snapshot.value.flow?.steps.findIndex((step) => step.id === selectedId.value) ?? -1,
);
const checkpointPageId = computed(
  () => snapshot.value.flow?.steps[selectedIndex.value]?.pageId ?? 'page-1',
);
const canRecord = computed(() =>
  Boolean(
    validRecordSize.value &&
    config.name.trim() &&
    config.startUrl.trim() &&
    config.recordBaseUrl.trim(),
  ),
);
const modeText = computed(
  () =>
    ({
      idle: '就绪',
      starting: '正在启动浏览器',
      recording: '正在录制，请在浏览器中操作',
      replaying: '正在回放',
      stopping: '正在停止并保存产物',
    })[snapshot.value.mode],
);
const browserOptions = [
  { label: 'Microsoft Edge', value: 'msedge' },
  { label: 'Google Chrome', value: 'chrome' },
];
const videoFormatOptions = [
  { label: 'WebM', value: 'webm' },
  { label: 'MP4（H.264）', value: 'mp4' },
];
const exportOptions = [
  { label: 'JSON 数据', key: 'json' },
  { label: 'TypeScript 脚本', key: 'ts' },
  { label: 'JavaScript 脚本', key: 'js' },
];

/** 当前用例会被替换，给 QA 留出导出的机会。 */
const startRecord = (): void => {
  if (!snapshot.value.flow?.steps.length) {
    void record();
    return;
  }
  dialog.warning({
    title: '开始新录制',
    content: '新录制将替换当前用例，请先导出需要保留的用例。',
    positiveText: '开始录制',
    negativeText: '取消',
    onPositiveClick: record,
  });
};
/** 清空会删除当前操作步骤，确认后同步重置编辑位置。 */
const confirmClearSteps = (): void => {
  dialog.warning({
    title: '清空操作步骤',
    content: '将清空当前用例的全部步骤和回放结果，保留用例信息与环境配置。',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      await clearSteps();
      selectedId.value = null;
      editingStep.value = null;
      editorVisible.value = false;
    },
  });
};
/** @param key 所选导出格式。 */
const selectExport = (key: string): void => {
  void exportFile(key as WebTestFormat);
};
/** @param id 用于插入检查点的步骤 ID。 */
const selectStep = (id: string): void => {
  selectedId.value = id;
};
/** @param step 要编辑的步骤。 */
const editStep = (step: WebTestStep): void => {
  editingStep.value = step;
  editorVisible.value = true;
};
/** 新建检查点，保存时插在当前选择的步骤之后。 */
const addCheckpoint = (): void => {
  editingStep.value = null;
  editorVisible.value = true;
};
/** 关闭步骤编辑器。 */
const closeEditor = (): void => {
  editorVisible.value = false;
};
/** @param step 编辑后的步骤。 */
const saveEditedStep = async (step: WebTestStep): Promise<void> => {
  if (await saveStep(step, editingStep.value ? undefined : (selectedId.value ?? undefined)))
    editorVisible.value = false;
};
/** @param id 要删除的步骤。 */
const deleteStep = (id: string): void => {
  dialog.warning({
    title: '删除步骤',
    content: '删除后请确认后续步骤仍可独立定位和执行。',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => removeStep(id),
  });
};
/** @param path 产物绝对路径。 */
const revealArtifact = async (path: string): Promise<void> => {
  try {
    await showInFolderApi(path);
  } catch {
    /* service 统一显示错误。 */
  }
};
/** @param path 产物路径。 @returns 文件名。 */
const artifactName = (path: string): string => path.split(/[\\/]/).at(-1) ?? path;
</script>

<style scoped lang="scss">
.webtest {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--tb-space-3);
  padding-bottom: var(--tb-space-4);
  container: webtest / inline-size;
  &__fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 0 var(--tb-space-4);
  }
  &__wide {
    grid-column: 1 / -1;
  }
  &__hint,
  &__help {
    color: var(--tb-text-secondary);
    font-size: 12px;
    line-height: 1.7;
  }
  &__hint {
    margin: var(--tb-space-2) 0 0;
  }
  &__step-toolbar {
    margin-bottom: var(--tb-space-3);
  }
  &__error {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    max-height: 160px;
    overflow: auto;
    margin: 0;
  }
  &__artifact {
    max-width: 100%;
    justify-content: flex-start;
  }
  :deep(.n-card) {
    flex-shrink: 0;
  }
  :deep(.n-input-number) {
    width: 100%;
  }
}
@container webtest (max-width: 500px) {
  .webtest__fields {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
