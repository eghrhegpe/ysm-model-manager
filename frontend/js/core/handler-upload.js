// ===== 上传新模型到仓库 =====
import { bus } from "../bus.js";

export function registerUpload(unsubs) {
  unsubs.push(
    bus.on("stats:upload", async () => {
      console.log("[upload] stats:upload");
      try {
        const {
          LoadAppConfig,
          ListVersionInstances,
          GetInstanceStatus,
          ScanModelEntries,
          SyncCustomToRepo,
        } = await import("../../wailsjs/go/main/App.js");
        const cfg = await LoadAppConfig();
        const repoRoot = cfg.repoRoot || "";
        const mcRoot = cfg.mcRoot || "";
        if (!repoRoot || !mcRoot) {
          bus.emit("toast:show", {
            msg: "请先配置目录",
            duration: 3000,
            type: "warn",
          });
          return;
        }
        const repoEntries = await ScanModelEntries(repoRoot);
        const repoNames = new Set((repoEntries || []).map((e) => e.Name));
        const allInstances = await ListVersionInstances(mcRoot);
        const statusList = await GetInstanceStatus(mcRoot, repoRoot);
        const pendingList = [];
        (statusList || []).forEach((s) => {
          (s.Extra || []).forEach((name) => {
            if (!repoNames.has(name)) {
              const ins = allInstances.find((x) => x.Name === s.Name);
              pendingList.push({ name, customDir: ins ? ins.CustomDir : "" });
            }
          });
        });
        if (!pendingList.length) {
          bus.emit("toast:show", {
            msg: "没有待上传的模型",
            duration: 2000,
            type: "info",
          });
          return;
        }
        let ok = 0,
          fail = 0;
        for (const item of pendingList) {
          if (!item.customDir) {
            fail++;
            continue;
          }
          try {
            const n = await SyncCustomToRepo(item.customDir, repoRoot);
            if (n > 0) ok++;
            else fail++;
          } catch {
            fail++;
          }
        }
        bus.emit("stats:refresh");
        bus.emit("toast:show", {
          msg: `📤 上传完成: ${ok} 成功, ${fail} 失败`,
          duration: 4000,
          type: fail > 0 ? "warn" : "success",
        });
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 上传失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      } finally {
        bus.emit("sync:upload:done");
        bus.emit("tree:reload");
      }
    }),
  );
}
