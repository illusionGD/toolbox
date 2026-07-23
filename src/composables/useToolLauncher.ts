import { useRouter } from 'vue-router';
import { getTool } from '@/utils/navigation';

/**
 * 工具启动器：统一跳转到工具路由。
 * 使用记录由路由守卫按 meta.navKey 统一埋点（见 router），故此处只负责跳转，避免重复计数。
 * @returns openTool 方法。
 */
export function useToolLauncher() {
  const router = useRouter();

  /**
   * 打开工具：跳转到对应路由。
   * @param key 工具 key（对应 NavItem.key）。
   * @param path 可选路由路径；不传则从导航表查找。
   */
  function openTool(key: string, path?: string): void {
    const target = path ?? getTool(key)?.path;
    if (target) void router.push(target);
  }

  return { openTool };
}
