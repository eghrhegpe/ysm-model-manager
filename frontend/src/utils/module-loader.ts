// ===== 懒加载 Web Component 统一加载器 =====
// 从 app-modules.ts 提取，消除 5 处 import(...).catch 重复模板
// 并使其可独立测试（app-modules.ts import 即触发顶层副作用）。

import { bus } from "../bus.ts";
import { friendlyError } from "./dom/errors.ts";
import { TOAST_MS } from "./dom/toast-ms.ts";

/**
 * 懒加载 Web Component：统一动态 import + 加载失败 toast 反馈。
 * 收敛 5 处 `import(...).catch` 模板（app-tree/sidebar/content/resource-manager/sync-manager）。
 * 用字面量路径确保 Vite 构建时解析。
 */
export const loadView = (name: string, importer: () => Promise<unknown>): Promise<void> => {
  return importer()
    .then(() => undefined)
    .catch((e) => {
      console.warn(`[module] 组件加载失败: ${name}`, e);
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e, "组件加载失败"),
        duration: TOAST_MS.long,
        type: "error",
      });
    });
};
