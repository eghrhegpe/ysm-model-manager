// ===== 资源包管理（类型化版 — ADR-014 P3 组件层）=====
// 薄 wrapper，由 app-resource-manager 组件驱动
import { bus } from "../bus.ts";

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
  rtype: string,
): Promise<() => void> {
  // 导入组件（确保已注册）
  await import("../components/app-resource-manager/index.js");

  container.innerHTML =
    '<app-resource-manager rtype="' +
    (rtype || "resourcepack") +
    '"></app-resource-manager>';

  // 监听 Toast 事件，改用事件总线确保 Toast 始终可达
  const manager = container.querySelector("app-resource-manager");
  const handler = (e: Event): void => {
    const { type, title, message } = (e as CustomEvent).detail as {
      type?: string;
      title: string;
      message?: string;
    };
    bus.emit("toast:show", {
      msg: title + (message ? ": " + message : ""),
      type: (type || "info") as "info" | "success" | "error" | "warning",
      duration: 3000,
    });
  };
  manager?.addEventListener("toast", handler as EventListener);

  // 返回清理函数，供上层移除事件监听
  return () => manager?.removeEventListener("toast", handler as EventListener);
}
