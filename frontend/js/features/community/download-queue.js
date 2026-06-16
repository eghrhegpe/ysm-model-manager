// ===== 创意工坊 — 批量下载队列（防骗 / 进度 / 取消） =====
// v2: 模块级持久层 — EventsOn 在脚本加载时注册一次，页面切换不丢失事件
import { bus } from "../../bus.js";
import { renderDisplayName } from "../../utils/display.js";
import { dbg } from "../../utils/debug.js";

// ============================================================
//  模块顶层 — 持久状态与事件注册（脚本加载时执行一次）
// ============================================================

/** @type {{ status: string, total: number, remaining: number, currentFile: string, progress: {dl:number,total:number}, errorList: Array, _lastDone: object|null, _lastDoneSeq: number }} */
const STATE = {
  status: "idle",          // "idle" | "downloading" | "done" | "cancelled"
  total: 0,
  remaining: 0,
  currentFile: "",
  progress: { dl: 0, total: 0 },
  errorList: [],
  _lastDone: null,        // { name, status, errMsg } — 最近完成的文件
  _lastDoneSeq: 0,
};

const listeners = new Set();
let _registered = false;

/**
 * 订阅 STATE 变更。返回取消订阅函数。
 * @param {(s: typeof STATE) => void} fn
 * @returns {() => void}
 */
export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify() {
  listeners.forEach(fn => fn(STATE));
}

/** @returns {typeof STATE} 当前状态的只读快照 */
export function getState() {
  return STATE;
}

/**
 * 页面切回时调用，从 Go 端恢复当前队列状态。
 * 如果下载仍在运行，STATE.status 会更新为 "downloading"，
 * 已订阅的 UI 层会根据 STATE 渲染进度条。
 */
export async function resume() {
  try {
    dbg("resume:start");
    const { QueueStatus } = await import("../../../wailsjs/go/main/App.js");
    const result = await QueueStatus();
    dbg("resume:result", result);
    // Wails v2 多返回值映射：数组/对象/单值 三种格式都要兜底
    let remaining, running;
    if (Array.isArray(result)) {
      remaining = result[0];
      running = result[1];
    } else if (result && typeof result === "object") {
      // Wails 某些版本返回 {Remaining, Running} 大写字段
      remaining = result.Remaining ?? result.remaining ?? 0;
      running   = result.Running   ?? result.running   ?? false;
    } else if (typeof result === "number") {
      remaining = result;
      running = remaining > 0;
    } else {
      return; // 无法解析，安全忽略
    }
    if (running) {
      STATE.status = "downloading";
      STATE.remaining = remaining;
      notify();
    }
  } catch (_) { /* QueueStatus 调用失败，安全忽略 */ }
}

/**
 * 模块级入队 — 纯粹的 Go 调用，不涉及 DOM。
 * UI 层应在此之前完成配置检查和 DOM 初始化。
 * @param {Array} tasks
 */
export async function enqueueDownloads(tasks) {
  dbg("enqueue:start", tasks.length);
  if (STATE.status === "downloading") return;
  if (!tasks || !tasks.length) return;

  STATE.status = "downloading";
  STATE.total = tasks.length;
  STATE.remaining = tasks.length;
  STATE.currentFile = "";
  STATE.progress = { dl: 0, total: 0 };
  STATE.errorList = [];
  STATE._lastDone = null;
  STATE._lastDoneSeq = 0;
  notify();

  const { EnqueueDownloads } = await import("../../../wailsjs/go/main/App.js");
  await EnqueueDownloads(tasks);
  dbg("enqueue:done", STATE.status);
}

/**
 * 模块级取消 — 纯粹的 Go 调用。
 */
export async function cancelDownloads() {
  if (STATE.status !== "downloading") return;
  try {
    const { CancelQueue } = await import("../../../wailsjs/go/main/App.js");
    await CancelQueue();
  } catch (_) { /* 取消失败不影响状态 */ }
}

