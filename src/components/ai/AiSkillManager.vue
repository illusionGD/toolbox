<template>
  <n-card title="Skills" size="small" class="ai-skills">
    <template #header-extra>
      <n-button size="tiny" quaternary :loading="loading" :disabled="busy" @click="refresh">
        刷新
      </n-button>
    </template>
    <p class="ai-skills__hint">
      添加任务说明，让 AI 按需使用。启用后从下一次发送生效，适用于所有 AI 配置。
    </p>
    <div class="ai-skills__library">
      <div class="ai-skills__info">
        <div class="ai-skills__hint">Skill 文件夹：{{ directory || '正在获取路径…' }}</div>
        <div class="ai-skills__hint">
          将 Skill 子文件夹放到这里，或在线安装后点击刷新；每个子文件夹需包含 SKILL.md。
        </div>
      </div>
      <n-button size="tiny" :disabled="busy" @click="openDirectory">打开文件夹</n-button>
    </div>
    <n-space size="small" class="ai-skills__actions">
      <n-button
        size="small"
        :disabled="busy"
        :loading="picking === 'directory'"
        @click="pickLocal('directory')"
      >
        添加本地目录
      </n-button>
      <n-button
        size="small"
        :disabled="busy"
        :loading="picking === 'file'"
        @click="pickLocal('file')"
      >
        添加本地文件
      </n-button>
      <n-button size="small" secondary :disabled="busy" @click="openOnline">在线安装</n-button>
    </n-space>
    <n-alert v-if="warnings.length" type="warning" :bordered="false" class="ai-skills__alert">
      <div v-for="warning in warnings" :key="warning">{{ warning }}</div>
    </n-alert>
    <n-alert v-if="error" type="error" :bordered="false" class="ai-skills__alert">{{
      error
    }}</n-alert>
    <n-empty
      v-if="!loading && !skills.length && !error"
      description="还没有 Skill"
      class="ai-skills__empty"
    />
    <n-scrollbar v-else style="max-height: 42vh">
      <div v-for="skill in skills" :key="skill.id" class="ai-skills__item">
        <div class="ai-skills__info">
          <div class="ai-skills__name">
            <span>{{ skill.name }}</span>
            <n-tag size="small" :type="skill.enabled ? 'success' : 'default'">
              {{ skill.enabled ? '已启用' : '未启用' }}
            </n-tag>
          </div>
          <p class="ai-skills__description">{{ skill.description }}</p>
          <div class="ai-skills__hint">
            {{ skill.fileCount }} 个文件<span v-if="skill.folder"> · {{ skill.folder }}</span>
          </div>
        </div>
        <div class="ai-skills__ops">
          <n-switch
            :value="skill.enabled"
            size="small"
            :disabled="busy"
            :loading="working === skill.id"
            :aria-label="`启用 ${skill.name}`"
            @update:value="(value: boolean) => toggle(skill, value)"
          />
          <n-button size="tiny" quaternary :disabled="busy" @click="viewDetail(skill.id)"
            >查看</n-button
          >
          <n-popconfirm :disabled="busy" @positive-click="remove(skill)">
            <template #trigger>
              <n-button size="tiny" quaternary type="error" :disabled="busy">删除</n-button>
            </template>
            删除 skills 文件夹中的「{{ skill.name }}」及其文件？
          </n-popconfirm>
        </div>
      </div>
    </n-scrollbar>

    <n-modal
      :show="installShow"
      preset="card"
      size="small"
      :title="preview ? '选择要安装的 Skill' : '在线安装 Skill'"
      class="ai-skills__modal"
      :mask-closable="false"
      :closable="!fetching && !installing"
      @update:show="(show: boolean) => !show && closeInstall()"
    >
      <template v-if="!preview">
        <div class="ai-skills__row">
          <div class="ai-skills__label">
            <span>Skill 地址</span>
            <span class="ai-skills__hint"
              >支持 GitHub 仓库、目录 / SKILL.md 链接，以及 HTTPS 的 ZIP 或 SKILL.md
              下载地址。</span
            >
          </div>
          <div class="ai-skills__control">
            <n-input
              v-model:value="sourceUrl"
              :disabled="fetching"
              placeholder="https://github.com/owner/repo"
              @keydown.enter="fetchOnline"
            />
          </div>
        </div>
        <p class="ai-skills__hint">
          下载后可预览内容并选择安装项。单独导入 SKILL.md 时仅保留该文件；需要附带资料请导入目录或
          ZIP。
        </p>
      </template>
      <template v-else>
        <p class="ai-skills__source">来源：{{ preview.source }}</p>
        <n-scrollbar style="max-height: 32vh">
          <n-checkbox-group v-model:value="selectedPaths" :disabled="installing">
            <div
              v-for="candidate in preview.candidates"
              :key="candidate.path"
              class="ai-skills__candidate"
            >
              <n-checkbox :value="candidate.path">{{ candidate.name }}</n-checkbox>
              <p class="ai-skills__description">{{ candidate.description }}</p>
              <div class="ai-skills__candidate-footer">
                <span class="ai-skills__hint"
                  >{{ candidate.fileCount }} 个文件 · {{ candidate.path }}</span
                >
                <n-button size="tiny" quaternary @click="candidateDetail = candidate"
                  >预览说明</n-button
                >
              </div>
            </div>
          </n-checkbox-group>
        </n-scrollbar>
        <n-alert type="info" :bordered="false" class="ai-skills__alert">
          安装完成后手动启用。Skill 可使用现有工具和运行附带的 Python
          脚本；询问模式下运行脚本前需确认。
        </n-alert>
      </template>
      <n-alert v-if="installError" type="error" :bordered="false" class="ai-skills__alert">{{
        installError
      }}</n-alert>
      <template #footer>
        <n-space justify="end" size="small">
          <n-button size="small" :disabled="fetching || installing" @click="closeInstall"
            >取消</n-button
          >
          <n-button
            v-if="preview"
            size="small"
            type="primary"
            :disabled="!selectedPaths.length"
            :loading="installing"
            @click="installSelected"
          >
            安装所选（{{ selectedPaths.length }}）
          </n-button>
          <n-button
            v-else
            size="small"
            type="primary"
            :disabled="!sourceUrl.trim()"
            :loading="fetching"
            @click="fetchOnline"
            >下载并预览</n-button
          >
        </n-space>
      </template>
    </n-modal>

    <n-modal
      :show="Boolean(detail || candidateDetail)"
      preset="card"
      size="small"
      :title="detail?.skill.name ?? candidateDetail?.name ?? 'Skill 说明'"
      class="ai-skills__modal"
      @update:show="closeDetail"
    >
      <n-scrollbar style="max-height: 60vh">
        <p v-if="detail" class="ai-skills__source">来源：{{ detail.skill.source }}</p>
        <pre class="ai-skills__content">{{ detail?.content ?? candidateDetail?.content }}</pre>
        <template v-if="detail">
          <p class="ai-skills__label">附带文件</p>
          <pre class="ai-skills__content">{{ detail.files.join('\n') }}</pre>
        </template>
      </n-scrollbar>
    </n-modal>
  </n-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCheckboxGroup,
  NEmpty,
  NInput,
  NModal,
  NPopconfirm,
  NScrollbar,
  NSpace,
  NSwitch,
  NTag,
  useMessage,
} from 'naive-ui';
import type { AiSkill, AiSkillCandidate, AiSkillDetail, AiSkillPreview } from '@shared/skills';
import {
  aiSkillDetailApi,
  aiSkillLibraryApi,
  discardAiSkillPreviewApi,
  installAiSkillsApi,
  openAiSkillDirectoryApi,
  pickLocalAiSkillsApi,
  previewOnlineAiSkillsApi,
  removeAiSkillApi,
  setAiSkillEnabledApi,
} from '@/services/skills';

