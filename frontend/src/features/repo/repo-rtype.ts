// ===== 当前仓库资源类型订阅（索引 4.3 收敛）=====
// 时刻值读取已下沉 utils/resource/repo-rtype.ts（backend/web-fs-auth 同源消费，
// 消除 backend → features 反向依赖），此处 re-export + 提供事件订阅。

import { bus } from "../../bus.ts";
import { currentRepoType } from "../../utils/resource/repo-rtype.ts";

export { currentRepoType };

/**
 * 订阅当前仓库资源类型。
 * @param onChange 类型变化回调（组件重载入口，如 render / loadRecycleBin）
 * @returns { get, cleanup } — get() 读当前类型（初值 + 事件更新后的最新值）；
 *   cleanup() 移除订阅（组件销毁时调用，防迟到响应/泄漏）
 */
export function useCurrentResourceType(onChange: () => void): {
  get: () => string;
  cleanup: () => void;
} {
  let currentType = currentRepoType();
  const unsub = bus.on("repo:rtype-changed", (rt) => {
    if (rt && rt !== currentType) {
      currentType = rt;
      onChange();
    }
  });
  return {
    get: () => currentType,
    cleanup: () => {
      if (unsub) unsub();
    },
  };
}
