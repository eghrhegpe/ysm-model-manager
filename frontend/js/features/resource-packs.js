// ===== 资源包管理（薄 wrapper，由 app-resource-manager 组件驱动） =====
import { bus } from "../bus.js";

/**
 * 初始化资源包 tab
 * @param {HTMLElement} container - ins-tab-xxx 容器
 * @param {object} host - app-content 组件实例
 * @param {string} rtype - 资源类型 (resourcepack/shaderpack)
 */
export async function initResourcePacks(container, host, rtype) {
  // 导入组件（确保已注册）
  await import("../components/app-resource-manager/index.js");

  container.innerHTML =
    '<app-resource-manager rtype="' +
    (rtype || "resourcepack") +
    '"></app-resource-manager>';

  // 监听 Toast 事件，改用事件总线确保 Toast 始终可达
  const manager = container.querySelector("app-resource-manager");
  const handler = (e) => {
    const { type, title, message } = e.detail;
    bus.emit("toast:show", {
      msg: title + (message ? ": " + message : ""),
      type: type || "info",
      duration: 3000,
    });
  };
  manager.addEventListener("toast", handler);

  // 返回清理函数，供上层移除事件监听
  return () => manager.removeEventListener("toast", handler);
}
