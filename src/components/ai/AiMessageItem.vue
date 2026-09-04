<template>
  <div class="ai-msg" :class="`ai-msg--${message.role}`">
    <div class="ai-msg__avatar">{{ message.role === 'user' ? '我' : 'AI' }}</div>

    <div class="ai-msg__body">
      <!-- 推理过程折叠在正文之上：deepseek-reasoner 那类会先吐一大段思考 -->
      <n-collapse v-if="message.reasoning" class="ai-msg__reasoning">
        <n-collapse-item title="思考过程" name="reasoning">
          <div class="ai-msg__reasoning-text">{{ message.reasoning }}</div>
        </n-collapse-item>
      </n-collapse>

      <div v-if="message.images?.length" class="ai-msg__images">
        <img
          v-for="image in message.images"
          :key="image.id"
          class="ai-msg__image"
          :src="image.thumbnailDataUrl"
          :alt="`图片 ${image.width}×${image.height}`"
          :title="`${image.width}×${image.height} · ${formatBytes(image.bytes)}`"
        />
      </div>

      <!--
        只助手消息渲染 markdown：用户自己打的字里 `*` `#` 缩进多半是字面意思，
        套一层解析反而把内容改了。工具卡片 / 告警 / 报错同理（`summary` 里全是绝对路径）。
      -->
      <AiMarkdown v-if="message.role === 'assistant'" :text="message.text" :streaming="streaming" />
      <div v-else-if="message.text" class="ai-msg__text">{{ message.text }}</div>

      <div v-if="streaming && !message.text" class="ai-msg__typing">正在生成…</div>

      <div
        v-for="call in message.toolCalls ?? []"
        :key="call.callId"
        class="ai-msg__tool"
        :class="`ai-msg__tool--${call.status}`"
      >
        <div class="ai-msg__tool-head">
          <span class="ai-msg__tool-dot" />
          <span class="ai-msg__tool-name">{{ call.name }}</span>
          <span class="ai-msg__tool-status">{{ STATUS_LABEL[call.status] }}</span>
          <span v-if="call.elapsed" class="ai-msg__tool-elapsed">
            {{ formatElapsed(call.elapsed) }}
          </span>
        </div>
        <div class="ai-msg__tool-summary">{{ call.summary }}</div>
        <div v-if="call.result" class="ai-msg__tool-result">{{ call.result }}</div>
        <!-- 只有 pending 才有按钮：其余状态那边的 promise 已经落定，点了没人接 -->
        <div v-if="call.status === 'pending'" class="ai-msg__tool-actions">
          <n-button size="tiny" type="primary" @click="chat.approveTool(call.callId)"
            >允许</n-button
          >
          <n-button size="tiny" quaternary @click="chat.denyTool(call.callId)">拒绝</n-button>
        </div>
      </div>

      <div v-for="(warning, index) in message.warnings ?? []" :key="index" class="ai-msg__warning">
        {{ warning }}
      </div>

      <div v-if="message.canceled" class="ai-msg__note">已取消</div>
      <div v-if="message.error" class="ai-msg__error">{{ message.error }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton, NCollapse, NCollapseItem } from 'naive-ui';
import type { AiMessage, AiToolCall } from '@shared/types';
import AiMarkdown from './AiMarkdown.vue';
import { formatBytes } from '@/utils/format';
import { useAiChatStore } from '@/stores/aiChat';

interface Props {
  /** 要渲染的消息。 */
  message: AiMessage;
  /** 这条消息是否正在流式生成。 */
  streaming?: boolean;
}

withDefaults(defineProps<Props>(), { streaming: false });

/** 工具调用状态的中文标签。 */
const STATUS_LABEL: Record<AiToolCall['status'], string> = {
  pending: '待确认',
  running: '执行中',
  done: '已完成',
  denied: '已拒绝',
  error: '失败',
  interrupted: '已中断',
};

// #region setup
/**
 * 直接拿 store 而不是往上抛事件。
 *
 * 确认按钮只会出现在这个独立窗口里，一路 emit 到 `AiPanelWindowBody` 再转调 store 只是
 * 多两层转发；store 本身就是全局单例。
 */
const chat = useAiChatStore();
// #endregion

/**
 * 把耗时毫秒数写成一行短文本。
 * @param ms 毫秒。
 * @returns 1 秒以内给毫秒，否则给一位小数的秒。
 */
function formatElapsed(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
</script>

<style scoped lang="scss">
.ai-msg {
  display: flex;
  gap: var(--tb-space-3);
  padding: var(--tb-space-3) 0;

  &__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--tb-bg-elevated);
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  &--user &__avatar {
    background: var(--tb-color-primary);
    color: #fff;
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__text {
    // 用户消息保持纯文本：换行与缩进靠 pre-wrap 保住（助手消息走 AiMarkdown）
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--tb-text-primary);
    font-size: 14px;
    line-height: 1.7;
  }

  &__images {
    display: flex;
    flex-wrap: wrap;
    gap: var(--tb-space-2);
    margin-bottom: var(--tb-space-2);
  }

  &__image {
    width: 64px;
    height: 64px;
    border-radius: var(--tb-radius-sm);
    border: 1px solid var(--tb-border);
    object-fit: cover;
  }

  &__reasoning {
    margin-bottom: var(--tb-space-2);
  }

  &__reasoning-text {
    white-space: pre-wrap;
    color: var(--tb-text-secondary);
    font-size: 13px;
    line-height: 1.6;
  }

  &__typing,
  &__note {
    color: var(--tb-text-secondary);
    font-size: 13px;
    word-break: break-word;
  }

  &__warning {
    margin-top: var(--tb-space-2);
    color: #d9a441;
    font-size: 12px;
    // 认不出的 feature 会带上英文 details，窄面板里没这条会把气泡顶出去
    word-break: break-word;
  }

  // 工具卡片：中性灰底 + 一颗状态色圆点，只有「允许」按钮是 primary（守配色规范）
  &__tool {
    margin-top: var(--tb-space-2);
    padding: var(--tb-space-2);
    border: 1px solid var(--tb-border);
    border-radius: var(--tb-radius-sm);
    background: var(--tb-bg-elevated);
  }

  &__tool-head {
    display: flex;
    align-items: center;
    gap: var(--tb-space-2);
  }

  &__tool-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tb-text-secondary);
  }

  &__tool-name {
    color: var(--tb-text-primary);
    font-size: 12px;
    font-family: var(--tb-font-mono, monospace);
    word-break: break-all;
  }

  &__tool-status,
  &__tool-elapsed {
    color: var(--tb-text-secondary);
    font-size: 12px;
  }

  &__tool-elapsed {
    margin-left: auto;
  }

  &__tool-summary,
  &__tool-result {
    margin-top: 2px;
    color: var(--tb-text-secondary);
    font-size: 12px;
    line-height: 1.6;
    // 参数里全是绝对路径，窄窗口不断词会把气泡顶出去（同 &__warning）
    word-break: break-word;
  }

  &__tool-actions {
    display: flex;
    gap: var(--tb-space-2);
    margin-top: var(--tb-space-2);
  }

  &__tool--pending &__tool-dot {
    background: #d9a441;
  }

  &__tool--running &__tool-dot {
    background: var(--tb-color-primary);
  }

  &__tool--done &__tool-dot {
    background: #4caf7d;
  }

  &__tool--error &__tool-dot {
    background: #e05252;
  }

  &__error {
    margin-top: var(--tb-space-2);
    color: #e05252;
    font-size: 13px;
    word-break: break-word;
  }
}
</style>
