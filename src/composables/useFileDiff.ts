import { computed, onUnmounted, ref } from 'vue';
import { FILE_DIFF_MEDIA_EXTENSIONS } from '@shared/fileDiff';
import type {
  FileDiffDetail,
  FileDiffEntry,
  FileDiffProgress,
  FileDiffResult,
  FileDiffStatus,
} from '@shared/fileDiff';
import {
  cancelFileDiffApi,
  compareFilesApi,
  getFileDiffDetailApi,
  onFileDiffProgressApi,
} from '@/services/fileDiff';
import { pickDirectoryApi, pickFilesApi } from '@/services/fs';
import { FILE_DIFF_STATUS_OPTIONS, type FileDiffStatusFilter } from '@/constants/fileDiff';
import { useToolConfig } from './useToolConfig';

/** @returns 文件对比配置、任务进度、筛选结果和操作方法。 */
export function useFileDiff() {
  const { config } = useToolConfig('file-diff', {
    leftPath: '',
    rightPath: '',
    include: '',
    exclude: FILE_DIFF_MEDIA_EXTENSIONS.join(', '),
    // 保留旧字段用于首次迁移状态筛选偏好。
    onlyDifferences: true,
    statusFilter: '' as FileDiffStatusFilter | '',
  });
  if (!FILE_DIFF_STATUS_OPTIONS.some((option) => option.value === config.statusFilter)) {
    config.statusFilter = config.onlyDifferences ? 'differences' : 'all';
  }
  const result = ref<FileDiffResult | null>(null);
  const progress = ref<FileDiffProgress | null>(null);
  const busy = ref(false);
  const canceling = ref(false);
  const error = ref('');
  const search = ref('');
  const detail = ref<FileDiffDetail | null>(null);
  const selected = ref<FileDiffEntry | null>(null);
  const detailOpen = ref(false);
  const detailLoading = ref(false);
  const detailError = ref('');
  let jobId = '';
  let detailVersion = 0;
  let mounted = true;
  const usedConfig = ref('');
  const configKey = (): string =>
    JSON.stringify([config.leftPath, config.rightPath, config.include, config.exclude]);
  const staleConfig = computed(() => Boolean(result.value && usedConfig.value !== configKey()));
  const entries = computed(() =>
    (result.value?.entries ?? []).filter(
      (row) =>
        (config.statusFilter === 'all' ||
          (config.statusFilter === 'differences'
            ? row.status !== 'same'
            : row.status === config.statusFilter)) &&
        row.relativePath.toLowerCase().includes(search.value.toLowerCase()),
    ),
  );
  const counts = computed(() => {
    const values: Record<FileDiffStatus, number> = {
      same: 0,
      modified: 0,
      'left-only': 0,
      'right-only': 0,
      'type-conflict': 0,
      error: 0,
    };
    for (const entry of result.value?.entries ?? []) values[entry.status]++;
    return values;
  });
  const unsubscribe = onFileDiffProgressApi((value) => {
    if (value.jobId === jobId && busy.value) progress.value = value;
  });
  onUnmounted(() => {
    mounted = false;
    detailVersion++;
    unsubscribe();
    if (busy.value) void cancelFileDiffApi(jobId).catch(() => undefined);
  });

  /** @param side 要填入的路径。 @param kind 选择文件或目录。 */
  async function pick(side: 'leftPath' | 'rightPath', kind: 'file' | 'directory'): Promise<void> {
    try {
      const path =
        kind === 'directory'
          ? await pickDirectoryApi('选择对比文件夹')
          : (await pickFilesApi({ multiple: false }))[0]?.path;
      if (path) config[side] = path;
    } catch {
      /* 对话框服务已提示错误。 */
    }
  }

  /** @param entry 用户选择的文件条目；版本隔离防止过期详情覆盖新选择。 */
  async function showDetail(entry: FileDiffEntry): Promise<void> {
    if (detailLoading.value || !result.value) return;
    const version = ++detailVersion;
    selected.value = entry;
    detailOpen.value = true;
    detail.value = null;
    detailError.value = '';
    detailLoading.value = true;
    try {
      const value = await getFileDiffDetailApi(result.value.jobId, entry.id);
      if (mounted && version === detailVersion) detail.value = value;
    } catch (cause) {
      if (mounted && version === detailVersion) detailError.value = String(cause);
    } finally {
      if (version === detailVersion) detailLoading.value = false;
    }
  }

  /** 关闭弹窗，读取中的请求自然结束，不因迟到响应重新打开。 */
  function closeDetail(): void {
    detailOpen.value = false;
  }

  /** 重新扫描并比较，读取原始值构建纯 IPC 对象。 */
  async function compare(): Promise<void> {
    if (busy.value || detailLoading.value) return;
    jobId = crypto.randomUUID();
    busy.value = true;
    canceling.value = false;
    error.value = '';
    result.value = null;
    selected.value = null;
    detailOpen.value = false;
    detail.value = null;
    progress.value = null;
    detailVersion++;
    usedConfig.value = configKey();
    try {
      const value = await compareFilesApi({
        jobId,
        leftPath: config.leftPath.trim(),
        rightPath: config.rightPath.trim(),
        include: config.include,
        exclude: config.exclude,
      });
      if (!mounted) return;
      result.value = value;
      if (value.entries.length === 1 && !value.canceled) await showDetail(value.entries[0]);
    } catch (cause) {
      if (mounted) error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (mounted) {
        busy.value = false;
        canceling.value = false;
      }
    }
  }

  /** 停止后保留已完成部分，不能把部分结果标为完整。 */
  async function cancel(): Promise<void> {
    if (!busy.value || canceling.value) return;
    canceling.value = true;
    try {
      await cancelFileDiffApi(jobId);
    } catch (cause) {
      error.value = String(cause);
      canceling.value = false;
    }
  }

  /** 恢复默认媒体排除规则。 */
  function resetMedia(): void {
    config.exclude = FILE_DIFF_MEDIA_EXTENSIONS.join(', ');
  }
  /** 交换两侧输入，不更改已经生成的结果。 */
  function swap(): void {
    [config.leftPath, config.rightPath] = [config.rightPath, config.leftPath];
  }
  return {
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
  };
}
