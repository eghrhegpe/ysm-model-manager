// ===== 创意工坊 — 批量下载队列（防骗 / 进度 / 取消） =====
import { bus } from "../../bus.js";
import { renderDisplayName } from "../../utils/display.js";

/**
 * 创建一个下载队列控制器。
 * 把"全部/选中/单文件"三个入口统一到 enqueue()，
 * 共享下载锁、进度防骗、清理逻辑。
 *
 * @param {Object} opts
 * @param {Element} opts.sr - searchResults 容器
 * @param {Object} opts.esc - HTML 转义
 * @param {Function} opts.getLocalMap - ()=>Map<name,hash>
 * @param {Function} opts.onFileSuccess - (name)=>void 下载成功时调用（用于清勾选）
 * @param {Function} opts.onAllDone - ({cancelled,errorList})=>void 队列结束
 * @returns {{
 *   enqueue: (tasks: Array) => Promise<void>,
 *   cancel: () => Promise<void>,
 *   isDownloading: () => boolean,
 * }}
 */
export function createDownloadQueue({
  sr,
  esc,
  getLocalMap,
  onFileSuccess,
  onAllDone,
}) {
  let downloading = false;
  let _offEvents = null;
  let _progressHandler = null;
  let _lastPct = -1;
  let _stuckTimer = null;
  let completeTimer = null;

  async function enqueue(tasks) {
    if (downloading) return;
    if (!tasks.length) return;

    const { LoadAppConfig, EnqueueDownloads, CancelQueue } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const repoRoot = cfg.filesRoot ? (cfg.filesRoot + "\\ysm") : "";
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
    const dlAllBtn = sr.querySelector(".gh-dl-all");
    const dlSelBtn = sr.querySelector(".gh-dl-selected");
    const queueStatus = sr.querySelector("#gh-queue-status");
    if (dlAllBtn) dlAllBtn.disabled = true;
    if (dlSelBtn) {
      dlSelBtn.style.opacity = ".4";
      dlSelBtn.style.pointerEvents = "none";
    }

    const totalTasks = tasks.length;
    const errorList = [];

    const clearCompleteTimer = () => {
      if (completeTimer) {
        clearTimeout(completeTimer);
        completeTimer = null;
      }
    };

    const stuckGuardReset = () => {
      _lastPct = -1;
      clearCompleteTimer();
      if (_stuckTimer) {
        clearTimeout(_stuckTimer);
        _stuckTimer = null;
      }
      const pctEl = queueStatus?.querySelector(".gh-progress-pct");
      if (pctEl?._dotTimer) {
        clearInterval(pctEl._dotTimer);
        pctEl._dotTimer = null;
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
      if (queueStatus) {
        if (errorSummary) {
          queueStatus.innerHTML = errorSummary;
        } else {
          queueStatus.style.display = "none";
        }
      }
      try {
        const _cc = window.go.main.App.ClearScanCache;
        if (_cc) _cc();
      } catch (_) { /* 清除缓存失败不影响清理 */ }
      bus.emit("tree:reload");
      bus.emit("stats:refresh");
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

    if (queueStatus) {
      queueStatus.style.display = "block";
      queueStatus.innerHTML =
        '<span class="gh-queue-icon">⬇️</span> 准备下载… 共 ' +
        totalTasks +
        " 个";
    }

    const onQueueStatus = (status) => {
      if (status === "done" || status === "cancelled") {
        const cancelled = status === "cancelled";
        let summary = "";
        if (errorList.length > 0) {
          summary =
            '<div class="gh-queue-error">⚠️ ' +
            errorList.length +
            " 个文件下载失败：</div>" +
            errorList
              .slice(0, 5)
              .map(
                (e) =>
                  '<div class="gh-queue-err-item">❌ ' +
                  renderDisplayName(e.name) +
                  ": " +
                  esc(e.err) +
                  "</div>",
              )
              .join("") +
            (errorList.length > 5
              ? '<div class="gh-queue-ellipsis">…还有 ' +
                (errorList.length - 5) +
                " 个</div>"
              : "");
        }
        if (cancelled) {
          cleanup(summary || '<span class="gh-queue-cancel">⏹ 已取消</span>');
          if (dlAllBtn) dlAllBtn.textContent = "⏹ 已取消";
        } else {
          cleanup(summary || null);
          if (dlAllBtn)
            dlAllBtn.textContent =
              errorList.length > 0
                ? "⚠️ " + errorList.length + " 失败"
                : "✅ 下载完成";
        }
        if (onAllDone) onAllDone({ cancelled, errorList });
      }
    };

    const onFileStart = (name, total, remaining) => {
      stuckGuardReset();
      const done = total - remaining;
      if (dlAllBtn) dlAllBtn.textContent = "⬇️ " + done + "/" + total;
      if (queueStatus) {
        const remain = total - done;
        queueStatus.innerHTML =
          '<div class="gh-progress-row">' +
          '<span class="gh-queue-icon">⬇️</span>' +
          '<span class="gh-progress-name">' +
          renderDisplayName(name) +
          "</span>" +
          '<span class="gh-progress-pct">⏳</span>' +
          (remain > 1
            ? '<span class="gh-progress-remain">剩余' + remain + "</span>"
            : "") +
          '<button class="btn-base sm gh-cancel-queue" title="取消">✕</button>' +
          "</div>" +
          '<div class="gh-progress-bar-wrap">' +
          '<div class="gh-progress-fill"></div>' +
          "</div>";
        queueStatus
          .querySelector(".gh-cancel-queue")
          ?.addEventListener("click", async () => {
            await CancelQueue();
          });
      }

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

        const isTiny = total > 0 && total <= 100 * 1024;
        if (isTiny && _lastPct < 10 && pct >= 99 && !completeTimer) {
          label = "99%";
          pct = 99;
          if (!_stuckTimer) {
            _stuckTimer = setTimeout(() => {
              const pctEl2 = queueStatus?.querySelector(".gh-progress-pct");
              const fillEl2 = queueStatus?.querySelector(".gh-progress-fill");
              if (pctEl2) pctEl2.textContent = "100%";
              if (fillEl2) {
                fillEl2.style.transition = "width .3s";
                fillEl2.style.width = "100%";
              }
              _stuckTimer = null;
            }, 300);
          }
        }

        const hasCL = total > 0 && pct > 0;
        if (
          hasCL &&
          !isTiny &&
          _lastPct < 10 &&
          pct >= 99 &&
          total > 1024 * 1024
        ) {
          label = "99%";
          pct = 99;
          if (!_stuckTimer) {
            queueStatus.querySelector(".gh-progress-pct").textContent = label;
            _stuckTimer = setTimeout(() => {
              const pctEl = queueStatus?.querySelector(".gh-progress-pct");
              const fillEl = queueStatus?.querySelector(".gh-progress-fill");
              if (pctEl && pctEl.textContent !== "100%") {
                pctEl.textContent = "⏳";
                pctEl.style.fontSize = "9px";
                pctEl._dots = 0;
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
          if (_stuckTimer) {
            clearTimeout(_stuckTimer);
            _stuckTimer = null;
          }
        }
        _lastPct = pct;

        const pctEl = queueStatus.querySelector(".gh-progress-pct");
        const fillEl = queueStatus.querySelector(".gh-progress-fill");
        if (pctEl && !_stuckTimer) pctEl.textContent = label;
        if (fillEl) {
          fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
          fillEl.style.width = pct + "%";
        }

        if (pct >= 100) {
          clearCompleteTimer();
          completeTimer = setTimeout(() => {
            if (!downloading) return;
            let summary = null;
            if (errorList.length > 0) {
              summary =
                '<div class="gh-queue-error">⚠️ ' +
                errorList.length +
                " 个文件下载失败</div>";
            }
            cleanup(summary);
            if (dlAllBtn)
              dlAllBtn.textContent =
                errorList.length > 0
                  ? "⚠️ " + errorList.length + " 失败"
                  : "✅ 下载完成";
            if (onAllDone) onAllDone({ cancelled: false, errorList });
          }, 3000);
        } else {
          clearCompleteTimer();
        }
      };
      window.runtime?.EventsOn("download:progress", _progressHandler);
    };

    const onFileDone = (name, status, errMsg) => {
      if (status === "ok") {
        if (name) getLocalMap().set(name, "");
        const cb = sr.querySelector('.gh-sel[data-name="' + esc(name) + '"]');
        if (cb) cb.checked = false;
        if (onFileSuccess) onFileSuccess(name);
      } else if (status === "fail") {
        errorList.push({ name, err: errMsg || "未知错误" });
        const pctEl = queueStatus?.querySelector(".gh-progress-pct");
        const fillEl = queueStatus?.querySelector(".gh-progress-fill");
        if (pctEl) {
          pctEl.textContent = "❌";
          pctEl.style.color = "#f38ba8";
          pctEl.title = errMsg || "下载失败";
          if (pctEl._dotTimer) {
            clearInterval(pctEl._dotTimer);
            pctEl._dotTimer = null;
          }
        }
        if (fillEl) fillEl.style.background = "#f38ba8";
        const cb = sr.querySelector('.gh-sel[data-name="' + esc(name) + '"]');
        if (cb) cb.checked = false;
        if (onFileSuccess) onFileSuccess(name);
      }
    };

    if (window.runtime?.EventsOn) {
      window.runtime.EventsOn("queue:status", onQueueStatus);
      window.runtime.EventsOn("queue:file-start", onFileStart);
      window.runtime.EventsOn("queue:file-done", onFileDone);
    }

    await EnqueueDownloads(tasks);
  }

  async function cancel() {
    if (!downloading) return;
    try {
      const { CancelQueue } =
        await import("../../../wailsjs/go/main/App.js");
      await CancelQueue();
    } catch (_) { /* 取消失败不影响清理 */ }
  }

  function isDownloading() {
    return downloading;
  }

  return { enqueue, cancel, isDownloading };
}