<template>
  <n-card class="pet-settings" title="桌宠" size="small">
    <n-alert type="info" :bordered="false" class="pet-settings__alert">
      切到桌宠后工具箱窗口会收起来，只在屏幕右下角留一个小精灵。<strong>右键</strong>点它弹出菜单：「设置
      / AI 对话 / 打开 app」三个入口、<strong>退出桌宠</strong>与<strong>退出 app</strong
      >，菜单里还能直接拖着调大小。标题栏那个 logo 也一样能开关桌宠。<br />
      桌宠开着时<strong>关掉工具箱窗口不会带走它</strong>——两个窗口各关各的，真要整个退出走菜单里的「退出
      app」。
    </n-alert>

    <!-- 资源类型：本轮只有图片能选，spine / live2d 分别是后续两段 -->
    <div class="pet-settings__row">
      <span class="pet-settings__label">资源类型</span>
      <n-radio-group
        :value="store.config.kind"
        @update:value="(v: PetResourceKind) => store.setKind(v)"
      >
        <n-radio value="image">图片</n-radio>
        <n-radio value="spine" disabled>spine（后续版本）</n-radio>
        <n-radio value="live2d" disabled>live2d（后续版本）</n-radio>
      </n-radio-group>
    </div>

    <div class="pet-settings__row">
      <span class="pet-settings__label">桌宠大小</span>
      <n-slider
        class="pet-settings__slider"
        :value="store.config.size"
        :min="PET_SIZE_MIN"
        :max="PET_SIZE_MAX"
        :step="8"
        @update:value="(v: number) => store.setSize(v)"
      />
      <span class="pet-settings__value">{{ store.config.size }} px</span>
    </div>

    <n-divider class="pet-settings__divider" />

    <!--
      五个状态的映射。**留空 = 用默认那格**，默认那格也留空 = 用应用 logo——
      这条兜底在 `@shared/pet` 的 resolvePetVisual 里，桩测断言着
    -->
    <div class="pet-settings__states">
      <div v-for="slot in SLOTS" :key="slot.key" class="pet-settings__slot">
        <div class="pet-settings__slot-head">
          <span class="pet-settings__slot-name">{{ slot.label }}</span>
          <span class="pet-settings__slot-hint">{{ slot.hint }}</span>
        </div>
        <div class="pet-settings__slot-body">
          <n-input
            class="pet-settings__path"
            size="small"
            :value="valueOf(slot.key)"
            readonly
            :placeholder="slot.placeholder"
          />
          <n-button size="small" secondary @click="pick(slot.key)">选择</n-button>
          <n-button size="small" quaternary :disabled="!valueOf(slot.key)" @click="clear(slot.key)">
            清空
          </n-button>
        </div>
      </div>
    </div>

    <!-- 待机轮播：N 条依次播（需求 3 的「长时间待机 N 种轮播」） -->
    <div class="pet-settings__slot">
      <div class="pet-settings__slot-head">
        <span class="pet-settings__slot-name">长时间待机（轮播）</span>
        <span class="pet-settings__slot-hint">可加多张，依次轮播；留空则用默认那张</span>
      </div>
      <div v-for="(item, index) in idleLoop" :key="index" class="pet-settings__slot-body">
        <n-input class="pet-settings__path" size="small" :value="item" readonly />
        <n-button size="small" quaternary @click="removeLoop(index)">移除</n-button>
      </div>
      <div class="pet-settings__slot-body">
        <n-button size="small" secondary @click="addLoop()">添加一张</n-button>
      </div>
    </div>

    <n-divider class="pet-settings__divider" />

    <!--
      AI 头像。**不属于「五个动画状态」那一组**，所以单独一段：它是 AI 对话窗口里助手气泡
      边上那个小圆头像，跟桌宠站在桌面上的样子通常不是同一张图
    -->
    <div class="pet-settings__slot">
      <div class="pet-settings__slot-head">
        <span class="pet-settings__slot-name">AI 头像</span>
        <span class="pet-settings__slot-hint">AI 对话窗口里助手的头像；留空则用应用 logo</span>
      </div>
      <div class="pet-settings__slot-body">
        <img class="pet-settings__avatar" :src="avatarPreview" alt="" />
        <n-input
          class="pet-settings__path"
          size="small"
          :value="store.config.aiAvatarRef"
          readonly
          placeholder="留空则使用应用 logo"
        />
        <n-button size="small" secondary @click="pick('aiAvatar')">选择</n-button>
        <n-button
          size="small"
          quaternary
          :disabled="!store.config.aiAvatarRef"
          @click="clear('aiAvatar')"
        >
          清空
        </n-button>
      </div>
    </div>

    <n-collapse class="pet-settings__advanced">
      <n-collapse-item title="高级：动画时长" name="timing">
        <div v-for="timing in TIMINGS" :key="timing.key" class="pet-settings__row">
          <span class="pet-settings__label">{{ timing.label }}</span>
          <n-input-number
            size="small"
            :value="store.config[timing.key]"
            :min="PET_MS_MIN"
            :max="PET_MS_MAX"
            :step="100"
            @update:value="(v: number | null) => store.setTiming(timing.key, v ?? timing.fallback)"
          />
          <span class="pet-settings__value">毫秒</span>
        </div>
      </n-collapse-item>
    </n-collapse>

    <div class="pet-settings__footer">
      <n-popconfirm @positive-click="store.reset()">
        <template #trigger>
          <n-button size="small" quaternary>恢复默认</n-button>
        </template>
        清空全部桌宠资源配置并恢复默认时长？
      </n-popconfirm>
    </div>
  </n-card>
