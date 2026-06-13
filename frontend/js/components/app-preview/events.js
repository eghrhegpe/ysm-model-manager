// ===== preview 事件总线绑定 =====
// 精简后仅保留 bindBusUpdates，其他已拆分到独立模块
import { bus } from "../../bus.js";
import { showPackageDetail } from "./preview-pack.js";
import { resetGlobalButtons } from "./preview-actions.js";

export function bindBusUpdates(root, unsubs) {
  unsubs.push(
    bus.on("package:selected", (pkg) => {
      showPackageDetail(root, pkg, resetGlobalButtons);
    }),
  );

  ["sync:download:done", "sync:upload:done", "sync:toggle:done"].forEach(
    (evt) => {
      unsubs.push(
        bus.on(evt, () => {
          console.log("[preview] 收到", evt, "→ resetGlobalButtons");
          resetGlobalButtons(root);
        }),
      );
    },
  );
}
