import { ref, type Ref } from 'vue';
import { useMessage } from 'naive-ui';
import type { PickedFile } from '@shared/types';
import { scanDirApi } from '@/services/file';
import { pickDirectoryApi } from '@/services/fs';
import { joinPath } from '@/utils/path';

/**
 * 「从文件夹添加」的公共实现。
 *
 * 四个页面（压缩 / 裁剪 / 风格化 / 批量重命名）的这段逻辑完全一样：
 * 选目录 → 递归扫描 → 摊平成 PickedFile → 交给各页自己的 addFiles 去重入列。
 * 扩展名过滤交给主进程（`ScanOptions.extensions`），不在这里筛——
 * 否则 maxFiles 会先被目录里的非目标文件占满。
 */

/** useFolderImport 的配置。 */
export interface FolderImportOptions {
  /** scanId 前缀，便于在日志里区分是哪个页面发起的扫描。 */
  key: string;
  /** 只收这些扩展名（小写不含点）；缺省收全部文件。 */
  accept?: string[];
  /** 本次导入的文件数上限，超出截断并提示。 */
  maxFiles: number;
  /** 目录选择对话框的标题。 */
  title: string;
}

/** useFolderImport 的返回值。 */
export interface FolderImport {
  /** 是否正在扫描（给按钮上 loading，大目录会扫好几秒）。 */
  scanning: Ref<boolean>;
  /**
   * 选目录并扫描。
   * @param recursive 是否递归子文件夹。
   * @returns 扫描到的文件；用户取消、目录为空或出错时返回空数组。
   */
  importFolder: (recursive: boolean) => Promise<PickedFile[]>;
}

/**
 * 提供「从文件夹添加文件」能力。
 * @param options 配置。
 * @returns 扫描状态与导入方法。
 */
export function useFolderImport(options: FolderImportOptions): FolderImport {
  const message = useMessage();
  const scanning = ref(false);

  async function importFolder(recursive: boolean): Promise<PickedFile[]> {
    const dir = await pickDirectoryApi(options.title);
    if (!dir) return [];

    scanning.value = true;
    try {
      const result = await scanDirApi({
        scanId: `${options.key}-${Date.now()}`,
        root: dir,
        includeHidden: true,
        skipIgnoredDirs: false,
        ignoreDirs: [],
        maxFiles: options.maxFiles,
        // 关掉「含子文件夹」就只取当前层
        maxDepth: recursive ? undefined : 1,
        ...(options.accept?.length ? { extensions: options.accept } : {}),
      });

      const files: PickedFile[] = result.files.map((file) => ({
        path: joinPath(result.dirs[file.dirIndex] ?? dir, file.name),
        name: file.name,
        size: file.size,
        ext: file.ext,
        mtime: file.mtime,
      }));

      if (!files.length) {
        // 分清「目录是空的」和「目录里没有能处理的文件」，否则用户会以为功能坏了
        message.warning(
          options.accept?.length
            ? `该文件夹${recursive ? '' : '当前层'}没有可处理的文件`
            : `该文件夹${recursive ? '' : '当前层'}没有文件`,
        );
        return [];
      }
      if (result.truncated) {
        message.warning(`文件数超过 ${options.maxFiles.toLocaleString()}，只取了前一部分`);
      }
      return files;
    } catch {
      // 错误提示已由 services 统一弹出
      return [];
    } finally {
      scanning.value = false;
    }
  }

  return { scanning, importFolder };
}
