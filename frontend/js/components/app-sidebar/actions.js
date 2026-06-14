// ===== 整合包内部操作绑定（< 100 行）=====
import { bus } from "../../bus.js";
import { InstallModelTo } from "../../../wailsjs/go/main/App.js";

/** 绑定整合包卡片中的操作按钮和缺失条目点击事件 */
export function bindInstanceActions(root, instances) {
  // 安装缺失按钮
  root.querySelectorAll(".btn-install-missing").forEach((btn) => {
    btn.onclick = async () => {
      const idx = btn.dataset.idx;
      const ins = instances[idx];
      if (!ins) return;
      bus.emit("toast:show", {
        msg: `⬇️ 正在安装 ${ins.name} 的缺失模型...`,
        duration: 2000,
        type: "info",
      });
      const { LoadAppConfig, ListVersionInstances } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      const allIns = mcRoot ? (await ListVersionInstances(mcRoot)) || [] : [];
      const match = allIns.find((i) => i.Name === ins.name);
      const targetDir = match ? match.CustomDir : "";
      if (!targetDir) {
        bus.emit("toast:show", {
          msg: "未找到整合包目录",
          duration: 3000,
          type: "error",
        });
        return;
      }
      let ok = 0,
        fail = 0;
      for (const srcPath of (ins._missingPaths || [])) {
        try {
          await InstallModelTo(srcPath, targetDir);
          ok++;
        } catch (_) {
          fail++;
        }
      }
      bus.emit("stats:refresh");
      bus.emit("toast:show", {
        msg: `✅ ${ins.name}: 安装 ${ok} 成功, ${fail} 失败`,
        duration: 3000,
        type: fail > 0 ? "warn" : "success",
      });
    };
  });
}