</template>

<script setup lang="ts">
/**
 * 桌宠设置卡片（设置页里挨着 AI 那张）。
 *
 * 五个状态的映射都可以留空——**留空不是「没配好」，是「用默认那张」**（需求 3），
 * 默认那张也留空就用应用 logo（需求 4）。所以这里不做任何必填校验，只在占位符里说清楚。
 */
import { computed } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDivider,
  NInput,
  NInputNumber,
  NPopconfirm,
  NRadio,
  NRadioGroup,
  NSlider,
} from 'naive-ui';
import {
  PET_IDLE_AFTER_MS_DEFAULT,
  PET_IDLE_LOOP_MS_DEFAULT,
  PET_MS_MAX,
  PET_MS_MIN,
  PET_TRANSIENT_MS_DEFAULT,
  type PetResourceKind,
  type PetStateMap,
} from '@shared/pet';
import { PET_SIZE_MAX, PET_SIZE_MIN } from '@shared/petWindow';
import { pickFilesApi } from '@/services/fs';
import { useAiAvatar } from '@/composables/useAiAvatar';
import { usePetStore } from '@/stores/pet';

// #region setup
const store = usePetStore();
/** 头像预览走的是和 AI 窗口**同一条**解析（配了用那张、没配用 logo），免得两处各画一套。 */
const avatarPreview = useAiAvatar();
// #endregion

// #region constants
/** 单张图的那五格（轮播那格是数组，单独渲染）。`aiAvatar` 不是动画状态，但复用同一套选文件逻辑。 */
type SlotKey = 'default' | 'aiAvatar' | Exclude<keyof PetStateMap, 'idleLoop'>;

const SLOTS: Array<{ key: SlotKey; label: string; hint: string; placeholder: string }> = [
  {
    key: 'default',
    label: '默认资源',
    hint: '所有没单独配的状态都用它',
    placeholder: '留空则使用应用 logo',
  },
  { key: 'idle', label: '默认状态', hint: '什么都没发生时', placeholder: '留空 = 用默认资源' },
  { key: 'click', label: '点击后', hint: '点一下，短暂播放', placeholder: '留空 = 用默认资源' },
  { key: 'drag', label: '拖拽中', hint: '按住拖着走的时候', placeholder: '留空 = 用默认资源' },
  { key: 'drop', label: '拖拽后放下', hint: '松手，短暂播放', placeholder: '留空 = 用默认资源' },
];

