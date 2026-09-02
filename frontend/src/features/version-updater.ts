// ===== 版本更新检查（类型化版 — ADR-014 P3 features）=====
import { TOAST_MS } from "../utils/dom/toast-ms.ts";
import { bus } from "../bus.ts";
import { t } from "../core/i18n/t.ts";
import { esc } from "../utils/dom/html.ts";
import { modalConfirm, modalProgress, fmtMB } from "../utils/dom/dialogs/modal.ts";
import { friendlyError } from "../utils/dom/errors.ts";
import { safeGet, safeSet } from "../utils/dom/storage.ts";
import { isViewerMode } from "../utils/dom/android-bridge.ts";
import { getApp } from "../backend/app.ts";
import { Events, Window } from "../backend/runtime.ts";
import { swallowError } from "../utils/core/async.ts";

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
/** 最短检查间隔（6 小时）——配置缺省回退值（ADR-062 §2.3：设置页可写 updateCheckIntervalMs） */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
/** 手动检查超时（30s，防 Go 端 CheckUpdate 网络挂起时按钮永久「检查中」） */
const CHECK_TIMEOUT = 30 * 1000;

/** 当前检查间隔：读取配置 updateCheckIntervalMs（>0 用之；0=关闭自动检查；缺省回退 6h） */
async function currentCheckInterval(): Promise<number> {
  try {
    const { LoadAppConfig } = await getApp();
    const cfg = await LoadAppConfig();
    const ms = cfg.updateCheckIntervalMs;
    if (ms === 0) return Infinity; // 显式关闭自动检查：恒不触发（canCheck 比较恒 false）
    return typeof ms === "number" && ms > 0 ? ms : CHECK_INTERVAL;
  } catch {
    return CHECK_INTERVAL; // 配置读取失败回退默认（不阻塞启动静默检查）
  }
}

/** 检查是否超过频次限制 */
async function canCheck(): Promise<boolean> {
  const interval = await currentCheckInterval();
  // P3（审核发现）：裸调 localStorage 改 safeGet——隐私模式/存储禁用下 getItem 抛错
  // 会中断启动链（ADR-044 策略 A：统一收敛至 utils/dom/storage.ts）
  const raw = parseInt(safeGet(CHECK_KEY) || "0", 10);
  // 守卫：存储值损坏为非数字时 parseInt→NaN，NaN 比较恒 false 会永久禁用更新检查
  const last = Number.isNaN(raw) ? 0 : raw;
  return Date.now() - last > interval;
}

