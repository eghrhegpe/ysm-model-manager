// ===== 资源包管理（薄 wrapper，由 app-resource-manager 组件驱动） =====

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

  // 监听 Toast 事件
  container
    .querySelector("app-resource-manager")
    .addEventListener("toast", (e) => {
      const { type, title, message } = e.detail;
      host._toast?.(type, title, message);
    });
}
