// ===== COI Service Worker 注册（ADR-079 M1：网页版跨源隔离注入）=====
// GitHub Pages 静态托管无法自定义响应头 → SW 拦截同源响应补 COOP/COEP（public/sw.js），
// 浏览器在下次导航解锁 crossOriginIsolated=true（SharedArrayBuffer → pthread WASM 前提）。
// 仅网页版（isWebPlatform）注册；桌面走 Go CoopCoepMiddleware、Android 走
// shouldInterceptRequest 注入（ADR-079 §1.3）。
// 渐进增强：SW 注册失败/不支持 → 静默降级（无跨源隔离，单线程 WASM 兜底，功能不残）。
import { isWebPlatform } from "./platform-web.ts";
import { safeGet, safeSet } from "../utils/dom/storage.ts";
import { dbg } from "../utils/debug/debug.ts";

/** 防 reload 循环标记（首次注册解锁需 reload 一次；标记存在则不再 reload） */
const COI_RELOAD_KEY = "ysm:coi-reload";

/** 当前是否已跨源隔离（SW 补头后 crossOriginIsolated=true；供多线程 WASM 分支） */
export function isCrossOriginIsolated(): boolean {
  return typeof crossOriginIsolated === "boolean" && crossOriginIsolated;
}

/** 注册 COI SW（网页版）：首次注册后 reload 一次让浏览器重新导航经 SW（解锁跨源隔离） */
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
        // 首次注册：SW 尚未控制当前页（补头未生效）→ reload 一次（localStorage 标记防循环）
        if (!safeGet(COI_RELOAD_KEY)) {
          safeSet(COI_RELOAD_KEY, "1");
          location.reload();
        }
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
