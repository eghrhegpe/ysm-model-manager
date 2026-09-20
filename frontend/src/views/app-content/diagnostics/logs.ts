// ===== 诊断页：日志加载（操作日志 + 运行时日志） =====
// ADR-040 按职责切文件：原 init.ts（797 行）拆分——日志加载（本文件）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { createLoadGuard } from "@/utils/async/load-guard.ts";
import { logError } from "@/utils/base/primitives/log.ts";
import { formatClock } from "@/utils/format/format.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { statRowHTML } from "./status-row.ts";

/** 转义函数签名（单一事实源 = utils/html/html.ts 的 esc；调用方以 (s) => esc(String(s || "")) 包装适配） */
export type EscFn = (s: unknown) => string;

// P3 修复（子代理审计，代际守卫；ADR-230 收口为全仓唯一守卫出口）：日志加载模块级守卫——
// 刷新/筛选/tab 切换可并发触发 loadDiagnosticsLogs/loadRuntimeLogs，后端慢时旧响应后到会
// 覆盖新响应（用户已切筛选/搜索，列表却显示旧条件结果）；入口捕获 gen，await 后写 DOM
// 前比对丢弃陈旧
const diagLoadGuard = createLoadGuard();

// ===== 展示窗口容量（单一事实源在 Go，此处为镜像）=====
// 两个窗口是「前端展示层收窄」，与 Go 侧环形缓冲上限对应但**独立**：
//   操作日志 Go 上限 500（go/logs/logs.go|logMaxEntries，AppConfig.LogMaxEntries 可配置）
//   运行时日志 Go 上限 200（go/logs/runtime.go|DefaultRuntimeCap，固定）
// ⚠️ 改 Go 容量时须同步此处（不崩，仅影响「窗口内检索」范围与无命中占位准确性）。
// 运行时后端恒 ≤200，DIAG_RUNTIME_WINDOW=300 是防御性冗余（搜索口径留余量）。
const DIAG_OP_WINDOW = 500;
const DIAG_RUNTIME_WINDOW = 300;

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

/** 操作类型 → 中文标签 + 图标（分组标题与行内徽标共用；图标走 UI_ICONS SVG，ADR-238） */
const OP_META: Record<string, { label: string; icon: string }> = {
  import: { label: t("diagnostics.opImport"), icon: UI_ICONS.import },
  scan: { label: t("diagnostics.opScan"), icon: UI_ICONS.search },
  download: { label: t("diagnostics.opDownload"), icon: UI_ICONS.download },
  sync: { label: t("diagnostics.opSync"), icon: UI_ICONS.refresh },
  rename: { label: t("diagnostics.opRename"), icon: UI_ICONS.edit },
  delete: { label: t("diagnostics.opDelete"), icon: UI_ICONS.delete },
  ui: { label: t("diagnostics.opUI"), icon: UI_ICONS.warning },
};

/** 未知 op 回退到通用标签，避免显示裸英文 */
function opMeta(op: string | undefined): { label: string; icon: string } {
  if (op && OP_META[op]) return OP_META[op];
  return { label: op || t("diagnostics.opImportFallback"), icon: UI_ICONS.note };
}

function dgLsGetListAndGen(
  root: ShadowRoot,
  listId: string,
): { list: HTMLElement; gen: number; copyLogTitle: string } | null {
  const list = root.getElementById(listId);
  if (!list) return null;
  const gen = diagLoadGuard.next();
  const copyLogTitle = t("diagnostics.copyLog");
  return { list, gen, copyLogTitle };
}

function dgLsCheckStale(gen: number): boolean {
  return diagLoadGuard.stale(gen);
}

function dgLsSetEmpty(list: HTMLElement, key: LocaleKey, type: "muted" | "error" = "muted"): void {
  list.innerHTML = statRowHTML(type === "error" ? "error" : "muted", t(key));
}

/** 读取搜索框当前值（小写去空白）——操作日志与运行时日志共用同一个输入框 */
function dgLsReadSearch(root: ShadowRoot): string {
  return (
    (root.getElementById("diag-log-search") as HTMLInputElement | null)?.value
      ?.trim()
      .toLowerCase() || ""
  );
}

