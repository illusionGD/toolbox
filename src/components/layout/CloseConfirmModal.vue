<template>
  <n-modal
    :show="show"
    preset="card"
    class="close-confirm"
    :style="MODAL_STYLE"
    size="small"
    title="关闭 Toolbox"
    :mask-closable="false"
    :bordered="false"
    @update:show="(v: boolean) => !v && cancel()"
  >
    <p class="close-confirm__text">
      正在进行的任务（转码、压缩）会随退出一起中断。收进托盘可以让它们继续跑完，随后从托盘图标回来。
    </p>

    <n-checkbox v-model:checked="remember" size="small">记住我的选择，不再询问</n-checkbox>

    <!-- 托盘建不起来时窗口是原样留着的（主进程拒绝了隐藏），弹窗也就不能关 -->
    <n-alert v-if="trayFailed" type="warning" :bordered="false" class="close-confirm__alert">
      系统托盘不可用，已保留窗口。可以直接退出，或者取消后继续用。
    </n-alert>

    <template #footer>
      <div class="close-confirm__footer">
        <n-button size="small" quaternary @click="cancel">取消</n-button>
        <n-space size="small">
          <n-button size="small" :disabled="trayFailed" @click="choose('tray')">
            最小化到托盘
          </n-button>
          <n-button size="small" type="error" @click="choose('quit')">退出</n-button>
        </n-space>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { NAlert, NButton, NCheckbox, NModal, NSpace } from 'naive-ui';
import type { AppCloseChoice } from '@shared/appWindow';
import { resolveCloseApi } from '@/services/appWindow';
import { useCloseAction } from '@/composables/useCloseAction';

/**
 * 点 ✕（或 `Alt+F4`）时的关闭确认弹窗。
 *
 * **应用内的 naive-ui 弹窗，而不是 `dialog.showMessageBox`**：系统弹窗跟不了主题配色，
 * 而这一下是用户最常看见的交互之一。
 *
 * 两种情况会弹它，主进程那边是一条通道（`closePrompt`）：① 设置是「每次询问」；
 * ② 设置是「最小化到托盘」但**托盘建不起来**——那时不许静默退出（会杀掉正在跑的 ffmpeg），
 * 于是退回来问用户。
 */
const props = defineProps<{
  /** 是否显示。由 AppLayout 按主进程的推送来控。 */
  show: boolean;
}>();

const emit = defineEmits<{
  /** 弹窗该收起来了（取消，或者动作已经做完）。 */
  close: [];
}>();

// #region setup
const { markRemembered } = useCloseAction();

/**
 * 弹窗宽度，**只能走内联 style**。
 *
 * `<style scoped>` 里写 `.close-confirm { width: 340px }` 是**无效的**：naive-ui 把 `class`
 * 一路 `h()` 传给内部的 `NCard`（modal/src/BodyWrapper.mjs 里 `Object.assign({}, $attrs, ...)`），
 * 那个节点拿不到本组件的 `data-v-*` 作用域属性，于是选择器一条都匹配不上——表现就是弹窗铺满
 * 整个窗口宽度（实测截图）。`style` 走的是同一条 `$attrs`，但内联样式不带作用域，落地就生效。
 */
const MODAL_STYLE = { width: '340px', maxWidth: '88vw' } as const;

/** 「记住我的选择」勾了没有。 */
const remember = ref(false);
/** 上一次「最小化到托盘」失败了（托盘建不出来）。 */
const trayFailed = ref(false);

// 每次重新弹出来都清干净：勾选状态与上次的失败提示都不该跨次留着
watch(
  () => props.show,
  (show) => {
    if (!show) return;
    remember.value = false;
    trayFailed.value = false;
  },
);
// #endregion

/** 取消：什么都不做，窗口留着。 */
function cancel(): void {
  // 也发一趟 IPC（虽然主进程对 cancel 是空操作），好让「弹窗的三个出口都走同一条路」
  void resolveCloseApi('cancel', false);
  emit('close');
}

/**
 * 退出 / 最小化到托盘。
 *
 * **托盘那条路可能失败**（`resolveCloseApi` 回 false 就是），这时候**弹窗不关**：窗口还在
 * 屏幕上，把按钮置灰 + 显示一行提示，让用户自己选退出还是继续用。
 * @param choice 用户点的那一下。
 */
async function choose(choice: Exclude<AppCloseChoice, 'cancel'>): Promise<void> {
  const remembered = remember.value;
  const done = await resolveCloseApi(choice, remembered);
  if (!done) {
    trayFailed.value = true;
    return;
  }
  // 落盘是主进程在 resolveClose 里做的，这里只把渲染进程那份跟上（少了这句，从托盘回来
  // 打开设置页会看到 radio 还停在「每次询问」）
  if (remembered) markRemembered(choice);
  emit('close');
}
</script>

<style scoped lang="scss">
.close-confirm {
  // 宽度在 MODAL_STYLE 里（scoped 选择器管不到 naive-ui 那个 card 节点，见那段注释）

  &__text {
    margin: 0 0 var(--tb-space-4);
    color: var(--tb-text-secondary);
    font-size: 13px;
    line-height: 1.7;
  }

  &__alert {
    width: 100%;
    margin-top: var(--tb-space-4);
  }

  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
