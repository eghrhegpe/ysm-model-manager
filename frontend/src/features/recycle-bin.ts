// ===== 回收站管理（类型化版 — ADR-014 P3 features）=====
import { bus } from "../bus.ts";
import { modalConfirm } from "../utils/dom/dialogs/modal.ts";
import { renderDisplayName } from "../utils/dom/display.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { loadResourceRegistry } from "../utils/resource/registry.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";
import { getApp } from "../wails/app.ts";

/** app-content 组件实例（initRecycleBin 依赖的成员） */
export interface RecycleHost {
  _root: ShadowRoot;
  _esc: (s: string) => string;
  _fmtSize: (s: number) => string;
}

/**
 * 判断条目路径是否位于资源根目录内（带路径分隔符边界，P3 修复）。
 * - 裸 startsWith 会把 D:/games/ysm2/… 误入 D:/games/ysm 根目录 → 要求 === 或 root + "/" 前缀
 * - root 尾部可能带分隔符（specificRoot 返回用户配置原值）→ 先剥尾部分隔符
 */
export function isPathInRoot(path: string, root: string): boolean {
  const p = path.replace(/\\/g, "/");
  const r = root.replace(/\\/g, "/").replace(/\/+$/, "");
  return p === r || p.startsWith(r + "/");
}

