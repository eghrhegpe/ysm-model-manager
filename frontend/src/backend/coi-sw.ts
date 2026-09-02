// ===== COI Service Worker 注册（ADR-079 M1：网页版跨源隔离注入）=====
// GitHub Pages 静态托管无法自定义响应头 → SW 拦截同源响应补 COOP/COEP（public/sw.js），
// 浏览器在下次导航解锁 crossOriginIsolated=true（SharedArrayBuffer → pthread WASM 前提）。
// 仅网页版（isWebPlatform）注册；桌面走 Go CoopCoepMiddleware、Android 走
// shouldInterceptRequest 注入（ADR-079 §1.3）。
// 渐进增强：SW 注册失败/不支持 → 静默降级（无跨源隔离，单线程 WASM 兜底，功能不残）。
import { isWebPlatform } from "./platform-web.ts";
import { safeGet, safeSet } from "../utils/dom/storage.ts";
import { dbg } from "../utils/debug/debug.ts";

/** 防 reload 循环标记（值 = JSON {t: 上次 reload 时间戳, n: 已尝试次数}）。
 *  旧版值为 "1"（首次注册固定写）——读到 "1" 视为「曾 reload 但未成功」，t=0 立即落入可重试。 */
const COI_RELOAD_KEY = "ysm:coi-reload";
/** 上次 reload 后此窗口内不再重试（防连续 reload 循环） */
const COI_RELOAD_WINDOW_MS = 30_000;
/** 重试次数上限：达上限后永久放弃（防 SW 激活失败场景无限 reload） */
const COI_RELOAD_MAX_ATTEMPTS = 3;

/** 读 reload 标记；无记录/损坏 → null（可 reload）；"1" 旧版 → {t:0,n:0}（可重试，计入本次） */
function readReloadRecord(): { t: number; n: number } | null {
  const raw = safeGet(COI_RELOAD_KEY);
  if (!raw) return null;
  if (raw === "1") return { t: 0, n: 0 }; // 旧版标记：曾 reload 过但未解锁，允许再试
  try {
    const rec = JSON.parse(raw) as { t: number; n: number };
    if (typeof rec.t === "number" && typeof rec.n === "number") return rec;
  } catch {
    // 损坏值 → 按无记录处理（允许重试）
  }
  return null;
}

/** 当前是否已跨源隔离（SW 补头后 crossOriginIsolated=true；供多线程 WASM 分支） */
export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated === "boolean" && crossOriginIsolated;
}

/** 注册 COI SW（网页版）：首次注册后 reload 一次让浏览器重新导航经 SW（解锁跨源隔离）。
 *  防循环策略：标记带时间戳+次数上限——窗口内不重试、超窗口可重试、达上限永久放弃；
 *  若 reload 后 SW 已控制当前页或已隔离则不再 reload。 */
export function registerCoiServiceWorker(): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!isWebPlatform()) return; // 仅网页版（桌面/Android 由原生注入）
    const base = import.meta.env.BASE_URL;
    void navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then(() => {
        // SW 已控制当前页或已隔离 → 无需 reload
        if (navigator.serviceWorker.controller || isCrossOriginIsolated()) return;
        // 未解锁 → 按窗口/次数决策是否 reload（标记防循环）
        const now = Date.now();
        const rec = readReloadRecord();
        if (rec && now - rec.t < COI_RELOAD_WINDOW_MS) return; // 窗口内刚 reload 过，跳过
        if (rec && rec.n >= COI_RELOAD_MAX_ATTEMPTS) return;   // 达上限，永久放弃
        safeSet(COI_RELOAD_KEY, JSON.stringify({ t: now, n: (rec?.n ?? 0) + 1 }));
        location.reload();
      })
      .catch((e) => {
        // 注册失败（不支持/隐私模式）→ 降级：无跨源隔离，单线程 WASM 兜底
        dbg("coi-sw", "SW 注册失败:", e);
      });
  } catch (e) {
    // 任何异常静默（SW 是渐进增强，失败不影响主功能）；留痕便于 GitHub Pages 排障
    dbg("coi-sw", "SW 注册异常:", e);
  }
}
