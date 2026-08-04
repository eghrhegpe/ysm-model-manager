// ===== 创意工坊事件绑定（类型化版 — ADR-014 P3 features）=====
// 下载队列逻辑已拆到 download-queue.js，本文件只做事件绑定 + 协调。
import { bus } from "../../bus.ts";
import { modalConfirm } from "../../widgets/dialogs/modal.ts";
import { renderModelList, isModelMissing, type WorkshopModel } from "./render.ts";
import { createDownloadQueue, type DownloadTask } from "./download-queue.ts";
import { ICONS } from "../../widgets/app-content/workshop-icons.ts";
import { getApp } from "../../wails/app.ts";

/** bindRepoEvents 上下文 */
export interface RepoEventsContext {
  esc: (s: string) => string;
  models: WorkshopModel[];
  dlPrefix: string;
  repo: string;
  source: string;
  showRepoModels: () => void;
  backToSite: () => void;
  localMap: Map<string, string>;
}

/** 绑定返回值 */
export interface RepoEventsHandle {
  renderList: (filter?: string) => DocumentFragment;
  updateSelectedUI: () => void;
  cleanup: () => Promise<void>;
}

/**
 * 绑定仓库模型页面的所有事件。
 * 管理 showAll / selectedSet 内部状态。
 *
 * @param sr searchResults DOM 容器
 * @param ctx 上下文
 */