// ── 一次性注册全部后端事件 ──
// Wails 脚本加载时执行一次，页面切换不受影响
if (!_registered && typeof window !== "undefined" && window.runtime?.EventsOn) {
  _registered = true;

  window.runtime.EventsOn("queue:status", (status, total, extra) => {
    dbg("event:queue:status", status, total, extra);
    STATE.status = status;
    if (status === "enqueued") {
      // Go 已收到任务但尚未开始处理 → 给 UI 即时反馈
      STATE.currentFile = "队列排队中…";
      STATE.progress = { dl: 0, total: 0 };
    }
    if (status === "done" || status === "cancelled") {
      STATE.currentFile = "";
      STATE.progress = { dl: 0, total: 0 };
    }
    notify();
  });

  window.runtime.EventsOn("queue:file-start", (name, total, remaining) => {
    dbg("event:queue:file-start", name, total, remaining);
    STATE.currentFile = name;
    STATE.total = total;
    STATE.remaining = remaining;
    STATE.progress = { dl: 0, total: 0 };
    notify();
  });

  window.runtime.EventsOn("queue:file-done", (name, status, errMsg) => {
    dbg("event:queue:file-done", name, status, errMsg);
    if (status === "fail") {
      STATE.errorList.push({ name, err: errMsg || "未知错误" });
    }
    STATE._lastDone = { name, status, errMsg: errMsg || "" };
    STATE._lastDoneSeq++;
    notify();
  });

  window.runtime.EventsOn("download:progress", (dl, total) => {
    dbg("event:download:progress", dl, total, typeof dl, typeof total);
    STATE.progress = { dl, total };
    notify();
  });
}


// ============================================================
//  createDownloadQueue — UI 层（订阅 STATE → 渲染 DOM）
// ============================================================

/**
 * 创建一个下载队列 UI 控制器。
 * 所有 Go 事件已在模块顶层注册，本函数只负责：
 *   1. 订阅 STATE 变更 → 渲染进度 DOM
 *   2. 暴露 enqueue() / cancel() 供事件绑定使用
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
 *   destroy: () => void,
 * }}
 */
