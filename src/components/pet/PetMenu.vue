<template>
  <div class="pet-menu">
    <div class="pet-menu__size">
      <div class="pet-menu__size-head">
        <span>大小</span>
        <n-input-number
          class="pet-menu__size-input"
          :value="store.config.size"
          :min="PET_SIZE_MIN"
          :max="PET_SIZE_MAX"
          size="small"
          :show-button="false"
          @update:value="onSize"
        />
        <span class="pet-menu__size-unit">px</span>
      </div>
      <div class="pet-menu__size-ctrl">
        <n-slider
          class="pet-menu__slider"
          :value="store.config.size"
          :min="PET_SIZE_MIN"
          :max="PET_SIZE_MAX"
          :step="8"
          :tooltip="false"
          :theme-overrides="SLIDER_THEME"
          @update:value="onSize"
        />
      </div>
    </div>
    <div class="pet-menu__divider" />
    <template v-for="item in ITEMS" :key="item.key">
      <div v-if="item.divided" class="pet-menu__divider" />
      <button
        class="pet-menu__item"
        :class="{ 'pet-menu__item--exit': item.exit }"
        type="button"
        @click="pick(item.key)"
      >
        <n-icon class="pet-menu__icon" :size="16"><component :is="item.icon" /></n-icon>
        <span class="pet-menu__label">{{ item.label }}</span>
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 桌宠的右键菜单（需求 5 的按钮组）。
 *
 * 从上往下：
 * - **实时调大小**（review 加的：「加一个可以实时调节大小的拖拽 + input 框」）。滑块与
 *   输入框共用 `store.setSize`，那条 action 会**立刻**让主进程改窗口尺寸、而把落盘与
 *   跨窗口广播防抖掉，所以拖起来是实时缩放且不刷爆写盘（见 `src/stores/pet.ts`）。
 *   它**不是菜单项**（不可点、不在 `ITEMS` 里），窗口高度里对应的是 `PET_MENU_SIZE_ROW`。
 *   排版是**输入框在上、滑块单独占下面一整行**（review 第三轮定的）：菜单只有 208px 宽，
 *   滑块和输入框挤在同一行时滑块只剩一百来像素、拖起来一格好几个 px；单独占一行才够长。
 *   滑块本身也按 {@link SLIDER_THEME} 缩过（默认手柄 18px 在这个尺度上过于抢眼）。
 * - **导航三项**（设置 / AI 对话 / 打开 app）——都**不关桌宠**。用户原话是「桌宠算是
 *   整个工具的小精灵，拥有整个 app 的控制权」，它退场了控制权就没了，所以「把主窗口
 *   拿回来」和「退出桌宠」是两码事。
 * - **隐藏桌宠**（review 第四轮加的：「加个隐藏桌宠的功能，隐藏后放到任务栏的隐藏处」）
 *   ——收进系统托盘，**桌宠模式不退**，位置大小动画全留着。它排在分隔线之后但**不按出口
 *   项降色**，因为它什么都没结束。主进程侧有一条硬守卫：**托盘建不起来就拒绝隐藏**
 *   （见 `main/pet/tray.ts`），不然主窗口也藏着、桌宠又 `skipTaskbar`，就没有出口了。
 * - **出口两项**（退出桌宠 / 退出 app）——review 加的。原先这里一个出口都没有，理由是
 *   「首页那个开关才是退出的地方」；但那要求用户先想到「打开 app 界面」再去首页找开关，
 *   桌宠模式下最想干的两件事反而最绕。**这两项排在最后并降一档颜色**（不给紫色，紫色是
 *   主动作的强调色），退出 app 垫底，减少手滑。
 *
 * **不给二次确认**：这个窗口上压根没挂 dialog / message provider（它不该弹任何东西），
 * 而所有状态（会话、配置、窗口位置）本来就是随时落盘的，退出不丢东西。
 *
 * 这块菜单**不是第三个窗口**，也不是常驻的大透明窗口（那会在屏幕角上常年吞掉一片点击）：
 * 菜单展开时由主进程把桌宠窗口临时放大，精灵锚在窗口右下角、窗口向左上长。
 * **加减菜单项时必须同步改 `shared/petWindow.ts` 的 `PET_MENU_ITEM_COUNT`**，那是窗口
 * 放大到多高的依据——少算一项，最下面那项（也就是「退出 app」）会被窗口边缘裁掉。
 */
