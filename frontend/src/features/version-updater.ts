// ===== 版本更新检查（类型化版 — ADR-014 P3 features）=====
import { bus } from "../bus.ts";
import { esc, modalConfirm } from "../utils/dom/dialogs/modal.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { getApp } from "../wails/app.ts";

/** 更新信息（CheckUpdate 返回） */
export interface UpdateInfo {
  available: boolean;
  latest: string;
  current: string;
  url?: string;
  expectedHash?: string;
  releaseNotes?: string;
}

/** 频次限制 key */
const CHECK_KEY = "ysm_lastUpdateCheck";
/** 最短检查间隔（6 小时） */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;

/** 检查是否超过频次限制 */
function canCheck(): boolean {
  const last = parseInt(localStorage.getItem(CHECK_KEY) || "0", 10);
  return Date.now() - last > CHECK_INTERVAL;
}

/** 记录本次检查时间 */
function markChecked(): void {
  localStorage.setItem(CHECK_KEY, String(Date.now()));
}

/** 下载并应用更新（公共逻辑） */
async function doUpdate(
  info: UpdateInfo,
  statusEl: HTMLElement | null,
): Promise<void> {
  if (statusEl) {
    statusEl.textContent = "⬇️ 下载+安装中...";
  }
  const { DoUpdate, RestartApplication } = await getApp();
  const result = await DoUpdate(info.url || "", info.expectedHash || "");
  if (result !== "success") {
    throw new Error(result);
  }
  // 说明：Go 侧 InstallUpdate 在替换完成后 os.Exit(0) 终止主进程，下面这段实际
  // 不可达（更新助手 ysm-updater-helper.exe 负责替换 exe 并重启新进程）；
  // 保留作防御——若未来 InstallUpdate 改为返回而非退出，可在此启动新进程
  await RestartApplication();
}

/** 弹出更新确认对话框（手动/静默共用） — 含格式化的更新日志区域 */
async function promptUpdate(
  info: UpdateInfo,
  statusEl: HTMLElement | null,
): Promise<void> {
  // 转义 HTML 后保留换行（textContent 法），样式通过 CSS 变量适应主题
  const notesHTML = info.releaseNotes
    ? (() => {
        const raw = info.releaseNotes.slice(0, 2000).trim();
        if (!raw) return "";
        const d = document.createElement("div");
        d.textContent = raw;
        return `<div style="border:1px solid var(--bd);border-radius:6px;background:var(--bg);padding:10px;font-size:11px;line-height:1.6;white-space:pre-wrap;max-height:40vh;overflow-y:auto;color:var(--txt);margin-top:6px">${d.innerHTML}</div>`;
      })()
    : "";
  const bodyHTML =
    `<div style="font-size:12px;color:var(--txt);line-height:1.5">发现新版本 ${esc(info.latest)}（当前 ${esc(info.current)}）<br>是否下载并更新？</div>` +
    (notesHTML
      ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">━━━ 更新日志 ━━━</div>${notesHTML}`
      : "");
  const ok = await modalConfirm({
    title: "发现新版本",
    icon: "📦",
    message: `发现新版本 ${info.latest}（当前 ${info.current}）\n是否下载并更新？`,
    okText: "⬇️ 下载更新",
    width: "480px",
    bodyHTML,
  });
  if (!ok) return;
  // P2 修复：静默路径（toast click 触发）statusEl 为 null，下载期（上限 500MB）界面零反馈——
  // 先发一条「下载中」toast，避免用户点完更新后长时间无感知
  if (!statusEl) {
    bus.emit("toast:show", {
      msg: `⬇️ 正在下载 ${info.latest}… 下载完成将自动重启应用`,
      duration: 10000,
      type: "info",
    });
  }
  try {
    await doUpdate(info, statusEl);
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ 更新失败: ${friendlyError(e)}`,
      duration: 5000,
      type: "error",
    });
    // 不重新抛出（外层 initVersionUpdater 的 finally 会恢复按钮状态）
  }
}

/**
 * 启动时静默检查更新（受 6h 频次限制）
 * 有新版本则在右下角显示可点击的 toast 通知
 */
export async function checkUpdateSilent(): Promise<void> {
  if (!canCheck()) return;
  try {
    const { CheckUpdate } = await getApp();
    const info = (await CheckUpdate()) as UpdateInfo;
    // 检查成功才计入频次：失败（网络/API）不阻塞下次启动重试
    markChecked();
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
export function initVersionUpdater(root: Document | ShadowRoot): void {
  root
    .getElementById("set-check-update")
    ?.addEventListener("click", async (): Promise<void> => {
      const btn = root.getElementById("set-check-update") as HTMLButtonElement;
      btn.textContent = "⏳ 检查中...";
      btn.disabled = true;
      try {
        const { CheckUpdate } = await getApp();
        const info = (await CheckUpdate()) as UpdateInfo;
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
