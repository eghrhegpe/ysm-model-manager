// ===== 诊断页：性能面板 — perf-log（优化历史卡片）=====
// 数据来源：Go CLI perf-log 命令文本输出，正则解析日期/区域/提交，卡片渲染。

import { t } from "@/core/i18n/t.ts";
import { executeCLI } from "@/services/cli-bridge.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import type { EscFn } from "./logs.ts";
import {
  getOutBox,
  renderLoadFailure,
  respHasOutput,
  sectionHeader,
  setBusy,
  setErrorCatch,
} from "./perf-common.ts";

// 代际守卫（ADR-230）
const perfHistGuard = createLoadGuard();

interface PerfLogEntry {
  date: string;
  area: string;
  commit: string;
  body: string[];
}

function perfLogParseEntries(output: string): PerfLogEntry[] | null {
  const lines = output.split("\n");
  const headRe = /^─\s*(.+?)\s*─\s*(.+?)\s*─\s*(.+?)\s*$/;
  const entries: PerfLogEntry[] = [];
  let cur: PerfLogEntry | null = null;
  for (const raw of lines) {
    const line = raw;
    const hm = line.match(headRe);
    if (hm) {
      cur = { date: hm[1].trim(), area: hm[2].trim(), commit: hm[3].trim(), body: [] };
      entries.push(cur);
      continue;
    }
    if (
      cur &&
      (line.startsWith("  问题:") || line.startsWith("  做法:") || line.startsWith("  效果:")) &&
      line.trim()
    ) {
      cur.body.push(line.trim());
    }
  }
  return entries.length ? entries : null;
}

function perfLogRenderCards(entries: PerfLogEntry[], rawOutput: string, esc: EscFn): string {
  const cards = entries
    .map((e, i) => {
      const body = e.body.length
        ? `<span class="perf-hist-body">${e.body.map((d) => esc(d)).join("<br>")}</span>`
        : "";
      return `<div class="perf-hist-card" style="animation-delay:${stagger(i)}ms">
<span class="perf-hist-head">${UI_ICONS.calendar} ${esc(e.date)} · ${esc(e.area)} · <code>${esc(e.commit)}</code></span>${body}
</div>`;
    })
    .join("");
  return (
    sectionHeader(UI_ICONS.note, t("diagnostics.perfHistResult"), rawOutput) +
    `<div class="perf-hist" style="padding:8px 2px;user-select:text;-webkit-user-select:text">${cards}</div>`
  );
}

export async function runPerfLog(root: ShadowRoot, esc: EscFn): Promise<void> {
  const gen = perfHistGuard.next();
  const out = getOutBox(root, "diag-perf-hist");
  if (!out) return;
  setBusy(out);
  try {
    const resp = await executeCLI("perf-log", {});
    if (perfHistGuard.stale(gen)) return;
    if (!respHasOutput(resp)) {
      renderLoadFailure(out, resp, esc, "diagnostics.perfFail");
      return;
    }
    const parsed = perfLogParseEntries(resp.data.output);
    if (!parsed) {
      // 解析不出条目也算载荷不可用：status=error 时改为转述 Go 原话（原先一律通用文案，
      // 会吞掉 Go 已给出的原因）——本单点带来的唯一行为变化，属改善
      renderLoadFailure(out, resp, esc, "diagnostics.perfFail");
      return;
    }
    out.innerHTML = perfLogRenderCards(parsed, resp.data.output, esc);
  } catch (e) {
    if (perfHistGuard.stale(gen)) return;
    setErrorCatch(out, e, esc);
  }
}
