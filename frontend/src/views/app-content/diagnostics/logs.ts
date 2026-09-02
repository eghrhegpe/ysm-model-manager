// ===== 诊断页：日志加载（操作日志 + 运行时日志） =====
// ADR-040 按职责切文件：原 init.ts（797 行）拆分——日志加载（本文件）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）
import { t, type LocaleKey } from "../../../core/i18n/t.ts";
import { getApp } from "../../../backend/app.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { stagger } from "../../../utils/animation/stagger.ts";

/** 转义函数签名（单一事实源 = utils/dom/html.ts 的 esc；调用方以 (s) => esc(String(s || "")) 包装适配） */
export type EscFn = (s: unknown) => string;

// P3 修复（子代理审计，代际守卫）：日志加载模块级序号——刷新/筛选/tab 切换可并发
// 触发 loadDiagnosticsLogs/loadRuntimeLogs，后端慢时旧响应后到会覆盖新响应（用户已
// 切筛选/搜索，列表却显示旧条件结果）；入口捕获 gen，await 后写 DOM 前比对丢弃陈旧
let diagLoadSeq = 0;

/** 绑定 ImportLog（仅用到的字段） */
interface ImportLogLike {
  Status?: string;
  Timestamp?: string | number;
  ModelName?: string;
  TargetDir?: string;
  SourcePath?: string;
  ErrorMsg?: string;
  Operation?: string;
  Level?: "" | "debug" | "info" | "warn" | "error" | "fatal";
}

/** 操作类型 → 中文标签 + 图标（分组标题与行内徽标共用） */
const OP_META: Record<string, { label: string; icon: string }> = {
  import: { label: t("diagnostics.opImport"), icon: "📥" },
  scan: { label: t("diagnostics.opScan"), icon: "🔍" },
  download: { label: t("diagnostics.opDownload"), icon: "⬇️" },
  sync: { label: t("diagnostics.opSync"), icon: "🔄" },
  rename: { label: t("diagnostics.opRename"), icon: "✏️" },
  delete: { label: t("diagnostics.opDelete"), icon: "🗑️" },
  ui: { label: t("diagnostics.opUI"), icon: "⚠️" },
};

/** 未知 op 回退到通用标签，避免显示裸英文 */
function opMeta(op: string | undefined): { label: string; icon: string } {
  if (op && OP_META[op]) return OP_META[op];
  return { label: op || t("diagnostics.opImportFallback"), icon: "🧾" };
}

function dgLsGetListAndGen(
  root: ShadowRoot,
  listId: string,
): { list: HTMLElement; gen: number; copyLogTitle: string } | null {
  const list = root.getElementById(listId);
  if (!list) return null;
  const gen = ++diagLoadSeq;
  const copyLogTitle = t("diagnostics.copyLog");
  return { list, gen, copyLogTitle };
}

function dgLsCheckStale(gen: number): boolean {
  return gen !== diagLoadSeq;
}

function dgLsSetEmpty(list: HTMLElement, key: LocaleKey, type: "muted" | "error" = "muted"): void {
  const cls = type === "error" ? "diag-stat-error" : "diag-stat-muted";
  list.innerHTML = `<div class="stat-row diag-stat ${cls}">${t(key)}</div>`;
}