/** 记录本次检查时间 */
function markChecked(): void {
  safeSet(CHECK_KEY, String(Date.now()));
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
  // 全局标题进度（用户反馈：弹窗可被误关丢进度）：下载前记录原标题，
  // 进度事件同步 Window.SetTitle（标题栏永远可见），finally 恢复
  const origTitle = document.title || "YSM 模型管理器";
  // P3（审核发现）：下载期界面零反馈——打开只读进度弹窗，并瞬态注册 update:progress
  // 事件（Go 侧 DoUpdate 下载时经 a.app.Event.Emit 推送 done/total 字节），
  // finally 注销监听并关闭弹窗，避免常驻 handler（与 download-queue 的模块级
  // ADR-039 豁免注册不同：本模块是瞬态生命周期，有明确的 Off 路径）
  const progress = modalProgress({
    title: "正在更新",
    icon: "⬇️",
    width: "420px",
    // P3 修复（用户反馈）：下载中弹窗禁止 Esc/点遮罩关闭——误关后进度不可见，
    // 用户无法判断是否还在下载；窗口标题进度（Window.SetTitle）作全局兜底
    closable: false,
  });
  const unsub = Events.On("update:progress", (e: { data: unknown[] }) => {
    // 事件 payload 防御（ADR-044 ② 数值守卫）：Go 侧 Emit(done,total) 多参打包为
    // 数组；契约漂移（单参/无参/非数组）时降级为 0，不抛 TypeError 也不渲染 NaN
    const data = Array.isArray(e?.data) ? e.data : [];
    const done = Number.isFinite(data[0]) ? (data[0] as number) : 0;
    const total = Number.isFinite(data[1]) ? (data[1] as number) : 0;
    progress.update(done, total);
    // 窗口标题同步进度（即使弹窗被意外关闭/挤兑，标题栏仍显示下载状态）；
    // SetTitle 失败（无窗口上下文）经 swallowError 记录（web 模式恒 resolve；桌面失败留痕），不阻断下载
    if (total > 0) {
      const pct = Math.min(100, Math.max(0, Math.round((done / total) * 100)));
      swallowError(Window.SetTitle(`⬇️ ${pct}% ${origTitle}`));
    } else {
      swallowError(Window.SetTitle(`⬇️ ${fmtMB(done)} ${origTitle}`));
    }
  });
  try {
    const result = await DoUpdate(info.url || "", info.expectedHash || "");
    if (result !== "success") {
      throw new Error(result);
    }
    // 说明：Go 侧 InstallUpdate 在替换完成后 os.Exit(0) 终止主进程，下面这段实际
    // 不可达（更新助手 ysm-updater-helper.exe 负责替换 exe 并重启新进程）；
    // 保留作防御——若未来 InstallUpdate 改为返回而非退出，可在此启动新进程
    await RestartApplication();
  } finally {
    unsub();
    progress.close();
    swallowError(Window.SetTitle(origTitle));
  }
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
    `<div style="font-size:12px;color:var(--txt);line-height:1.5">${t("update.newVersionPrompt", { latest: esc(info.latest), current: esc(info.current) })}</div>` +
    (notesHTML
      ? `<div style="font-size:11px;color:var(--muted);margin-top:6px">━━━ ${t("update.changelog")} ━━━</div>${notesHTML}`
      : "");
  const ok = await modalConfirm({
    title: t("update.newVersionTitle"),
    icon: "📦",
    message: `${t("update.newVersionPrompt", { latest: info.latest, current: info.current })}\n`,
    okText: `⬇️ ${t("update.download")}`,
    width: "480px",
    bodyHTML,
  });
  if (!ok) return;
  // P2 修复：静默路径（toast click 触发）statusEl 为 null，下载期（上限 500MB）界面零反馈——
  // 先发一条「下载中」toast，避免用户点完更新后长时间无感知。
  // P3 修复（code_review）：10s 对慢网大文件不够，拉到 60s，保证覆盖整个下载窗口
  if (!statusEl) {
    bus.emit("toast:show", {
      msg: `⬇️ ${t("update.downloading", { version: info.latest })}`,
      duration: TOAST_MS.sticky,
      type: "info",
    });
  }
  try {
    await doUpdate(info, statusEl);
  } catch (e) {
    bus.emit("toast:show", {
      msg: `❌ ${t("update.failed")}: ${friendlyError(e)}`,
      duration: TOAST_MS.long,
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
  // ADR-047 平台守卫：自动更新 Windows-only（ADR-033），查看器模式（Android 无
  // exe 替换链路 / 网页版无更新概念）跳过
  if (isViewerMode()) return;
  // P3 修复：canCheck 移入 try——原实现位于 try 之外，隐私模式 localStorage.getItem 抛错时
  // promise 会 reject（靠调用方 .catch 兜底而非模块内静默），违反「静默路径绝不向启动流程抛错」
  try {
    if (!(await canCheck())) return;
    const { CheckUpdate } = await getApp();
    const info = (await CheckUpdate()) as UpdateInfo | null;
    // 检查成功才计入频次：失败（网络/API）不阻塞下次启动重试
    markChecked();
    if (info?.available) {
      bus.emit("toast:show", {
        msg: `📦 ${t("update.found", { latest: info.latest, current: info.current })}`,
        duration: TOAST_MS.persist,
        type: "info",
        click: () => {
          // P3（审核发现）：toast click 回调补 catch 出口——静默路径 modalConfirm 若
          // reject 会成为 unhandled rejection（手动路径有外层 try/catch，静默路径没有，
          // 错误边界不对称，ADR-044 ①）
          promptUpdate(info, null).catch((e) => {
            bus.emit("toast:show", {
              msg: `❌ ${friendlyError(e)}`,
              duration: TOAST_MS.long,
              type: "error",
            });
          });
        },
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
      // ADR-047 平台守卫：查看器模式（Android/网页版）无更新链路，点击明确拒绝
      if (isViewerMode()) {
        bus.emit("toast:show", {
          msg: t("update.windowsOnly"),
          duration: TOAST_MS.normal,
          type: "info",
        });
        return;
      }
      const btn = root.getElementById("set-check-update") as HTMLButtonElement;
      // P3（审核发现）：重入守卫——编程式 .click()/异常事件流下 disabled 语义不可靠，
      // 首行显式拦截避免双执行（真实用户连点已由 disabled 挡住，此处为防御补强）
      if (btn.disabled) return;
      btn.textContent = "⏳ 检查中...";
      btn.disabled = true;
      // P3（审核，资源）：超时计时器句柄——CheckUpdate 先返回时若不清理，计时器会
      // 悬挂 30s 才空转（reject 已 settled 的 Promise 虽无害但属资源泄漏）；
      // finally 统一 clearTimeout 回收（Timeout 挂起则 reject 后清掉是幂等 no-op）
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const { CheckUpdate } = await getApp();
        // P2 修复（审核，超时护栏）：手动路径原无前端超时——CheckUpdate 网络请求挂起
        // （Go 端 HTTP 卡死/代理黑洞）时 await 永不返回，按钮永久「检查中...」。
        // Promise.race 30s 超时 reject → catch toast + finally 恢复按钮；
        // 与静默路径（启动检查失败静默）语义对齐：手动路径必须给用户明确反馈
        const info = (await Promise.race([
          CheckUpdate(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(t("update.timeout"))),
              CHECK_TIMEOUT,
            );
          }),
        ])) as UpdateInfo | null;
        markChecked();
        if (!info?.available) {
          bus.emit("toast:show", {
            // null（绑定契约允许）视为不可用；info?.current ?? "" 兜底避免空括号
            msg: `✅ ${t("update.latest", { version: info?.current ?? "" })}`,
            duration: TOAST_MS.normal,
            type: "success",
          });
          return;
        }
        await promptUpdate(info, btn);
      } catch (e) {
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e)}`,
          duration: TOAST_MS.long,
          type: "error",
        });
      } finally {
        clearTimeout(timeoutId);
        btn.textContent = "🔄 检查更新";
        btn.disabled = false;
      }
    });
}