/** 三个时长。 */
const TIMINGS = [
  { key: 'idleAfterMs', label: '静置多久进入待机轮播', fallback: PET_IDLE_AFTER_MS_DEFAULT },
  { key: 'transientMs', label: '点击 / 放下的播放时长', fallback: PET_TRANSIENT_MS_DEFAULT },
  { key: 'idleLoopMs', label: '待机轮播每张停留', fallback: PET_IDLE_LOOP_MS_DEFAULT },
] as const;

/** 文件选择器的过滤：和主进程 readDataUrl 认得的那批对齐（gif 动画会原样保留）。 */
const IMAGE_FILTERS = [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'] },
];
// #endregion

// #region computed
const idleLoop = computed(() => store.config.states.idleLoop ?? []);
// #endregion

// #region methods
/**
 * 取某一格当前的值。
 * @param key 格子。
 * @returns 路径；没配是空串。
 */
function valueOf(key: SlotKey): string {
  if (key === 'default') return store.config.defaultRef;
  if (key === 'aiAvatar') return store.config.aiAvatarRef;
  return store.config.states[key] ?? '';
}

/**
 * 选一张图填进某一格。
 * @param key 格子。
 */
async function pick(key: SlotKey): Promise<void> {
  const files = await pickFilesApi({ filters: IMAGE_FILTERS, multiple: false, title: '选择图片' });
  const path = files[0]?.path;
  if (!path) return;
  if (key === 'default') store.setDefaultRef(path);
  else if (key === 'aiAvatar') store.setAiAvatarRef(path);
  else store.setStateRef(key, path);
}

/**
 * 清空某一格（回到「用默认 / 用 logo」）。
 * @param key 格子。
 */
function clear(key: SlotKey): void {
  if (key === 'default') store.setDefaultRef('');
  else if (key === 'aiAvatar') store.setAiAvatarRef('');
  else store.setStateRef(key, '');
}

/** 往轮播里加一张。 */
async function addLoop(): Promise<void> {
  const files = await pickFilesApi({ filters: IMAGE_FILTERS, multiple: true, title: '选择图片' });
  const paths = files.map((f) => f.path);
  if (paths.length === 0) return;
  store.setIdleLoop([...idleLoop.value, ...paths]);
}

/**
 * 从轮播里移掉一张。
 * @param index 下标。
 */
function removeLoop(index: number): void {
  store.setIdleLoop(idleLoop.value.filter((_, i) => i !== index));
}
// #endregion
</script>

<style scoped lang="scss">
.pet-settings {
  &__alert {
    margin-bottom: var(--tb-space-3);
  }

  &__row {
    display: flex;
    align-items: center;
    gap: var(--tb-space-3);
    margin-bottom: var(--tb-space-3);
  }

  &__label {
    width: 180px;
    flex-shrink: 0;
    color: var(--tb-text-secondary);
    font-size: 13px;
  }

  &__slider {
    flex: 1;
  }

  &__value {
    width: 56px;
    flex-shrink: 0;
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  &__divider {
    margin: var(--tb-space-3) 0;
  }

  &__states {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-3);
  }

  &__slot {
    display: flex;
    flex-direction: column;
    gap: var(--tb-space-1);
  }

  &__slot-head {
    display: flex;
    align-items: baseline;
    gap: var(--tb-space-2);
  }

  &__slot-name {
    color: var(--tb-text-primary);
    font-size: 13px;
  }

  &__slot-hint {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  &__slot-body {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    margin-top: var(--tb-space-1);
  }

  &__path {
    flex: 1;
    min-width: 0;
  }

  // 头像预览：和 AI 对话里那个小圆头像一样是圆的，contain 免得非方图被拉变形
  &__avatar {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    object-fit: contain;
    background: var(--tb-bg-elevated);
    border: 1px solid var(--tb-border);
    border-radius: 50%;
  }

  &__advanced {
    margin-top: var(--tb-space-3);
  }

  &__footer {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--tb-space-3);
  }
}
</style>