import { NIcon, NInputNumber, NSlider } from 'naive-ui';
import type { SliderProps } from 'naive-ui';
import type { Component } from 'vue';
import {
  ChatbubbleEllipsesOutline,
  ExitOutline,
  EyeOffOutline,
  OpenOutline,
  PowerOutline,
  SettingsOutline,
} from '@vicons/ionicons5';
import { PET_SIZE_MAX, PET_SIZE_MIN } from '@shared/petWindow';
import {
  closePetApi,
  hidePetApi,
  petOpenAiWindowApi,
  petQuitAppApi,
  petShowHostApi,
} from '@/services/pet';
import { usePetStore } from '@/stores/pet';

// #region emits
const emit = defineEmits<{ picked: [] }>();
// #endregion

// #region state
const store = usePetStore();
// #endregion

// #region constants
/**
 * 滑块缩小一档。
 *
 * naive-ui 默认手柄 18px、轨道 4px，那是给设置页那种整页表单用的；这个菜单一共才 208px
 * 宽、每项 30px 高，照默认画出来手柄比旁边的菜单文字还高，视觉上整块「大小」区喧宾夺主
 * （review 原话「设置大小的拖拽太大了」）。手柄 12 / 轨道 3 是**和菜单项文字同一量级**的
 * 尺寸，仍然按得住（12px 已经超过 Windows 上的最小可点目标）。
 *
 * 改这两个数要回头看 `.pet-menu__size-ctrl` 那行的高度与 `PET_MENU_SIZE_ROW`：手柄一大，
 * 滑块自己的盒子就跟着高，菜单会被窗口边缘裁掉一截。
 */
const SLIDER_THEME: NonNullable<SliderProps['themeOverrides']> = {
  handleSize: '12px',
  railHeight: '3px',
};

/** 一个菜单项。 */
interface MenuItem {
  /** 点了要干什么（见 {@link pick}）。 */
  key: 'settings' | 'ai' | 'app' | 'hide' | 'exitPet' | 'quitApp';
  /** 显示的字。 */
  label: string;
  /** 图标组件。 */
  icon: Component;
  /** 这项之前画一条分隔线（导航组与出口组之间那条）。 */
  divided?: boolean;
  /** 是不是出口项（降一档颜色，不给紫色）。 */
  exit?: boolean;
}

/**
 * 六个菜单项。顺序：导航三项（设置 / AI 对话 / 打开 app）→ 分隔线 → 隐藏 → 出口两项。
 *
 * 「隐藏桌宠」排在分隔线之后、但**不算出口项**（保留紫色 hover）：它不结束任何东西，
 * 桌宠模式、位置、正在播的动画全都留着，点托盘图标原样回来。
 *
 * 项数要和 `PET_MENU_ITEM_COUNT` 对得上（见文件头）。
 */
const ITEMS: MenuItem[] = [
  { key: 'settings', label: '设置', icon: SettingsOutline },
  { key: 'ai', label: 'AI 对话', icon: ChatbubbleEllipsesOutline },
  { key: 'app', label: '打开 app', icon: OpenOutline },
  { key: 'hide', label: '隐藏桌宠', icon: EyeOffOutline, divided: true },
  { key: 'exitPet', label: '退出桌宠', icon: ExitOutline, exit: true },
  { key: 'quitApp', label: '退出 app', icon: PowerOutline, exit: true },
];
// #endregion

// #region methods
/**
 * 改大小。
 *
 * 输入框清空时 naive-ui 会给 `null`，直接丢给 `setSize` 会被 `clampPetSize` 当成脏值
 * 弹回默认 160——用户只是想删掉重打，所以这一步忽略。
 * @param value 新的边长；null 表示输入框被清空了。
 */