/** 初始化回收站管理，返回清理函数 */
export function initRecycleBin(app: RecycleHost): () => void {
  const root = app._root;
  const esc = (s: string): string => app._esc(s);
  const fmtSize = (s: number): string => app._fmtSize(s);
  const onRefreshClick = (): void => {
    loadRecycleBin();
  };
  root
    .getElementById("recy-refresh")
    ?.addEventListener("click", onRefreshClick);
  const onEmptyClick = async (): Promise<void> => {
    const confirmed = await modalConfirm({
      title: "清空回收站",
      icon: "♻️",
      message: "确定永久清空回收站所有文件？此操作不可恢复！",
      okText: "♻️ 清空",
      danger: true,
    });
    if (!confirmed) return;
    try {
      const { EmptyRecycleBin } = await getApp();
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
  };
  root.getElementById("recy-empty")?.addEventListener("click", onEmptyClick);
  // 监听全局类型切换
  // currentType 初值取 localStorage（持久化权威源，由 app-nav 写入）；运行期以 repo:rtype-changed
  // 事件载荷为准，二者一致时不会重复加载（事件是唯一运行期变更入口）
  let currentType = localStorage.getItem("repo_rtype") || RESOURCE_TYPES.YSM;
  let _loadGen = 0;

  const unsubRtype = bus.on("repo:rtype-changed", (rt) => {
    if (rt && rt !== currentType) {
      currentType = rt;
      loadRecycleBin();
    }
  });

  // 文件名点击 → 模型详情：事件委托只绑一次，cleanup 成对移除（避免每次渲染累积监听）
  const listEl = root.getElementById("recy-list");
  const onListClick = (e: MouseEvent): void => {
    const t = e.target as Element;
    if (t.closest(".recy-restore") || t.closest(".recy-del")) return;
    const el = t.closest("[data-path]");
    if (el) {
      const path = el.getAttribute("data-path");
      if (path) bus.emit("model:select", { path });
    }
  };
  if (listEl) listEl.addEventListener("click", onListClick);

  loadRecycleBin();

  async function loadRecycleBin(): Promise<void> {
    // generation 守卫：每次加载自增，await 后比对，旧请求结果不再覆盖新列表
    const gen = ++_loadGen;
    const list = root.getElementById("recy-list");
    const count = root.getElementById("recy-count");
    if (!list) return;
    try {
      const {
        ListRecycleBin,
        RestoreFromRecycle,
        DeleteFromRecycle,
        GetRepoRoot,
      } = await getApp();

      // 获取当前类型的根目录（用于路径过滤）
      const currentRoot = await GetRepoRoot(currentType);
      const allEntries = (await ListRecycleBin("")) || [];
      if (gen !== _loadGen) return; // 已有更新的加载，丢弃过期结果

      // 过滤：只显示路径在当前类型根目录下的文件
      const entries = currentRoot
        ? allEntries.filter((e) => e.Path && isPathInRoot(e.Path, currentRoot))
        : allEntries;

      if (!entries || !entries.length) {
        list.innerHTML = "";
        if (count) count.textContent = "空";
        return;
      }
      const reg = await loadResourceRegistry();
      if (gen !== _loadGen) return;
      const icon = (reg[currentType] && reg[currentType].icon) || "📦";
      if (count) count.textContent = icon + " " + entries.length + " 个文件";
      list.innerHTML = entries
        .map((e, i) => {
          const name = e.Name.replace(/\.(ysm|zip|7z)\.ban$/i, ".$1");
          const size = e.Size ? fmtSize(e.Size) : "?";
          return `<div class="recy-item" style="animation-delay:${Math.min(i * 25, 400)}ms;display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:var(--fs-sm)">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);cursor:pointer" title="点击查看详情: ${esc(e.Path)}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:var(--fs-xs);color:var(--muted)">${size}</span>
<button class="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-xs)">↩️ 恢复</button>
<button class="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--paid);background:transparent;color:var(--paid);cursor:pointer;font-size:var(--fs-xs)">🗑️ 删除</button>
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
        })
        .join("");

      // 恢复按钮
      list.querySelectorAll(".recy-restore").forEach((btnEl) => {
        const btn = btnEl as HTMLButtonElement;
        btn.onclick = async (): Promise<void> => {
          if (btn.disabled) return;
          btn.disabled = true;
          const item = btn.closest(".recy-item");
          if (item) {
            item.classList.add("leaving");
            await new Promise((r) => setTimeout(r, 150));
          }
          try {
            await RestoreFromRecycle(btn.dataset.path || "", "");
            bus.emit("toast:show", {
              msg: "✅ 已恢复",
              duration: 2000,
              type: "success",
            });
            loadRecycleBin();
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
          } catch (e) {
            if (item) item.classList.remove("leaving");
            btn.disabled = false;
            bus.emit("toast:show", {
              msg: `❌ ${friendlyError(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 删除按钮
      list.querySelectorAll(".recy-del").forEach((btnEl) => {
        const btn = btnEl as HTMLButtonElement;
        btn.onclick = async (): Promise<void> => {
          if (btn.disabled) return;
          const confirmed = await modalConfirm({
            title: "删除文件",
            icon: "🗑️",
            message: "确定永久删除此文件？",
            okText: "🗑️ 删除",
            danger: true,
          });
          if (!confirmed) return;
          btn.disabled = true;
          const item = btn.closest(".recy-item");
          if (item) {
            item.classList.add("leaving");
            await new Promise((r) => setTimeout(r, 150));
          }
          try {
            await DeleteFromRecycle(btn.dataset.path || "");
            loadRecycleBin();
            // P2 修复：与 restore/empty 对齐，删除后联动统计与资源树刷新
            bus.emit("stats:refresh");
            bus.emit("tree:reload");
            bus.emit("toast:show", {
              msg: "✅ 已删除",
              duration: 2000,
              type: "success",
            });
          } catch (e) {
            if (item) item.classList.remove("leaving");
            btn.disabled = false;
            bus.emit("toast:show", {
              msg: `❌ ${friendlyError(e)}`,
              duration: 3000,
              type: "error",
            });
          }
        };
      });

      // 文件名点击 → 模型详情：已在 init 用事件委托统一绑定（onListClick），此处无需逐元素绑定
    } catch (e) {
      if (gen !== _loadGen) return;
      list.innerHTML = `<div class="stat-row" style="padding:12px;color:var(--paid);font-size:11px">❌ ${esc(friendlyError(e, "读取回收站失败"))}</div>`;
      if (count) count.textContent = "加载失败";
    }
  }

  // 返回清理函数，供上层在组件销毁时调用
  return () => {
    if (unsubRtype) unsubRtype();
    if (listEl) listEl.removeEventListener("click", onListClick);
    root
      .getElementById("recy-refresh")
      ?.removeEventListener("click", onRefreshClick);
    root.getElementById("recy-empty")?.removeEventListener("click", onEmptyClick);
  };
}
