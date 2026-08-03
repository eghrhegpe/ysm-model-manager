// ===== preview 事件总线绑定 =====
// 精简后仅保留 bindBusUpdates，其他已拆分到独立模块
import { bus } from "../../bus.ts";
import { dbg } from "../../utils/debug.ts";
import { showPackageDetail, type PackagePayload } from "./preview-pack.ts";
import { resetGlobalButtons } from "./preview-actions.ts";

export function bindBusUpdates(
  root: ShadowRoot,
  unsubs: Array<() => void>,
): void {
  unsubs.push(
    bus.on("package:selected", (pkg) => {
      showPackageDetail(root, pkg as PackagePayload | null, resetGlobalButtons);
    }),
  );

  ["sync:download:done", "sync:upload:done", "sync:toggle:done"].forEach(
    (evt) => {
      unsubs.push(
        bus.on(evt as never, () => {
          dbg("preview", "收到", evt, "→ resetGlobalButtons");
          resetGlobalButtons(root);
        }),
      );
    },
  );
}