export function bindRepoEvents(
  sr: HTMLElement,
  ctx: RepoEventsContext,
): RepoEventsHandle {
  const {
    esc,
    models,
    dlPrefix,
    repo,
    source,
    showRepoModels,
    backToSite,
    localMap,
  } = ctx;
  let showAll = false;
  const selectedSet = new Set<string>();

  const isMissing = (m: WorkshopModel): boolean => isModelMissing(m, localMap);

  // ============================================================
  //  🎯 下载队列（委派给 download-queue.js）
  // ============================================================
  const queue = createDownloadQueue({
    sr,
    esc,
    getLocalMap: () => localMap,
    onFileSuccess: (name) => {
      selectedSet.delete(name);
      updateSelectedUI();
    },
    onAllDone: () => {
      selectedSet.clear();
      setTimeout(() => showRepoModels(), 200);
    },
  });

  // ============================================================
  //  列表渲染
  // ============================================================
  const renderList = (filter = ""): DocumentFragment => {
    const q = filter.trim().toLowerCase();
    let filtered = q
      ? models.filter((m) => m.name.toLowerCase().includes(q))
      : models;
    if (!showAll) {
      filtered = filtered.filter((m) => isMissing(m));
    }
    return renderModelList(
      filtered,
      dlPrefix,
      localMap,
      showAll,
      selectedSet,
      esc,
    );
  };

  const updateSelectedUI = (): void => {
    const checked = selectedSet.size;
    const btn = sr.querySelector(".gh-dl-selected") as HTMLButtonElement | null;
    if (btn) {
      btn.textContent = "⬇️ 下载选中 (" + checked + ")";
      btn.disabled = checked === 0;
    }
  };

  // ============================================================
  //  事件绑定
  // ============================================================

  // ==== 返回 ====
  sr.querySelector(".gh-back-repo")?.addEventListener("click", () => {
    backToSite();
  });

  // ==== 搜索过滤 ====
  const srch = sr.querySelector("#gh-repo-srch") as HTMLInputElement | null;
  if (srch) {
    srch.addEventListener("input", () => {
      const list = sr.querySelector("#gh-repo-list");
      if (list) list.replaceChildren(renderList(srch.value));
    });
  }

  // ==== 📁 仅显示缺失 切换 ====
  const toggleBtn = sr.querySelector(".gh-toggle-missing") as HTMLElement | null;
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showAll = !showAll;
      toggleBtn.textContent = showAll ? "📁 显示全部" : "📁 仅显示缺失";
      toggleBtn.classList.toggle("active", showAll);
      const list = sr.querySelector("#gh-repo-list");
      const inp = sr.querySelector("#gh-repo-srch") as HTMLInputElement | null;
      if (list) list.replaceChildren(renderList(inp?.value || ""));
    });
  }

  // ==== 复选框 → 更新选中计数 ====
  const selContainer = sr.querySelector("#gh-repo-list");
  if (selContainer) {
    selContainer.addEventListener("change", (e: Event) => {
      const target = e.target as HTMLInputElement;
      if (!target.classList.contains("gh-sel")) return;
      const name = target.dataset.name || "";
      if (target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      updateSelectedUI();
    });
  }

  // ==== ⬇️ 下载选中 ====
  const dlSelBtn = sr.querySelector(".gh-dl-selected") as HTMLElement | null;
  if (dlSelBtn) {
    dlSelBtn.addEventListener("click", async () => {
      if (queue.isDownloading() || !selectedSet.size) return;
      const tasks = [...selectedSet]
        .map((name) => models.find((m) => m.name === name))
        .filter((m): m is WorkshopModel => Boolean(m))
        .map(
          (m): DownloadTask => ({
            url: dlPrefix + m.path.replace(/\\/g, "/"),
            saveDir: "",
            name: m.name,
            size: m.size || 0,
          }),
        );
      await queue.enqueue(tasks);
    });
  }

  // ==== ☐ 全选 / 取消全选 ====
  const selAllCb = sr.querySelector(
    ".gh-select-all input[type=checkbox]",
  ) as HTMLInputElement | null;
  if (selAllCb) {
    selAllCb.addEventListener("change", () => {
      const checked = selAllCb.checked;
      selContainer?.querySelectorAll(".gh-sel").forEach((cb) => {
        const input = cb as HTMLInputElement;
        input.checked = checked;
        if (checked) selectedSet.add(input.dataset.name || "");
        else selectedSet.delete(input.dataset.name || "");
      });
      updateSelectedUI();
    });
  }

  // ==== 右键模型行 → 查看索引信息 ====
  const listEl = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (listEl) {
    listEl.addEventListener("contextmenu", (e: MouseEvent) => {
      const row = (e.target as Element).closest("[data-name]") as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name || "";
      const m = models.find((x) => x.name === name);
      if (!m) return;
      const sizeStr = m.size ? (m.size / 1024).toFixed(0) + "KB" : "?KB";
      bus.emit("menu:show", {
        x: e.clientX,
        y: e.clientY,
        items: [
          // menu:show 契约传原文：转义职责归 context-menu 组件（此处再 esc 会双重转义出 &amp;）
          { label: "📄 " + m.name, onClick: () => {} },
          { label: "📂 " + m.path, onClick: () => {} },
          { label: "🔐 " + (m.hash ? m.hash : "—"), onClick: () => {} },
          { label: "📏 " + sizeStr, onClick: () => {} },
        ],
      });
    });
  }

  // ==== ⬇️ 单文件下载（事件委托） ====
  const dlContainer = sr.querySelector("#gh-repo-list") as HTMLElement | null;
  if (dlContainer) {
    dlContainer.addEventListener("click", async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("gh-sel")) return;

      // 下载按钮
      const dlBtn = target.closest(
        '.gh-icon-btn[data-action="download"]',
      ) as HTMLElement | null;
      if (dlBtn && !queue.isDownloading()) {
        const row = dlBtn.closest("[data-name]");
        await handleSingleDownload(dlBtn, row);
        return;
      }

      // B站搜索按钮
      const searchBtn = target.closest(
        '.gh-icon-btn[data-action="search-bili"]',
      ) as HTMLElement | null;
      if (searchBtn) {
        e.stopPropagation();
        const row = searchBtn.closest("[data-name]");
        if (row) {
          const { parseModelName } = await import("../../utils/dom/display.ts");
          const { author } = parseModelName(
            (row as HTMLElement).dataset.name || "",
          );
          if (author) {
            const { OpenInBrowser } = await getApp();
            OpenInBrowser(
              "https://search.bilibili.com/all?keyword=" +
                encodeURIComponent(author),
            );
          }
        }
        return;
      }
    });
  }

  // 提取单文件下载逻辑
  async function handleSingleDownload(
    btn: HTMLElement,
    row: Element | null,
  ): Promise<void> {
    const cbName = btn.dataset.name || "";
    const url = btn.dataset.url || "";
    const size = parseInt(btn.dataset.size || "", 10) || 0;
    const FOUR_MB = 4 * 1024 * 1024;
    const TEN_MB = 10 * 1024 * 1024;
    if (size > TEN_MB) {
      bus.emit("toast:show", {
        msg: "📏 文件超过 10MB，已拒绝下载",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    if (size > FOUR_MB) {
      const ok = await modalConfirm({
        title: "文件较大",
        icon: "📏",
        message: (size / 1024 / 1024).toFixed(1) + "MB，确定要下载吗？",
        okText: "下载",
      });
      if (!ok) return;
    }

    // 同步勾选
    const cb = row?.querySelector(".gh-sel") as HTMLInputElement | null;
    if (cb && cbName) {
      cb.checked = true;
      selectedSet.add(cbName);
      updateSelectedUI();
    }

    btn.innerHTML = ICONS.HOURGLASS;
    await queue.enqueue([{ url, saveDir: "", name: cbName, size }]);
    btn.innerHTML = ICONS.DOWNLOAD;
  }

  // 对外暴露的清理函数（供上层在视图销毁时调用）
  const externalCleanup = async (): Promise<void> => {
    await queue.cancel();
    selectedSet.clear();
    queue.destroy();
  };

  return { renderList, updateSelectedUI, cleanup: externalCleanup };
}
