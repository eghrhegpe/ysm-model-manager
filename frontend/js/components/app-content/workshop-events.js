// ===== 创意工坊事件绑定（为 showRepoModels 减负） =====
import { bus } from "../../bus.js";
import { modalConfirm } from "../../dialogs/modal.js";
import { renderModelList, isModelMissing } from "./workshop-render.js";

/**
 * 绑定仓库模型页面的所有事件。
 * 管理 showAll / selectedSet 内部状态。
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
 * @returns {{ renderList: Function }}
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
  let selectedSet = new Set();
  let downloading = false; // 全局下载锁，防止并发

  const isMissing = (m) => isModelMissing(m, localMap);

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
      models,
      dlPrefix,
      localMap,
      showAll,
      selectedSet,
      esc,
    );
  };

  const updateSelectedUI = () => {
    const checked = selectedSet.size;
    const btn = sr.querySelector(".ws-dl-selected");
    if (btn) {
      btn.textContent = "⬇️ 下载选中 (" + checked + ")";
      btn.style.opacity = checked > 0 ? "1" : ".4";
      btn.style.pointerEvents = checked > 0 ? "auto" : "none";
    }
  };

  // ============================================================
  //  🎯 统一下载入口 — 三个入口（全部/选中/单击）都走这里
  // ============================================================
  let _offEvents = null; // 取消事件监听的函数
  let _progressHandler = null; // 当前文件的进度回调
  let _lastPct = -1; // 上一次进度百分比（用于检测秒跳）
  let _stuckTimer = null; // "写入中"防骗计时器

  /**
   * 入队并启动下载，仅注册一组 Wails 事件。
   * 调用前确保 tasks 已填好 url/saveDir/name/size。
   */
  async function enqueueDownloadTasks(tasks, opts = {}) {
    if (downloading) return;
    if (!tasks.length) return;

    // 取 repoRoot（所有入口共用）
    const { LoadAppConfig, EnqueueDownloads, CancelQueue } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const repoRoot = cfg.repoRoot || "";
    if (!repoRoot) {
      bus.emit("toast:show", {
        msg: "请先在设置中配置仓库目录",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    tasks.forEach((t) => (t.saveDir = repoRoot));

    downloading = true;
    const dlAllBtn = sr.querySelector(".ws-dl-all");
    const dlSelBtn = sr.querySelector(".ws-dl-selected");
    const queueStatus = sr.querySelector("#ws-queue-status");

    // 禁用按钮
    if (dlAllBtn) dlAllBtn.disabled = true;
    if (dlSelBtn) {
      dlSelBtn.style.opacity = ".4";
      dlSelBtn.style.pointerEvents = "none";
    }

    const totalTasks = tasks.length;
    let errorList = []; // 聚合错误 [{ name, err }]
    let completeTimer = null; // 100% 后超时自动完成

    const clearCompleteTimer = () => {
      if (completeTimer) {
        clearTimeout(completeTimer);
        completeTimer = null;
      }
    };

    const stuckGuardReset = () => {
      _lastPct = -1;
      clearCompleteTimer(); // 上一个文件的 3s 超时对新文件无效
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      // 清理菊花动画
      const pctEl2 = queueStatus?.querySelector(".ws-progress-pct");
      if (pctEl2?._dotTimer) {
        clearInterval(pctEl2._dotTimer);
        pctEl2._dotTimer = null;
      }
    };

    const cleanup = (errorSummary) => {
      clearCompleteTimer();
      stuckGuardReset();
      downloading = false;
      if (_offEvents) {
        _offEvents();
        _offEvents = null;
      }
      _progressHandler = null;
      if (dlAllBtn) dlAllBtn.disabled = false;
      if (dlSelBtn) updateSelectedUI();
      if (queueStatus) {
        if (errorSummary) {
          queueStatus.innerHTML = errorSummary;
        } else {
          queueStatus.style.display = "none";
        }
      }
    };

    const offEvents = () => {
      if (window.runtime?.EventsOff) {
        window.runtime.EventsOff("queue:status");
        window.runtime.EventsOff("queue:file-start");
        window.runtime.EventsOff("queue:file-done");
        window.runtime.EventsOff("download:progress");
      }
    };
    _offEvents = offEvents;

    // 进度条
    if (queueStatus) {
      queueStatus.style.display = "block";
      queueStatus.innerHTML =
        '<span style="color:var(--accent)">⬇️</span> 准备下载… 共 ' +
        totalTasks +
        " 个";
    }

    const onQueueStatus = (status) => {
      if (status === "done" || status === "cancelled") {
        const cancelled = status === "cancelled";
        let summary = "";
        if (errorList.length > 0) {
          summary =
            '<div style="padding:2px 0;font-size:10px;color:#f38ba8">⚠️ ' +
            errorList.length +
            " 个文件下载失败：</div>" +
            errorList
              .slice(0, 5)
              .map(
                (e) =>
                  '<div style="font-size:9px;color:var(--muted);padding:0 4px">❌ ' +
                  esc(e.name) +
                  ": " +
                  esc(e.err) +
                  "</div>",
              )
              .join("") +
            (errorList.length > 5
              ? '<div style="font-size:9px;color:var(--muted);padding:0 4px">…还有 ' +
                (errorList.length - 5) +
                " 个</div>"
              : "");
        }
        if (cancelled) {
          cleanup(
            summary ||
              '<span style="color:var(--muted);font-size:10px">⏹ 已取消</span>',
          );
          if (dlAllBtn) dlAllBtn.textContent = "⏹ 已取消";
        } else {
          cleanup(summary || null);
          if (dlAllBtn)
            dlAllBtn.textContent =
              errorList.length > 0
                ? "⚠️ " + errorList.length + " 失败"
                : "✅ 下载完成";
        }
        selectedSet.clear();
        setTimeout(() => showRepoModels(), 1000);
      }
    };

    const onFileStart = (name, total, remaining) => {
      stuckGuardReset(); // 新文件重置防骗状态
      const done = total - remaining;
      if (dlAllBtn) dlAllBtn.textContent = "⬇️ " + done + "/" + total;
      if (queueStatus) {
        const remain = total - done;
        // 创建一个固定的进度容器，后续 download:progress 只更新 bar 部分
        queueStatus.innerHTML =
          '<div style="display:flex;align-items:center;gap:4px">' +
          '<span style="color:var(--accent)">⬇️</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px">' +
          esc(name) +
          "</span>" +
          '<span class="ws-progress-pct" style="font-size:9px;color:var(--muted);flex-shrink:0">⏳</span>' +
          (remain > 1
            ? '<span style="font-size:9px;color:var(--muted);flex-shrink:0">剩余' +
              remain +
              "</span>"
            : "") +
          '<button class="ws-cancel-queue" style="padding:1px 6px;border-radius:3px;border:1px solid var(--bd);background:transparent;color:var(--muted);cursor:pointer;font-size:9px;flex-shrink:0">✕</button>' +
          "</div>" +
          '<div class="ws-progress-bar" style="margin-top:3px;height:4px;border-radius:2px;background:var(--bd);overflow:hidden">' +
          '<div class="ws-progress-fill" style="height:100%;width:0%;border-radius:2px;background:var(--accent);transition:width .2s"></div>' +
          "</div>";
        queueStatus
          .querySelector(".ws-cancel-queue")
          ?.addEventListener("click", async () => {
            await CancelQueue();
          });
      }

      // 注册当前文件的字节级进度
      if (_progressHandler) window.runtime?.EventsOff("download:progress");
      _progressHandler = (dl, total) => {
        if (!queueStatus) return;
        let pct, label;
        if (total <= 0) {
          const mb = (dl / 1024 / 1024).toFixed(1);
          label = mb + "MB";
          pct = dl > 0 ? 100 : 0;
        } else {
          pct = Math.min(Math.round((dl / total) * 100), 100);
          label = pct + "%";
        }

        // � 极速动画：小文件（<100KB）秒完成时，先 99% 再 100%
        const isTiny = total > 0 && total <= 100 * 1024;
        if (isTiny && _lastPct < 10 && pct >= 99 && !completeTimer) {
          label = "99%";
          pct = 99;
          if (!_stuckTimer) {
            // 150ms 后显示真正进度
            _stuckTimer = setTimeout(() => {
              const pctEl2 = queueStatus?.querySelector(".ws-progress-pct");
              const fillEl2 = queueStatus?.querySelector(".ws-progress-fill");
              if (pctEl2) pctEl2.textContent = "100%";
              if (fillEl2) {
                fillEl2.style.transition = "width .15s";
                fillEl2.style.width = "100%";
              }
              _stuckTimer = null;
            }, 150);
          }
        }

        // 🛡️ 防骗：检测秒跳 0→100%（有 Content-Length 且 >1MB 时可疑）
        const hasCL = total > 0 && pct > 0;
        if (
          hasCL &&
          !isTiny &&
          _lastPct < 10 &&
          pct >= 99 &&
          total > 1024 * 1024
        ) {
          label = "99%"; // 先显示 99%，不跳 100%
          pct = 99;
          if (!_stuckTimer) {
            queueStatus.querySelector(".ws-progress-pct").textContent = label;
            // 2 秒后如果还没完成，显示旋转菊花
            _stuckTimer = setTimeout(() => {
              const pctEl = queueStatus?.querySelector(".ws-progress-pct");
              const fillEl = queueStatus?.querySelector(".ws-progress-fill");
              if (pctEl && pctEl.textContent !== "100%") {
                pctEl.textContent = "⏳";
                pctEl.style.fontSize = "9px";
                pctEl._dots = 0;
                // 闪烁动画：. → .. → ... → 循环
                pctEl._dotTimer = setInterval(() => {
                  if (!pctEl || pctEl.textContent === "100%") {
                    clearInterval(pctEl._dotTimer);
                    return;
                  }
                  pctEl._dots = (pctEl._dots + 1) % 4;
                  pctEl.textContent = "⏳" + ".".repeat(pctEl._dots);
                }, 400);
              }
              if (fillEl) fillEl.style.width = "99%";
            }, 2000);
          }
        } else {
          // 正常进度
          if (_stuckTimer) {
            clearTimeout(_stuckTimer);
            _stuckTimer = null;
          }
        }
        _lastPct = pct;

        const pctEl = queueStatus.querySelector(".ws-progress-pct");
        const fillEl = queueStatus.querySelector(".ws-progress-fill");
        if (pctEl && !_stuckTimer) pctEl.textContent = label;
        if (fillEl) {
          fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
          fillEl.style.width = pct + "%";
        }

        // 100% 后 3 秒收不到 done 则强制完成
        if (pct >= 100) {
          clearCompleteTimer();
          completeTimer = setTimeout(() => {
            if (!downloading) return;
            let summary = null;
            if (errorList.length > 0) {
              summary =
                '<div style="padding:2px 0;font-size:10px;color:#f38ba8">⚠️ ' +
                errorList.length +
                " 个文件下载失败</div>";
            }
            cleanup(summary);
            if (dlAllBtn)
              dlAllBtn.textContent =
                errorList.length > 0
                  ? "⚠️ " + errorList.length + " 失败"
                  : "✅ 下载完成";
            selectedSet.clear();
            setTimeout(() => showRepoModels(), 1000);
          }, 3000);
        } else {
          clearCompleteTimer();
        }
      };
      window.runtime?.EventsOn("download:progress", _progressHandler);
    };

    const onFileDone = (name, status, errMsg) => {
      if (status === "fail") {
        errorList.push({ name, err: errMsg || "未知错误" });
        // 进度条显示红色错误
        const pctEl = queueStatus?.querySelector(".ws-progress-pct");
        const fillEl = queueStatus?.querySelector(".ws-progress-fill");
        if (pctEl) {
          pctEl.textContent = "❌";
          pctEl.style.color = "#f38ba8";
          pctEl.title = errMsg || "下载失败";
          if (pctEl._dotTimer) {
            clearInterval(pctEl._dotTimer);
            pctEl._dotTimer = null;
          }
        }
        if (fillEl) {
          fillEl.style.background = "#f38ba8";
        }
        // 取消该文件的勾选
        const cb = sr.querySelector('.ws-sel[data-name="' + esc(name) + '"]');
        if (cb) {
          cb.checked = false;
          selectedSet.delete(name);
          updateSelectedUI();
        }
      }
    };

    if (window.runtime?.EventsOn) {
      window.runtime.EventsOn("queue:status", onQueueStatus);
      window.runtime.EventsOn("queue:file-start", onFileStart);
      window.runtime.EventsOn("queue:file-done", onFileDone);
    }

    await EnqueueDownloads(tasks);
  }

  // ============================================================
  //  事件绑定
  // ============================================================

  // ==== 返回 ====
  sr.querySelector(".ws-back-repo")?.addEventListener("click", () => {
    backToSite();
  });

  // ==== 搜索过滤 ====
  const srch = sr.querySelector("#ws-repo-srch");
  if (srch) {
    srch.addEventListener("input", () => {
      const list = sr.querySelector("#ws-repo-list");
      if (list) list.replaceChildren(renderList(srch.value));
    });
  }

  // ==== 📁 显示全部 切换 ====
  const toggleBtn = sr.querySelector(".ws-toggle-all");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      showAll = !showAll;
      toggleBtn.textContent = showAll ? "📁 显示全部" : "📁 仅显示缺失";
      toggleBtn.style.borderColor = showAll ? "var(--accent)" : "var(--bd)";
      toggleBtn.style.color = showAll ? "var(--accent)" : "var(--txt)";
      const list = sr.querySelector("#ws-repo-list");
      const inp = sr.querySelector("#ws-repo-srch");
      if (list) list.replaceChildren(renderList(inp?.value || ""));
    });
  }

  // ==== ⚙️ 筛选下拉展开/收起 ====
  const filterBtn = sr.querySelector(".ws-filter-btn");
  const filterDropdown = sr.querySelector(".ws-filter-dropdown");
  if (filterBtn && filterDropdown) {
    filterBtn.addEventListener("click", () => {
      const isOpen = filterDropdown.style.display === "flex";
      filterDropdown.style.display = isOpen ? "none" : "flex";
      filterBtn.textContent = isOpen ? "⚙️ 筛选" : "⚙️ 收起";
    });
  }

  // ==== ⬇️ 下载全部缺失 ====
  const dlAllBtn = sr.querySelector(".ws-dl-all");
  if (dlAllBtn) {
    dlAllBtn.addEventListener("click", async () => {
      if (downloading) return;
      const missing = models.filter((m) => isMissing(m));
      if (!missing.length) return;
      const ok = await modalConfirm({
        title: "批量下载",
        icon: "⬇️",
        message:
          "将从 0 号模型开始依次下载 " +
          missing.length +
          " 个模型，每 10 秒下载一个，是否继续？",
        okText: "开始下载",
      });
      if (!ok) return;
      const tasks = missing.map((m) => ({
        url: dlPrefix + m.path.replace(/\\/g, "/"),
        saveDir: "",
        name: m.name,
        size: m.size || 0,
      }));
      await enqueueDownloadTasks(tasks);
    });
  }

  // ==== 复选框 → 更新选中计数 ====
  const selContainer = sr.querySelector("#ws-repo-list");
  if (selContainer) {
    selContainer.addEventListener("change", (e) => {
      if (!e.target.classList.contains("ws-sel")) return;
      const name = e.target.dataset.name;
      if (e.target.checked) selectedSet.add(name);
      else selectedSet.delete(name);
      updateSelectedUI();
    });
  }

  // ==== ⬇️ 下载选中 ====
  const dlSelBtn = sr.querySelector(".ws-dl-selected");
  if (dlSelBtn) {
    dlSelBtn.addEventListener("click", async () => {
      if (downloading || !selectedSet.size) return;
      const tasks = [...selectedSet]
        .map((name) => models.find((m) => m.name === name))
        .filter(Boolean)
        .map((m) => ({
          url: dlPrefix + m.path.replace(/\\/g, "/"),
          saveDir: "",
          name: m.name,
          size: m.size || 0,
        }));
      await enqueueDownloadTasks(tasks);
    });
  }

  // ==== ☐ 全选 / 取消全选 ====
  const selAllBtn = sr.querySelector(".ws-select-all");
  if (selAllBtn) {
    selAllBtn.addEventListener("click", () => {
      const allChecked =
        selContainer?.querySelectorAll(".ws-sel:checked").length ===
        selContainer?.querySelectorAll(".ws-sel").length;
      selContainer?.querySelectorAll(".ws-sel").forEach((cb) => {
        cb.checked = !allChecked;
        if (cb.checked) selectedSet.add(cb.dataset.name);
        else selectedSet.delete(cb.dataset.name);
      });
      selAllBtn.textContent = allChecked ? "☐ 全选" : "☑ 取消全选";
      updateSelectedUI();
    });
  }

  // ==== 右键模型行 → 查看索引信息 ====
  const listEl = sr.querySelector("#ws-repo-list");
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

  // ==== ⬇️ 单文件下载（事件委托：按钮 + 整行可点） ====
  const dlContainer = sr.querySelector("#ws-repo-list");
  if (dlContainer) {
    dlContainer.addEventListener("click", async (e) => {
      // 点复选框不触发下载
      if (e.target.classList.contains("ws-sel")) return;

      const row = e.target.closest(".model-row");
      const btn =
        e.target.closest(".ws-dl-model") || row?.querySelector(".ws-dl-model");
      if (!btn || downloading) return;

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
      const cb = row?.querySelector(".ws-sel");
      if (cb && cbName) {
        cb.checked = true;
        selectedSet.add(cbName);
        updateSelectedUI();
      }

      btn.textContent = "⏳";
      await enqueueDownloadTasks([{ url, saveDir: "", name: cbName, size }]);
      btn.textContent = "⬇️";
    });
  }

  return { renderList, updateSelectedUI };
}
