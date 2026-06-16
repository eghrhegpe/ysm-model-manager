// ===== 创意工坊事件绑定（搜索 / 多选 / 筛选 / 下载） =====
// 下载队列逻辑已拆到 download-queue.js，本文件只做事件绑定 + 协调。
import { bus } from "../../bus.js";
import { modalConfirm } from "../../dialogs/modal.js";
import { renderModelList, isModelMissing } from "./render.js";
import { createDownloadQueue } from "./download-queue.js";
import { ICONS } from "../../components/app-content/workshop-icons.js";

/**
 * 绑定仓库模型页面的所有事件。
 * 管理 showAll / selectedSet 内部状态。
 *
 * @param {Element} sr - searchResults DOM 容器
 * @param {Object} ctx
 * @param {Function} ctx.esc - HTML 转义 (s)=>string
 * @param {Array} ctx.models - 模型列表
 * @param {string} ctx.dlPrefix - 下载 URL 前缀
 * @param {string} ctx.repo - 仓库名
 * @param {string} ctx.source - 数据源标识
 * @param {Function} ctx.showRepoModels - 完整刷新 ()=>void
 * @param {Function} ctx.backToSite - 返回站点视图 ()=>void
 * @param {Map} ctx.localMap - 本地文件 Map<name, hash>
 * @returns {{ renderList: Function, updateSelectedUI: Function, cleanup: Function }}
 */
export function bindRepoEvents(sr, ctx) {
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
  const selectedSet = new Set();

  const isMissing = (m) => isModelMissing(m, localMap);

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
  const renderList = (filter = "") => {
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

  const updateSelectedUI = () => {
    const checked = selectedSet.size;
    const btn = sr.querySelector(".gh-dl-selected");
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
  const srch = sr.querySelector("#gh-repo-srch");
  if (srch) {
    srch.addEventListener("input", () => {
      const list = sr.querySelector("#gh-repo-list");
      if (list) list.replaceChildren(renderList(srch.value));
    });
  }

  // ==== 📁 仅显示缺失 切换 ====
  const toggleBtn = sr.querySelector(".gh-toggle-missing");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showAll = !showAll;
      toggleBtn.textContent = showAll ? "📁 显示全部" : "📁 仅显示缺失";
      toggleBtn.classList.toggle("active", showAll);
      const list = sr.querySelector("#gh-repo-list");
      const inp = sr.querySelector("#gh-repo-srch");
      if (list) list.replaceChildren(renderList(inp?.value || ""));
    });
  }

  // ==== 复选框 → 更新选中计数 ====
  const selContainer = sr.querySelector("#gh-repo-list");
  if (selContainer) {
    selContainer.addEventListener("change", (e) => {
      if (!e.target.classList.contains("gh-sel")) return;
      const name = e.target.dataset.name;
      if (e.target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      updateSelectedUI();
    });
  }

  // ==== ⬇️ 下载选中 ====
  const dlSelBtn = sr.querySelector(".gh-dl-selected");
  if (dlSelBtn) {
    dlSelBtn.addEventListener("click", async () => {
      if (queue.isDownloading() || !selectedSet.size) return;
      const tasks = [...selectedSet]
        .map((name) => models.find((m) => m.name === name))
        .filter(Boolean)
        .map((m) => ({
          url: dlPrefix + m.path.replace(/\\/g, "/"),
          saveDir: "",
          name: m.name,
          size: m.size || 0,
        }));
      await queue.enqueue(tasks);
    });
  }

  // ==== ☐ 全选 / 取消全选 ====
  const selAllCb = sr.querySelector(".gh-select-all input[type=checkbox]");
  if (selAllCb) {
    selAllCb.addEventListener("change", () => {
      const checked = selAllCb.checked;
      selContainer?.querySelectorAll(".gh-sel").forEach((cb) => {
        cb.checked = checked;
        if (checked) selectedSet.add(cb.dataset.name);
        else selectedSet.delete(cb.dataset.name);
      });
      updateSelectedUI();
    });
  }

  // ==== 右键模型行 → 查看索引信息 ====
  const listEl = sr.querySelector("#gh-repo-list");
  if (listEl) {
    listEl.addEventListener("contextmenu", (e) => {
      const row = e.target.closest("[data-name]");
      if (!row) return;
      e.preventDefault();
      e.stopPropagation();
      const name = row.dataset.name;
      const m = models.find((x) => x.name === name);
      if (!m) return;
      const sizeStr = m.size ? (m.size / 1024).toFixed(0) + "KB" : "?KB";
      bus.emit("menu:show", {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "📄 " + esc(m.name), onClick: () => {} },
          { label: "📂 " + esc(m.path), onClick: () => {} },
          { label: "🔐 " + (m.hash ? m.hash : "—"), onClick: () => {} },
          { label: "📏 " + sizeStr, onClick: () => {} },
        ],
      });
    });
  }

  // ==== ⬇️ 单文件下载（事件委托） ====
  const dlContainer = sr.querySelector("#gh-repo-list");
  if (dlContainer) {
    dlContainer.addEventListener("click", async (e) => {
      if (e.target.classList.contains("gh-sel")) return;

      // 下载按钮
      const dlBtn = e.target.closest('.gh-icon-btn[data-action="download"]');
      if (dlBtn && !queue.isDownloading()) {
        const row = dlBtn.closest("[data-name]");
        await handleSingleDownload(dlBtn, row);
        return;
      }

      // B站搜索按钮
      const searchBtn = e.target.closest('.gh-icon-btn[data-action="search-bili"]');
      if (searchBtn) {
        e.stopPropagation();
        const row = searchBtn.closest("[data-name]");
        if (row) {
          const { parseModelName } = await import("../../utils/display.js");
          const { author } = parseModelName(row.dataset.name);
          if (author) {
            const { OpenInBrowser } = await import("../../../wailsjs/go/main/App.js");
            OpenInBrowser("https://search.bilibili.com/all?keyword=" + encodeURIComponent(author));
          }
        }
        return;
      }
    });
  }

  // 提取单文件下载逻辑
  async function handleSingleDownload(btn, row) {
      const cbName = btn.dataset.name || "";
      const url = btn.dataset.url;
      const size = parseInt(btn.dataset.size, 10) || 0;
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
      const cb = row?.querySelector(".gh-sel");
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
  const externalCleanup = async () => {
    await queue.cancel();
    selectedSet.clear();
    queue.destroy?.();
  };

  return { renderList, updateSelectedUI, cleanup: externalCleanup };
}
