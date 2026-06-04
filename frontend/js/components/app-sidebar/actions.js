// ===== 整合包内部操作绑定（< 100 行）=====
import { bus } from "../../bus.js";
import {
  InstallModelTo,
  SyncCustomToRepo,
} from "../../../wailsjs/go/main/App.js";

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
      for (const item of ins.items.missing) {
        try {
          await InstallModelTo(item.name, targetDir);
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

  // 缺失模型条目 → 独立安装按钮点击
  root.querySelectorAll(".btn-install-one").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const name = btn.dataset.path;
      if (!name) return;
      // 查找所在整合包
      const parentVc = btn.closest(".vc-body")?.previousElementSibling;
      const insName =
        parentVc?.querySelector(".name")?.textContent?.replace(/^📦\s*/, "") ||
        "";
      const { LoadAppConfig, ListVersionInstances, InstallModelTo } =
        await import("../../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const mcRoot = cfg.mcRoot || "";
      const allIns = mcRoot ? (await ListVersionInstances(mcRoot)) || [] : [];
      const match = allIns.find((i) => i.Name === insName);
      const targetDir = match ? match.CustomDir : "";
      if (!targetDir) {
        bus.emit("toast:show", {
          msg: "未找到整合包目录",
          duration: 3000,
          type: "error",
        });
        return;
      }
      try {
        await InstallModelTo(name, targetDir);
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `✅ 已安装: ${name}`,
          duration: 2000,
          type: "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 安装失败: ${String(e)}`,
          duration: 3000,
          type: "error",
        });
      }
    };
  });
}