export function createDownloadQueue({
  sr,
  esc,
  getLocalMap,
  onFileSuccess,
  onAllDone,
}) {
  let _prevStatus = "idle";
  let _prevFile = "";
  let _prevLastDoneSeq = 0;
  let _lastPct = -1;
  let _stuckTimer = null;
  let completeTimer = null;

  const qsEl = () => sr.querySelector("#gh-queue-status");
  const dlBtn = () => sr.querySelector(".gh-dl-selected");

  // ── 工具函数 ──

  const clearCompleteTimer = () => {
    if (completeTimer) { clearTimeout(completeTimer); completeTimer = null; }
  };

  const stuckGuardReset = () => {
    _lastPct = -1;
    clearCompleteTimer();
    if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
    const pctEl = qsEl()?.querySelector(".gh-progress-pct");
    if (pctEl?._dotTimer) { clearInterval(pctEl._dotTimer); pctEl._dotTimer = null; }
  };

  const cleanupProgressUI = (errorSummary) => {
    clearCompleteTimer();
    stuckGuardReset();
    const qs = qsEl();
    if (qs) {
      if (errorSummary) {
        qs.innerHTML = errorSummary;
      } else {
        qs.classList.remove("show");
      }
    }
    try {
      const _cc = window.go?.main?.App?.ClearScanCache;
      if (_cc) _cc();
    } catch (_) { /* 清除缓存失败不影响清理 */ }
    bus.emit("tree:reload");
    bus.emit("stats:refresh");
  };

  // ── 事件 → UI 映射 ──

  /** 新文件开始下载 → 渲染进度行 + 取消按钮 */
  function handleFileStart(s) {
    stuckGuardReset();
    const done = s.total - s.remaining;
    const qs = qsEl();
    if (qs) {
      const remain = s.total - done;
      qs.innerHTML =
        '<div class="gh-progress-row">' +
        '<span class="gh-queue-icon">⬇️</span>' +
        '<span class="gh-progress-name">' + renderDisplayName(s.currentFile) + '</span>' +
        '<span class="gh-progress-pct">⏳</span>' +
        (remain > 1 ? '<span class="gh-progress-remain">剩余' + remain + '</span>' : '') +
        '<button class="btn-base sm gh-cancel-queue" title="取消">✕</button>' +
        '</div>' +
        '<div class="gh-progress-bar-wrap"><div class="gh-progress-fill"></div></div>';
      qs.querySelector(".gh-cancel-queue")?.addEventListener("click", async () => {
        await cancelDownloads();
      });
    }
  }

  /** 下载进度更新 → 更新进度条和百分比 */
  function handleProgress(s) {
    const qs = qsEl();
    if (!qs) return;
    const { dl, total } = s.progress;

    let pct, label;
    if (total <= 0) {
      const mb = (dl / 1024 / 1024).toFixed(1);
      label = mb + "MB";
      pct = 0;
    } else {
      pct = Math.min(Math.round((dl / total) * 100), 100);
      label = pct + "%";
    }

    const isTiny = total > 0 && total <= 100 * 1024;

    // 小文件卡进度防骗
    if (isTiny && _lastPct < 10 && pct >= 99 && !completeTimer) {
      label = "99%";
      pct = 99;
      if (!_stuckTimer) {
        _stuckTimer = setTimeout(() => {
          const pctEl2 = qs?.querySelector(".gh-progress-pct");
          const fillEl2 = qs?.querySelector(".gh-progress-fill");
          if (pctEl2) pctEl2.textContent = "100%";
          if (fillEl2) { fillEl2.style.transition = "width .3s"; fillEl2.style.width = "100%"; }
          _stuckTimer = null;
        }, 300);
      }
    }

    // 大文件卡进度防骗（CLIP / VAE / UNET 结尾）
    const hasCL = total > 0 && pct > 0;
    if (hasCL && !isTiny && _lastPct < 10 && pct >= 99 && total > 1024 * 1024) {
      label = "99%";
      pct = 99;
      if (!_stuckTimer) {
        qs.querySelector(".gh-progress-pct").textContent = label;
        _stuckTimer = setTimeout(() => {
          const pctEl = qs?.querySelector(".gh-progress-pct");
          const fillEl = qs?.querySelector(".gh-progress-fill");
          if (pctEl && pctEl.textContent !== "100%") {
            pctEl.textContent = "⏳";
            pctEl.style.fontSize = "9px";
            pctEl._dots = 0;
            pctEl._dotTimer = setInterval(() => {
              if (!pctEl || pctEl.textContent === "100%") { clearInterval(pctEl._dotTimer); return; }
              pctEl._dots = (pctEl._dots + 1) % 4;
              pctEl.textContent = "⏳" + ".".repeat(pctEl._dots);
            }, 400);
          }
          if (fillEl) fillEl.style.width = "99%";
        }, 2000);
      }
    } else {
      if (_stuckTimer) { clearTimeout(_stuckTimer); _stuckTimer = null; }
    }
    _lastPct = pct;

    const pctEl = qs.querySelector(".gh-progress-pct");
    const fillEl = qs.querySelector(".gh-progress-fill");
    if (pctEl && !_stuckTimer) pctEl.textContent = label;
    if (fillEl) {
      fillEl.style.transition = pct === 100 ? "width 0s" : "width .2s";
      fillEl.style.width = pct + "%";
    }

    if (pct >= 100) {
      clearCompleteTimer();
      completeTimer = setTimeout(() => {
        if (STATE.status !== "downloading") return;
        let summary = null;
        if (STATE.errorList.length > 0) {
          summary = '<div class="gh-queue-error">⚠️ ' + STATE.errorList.length + " 个文件下载失败</div>";
        }
        cleanupProgressUI(summary);
        if (onAllDone) onAllDone({ cancelled: false, errorList: STATE.errorList });
      }, 3000);
    } else {
      clearCompleteTimer();
    }
  }

  /** 文件下载完成 → 更新本地缓存 / 清勾选 / 显示错误 */
  function handleFileDone(done) {
    if (done.status === "ok") {
      if (done.name) getLocalMap().set(done.name, "");
      const cb = sr.querySelector('.gh-sel[data-name="' + esc(done.name) + '"]');
      if (cb) cb.checked = false;
      if (onFileSuccess) onFileSuccess(done.name);
    } else if (done.status === "fail") {
      const pctEl = qsEl()?.querySelector(".gh-progress-pct");
      const fillEl = qsEl()?.querySelector(".gh-progress-fill");
      if (pctEl) {
        pctEl.textContent = "❌";
        pctEl.classList.add("gh-progress-error");
        pctEl.title = done.errMsg || "下载失败";
        if (pctEl._dotTimer) { clearInterval(pctEl._dotTimer); pctEl._dotTimer = null; }
      }
      if (fillEl) fillEl.classList.add("gh-progress-fill-error");
      const cb = sr.querySelector('.gh-sel[data-name="' + esc(done.name) + '"]');
      if (cb) cb.checked = false;
      if (onFileSuccess) onFileSuccess(done.name);
    }
  }

  /** 队列结束 → 显示错误摘要 / 清理 UI / 通知外部 */
  function handleQueueEnded(s) {
    const cancelled = s.status === "cancelled";
    let summary = "";
    if (s.errorList.length > 0) {
      summary =
        '<div class="gh-queue-error">⚠️ ' + s.errorList.length + " 个文件下载失败：</div>" +
        s.errorList.slice(0, 5).map(e =>
          '<div class="gh-queue-err-item">❌ ' + renderDisplayName(e.name) + ": " + esc(e.err) + "</div>"
        ).join("") +
        (s.errorList.length > 5
          ? '<div class="gh-queue-ellipsis">…还有 ' + (s.errorList.length - 5) + " 个</div>"
          : "");
    }
    if (cancelled) {
      cleanupProgressUI(summary || '<span class="gh-queue-cancel">⏹ 已取消</span>');
    } else {
      cleanupProgressUI(summary || null);
    }
    if (onAllDone) onAllDone({ cancelled, errorList: s.errorList });
  }

  // ── 核心：订阅 STATE → 渲染 DOM ──

  function handleStateChange(s) {
    // 文件完成事件（可能夹在 file-start 和 progress 之间到达）
    if (s._lastDoneSeq > _prevLastDoneSeq) {
      handleFileDone(s._lastDone);
      _prevLastDoneSeq = s._lastDoneSeq;
    }

    // 新文件开始
    if (s.currentFile && s.currentFile !== _prevFile) {
      handleFileStart(s);
    }

    // 下载进度更新
    if (s.progress && (s.progress.dl > 0 || s.progress.total > 0)) {
      handleProgress(s);
    }

    // 队列状态变化
    if (s.status !== _prevStatus) {
      if (s.status === "done" || s.status === "cancelled") {
        clearCompleteTimer(); // 强制清掉进度条 3s timer，防止 "100% → done" 间隙
        handleQueueEnded(s);
      } else if (s.status === "downloading") {
        // 队列启动或 resume 恢复 — 确保 UI 就绪
        const qs = qsEl();
        const btn = dlBtn();
        if (btn) btn.disabled = true;
        if (qs && !qs.classList.contains("show")) {
          // resume 路径：UI 未初始化，补上进度条
          qs.classList.add("show");
          if (s.currentFile) {
            handleFileStart(s);
          } else {
            qs.innerHTML = '<span class="gh-queue-icon">⬇️</span> 下载中… 剩余 ' + (s.remaining || "?") + " 个";
          }
        }
      }
    }

    _prevFile = s.currentFile;
    _prevStatus = s.status;
  }

  const unsub = subscribe(handleStateChange);

  // 页面进入时恢复下载状态（防止切页期间进度丢失）
  resume();

  // ── 公开 API ──

  async function enqueue(tasks) {
    if (STATE.status === "downloading") return;
    if (!tasks.length) return;

    const { LoadAppConfig, GetRepoRoot } =
      await import("../../../wailsjs/go/main/App.js");
    const cfg = await LoadAppConfig();
    const repoRoot = await GetRepoRoot("ysm");
    if (!repoRoot) {
      bus.emit("toast:show", {
        msg: "请先在设置中配置仓库目录",
        duration: 3000,
        type: "warn",
      });
      return;
    }
    tasks.forEach((t) => (t.saveDir = repoRoot));

    const btn = dlBtn();
    if (btn) btn.disabled = true;

    const qs = qsEl();
    if (qs) {
      qs.classList.add("show");
      qs.innerHTML =
        '<span class="gh-queue-icon">⬇️</span> 准备下载… 共 ' + tasks.length + " 个";
    }

    await enqueueDownloads(tasks);
  }

  async function cancel() {
    await cancelDownloads();
  }

  return {
    enqueue,
    cancel,
    isDownloading: () => STATE.status === "downloading",
    /** 组件销毁时取消订阅，防止僵尸回调累积 */
    destroy: unsub,
  };
}
