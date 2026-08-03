// ===== preview 渲染层 =====
import type { PreviewStats } from "./utils.ts";

/** 更新所有统计 DOM */
export function updateDisplay(root: ShadowRoot, stats: PreviewStats): void {
  const $ = (id: string): HTMLElement | null => root.getElementById(id);
  if ($("s-repo")) $("s-repo")!.textContent = String(stats.repo);
  if ($("s-ver")) $("s-ver")!.textContent = String(stats.ver);
  if ($("s-ok")) $("s-ok")!.textContent = String(stats.ok);
  if ($("s-tot")) $("s-tot")!.textContent = String(stats.tot);
  if ($("s-pending")) $("s-pending")!.textContent = String(stats.pending);
}
