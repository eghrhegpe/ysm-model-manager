// ===== 仓库页面 =====
import { bus } from "../bus.js";

export function initRepository(root) {
  const btn = root.getElementById("repo-genindex");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.textContent = "⏳";
    try {
      const { LoadAppConfig, GenerateRepoIndex } =
        await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        bus.emit("toast:show", {
          msg: "请先在设置中配置仓库目录",
          duration: 2000,
          type: "warn",
        });
        btn.textContent = "📇 生成 GitHub 索引";
        return;
      }
      const path = await GenerateRepoIndex(repoRoot);
      bus.emit("toast:show", {
        msg:
          "✅ index.json 已生成: " +
          path +
          "，用 GitHub Desktop 提交并推送即可在线浏览",
        duration: 6000,
        type: "success",
      });
      btn.textContent = "✅";
      setTimeout(() => {
        btn.textContent = "📇 生成 GitHub 索引";
      }, 3000);
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 索引失败: " + String(e),
        duration: 4000,
        type: "error",
      });
      btn.textContent = "📇 生成 GitHub 索引";
    }
  });
}