function dgLsFormatTime(ts: string | number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function dgLsFilterDiagLogs(logs: ImportLogLike[], root: ShadowRoot): ImportLogLike[] {
  const activeBtn = root.querySelector(".diag-log-fbtn.active");
  const filter = activeBtn ? (activeBtn as HTMLElement).dataset.status : "all";
  const search =
    (root.getElementById("diag-log-search") as HTMLInputElement | null)?.value
      ?.trim()
      .toLowerCase() || "";
  return logs.slice(-500).reverse().filter((l) => {
    if (filter !== "all" && l.Status !== filter) return false;
    if (search && !(l.ModelName || "").toLowerCase().includes(search)) return false;
    return true;
  });
}

function dgLsGroupByOp(filtered: ImportLogLike[]): Map<string, ImportLogLike[]> {
  const groups = new Map<string, ImportLogLike[]>();
  for (const l of filtered) {
    const key = l.Operation || "import";
    const arr = groups.get(key);
    if (arr) arr.push(l);
    else groups.set(key, [l]);
  }
  return groups;
}

function dgLsMakeStatusLabel(l: ImportLogLike): string {
  if (l.Level) {
    return l.Level === "error"
      ? "❌"
      : l.Level === "warn"
        ? "⚠️"
        : l.Level === "debug"
          ? "🔍"
          : l.Level === "fatal"
            ? "💀"
            : "✅";
  }
  return l.Status === "success"
    ? "✅"
    : l.Status === "failed"
      ? "❌"
      : l.Status === "warn"
        ? "⚠️"
        : "⏭️";
}

function dgLsBuildDiagMsg(l: ImportLogLike, esc: EscFn): string {
  const dir = l.TargetDir || l.SourcePath ? "<br>📂 " + esc(l.TargetDir || l.SourcePath) : "";
  const raw = l.ErrorMsg || "";
  const cleanErr = esc(raw)
    .replace(/^[❌✅⚠️⏭️]\s*/, "")
    .replace(/\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g, "<br>$1：");
  const modelDisplay = renderDisplayName(l.ModelName || "");
  const modelPart = modelDisplay && modelDisplay !== cleanErr ? modelDisplay : "";
  if (!modelPart && !cleanErr) return dir || "";
  if (!modelPart) return dir || cleanErr ? dir + cleanErr : "";
  if (!cleanErr) return modelPart + dir;
  return modelPart + dir + "<br>" + cleanErr;
}

function dgLsRenderDiagGroups(
  groups: Map<string, ImportLogLike[]>,
  esc: EscFn,
  copyLogTitle: string,
): string {
  const parts: string[] = [];
  for (const [op, items] of groups) {
    const meta = opMeta(op);
    parts.push(
      `<div class="log-group" style="padding:4px 16px 2px;font-size:var(--fs-xs);color:var(--muted);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd);background:var(--surf)">
<span>${meta.icon} ${meta.label}</span><span style="margin-left:auto">${t("diagnostics.itemsCount", { n: items.length })}</span></div>`,
    );
    items.forEach((l, i) => {
      const statusLabel = dgLsMakeStatusLabel(l);
      const timeStr = dgLsFormatTime(l.Timestamp);
      const msg = dgLsBuildDiagMsg(l, esc);
      parts.push(
        `<div class="log-row" style="animation-delay:${stagger(i, 20, 400)}ms">
<span class="log-status ${l.Status || ""}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">📋</button>
</div>`,
      );
    });
  }
  return parts.join("");
}

/** 运行时日志条目（仅用到的字段） */
interface RuntimeLogLike {
  Message?: string;
  Timestamp?: string | number;
}

function dgLsRenderRuntimeRows(
  logs: RuntimeLogLike[],
  esc: EscFn,
  copyLogTitle: string,
): string {
  return logs
    .slice(-300)
    .reverse()
    .map((l, i) => {
      const timeStr = dgLsFormatTime(l.Timestamp);
      return `<div class="log-row" style="animation-delay:${stagger(i, 20, 400)}ms">
<span class="log-status">🕹️</span>
<span class="log-msg" style="white-space:pre-wrap">${esc(l.Message || "")}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">📋</button>
</div>`;
    })
    .join("");
}

export async function loadDiagnosticsLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const ctx = dgLsGetListAndGen(root, "diag-log-list");
  if (!ctx) return;
  const { list, gen, copyLogTitle } = ctx;
  try {
    const { GetImportLogs } = await getApp();
    const logs: ImportLogLike[] = (await GetImportLogs()) || [];
    if (dgLsCheckStale(gen)) return;
    if (!logs.length) return dgLsSetEmpty(list, "diagnostics.noLogs");
    const filtered = dgLsFilterDiagLogs(logs, root);
    if (!filtered.length) return dgLsSetEmpty(list, "diagnostics.noMatchLogs");
    const groups = dgLsGroupByOp(filtered);
    list.innerHTML = dgLsRenderDiagGroups(groups, esc, copyLogTitle);
  } catch (e) {
    console.error("[diagnostics] 加载操作日志失败:", e);
    dgLsSetEmpty(list, "diagnostics.loadLogsFailed", "error");
  }
}

/** 加载运行时日志（watcher/sync 等标准库 log 输出） */
export async function loadRuntimeLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const ctx = dgLsGetListAndGen(root, "diag-runtime-list");
  if (!ctx) return;
  const { list, gen, copyLogTitle } = ctx;
  try {
    const { GetRuntimeLogs } = await getApp();
    const logs: RuntimeLogLike[] = (await GetRuntimeLogs()) || [];
    if (dgLsCheckStale(gen)) return;
    if (!logs.length) return dgLsSetEmpty(list, "diagnostics.noRuntimeLogs");
    list.innerHTML = dgLsRenderRuntimeRows(logs, esc, copyLogTitle);
  } catch (e) {
    console.error("[diagnostics] 加载运行时日志失败:", e);
    dgLsSetEmpty(list, "diagnostics.loadRuntimeLogsFailed", "error");
  }
}
