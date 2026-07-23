import { ref, type Ref } from 'vue';
import type { PickedFile } from '@shared/types';

/** useFileDrop 的选项。 */
interface UseFileDropOptions {
  /** 拖入文件时的回调。 */
  onDrop: (files: PickedFile[]) => void;
  /** 可接受的扩展名（小写，不含点）；为空则接受全部。 */
  accept?: string[];
}

/** useFileDrop 返回值。 */
interface UseFileDropReturn {
  /** 是否有文件正拖拽悬停在区域上。 */
  isDragOver: Ref<boolean>;
  /** 绑定到目标元素的拖拽事件处理器。 */
  handlers: {
    onDragover: (e: DragEvent) => void;
    onDragleave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * 从 File 对象构建 PickedFile。
 * @param file 拖拽得到的 File。
 * @returns 含绝对路径的文件信息。
 */
function toPickedFile(file: File): PickedFile {
  const path = window.api.getPathForFile(file);
  const dotIndex = file.name.lastIndexOf('.');
  const ext = dotIndex > -1 ? file.name.slice(dotIndex + 1).toLowerCase() : '';
  return { path, name: file.name, size: file.size, ext };
}

/**
 * 文件拖拽处理 composable：管理拖拽悬停态并解析拖入文件为带路径的信息。
 * @param options 拖入回调与扩展名过滤。
 * @returns 悬停状态与需绑定到元素的事件处理器。
 */
export function useFileDrop(options: UseFileDropOptions): UseFileDropReturn {
  const isDragOver = ref(false);

  function onDragover(e: DragEvent): void {
    e.preventDefault();
    isDragOver.value = true;
  }

  function onDragleave(e: DragEvent): void {
    e.preventDefault();
    isDragOver.value = false;
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    isDragOver.value = false;
    const fileList = e.dataTransfer?.files;
    if (!fileList || fileList.length === 0) return;

    let files = Array.from(fileList).map(toPickedFile);
    if (options.accept?.length) {
      const accepted = new Set(options.accept.map((ext) => ext.toLowerCase()));
      files = files.filter((file) => accepted.has(file.ext));
    }
    if (files.length) options.onDrop(files);
  }

  return { isDragOver, handlers: { onDragover, onDragleave, onDrop } };
}
