// ===== 资源包管理（类型化版 — ADR-014 P3 组件层）=====
// 薄 wrapper，由 app-resource-manager 组件驱动
import { RESOURCE_TYPES } from "../utils/resource/resource-types.ts";

/**
 * 初始化资源包 tab
 * @param container ins-tab-xxx 容器
 * @param host app-content 组件实例
 * @param rtype 资源类型 (resourcepack/shaderpack)
 * @returns 清理函数，供上层移除事件监听
 */
export async function initResourcePacks(
  container: HTMLElement,
  host: object,
  rtype?: string,
): Promise<() => void> {
  // 导入组件（确保已注册）
  await import("../components/app-resource-manager/index.js");

  container.innerHTML =
    '<app-resource-manager rtype="' +
    (rtype || RESOURCE_TYPES.PACK) +
    '"></app-resource-manager>';

  // Toast 由 app-resource-manager 内部直接 bus.emit("toast:show") 发出，
  // 此处不再桥接游离 DOM 事件（Design.md §14.6 D3）。
  // 保留清理函数返回值以兼容上层调用契约。
  return () => {};
}
