// ===== COI Service Worker 注册（ADR-079 M1：网页版跨源隔离注入）=====
// GitHub Pages 静态托管无法自定义响应头 → SW 拦截同源响应补 COOP/COEP（public/sw.js），
// 浏览器在下次导航解锁 crossOriginIsolated=true（SharedArrayBuffer → pthread WASM 前提）。
// 仅网页版（isWebPlatform）注册；桌面走 Go CoopCoepMiddleware、Android 走
// shouldInterceptRequest 注入（ADR-079 §1.3）。
// 渐进增强：SW 注册失败/不支持 → 静默降级（无跨源隔离，单线程 WASM 兜底，功能不残）。
import { isWebPlatform } from "@/backend/platform.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { dbg } from "@/utils/debug/debug.ts";
import { isCrossOriginIsolated } from "./stats-protocol.ts";

/** 防 reload 循环标记（值 = JSON {t: 上次 reload 时间戳, n: 已尝试次数}）。
 *  旧版值为 "1"（首次注册固定写）——读到 "1" 视为「曾 reload 但未成功」，t=0 立即落入可重试。
 *  sessionStorage 兜底：localStorage 不可用（隐私模式/存储禁用）时 safeGet 读不到记录，
 *  会话级持久同样足够防循环（reload 内保留；新标签页重新计次）。 */
const COI_RELOAD_KEY = "ysm:coi-reload";
/** 上次 reload 后此窗口内不再重试（防连续 reload 循环） */
const COI_RELOAD_WINDOW_MS = 30_000;
/** 重试次数上限：达上限后永久放弃（防 SW 激活失败场景无限 reload） */
const COI_RELOAD_MAX_ATTEMPTS = 3;

/** sessionStorage 兜底读：裸访问 + try/catch（存储被禁时连 sessionStorage 访问也抛）；
 *  运行环境无 sessionStorage（node 测试环境等）→ null */
function readSessionRecord(): string | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(COI_RELOAD_KEY);
  } catch {
    return null;
  }
}

/** 读 reload 标记（localStorage 优先，读不到回退 sessionStorage 同 key）；
 *  无记录/损坏 → null（可 reload）；"1" 旧版 → {t:0,n:0}（可重试，计入本次） */
function readReloadRecord(): { t: number; n: number } | null {
  const raw = safeGet(COI_RELOAD_KEY) ?? readSessionRecord();
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

/** sessionStorage 兜底镜像写：同步于 safeSet 路径（try/catch + 环境防护，静默跳过） */
function writeSessionRecord(val: string): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(COI_RELOAD_KEY, val);
  } catch {
    // sessionStorage 不可用（隐私模式常与 localStorage 同废）→ 跳过兜底
  }
}

// 跨源隔离判定收敛至 stats-protocol.ts 单一事实源（coi-sw 注册判定 / stats.worker mt 选型 /
// 未来主线程分支共用），此处 import + 显式导出保持公共 API 兼容（coi-sw.test.ts 消费）。
// 注：不用 `export { x } from` 直接 re-export——vitest 模块代理对该语法处理异常
// （实测 register().then 回调不触发），import + export 语义等价且测试稳定。
export { isCrossOriginIsolated };

/** 注册 COI SW（网页版）：首次注册后 reload 一次让浏览器重新导航经 SW（解锁跨源隔离）。
 *  防循环策略：标记带时间戳+次数上限——窗口内不重试、超窗口可重试、达上限永久放弃；
 *  标记经 sessionStorage 镜像兜底（localStorage 不可用时防循环状态不丢失）；
 *  若 reload 后 SW 已控制当前页或已隔离则不再 reload。 */
export function registerCoiServiceWorker(): void {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!isWebPlatform()) return; // 仅网页版（桌面/Android 由原生注入）
    const base = import.meta.env.BASE_URL;
    // 非 fire-and-forget：.then 内完成 reload 决策，.catch 兜底注册期失败（渐进增强静默降级）；
    // void 仅显式丢弃终点 promise（catch 回调自身不抛），标记「已处理」意图
    void navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .then(() => {
        // SW 已控制当前页或已隔离 → 无需 reload
        if (navigator.serviceWorker.controller || isCrossOriginIsolated()) return;
        // 未解锁 → 按窗口/次数决策是否 reload（标记防循环）
        const now = Date.now();
        const rec = readReloadRecord();
        if (rec && now - rec.t < COI_RELOAD_WINDOW_MS) return; // 窗口内刚 reload 过，跳过
        if (rec && rec.n >= COI_RELOAD_MAX_ATTEMPTS) return; // 达上限，永久放弃
        const val = JSON.stringify({ t: now, n: (rec?.n ?? 0) + 1 });
        safeSet(COI_RELOAD_KEY, val);
        writeSessionRecord(val); // 兜底镜像：localStorage 不可用时 reload 后仍能读到记录，阻断循环
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
