// ===== 版本更新检查 =====
import { bus } from "../bus.js";
import { esc } from "../dialogs/modal.js";

/** 频次限制 key */
const CHECK_KEY = "ysm_lastUpdateCheck";
/** 最短检查间隔（6 小时） */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** 检查是否超过频次限制 */
function canCheck() {
  const last = parseInt(localStorage.getItem(CHECK_KEY) || "0", 10);
  return Date.now() - last > CHECK_INTERVAL;
}

/** 记录本次检查时间 */
function markChecked() {
  localStorage.setItem(CHECK_KEY, String(Date.now()));
}

/** 下载并应用更新（公共逻辑） */
async function doUpdate(info, statusEl) {
  if (statusEl) {
    statusEl.textContent = "⬇️ 下载+安装中...";
  }
  const { DoUpdate } = await import("../../wailsjs/go/main/App.js");
  const result = await DoUpdate(info.url);
  if (result !== "success") {
    throw new Error(result);
  }
  // 启动新进程后退出
  const { RestartApplication } = await import("../../wailsjs/go/main/App.js");
  await RestartApplication();
}

/** 弹出更新确认对话框（手动/静默共用） — 含格式化的更新日志区域 */
async function promptUpdate(info, statusEl) {
  const ok = await new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.tabIndex = 0;
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(false);
      }
    };
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.remove();
        resolve(false);
      }
    });

    const box = document.createElement("div");
    box.className = "dlg-box dlg-pad";
    box.style.cssText = "gap:10px;width:480px";

    const notesHTML = info.releaseNotes
      ? (() => {
          const raw = info.releaseNotes.slice(0, 2000).trim();
          if (!raw) return "";
          // 转义 HTML 后保留换行，样式通过 CSS 变量适应主题
          const d = document.createElement("div");
          d.textContent = raw;
          return `<div style="border:1px solid var(--bd);border-radius:6px;background:var(--bg);padding:10px;font-size:11px;line-height:1.6;white-space:pre-wrap;max-height:40vh;overflow-y:auto;color:var(--txt);margin-top:4px">${d.innerHTML}</div>`;
        })()
      : "";

    box.innerHTML = `
      <div class="dlg-title" style="margin:0">📦 发现新版本</div>
      <div style="font-size:12px;color:var(--txt);line-height:1.5">发现新版本 ${esc(info.latest)}（当前 ${esc(info.current)}）<br>是否下载并更新？</div>
      ${notesHTML ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">━━━ 更新日志 ━━━</div>${notesHTML}` : ""}
      <div class="dlg-footer" style="padding:0">
        <button class="dlg-btn" id="um-cancel">取消 (Esc)</button>
        <button class="dlg-btn dlg-btn-primary" id="um-ok">⬇️ 下载更新</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.focus();

    box.querySelector("#um-cancel").onclick = () => {
      overlay.remove();
      resolve(false);
    };
    box.querySelector("#um-ok").onclick = () => {
      overlay.remove();
      resolve(true);
    };
  });

  if (!ok) return;
  await doUpdate(info, statusEl);
}

/**
 * 启动时静默检查更新（受 6h 频次限制）
 * 有新版本则在右下角显示可点击的 toast 通知
 */
export async function checkUpdateSilent() {
  if (!canCheck()) return;
  markChecked();
  try {
    const { CheckUpdate } = await import("../../wailsjs/go/main/App.js");
    const info = await CheckUpdate();
    if (info?.available) {
      bus.emit("toast:show", {
        msg: `📦 发现新版本 ${info.latest}（当前 ${info.current}）— 点击查看`,
        duration: 10000,
        type: "info",
        click: () => promptUpdate(info, null),
      });
    }
  } catch {
    // 静默失败，不影响启动
  }
}

/**
 * 手动检查更新（设置页按钮）
 */
export function initVersionUpdater(root) {
  root
    .getElementById("set-check-update")
    ?.addEventListener("click", async () => {
      const btn = root.getElementById("set-check-update");
      btn.textContent = "⏳ 检查中...";
      btn.disabled = true;
      try {
        const { CheckUpdate } = await import("../../wailsjs/go/main/App.js");
        const info = await CheckUpdate();
        markChecked();
        if (!info.available) {
          bus.emit("toast:show", {
            msg: `✅ 已是最新版本 (${info.current})`,
            duration: 3000,
            type: "success",
          });
          return;
        }
        await promptUpdate(info, btn);
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: 5000,
          type: "error",
        });
      } finally {
        btn.textContent = "🔄 检查更新";
        btn.disabled = false;
      }
    });
}