const message = useMessage();
const skills = ref<AiSkill[]>([]);
const directory = ref('');
const warnings = ref<string[]>([]);
const loading = ref(false);
const working = ref('');
const picking = ref<'file' | 'directory' | ''>('');
const error = ref('');
const installError = ref('');
const installShow = ref(false);
const sourceUrl = ref('');
const preview = ref<AiSkillPreview | null>(null);
const selectedPaths = ref<string[]>([]);
const fetching = ref(false);
const installing = ref(false);
const detail = ref<AiSkillDetail | null>(null);
const candidateDetail = ref<AiSkillCandidate | null>(null);
const busy = computed(
  () => loading.value || Boolean(working.value || picking.value) || installShow.value,
);
let disposed = false;
const describe = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

async function refresh(): Promise<void> {
  if (loading.value || disposed) return;
  loading.value = true;
  error.value = '';
  try {
    const library = await aiSkillLibraryApi();
    skills.value = library.skills;
    directory.value = library.directory;
    warnings.value = library.warnings;
  } catch (value) {
    error.value = describe(value);
  } finally {
    loading.value = false;
  }
}

async function openDirectory(): Promise<void> {
  if (busy.value) return;
  working.value = 'directory';
  error.value = '';
  try {
    directory.value = await openAiSkillDirectoryApi();
  } catch (value) {
    error.value = describe(value);
  } finally {
    working.value = '';
  }
}

function usePreview(value: AiSkillPreview): void {
  preview.value = value;
  selectedPaths.value = value.candidates.length === 1 ? [value.candidates[0].path] : [];
  installError.value = '';
  installShow.value = true;
}

