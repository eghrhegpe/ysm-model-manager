// ===== 诊断页：性能面板 — 共享工具层 =====
// 三个命令模块（single-bench / gui-flow / perf-log）与 perf-trace 共用的渲染/守卫/错误辅助。
// 纯前端逻辑，零 Go 改动。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import type { executeCLI } from "@/services/cli-bridge.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import type { EscFn } from "./logs.ts";

// ===== 区段头（带可选复制按钮）=====

/** 结果区段头（可选复制按钮：data-perf-copy 供事件委托识别） */
export function sectionHeader(icon: string, label: string, rawText?: string): string {
  const copyBtn =
    rawText !== undefined
      ? `<button type="button" data-perf-copy class="btn-base perf-copy-btn" style="margin-left:auto;padding:2px 8px;font-size:var(--fs-xs);line-height:1.4" title="${t("perf.copyRaw")}">📋 ${t("perf.copy")}</button>`
      : "";
  const wrapper = rawText !== undefined ? ` data-perf-raw="${encodeURIComponent(rawText)}"` : "";
  return `<div class="perf-section" style="margin-top:10px;font-size:var(--fs-sm);font-weight:600;color:var(--txt);display:flex;align-items:center;gap:6px"${wrapper}>
<span>${icon}</span><span>${label}</span>${copyBtn}</div>`;
}

// ===== 复制按钮事件委托 =====

/** 统一复制：优先 navigator.clipboard，降级 textarea + execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 兜底到下方 textarea */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * 为三个结果容器注册复制按钮事件委托。
 * 归属按「容器元素」跟踪（WeakSet<Element>）而非模块级 boolean：
 * 面板重建（lang:changed → clearPanels 移除面板 DOM → 新容器元素）后 initPerfPanel
 * 再次调用，新容器不在集合内 → 重新绑定；同一容器重复调用 → 幂等跳过（不双绑）。
 * 原模块级 perfCopyBound 首次置 true 后永不重绑——面板重建后复制按钮永久失效直到重启。
 */
const perfCopyBoundEls = new WeakSet<Element>();
export function bindPerfCopyHandlers(root: ShadowRoot): void {
  for (const id of ["diag-perf-single", "diag-perf-gui-out", "diag-perf-hist"]) {
    const el = root.getElementById(id);
    if (!el || perfCopyBoundEls.has(el)) continue;
    perfCopyBoundEls.add(el);
    el.addEventListener("click", async (e) => {
      const target = e.target as HTMLElement | null;
      if (!target?.matches?.("[data-perf-copy]")) return;
      const section = target.closest<HTMLElement>("[data-perf-raw]");
      const raw = section?.dataset.perfRaw;
      if (raw === undefined) return;
      const text = decodeURIComponent(raw);
      const ok = await copyText(text);
      bus.emit("toast:show", {
        msg: ok ? `✅ ${t("diagnostics.perfCopied")}` : `❌ ${t("diagnostics.perfCopyFail")}`,
        duration: ok ? 2000 : 3000,
        ...(ok ? {} : { type: "error" as const }),
      });
    });
  }
}

// ===== CLI 命令共用守卫/错误渲染辅助 =====

type CLIResp = Awaited<ReturnType<typeof executeCLI>>;

interface GenGuard {
  gen: number;
  stale: () => boolean;
}

function makeGenGuard(seqRef: { current: number }): GenGuard {
  const gen = ++seqRef.current;
  return { gen, stale: () => gen !== seqRef.current };
}

function getOutBox(root: ShadowRoot, id: string): HTMLElement | null {
  return root.getElementById(id);
}

function setBusy(out: HTMLElement): void {
  out.innerHTML = `<div class="diag-stat diag-stat-muted">⏳ ${t("diagnostics.perfRunning")}</div>`;
}

function setErrorMsg(out: HTMLElement, msg: string, esc: EscFn): void {
  out.innerHTML = `<div class="diag-stat diag-stat-error">❌ ${esc(msg)}</div>`;
}

function setErrorResp(out: HTMLElement, resp: CLIResp, esc: EscFn): void {
  out.innerHTML = errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc);
}

function setErrorCatch(out: HTMLElement, e: unknown, esc: EscFn): void {
  logError("diagnostics", "perf-cli 失败", e);
  out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
}

function errorHTML(msg: string, esc: EscFn): string {
  return `<div class="diag-stat diag-stat-error">❌ ${esc(msg)}</div>`;
}

/** 类型谓词：仅当 output 是**非空字符串**时才为 true。
 *  不能只查 truthy——`output: 123` / `{}` 同样 truthy，却与谓词断言的 `string` 不符，
 *  消费方随后按 string 调 `.split()` 等即 TypeError（与 cli-bridge 的 `as` 断言同源病：
 *  类型谓词必须保证断言出来的类型真的成立）。 */
function respHasOutput(
  resp: CLIResp,
): resp is CLIResp & { status: "success"; data: { output: string } } {
  return (
    resp.status === "success" &&
    typeof resp.data?.output === "string" &&
    resp.data.output.length > 0
  );
}

// ===== 导出命令模块用的辅助 =====

export type { CLIResp };
export {
  getOutBox,
  makeGenGuard,
  respHasOutput,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
};