function onSize(value: number | null): void {
  if (value === null) return;
  store.setSize(value);
}

/**
 * 点了某一项。
 * @param key 菜单项。
 */
function pick(key: MenuItem['key']): void {
  switch (key) {
    // AI 对话开的是**独立的 AI 窗口**，主窗口保持隐藏——用户要的是和小精灵说话，
    // 不是把整个工具箱翻出来
    case 'ai':
      void petOpenAiWindowApi();
      break;
    // 退出桌宠 = 主窗口回来 + 桌宠销毁。和标题栏那个 logo 入口走的是同一条通道
    case 'exitPet':
      void closePetApi();
      break;
    // 隐藏 ≠ 退出：窗口留着、桌宠模式留着，只是收进系统托盘，点托盘图标原样回来。
    // 主进程会先确认托盘真的建起来了才藏（藏进一个叫不回来的地方比不藏更糟）
    case 'hide':
      void hidePetApi();
      break;
    // 退出 app 不能在这边自己 close 窗口：桌宠的 close 被主进程拦成「退出桌宠模式」了，
    // 真正的退出得走专用通道（理由见 main/pet/petWindow.ts 的 quitAppFromPet）
    case 'quitApp':
      void petQuitAppApi();
      break;
    default:
      void petShowHostApi(key);
  }
  emit('picked');
}
// #endregion
</script>

<style scoped lang="scss">
.pet-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--tb-space-1);
  background: var(--tb-bg-surface);
  border: 1px solid var(--tb-border);
  border-radius: var(--tb-radius-md);
  // 窗口本身 hasShadow:false（透明窗口带原生阴影会在 Win 上画出矩形边），
  // 所以菜单自己画一层，否则它会像是浮在桌面上的一块裸色块
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);

  &__size {
    // 高度要和 shared/petWindow.ts 的 PET_MENU_SIZE_ROW = 46 对得上：
    // 输入框那行 28（naive-ui small 输入框的高）+ 间距 4 + 滑块那行 14 = 46。
    // 改这里就得改那个常数，否则菜单会被裁
    padding: 0 2px;
    margin-top: 5px;

    &-head {
      display: flex;
      align-items: center;
      gap: var(--tb-space-2);
      height: 28px;
      margin-bottom: 4px;
      font-size: 12px;
      color: var(--tb-text-secondary);
    }

    &-unit {
      font-variant-numeric: tabular-nums;
    }

    // 滑块单独占一整行：菜单才 208px 宽，和输入框挤一行时它只剩一百来像素，
    // 64→512 的量程摊在那么短的轨道上，拖一格就是好几个 px（review 提的）
    &-ctrl {
      display: flex;
      align-items: center;
      height: 14px;
    }

    &-input {
      // 让输入框把标题行剩下的宽度吃掉（右边只留「px」两个字），数字才不会被截断
      flex: 1;
      min-width: 0;
    }
  }

  &__slider {
    flex: 1;
    min-width: 0;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
    width: 100%;
    padding: 6px var(--tb-space-2);
    text-align: left;
    color: var(--tb-text-primary);
    background: transparent;
    border: none;
    border-radius: var(--tb-radius-sm);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 0.12s,
      color 0.12s;

    // 紫色只描当前 hover 的那一项，底仍是中性面板色
    &:hover {
      color: var(--tb-color-primary);
      background: var(--tb-bg-hover);
    }

    // 出口两项降一档：默认次级灰，hover 也不给紫色（紫色留给主动作），
    // 只提亮到主文本色 —— 让它们看起来不像「要点的那个」
    &--exit {
      color: var(--tb-text-secondary);

      &:hover {
        color: var(--tb-text-primary);
        background: var(--tb-bg-hover);
      }
    }
  }

  &__divider {
    flex-shrink: 0;
    height: 1px;
    margin: var(--tb-space-1) 2px;
    background: var(--tb-border);
  }

  &__icon {
    flex-shrink: 0;
  }

  &__label {
    font-size: 13px;
  }
}
</style>