/** 读取操作类型下拉当前值（缺省 / 空 / "all" → 全部） */
function dgLsReadOpFilter(root: ShadowRoot): string {
  const sel = root.getElementById("diag-log-op-filter") as HTMLSelectElement | null;
  return sel?.value || "all";
}

/**
 * 操作日志搜索命中域：模型名 / 报错内容 / 目标路径 / 源路径 / 操作类型。
 * 2026-09-17 收口：此前只匹配 ModelName，placeholder 写着「搜索模型名」——用户搜报错文本必然空手。
 * 2026-09-18 扩展：Operation 同时匹配原始 key 与本地化标签（opMeta 同源），
 * 搜「导入」/「import」都能命中——搜索框与分组标题共用 OP_META，标签即用户所见。
 */
function dgLsMatchDiagSearch(l: ImportLogLike, search: string): boolean {
  if (!search) return true;
  const op = l.Operation || "import";
  return [l.ModelName, l.ErrorMsg, l.TargetDir, l.SourcePath, op, opMeta(op).label]
    .map((v) => String(v ?? ""))
    .join("\n")
    .toLowerCase()
    .includes(search);
}

function dgLsFilterDiagLogs(logs: ImportLogLike[], root: ShadowRoot): ImportLogLike[] {
  const activeBtn = root.querySelector(".diag-log-fbtn.active");
  const filter = activeBtn ? (activeBtn as HTMLElement).dataset.status : "all";
  const opFilter = dgLsReadOpFilter(root);
  const search = dgLsReadSearch(root);
  return logs
    .slice(-DIAG_OP_WINDOW)
    .reverse()
    .filter((l) => {
      // 横向（状态）× 纵向（操作类型）× 搜索，三者 AND 交集——互斥维度，叠加不冲突
      if (filter !== "all" && l.Status !== filter) return false;
      if (opFilter !== "all" && (l.Operation || "import") !== opFilter) return false;
      return dgLsMatchDiagSearch(l, search);
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

// 状态 emoji → SVG 收债完成（ADR-238 专项，2026-09-18）：
//   本函数此前产出 6 枚 emoji（✅❌⚠️🔍💀⏭️）当状态图标；因源码只写 `${statusLabel}`
//   模板插值，`check-design-tokens` 的 findEmojiIconViolations（只认「HTML 图标位 + 字面量」
//   的 emoji-icon 判定）结构性量不到——与 toast `msg` 载荷 emoji 同属盲区债。
//   现已全转 UI_ICONS 语义 SVG；💀/⏭️ 对应的 fatal/skip 图标已补进 ui-icons.ts，
//   icon-map 误把 ⏭️ 记成 performance 的串味映射也已纠正为 skip。
function dgLsMakeStatusLabel(l: ImportLogLike): string {
  if (l.Level) {
    return l.Level === "error"
      ? UI_ICONS.error
      : l.Level === "warn"
        ? UI_ICONS.warning
        : l.Level === "debug"
          ? UI_ICONS.search
          : l.Level === "fatal"
            ? UI_ICONS.fatal
            : UI_ICONS.success;
  }
  return l.Status === "success"
    ? UI_ICONS.success
    : l.Status === "failed"
      ? UI_ICONS.error
      : l.Status === "warn"
        ? UI_ICONS.warning
        : UI_ICONS.skip;
}

function dgLsBuildDiagMsg(l: ImportLogLike, esc: EscFn): string {
  const dir =
    l.TargetDir || l.SourcePath
      ? `<br>${UI_ICONS.folderOpen} ${esc(l.TargetDir || l.SourcePath)}`
      : "";
  const raw = l.ErrorMsg || "";
  const cleanErr = esc(raw)
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: 匹配日志状态 emoji 前缀，变音选择符为边角
    .replace(/^[❌✅⚠️⏭️]\s*/, "")
    .replace(/\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g, "<br>$1：");
  const modelDisplay = renderDisplayName(l.ModelName || "");
  const modelPart = modelDisplay && modelDisplay !== cleanErr ? modelDisplay : "";
  if (!modelPart && !cleanErr) return dir || "";
  if (!modelPart) return dir || cleanErr ? dir + cleanErr : "";
  if (!cleanErr) return modelPart + dir;
  return `${modelPart + dir}<br>${cleanErr}`;
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
      const timeStr = formatClock(l.Timestamp);
      const msg = dgLsBuildDiagMsg(l, esc);
      parts.push(
        `<div class="log-row" style="animation-delay:${stagger(i, 20, 400)}ms">
<span class="log-status ${l.Level || l.Status || ""}">${statusLabel}</span>
<span class="log-msg">${msg}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">${UI_ICONS.clipboard}</button>
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

/**
 * 运行时日志按搜索词过滤（只匹配 Message——运行时日志无 Status/路径概念）。
 * 与操作日志同口径：在「最新 DIAG_RUNTIME_WINDOW 条」窗口内检索（超窗口的历史条目不召回，避免大缓冲全量扫描）。
 */
function dgLsFilterRuntimeLogs(logs: RuntimeLogLike[], root: ShadowRoot): RuntimeLogLike[] {
  const search = dgLsReadSearch(root);
  return logs
    .slice(-DIAG_RUNTIME_WINDOW)
    .reverse()
    .filter(
      (l) =>
        !search ||
        String(l.Message ?? "")
          .toLowerCase()
          .includes(search),
    );
}

function dgLsRenderRuntimeRows(logs: RuntimeLogLike[], esc: EscFn, copyLogTitle: string): string {
  return logs
    .map((l, i) => {
      const timeStr = formatClock(l.Timestamp);
      return `<div class="log-row" style="animation-delay:${stagger(i, 20, 400)}ms">
<span class="log-status">${UI_ICONS.joystick}</span>
<span class="log-msg" style="white-space:pre-wrap">${esc(l.Message || "")}</span>
<span class="log-time">${timeStr}</span>
<button class="log-copy" title="${copyLogTitle}">${UI_ICONS.clipboard}</button>
</div>`;
    })
    .join("");
}

export async function loadDiagnosticsLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const ctx = dgLsGetListAndGen(root, "diag-log-list");
  if (!ctx) return;
  const { list, gen, copyLogTitle } = ctx;
  try {
    const { GetImportLogs } = await backendGetApp();
    const logs: ImportLogLike[] = (await GetImportLogs()) || [];
    if (dgLsCheckStale(gen)) return;
    if (!logs.length) return dgLsSetEmpty(list, "diagnostics.noLogs");
    const filtered = dgLsFilterDiagLogs(logs, root);
    if (!filtered.length) return dgLsSetEmpty(list, "diagnostics.noMatchLogs");
    const groups = dgLsGroupByOp(filtered);
    list.innerHTML = dgLsRenderDiagGroups(groups, esc, copyLogTitle);
  } catch (e) {
    logError("diagnostics", "加载操作日志失败", e);
    dgLsSetEmpty(list, "diagnostics.loadLogsFailed", "error");
  }
}

/** 加载运行时日志（watcher/sync 等标准库 log 输出） */
export async function loadRuntimeLogs(root: ShadowRoot, esc: EscFn): Promise<void> {
  const ctx = dgLsGetListAndGen(root, "diag-runtime-list");
  if (!ctx) return;
  const { list, gen, copyLogTitle } = ctx;
  try {
    const { GetRuntimeLogs } = await backendGetApp();
    const logs: RuntimeLogLike[] = (await GetRuntimeLogs()) || [];
    if (dgLsCheckStale(gen)) return;
    if (!logs.length) return dgLsSetEmpty(list, "diagnostics.noRuntimeLogs");
    const filtered = dgLsFilterRuntimeLogs(logs, root);
    if (!filtered.length) return dgLsSetEmpty(list, "diagnostics.noMatchLogs");
    list.innerHTML = dgLsRenderRuntimeRows(filtered, esc, copyLogTitle);
  } catch (e) {
    logError("diagnostics", "加载运行时日志失败", e);
    dgLsSetEmpty(list, "diagnostics.loadRuntimeLogsFailed", "error");
  }
}
