import type { WebTestAction } from '@shared/webtest';

/** 录制步骤、编辑器和进度列表使用的动作名称。 */
export const WEBTEST_ACTION_LABELS: Record<WebTestAction, string> = {
  navigate: '打开页面',
  click: '点击',
  dblclick: '双击',
  fill: '输入',
  check: '勾选',
  select: '选择选项',
  press: '快捷键',
  scroll: '滚动',
  assertVisible: '检查：元素可见',
  assertHidden: '检查：元素隐藏',
  assertValue: '检查：输入值',
  assertChecked: '检查：勾选状态',
  assertUrl: '检查：页面地址',
  openPage: '打开新页签',
  closePage: '关闭页签',
  unsupported: '需手工处理的操作',
};