async function pickLocal(kind: 'file' | 'directory'): Promise<void> {
  if (busy.value) return;
  picking.value = kind;
  error.value = '';
  try {
    const value = await pickLocalAiSkillsApi(kind);
    if (value) {
      if (disposed) await discardAiSkillPreviewApi(value.token);
      else usePreview(value);
    }
  } catch (value) {
    error.value = describe(value);
  } finally {
    picking.value = '';
  }
}

function openOnline(): void {
  installError.value = '';
  preview.value = null;
  selectedPaths.value = [];
  installShow.value = true;
}

async function fetchOnline(): Promise<void> {
  if (fetching.value || !sourceUrl.value.trim()) return;
  fetching.value = true;
  installError.value = '';
  try {
    const value = await previewOnlineAiSkillsApi(sourceUrl.value.trim());
    if (disposed) await discardAiSkillPreviewApi(value.token);
    else usePreview(value);
  } catch (value) {
    installError.value = describe(value);
  } finally {
    fetching.value = false;
  }
}

function closeInstall(): void {
  if (fetching.value || installing.value) return;
  const token = preview.value?.token;
  preview.value = null;
  installShow.value = false;
  candidateDetail.value = null;
  if (token) void discardAiSkillPreviewApi(token).catch(() => {});
}

async function installSelected(): Promise<void> {
  if (!preview.value || !selectedPaths.value.length || installing.value) return;
  installing.value = true;
  installError.value = '';
  try {
    const installed = await installAiSkillsApi(preview.value.token, [...selectedPaths.value]);
    preview.value = null;
    installShow.value = false;
    candidateDetail.value = null;
    message.success(`已安装 ${installed.length} 个 Skill，可在列表中启用`);
    await refresh();
  } catch (value) {
    installError.value = describe(value);
  } finally {
    installing.value = false;
  }
}

async function toggle(skill: AiSkill, enabled: boolean): Promise<void> {
  if (busy.value) return;
  working.value = skill.id;
  error.value = '';
  try {
    const updated = await setAiSkillEnabledApi(skill.id, enabled);
    skills.value = skills.value.map((item) => (item.id === updated.id ? updated : item));
  } catch (value) {
    error.value = describe(value);
  } finally {
    working.value = '';
  }
}

async function remove(skill: AiSkill): Promise<void> {
  if (busy.value) return;
  working.value = skill.id;
  error.value = '';
  try {
    await removeAiSkillApi(skill.id);
    skills.value = skills.value.filter((item) => item.id !== skill.id);
    message.success('已删除 Skill');
  } catch (value) {
    error.value = describe(value);
  } finally {
    working.value = '';
  }
}

async function viewDetail(id: string): Promise<void> {
  if (busy.value) return;
  working.value = id;
  error.value = '';
  try {
    detail.value = await aiSkillDetailApi(id);
  } catch (value) {
    error.value = describe(value);
  } finally {
    working.value = '';
  }
}
function closeDetail(): void {
  detail.value = null;
  candidateDetail.value = null;
}
function refreshOnFocus(): void {
  if (!busy.value) void refresh();
}
onMounted(() => {
  void refresh();
  window.addEventListener('focus', refreshOnFocus);
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('focus', refreshOnFocus);
  if (preview.value) void discardAiSkillPreviewApi(preview.value.token).catch(() => {});
});
</script>

<style scoped lang="scss">
.ai-skills {
  width: 100%;
  background: var(--tb-bg-surface);
  border: 1px solid var(--tb-border);

  &__hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  &__library {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
  }
  &__actions {
    margin: var(--tb-space-3) 0;
  }
  &__alert {
    margin-top: var(--tb-space-3);
  }
  &__empty {
    padding: var(--tb-space-4);
  }
  &__item {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
    padding: var(--tb-space-3) 0;
  }
  &__item + &__item {
    border-top: 1px solid var(--tb-border);
  }
  &__info {
    flex: 1;
    min-width: 0;
  }
  &__name {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    overflow-wrap: anywhere;
  }
  &__description {
    margin: var(--tb-space-1) 0;
    color: var(--tb-text-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-line;
  }
  &__ops {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    gap: var(--tb-space-2);
  }
  &__modal {
    width: 680px;
    max-width: 92vw;
  }
  &__row {
    display: grid;
    gap: var(--tb-space-2);
  }
  &__label {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-1);
  }
  &__control {
    display: flex;
    flex-direction: column;
  }
  &__source {
    color: var(--tb-text-secondary);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  &__candidate {
    padding: var(--tb-space-3) 0;
  }
  &__candidate + &__candidate {
    border-top: 1px solid var(--tb-border);
  }
  &__candidate-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--tb-space-2);
  }
  &__candidate-footer .ai-skills__hint {
    overflow-wrap: anywhere;
  }
  &__content {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 12px;
    line-height: 1.7;
  }
}
@media (max-width: 480px) {
  .ai-skills__item {
    align-items: flex-start;
    flex-direction: column;
  }
  .ai-skills__ops {
    align-self: flex-end;
  }
}
</style>
