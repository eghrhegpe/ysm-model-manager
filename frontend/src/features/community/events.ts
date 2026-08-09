// ===== 创意工坊事件绑定（类型化版 — ADR-014 P3 features）=====
// 下载队列逻辑已拆到 download-queue.js，本文件只做事件绑定 + 协调。
import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { modalConfirm } from "../../utils/dom/dialogs/modal.ts";
import { renderModelList, filterModels, type WorkshopModel } from "./render.ts";
import { createDownloadQueue } from "./download-queue.ts";
import { buildDownloadTasks, classifyDownloadSize } from "./download-tasks.ts";
import { ICONS } from "../../utils/icon/workshop-icons.ts";
import { parseModelName } from "../../utils/dom/display.ts";
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
    const filtered = filterModels(models, filter, showAll, localMap);
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
      btn.textContent = "⬇️ " + t("workshop.downloadSelected", { n: checked });
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
      toggleBtn.textContent = showAll ? t("workshop.showAll") : t("workshop.showMissing");
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
      const tasks = buildDownloadTasks(models, selectedSet, dlPrefix);
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
      // P1 修复：closest 匹配 `.gh-row` 而非 `[data-name]`——下载按钮自身带 data-name，
      // 旧选择器命中按钮自己导致 row.querySelector(".gh-sel") 恒为 null（勾选同步从未生效）
      const row = (e.target as Element).closest(".gh-row") as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name || "";
      const m = models.find((x) => x.name === name);
      if (!m) return;
      // P4 修复（审核发现）：`m.size ? ...` truthiness 把 0 字节折叠为 "?KB"；`m.size`
      // 可选需先 ?? 0 窄化再比较，避免 TS18048 与语义歧义
      const sizeStr = (m.size ?? 0) > 0 ? (m.size! / 1024).toFixed(0) + "KB" : "?KB";
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
        // 匹配 .gh-row 而非 [data-name]：dlBtn 自身带 data-name 会命中自己
        const row = dlBtn.closest(".gh-row");
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
    const decision = classifyDownloadSize(size);
    if (decision === "reject") {
      bus.emit("toast:show", {
        msg: `📏 ${t("workshop.fileTooLarge")}`,
        duration: 3000,
        type: "warn",
      });
      return;
    }
    if (decision === "confirm") {
      const ok = await modalConfirm({
        title: t("workshop.largeFile"),
        icon: "📏",
        message: (size / 1024 / 1024).toFixed(1) + "MB，" + t("workshop.confirmDownload"),
        okText: t("workshop.download"),
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
    // P2 修复：try/finally 保证无论 enqueue 成功/失败按钮都恢复，防永久卡 HOURGLASS
    try {
      await queue.enqueue([{ url, saveDir: "", name: cbName, size }]);
    } finally {
      btn.innerHTML = ICONS.DOWNLOAD;
    }
  }

  // 对外暴露的清理函数（供上层在视图销毁时调用）
  const externalCleanup = async (): Promise<void> => {
    // 移除所有 DOM 事件监听器
    sr.querySelectorAll(".gh-back-repo, #gh-repo-srch, .gh-toggle-missing, #gh-repo-list, .gh-dl-selected, .gh-select-all input[type=checkbox]").forEach((el) => {
      el.replaceWith(el.cloneNode(true));
    });
    await queue.cancel();
    selectedSet.clear();
    queue.destroy();
  };

  return { renderList, updateSelectedUI, cleanup: externalCleanup };
}
