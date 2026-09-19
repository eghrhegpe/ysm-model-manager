// ===== 诊断页：性能面板 — 共享工具层 =====
// 命令模块（single-bench / concurrent / scan-bench）与 perf-trace 共用的渲染/守卫/错误辅助。
// 纯前端逻辑，零 Go 改动。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import type { executeCLI } from "@/services/cli-bridge.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { copyWithToast } from "./copy-toast.ts";
import type { EscFn } from "./logs.ts";

// ===== 区段头（带可选复制按钮）=====

/** 结果区段头（可选复制按钮：data-perf-copy 供事件委托识别） */
export function sectionHeader(icon: string, label: string, rawText?: string): string {
  const copyBtn =
    rawText !== undefined
      ? `<button type="button" data-perf-copy class="btn-base perf-copy-btn" style="margin-left:auto;padding:2px 8px;font-size:var(--fs-xs);line-height:1.4" title="${t("perf.copyRaw")}">${UI_ICONS.clipboard} ${t("perf.copy")}</button>`
      : "";
  const wrapper = rawText !== undefined ? ` data-perf-raw="${encodeURIComponent(rawText)}"` : "";
  return `<div class="perf-section" style="margin-top:10px;font-size:var(--fs-sm);font-weight:600;color:var(--txt);display:flex;align-items:center;gap:6px"${wrapper}>
<span>${icon}</span><span>${label}</span>${copyBtn}</div>`;
}

// ===== 复制按钮事件委托 =====

/**
 * 为三个结果容器注册复制按钮事件委托。
 * 归属按「容器元素」跟踪（WeakSet<Element>）而非模块级 boolean：
 * 面板重建（lang:changed → clearPanels 移除面板 DOM → 新容器元素）后 initPerfPanel
 * 再次调用，新容器不在集合内 → 重新绑定；同一容器重复调用 → 幂等跳过（不双绑）。
 * 原模块级 perfCopyBound 首次置 true 后永不重绑——面板重建后复制按钮永久失效直到重启。
 */
const perfCopyBoundEls = new WeakSet<Element>();
export function bindPerfCopyHandlers(root: ShadowRoot): void {
  for (const id of ["diag-perf-single", "diag-perf-scan-bench-out"]) {
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
      // 回执（含失败分支）统一由 copyWithToast 负责，本处只声明成功文案
      await copyWithToast(text, "diagnostics.perfCopied");
    });
  }
}

// ===== CLI 命令共用守卫/错误渲染辅助 =====

type CLIResp = Awaited<ReturnType<typeof executeCLI>>;

function getOutBox(root: ShadowRoot, id: string): HTMLElement | null {
  return root.getElementById(id);
}

function setBusy(out: HTMLElement): void {
  out.innerHTML = `<div class="diag-stat diag-stat-muted">${UI_ICONS.refresh} ${t("diagnostics.perfRunning")}</div>`;
}

function setErrorMsg(out: HTMLElement, msg: string, esc: EscFn): void {
  // 与 errorHTML 曾是同一字面量的两份实现（诊断页重复实现审计 C3）：横幅只留一个出处，改样式只改一处
  out.innerHTML = errorHTML(msg, esc);
}

function setErrorResp(out: HTMLElement, resp: CLIResp, esc: EscFn): void {
  out.innerHTML = errorHTML(resp.error?.message ?? t("diagnostics.perfFail"), esc);
}

function setErrorCatch(out: HTMLElement, e: unknown, esc: EscFn): void {
  logError("diagnostics", "perf-cli 失败", e);
  out.innerHTML = errorHTML(`${t("diagnostics.perfFail")}: ${safeErrorMessage(e)}`, esc);
}

function errorHTML(msg: string, esc: EscFn): string {
  return `<div class="diag-stat diag-stat-error">${UI_ICONS.error} ${esc(msg)}</div>`;
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

/**
 * 载荷不可用时的统一失败渲染（诊断页重复实现审计 C4，2026-09-18）。
 *
 * 立因：同一段三元分支曾在 **5 个模块**各写一遍——`perf-single-bench`（原 `renderBenchFailure`）、
 * `perf-concurrent`、`perf-scan-bench`、`perf-gui-flow`（已随 gui-flow 面板下线）——唯一差异是空载荷文案键。
 * 判据收敛在这里，各模块只回答「我这块的空载荷该怎么说」：
 *   · `status === "success"` 却拿不到载荷 = **契约漂移**，比「执行失败」更值得暴露（要人去修契约）；
 *   · 其余（error / 部分失败）= 转述 Go 原话（`error.message`，没有则退回通用失败文案）。
 *
 * @param emptyKey 本模块的空载荷文案键——由调用点给，契约测试按源码子串锚定各文件自己的键
 */
function renderLoadFailure(out: HTMLElement, resp: CLIResp, esc: EscFn, emptyKey: LocaleKey): void {
  if (resp.status === "success") {
    setErrorMsg(out, t(emptyKey), esc);
    return;
  }
  setErrorResp(out, resp, esc);
}

// ===== 导出命令模块用的辅助 =====

export type { CLIResp };
// errorHTML 导出（2026-09-18）：基准对比判「退化」时 Go 返回 error 状态但载荷有效，
// 消费方需要「载荷 + 错误横幅」**同时**渲染（规律六：错误分支也要交出结构化数据），
// 而 setErrorResp 是整块替换 innerHTML 的，无法叠加——故把字符串版放出来组合。
export {
  errorHTML,
  getOutBox,
  renderLoadFailure,
  respHasOutput,
  setBusy,
  setErrorCatch,
  setErrorMsg,
  setErrorResp,
};
