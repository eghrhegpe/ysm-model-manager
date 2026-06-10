// ===== 回收站管理 =====
import { bus } from "../bus.js";
import { modalConfirm } from "../dialogs/modal.js";
import { renderDisplayName } from "../utils/display.js";

export function initRecycleBin(app) {
  const root = app._root;
  const esc = (s) => app._esc(s);
  const fmtSize = (s) => app._fmtSize(s);
  root
    .getElementById("recy-refresh")
    ?.addEventListener("click", () => loadRecycleBin());
  root.getElementById("recy-empty")?.addEventListener("click", async () => {
    const confirmed = await modalConfirm({
      title: "清空回收站",
      icon: "🗑️",
      message: "确定永久清空回收站所有文件？此操作不可恢复！",
      okText: "🗑️ 清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const { LoadAppConfig, EmptyRecycleBin } =
        await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        bus.emit("toast:show", {
          msg: "请先设置仓库目录",
          duration: 3000,
          type: "warn",
        });
        return;
      }
      const n = await EmptyRecycleBin(repoRoot);
      bus.emit("toast:show", {
        msg: `🗑️ 已清空 ${n} 个文件`,
        duration: 3000,
        type: "success",
      });
      loadRecycleBin();
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ 清空失败: ${String(e)}`,
        duration: 5000,
        type: "error",
      });
    }
  });
  loadRecycleBin();

  async function loadRecycleBin() {
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        LoadAppConfig,
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        EmptyRecycleBin,
      } = await import("../../wailsjs/go/main/App.js");
      const cfg = await LoadAppConfig();
      const repoRoot = cfg.repoRoot || "";
      if (!repoRoot) {
        if (count) count.textContent = "请先设置仓库目录";
        return;
      }

      const entries = await ListRecycleBin(repoRoot);
      if (!entries || !entries.length) {
        list.innerHTML = "";
        if (count) count.textContent = "空";
        return;
      }
      if (count) count.textContent = `${entries.length} 个文件`;

      list.innerHTML = entries
        .map((e) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
          const size = e.Size ? fmtSize(e.Size) : "?";
          return `<div class="recy-item" style="display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg,#1e1e2e);font-size:11px">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt,#cdd6f4);cursor:pointer" title="点击查看详情: ${esc(e.Path)}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:9px;color:var(--muted,#6c7086)">${size}</span>
<button class="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd,#444);background:var(--surf,#2a2a42);color:var(--txt,#cdd6f4);cursor:pointer;font-size:9px">↩️ 恢复</button>
<button class="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid #e5534b;background:transparent;color:#e5534b;cursor:pointer;font-size:9px">🗑️ 删除</button>
</div>
<div style="font-size:9px;color:var(--muted,#6c7086);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 恢复按钮
      list.querySelectorAll(".recy-restore").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await RestoreFromRecycle(btn.dataset.path, repoRoot);
            bus.emit("toast:show", {
              msg: "✅ 已恢复",
              duration: 2000,
              type: "success",
            });
            loadRecycleBin();
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 恢复失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 删除按钮
      list.querySelectorAll(".recy-del").forEach((btn) => {
        btn.onclick = async () => {
          const confirmed = await modalConfirm({
            title: "删除文件",
            icon: "🗑️",
            message: "确定永久删除此文件？",
            okText: "🗑️ 删除",
            danger: true,
          });
          if (!confirmed) return;
          try {
            await DeleteFromRecycle(btn.dataset.path);
            loadRecycleBin();
            bus.emit("toast:show", {
              msg: "✅ 已删除",
              duration: 2000,
              type: "success",
            });
          } catch (e) {
            bus.emit("toast:show", {
              msg: `❌ 删除失败: ${String(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 文件名点击 → 模型详情
      list.querySelectorAll("[data-path]").forEach((el) => {
        if (
          el.classList.contains("recy-restore") ||
          el.classList.contains("recy-del")
        )
          return;
        el.addEventListener("click", () => {
          const path = el.dataset.path;
          if (path) bus.emit("model:select", { path });
        });
      });
    } catch (e) {
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">❌ 读取回收站失败: ${esc(String(e))}</div>`;
      if (count) count.textContent = "加载失败";
    }
  }
}
