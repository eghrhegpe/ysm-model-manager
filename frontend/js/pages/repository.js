// ===== 仓库页面 =====
import { bus } from "../bus.js";

export function initRepository(root) {
  // ---- 生成 GitHub 索引 ----
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
        msg: "✅ index.json + GitHub Action 已生成。\n\n请将您的模型仓库推送到 GitHub，\n\n此管理器可根据你的仓库的 index.json，下载模型。\n\ngenerate-index 文件将自动维护你仓库索引。",
        duration: 10000,
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

  // ---- 批量导出骨骼结构 ----
  const boneBtn = root.getElementById("repo-export-bones");
  if (!boneBtn) return;
  boneBtn.addEventListener("click", async () => {
    boneBtn.textContent = "⏳";
    try {
      const { LoadAppConfig, ExportBoneStructures } =
        await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        bus.emit("toast:show", {
          msg: "请先在设置中配置仓库目录",
          duration: 2000,
          type: "warn",
        });
        boneBtn.textContent = "📋 骨骼结构";
        return;
      }
      const text = await ExportBoneStructures(repoRoot);
      // 下载为 txt
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.download = `bone-structures-${today}.txt`;
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      bus.emit("toast:show", {
        msg: `✅ 骨骼结构已导出: ${a.download}`,
        duration: 3000,
        type: "success",
      });
      boneBtn.textContent = "✅";
      setTimeout(() => {
        boneBtn.textContent = "📋 骨骼结构";
      }, 3000);
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ 导出失败: " + String(e?.message || e),
        duration: 4000,
        type: "error",
      });
      boneBtn.textContent = "📋 骨骼结构";
    }
  });
}
