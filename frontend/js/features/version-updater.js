// ===== 版本更新检查 =====
import { bus } from "../bus.js";
import { modalConfirm } from "../dialogs/modal.js";

export function initVersionUpdater(root) {
  root
    .getElementById("set-check-update")
    ?.addEventListener("click", async () => {
      const btn = root.getElementById("set-check-update");
      btn.textContent = "⏳ 检查中...";
      btn.disabled = true;
      try {
        const { CheckUpdate, DownloadUpdate, ApplyUpdate, CurrentVersion } =
          await import("../../wailsjs/go/main/App.js");
        const info = await CheckUpdate();
        if (!info.available) {
          bus.emit("toast:show", {
            msg: `✅ 已是最新版本 (${info.current})`,
            duration: 3000,
            type: "success",
          });
          return;
        }
        const confirmed = await modalConfirm({
          title: "发现新版本",
          icon: "📦",
          message: `发现新版本 ${info.latest}（当前 ${info.current}）\n是否下载并更新？\n\n更新内容请在浏览器中查看：\nhttps://github.com/eghrhegpe/ysm-model-manager/releases/tag/${info.latest}`,
          okText: "⬇️ 下载更新",
        });
        if (!confirmed) return;
        btn.textContent = "⬇️ 下载中...";
        const zipPath = await DownloadUpdate(info.url);
        btn.textContent = "🔄 更新中...";
        await ApplyUpdate(zipPath);
        // 触发应用重启
        setTimeout(() => {
          window.close?.();
        }, 1000);
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ 更新失败: ${String(e)}`,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🔄 检查更新";
        btn.disabled = false;
      }
    });
}
