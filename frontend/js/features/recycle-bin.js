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
      icon: "♻️",
      message: "确定永久清空回收站所有文件？此操作不可恢复！",
      okText: "♻️ 清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const { LoadAppConfig, EmptyRecycleBin } =
        await import("../../wailsjs/go/main/App.js");
      const n = await EmptyRecycleBin("");
      bus.emit("toast:show", {
        msg: `♻️ 已清空 ${n} 个文件`,
        duration: 3000,
        type: "success",
      });
      loadRecycleBin();
      bus.emit("stats:refresh");
      bus.emit("tree:reload");
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e)}`,
        duration: 5000,
        type: "error",
      });
    }
  });
  // 监听全局类型切换
  let currentType = localStorage.getItem("repo_rtype") || "ysm";
  const typeIcons = {
    ysm: "💎",
    "mmd-skin": "🎭",
    "vrchat-avatar": "🥽",
    resourcepack: "🎨",
    shaderpack: "☀️",
    "create-blueprint": "⚙️",
  };
  let unsubRtype = bus.on("repo:rtype-changed", (rt) => {
    if (rt && rt !== currentType) {
      currentType = rt;
      loadRecycleBin();
    }
  });

  loadRecycleBin();

  async function loadRecycleBin() {
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        EmptyRecycleBin,
        GetRepoRoot,
      } = await import("../../wailsjs/go/main/App.js");

      // 获取当前类型的根目录（用于路径过滤）
      const currentRoot = await GetRepoRoot(currentType);
      const allEntries = await ListRecycleBin("");

      // 过滤：只显示路径在当前类型根目录下的文件
      const entries = currentRoot
        ? allEntries.filter(
            (e) =>
              e.Path &&
              e.Path.replace(/\\/g, "/").startsWith(
                currentRoot.replace(/\\/g, "/"),
              ),
          )
        : allEntries;

      if (!entries || !entries.length) {
        list.innerHTML =
          '<div style="padding:8px 12px;font-size:11px;color:var(--muted)">♻️ 回收站为空</div>';
        if (count) count.textContent = "空";
        return;
      }
      const icon = typeIcons[currentType] || "📦";
      if (count) count.textContent = icon + " " + entries.length + " 个文件";

      list.innerHTML = entries
        .map((e) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
          const size = e.Size ? fmtSize(e.Size) : "?";
          return `<div class="recy-item" style="display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:var(--fs-sm)">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);cursor:pointer" title="点击查看详情: ${esc(e.Path)}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:var(--fs-xs);color:var(--muted)">${size}</span>
<button class="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-xs)">↩️ 恢复</button>
<button class="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--err);background:transparent;color:var(--err);cursor:pointer;font-size:var(--fs-xs)">🗑️ 删除</button>
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 恢复按钮
      list.querySelectorAll(".recy-restore").forEach((btn) => {
        btn.onclick = async () => {
          try {
            await RestoreFromRecycle(btn.dataset.path, "");
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
              msg: `❌ ${friendlyError(e)}`,
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
              msg: `❌ ${friendlyError(e)}`,
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
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:#f38ba8;font-size:11px">❌ ${esc(friendlyError(e, "读取回收站失败"))}</div>`;
      if (count) count.textContent = "加载失败";
    }
  }
}
