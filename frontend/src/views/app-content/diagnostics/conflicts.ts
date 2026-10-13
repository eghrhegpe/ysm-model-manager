// ===== 诊断页：同步冲突检测与解决（sync-conflict tab） =====
// 「冲突检测」（跨实例同名内容漂移）tab 已于 2026-09 下线（用户视角与同步冲突重叠、
// 只读无后续动作、扫描成本全页最重），本文件只剩同步冲突一条链。

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import type { EscFn } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPE_LABELS } from "@/utils/resource/types.ts";
import type { FileConflict } from "@/utils/types-re-export.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { optionRows } from "./option-rows.ts";
import { msgRowHTML } from "./status-row.ts";

// 同步冲突扫描并发标志（纯并发守卫，无跨调用配置状态——【范式豁免】同 dedup 会话工厂
// 改造 ROI 低，不立项；try/finally 兜底复位）
let diagSyncBusy = false;

/** resolve 成功后自动复扫延迟：给用户留读「已解决 N」结果消息的窗口 */
const RESOLVE_RESCAN_MS = 1500;
/** list → 在途复扫 timer（WeakMap 合并——结果行为 append 不移除按钮，连点 resolve
 *  若各排一次复扫会叠重复 RPC + 双写列表；合并后只保留最后一次，键随 list GC 自清） */
const pendingRescans = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

// ===== 同步冲突绑定类型（已 struct 化，ADR-143 P0） =====
// DetectConflicts / ResolveConflicts 现返回 typed struct，失败走 error 通道（Promise reject）

// 兼容旧 interface，实际使用 binding 生成的类型
type DgCfFileConflict = FileConflict;

function dgCfRenderRadarPlaceholder(list: HTMLElement): void {
  // 2026-10-13 拆旁路：文案行原手写 `<div class="stat-row diag-msg …" style="text-align:center">`
  // ——text-align 对 flex 行定位本就无效（知识卡判词「靠巧合」），随外壳单点一并退场；
  // 雷达动画容器是结果区专属结构，非状态行，保留手写。
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div>' +
    msgRowHTML("muted", t("diagnostics.scanningConflicts"));
}

// ===== 常驻参数栏 + 扫描流程（ADR-288 D2/D3）=====

/** 一次扫描的目标：栏内选中值 + 结果区/按钮引用（「解决后自动复扫」按原目标重跑）。 */
export interface DgCfScanTarget {
  rtype: string;
  instance: string;
  scanBtn: HTMLButtonElement | null;
}

/** 扫描按钮可用性单点：扫描进行中与「目标不可用」两态共用。
 *  禁用是给用户的**可见**反馈——旧实现只靠 busy 守卫静默吞掉重复点击，界面毫无变化。 */
function dgCfSetScanEnabled(btn: HTMLButtonElement | null, enabled: boolean): void {
  if (btn) btn.disabled = !enabled;
}

async function dgCfLoadSyncContext(): Promise<{
  availableInstances: string[];
  errorHtml: string | null;
}> {
  const { ListVersionInstances, LoadAppConfig } = await backendGetApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    return {
      availableInstances: [],
      errorHtml: msgRowHTML("error", t("diagnostics.configGameDir")),
    };
  }
  const instances = (await ListVersionInstances(mcRoot)) || [];
  return {
    availableInstances: instances.filter((ins) => ins.Exists).map((ins) => ins.Name),
    errorHtml: null,
  };
}

/**
 * 初始化常驻参数栏（**页面挂载时一次**，ADR-288 D3）：
 * 资源类型下拉（`RESOURCE_TYPE_LABELS` 声明序，与旧参数面板逐字一致）→ 异步填充可用实例。
 *
 * 不可用态（无游戏目录 / 无可用实例 / 上下文读取失败）→ 原因落**结果区** + 禁用扫描按钮
 * （ADR-288 D4：点不了好过点了报错）。
 *
 * ⚠️ 旧实现是「点外层按钮才渲染参数面板」的两段式：首次点击零信息增量，且面板连同按钮
 * 住在结果容器内 → 头一次扫描的 `innerHTML` 整块替换把入口一起抹掉（ADR-288 §1）。
 */
export async function initSyncConflictPanel(
  bar: HTMLElement | null,
  list: HTMLElement | null,
  esc: EscFn,
): Promise<void> {
  const rtypeSel = bar?.querySelector<HTMLSelectElement>("#sync-rtype");
  const insSel = bar?.querySelector<HTMLSelectElement>("#sync-instance");
  const scanBtn = bar?.querySelector<HTMLButtonElement>("#diag-scan-sync-conflict") ?? null;
  if (!list || !rtypeSel || !insSel || !scanBtn) return;

  rtypeSel.innerHTML = optionRows(
    // RESOURCE_TYPE_LABELS 已在模块构建期过滤掉无 name 的类型（见 utils/resource/types.ts:35-38），
    // 故这里不会产出空标签选项；顺序 = JSON 声明序，逐字保持旧面板口径
    Object.entries(RESOURCE_TYPE_LABELS).map(([id, label]) => ({ value: id, label })),
    esc,
  );

  const state = { rtype: rtypeSel.value, instance: "" };
  rtypeSel.addEventListener("change", () => {
    state.rtype = rtypeSel.value;
  });
  insSel.addEventListener("change", () => {
    state.instance = insSel.value;
  });
  scanBtn.addEventListener("click", () => {
    // 每次点击现读栏内选中值：栏常驻，用户可换实例后直接复扫（无需离开页面）
    void runSyncConflictScan(list, esc, { ...state, scanBtn });
  });

  try {
    const { availableInstances, errorHtml } = await dgCfLoadSyncContext();
    if (errorHtml) {
      list.innerHTML = errorHtml;
      dgCfSetScanEnabled(scanBtn, false);
      return;
    }
    if (!availableInstances.length) {
      list.innerHTML = msgRowHTML("error", t("diagnostics.noInstances"), undefined, {
        icon: UI_ICONS.warning,
      });
      dgCfSetScanEnabled(scanBtn, false);
      return;
    }
    insSel.innerHTML = optionRows(
      availableInstances.map((n) => ({ value: n, label: n })),
      esc,
    );
    state.instance = insSel.value; // 默认选中首个可用实例（无 selected 声明时浏览器取首项）
  } catch (err) {
    // 低优先③：统一走 friendlyError（AppError Code→i18n；Go 中文 Reason 透传剥内部路径；
    // 英文才加「扫描失败: 」前缀）——原 `${t(...)}: ${esc(String(err))}` 把 Go 中文错误
    // 硬挂在英文前缀后，双语混排。esc 交 msgRowHTML 单点转义（勿二次 esc）。
    list.innerHTML = msgRowHTML("error", friendlyError(err, t("diagnostics.scanFailed")), esc);
    dgCfSetScanEnabled(scanBtn, false);
  }
}

/**
 * 跑一次同步冲突检测（栏内按钮与「解决后自动复扫」共用）：**只写结果区**，
 * 栏与按钮不受影响——这是 ADR-288 D2 的核心约束，结果整块替换不得再吃掉入口。
 */
export async function runSyncConflictScan(
  list: HTMLElement,
  esc: EscFn,
  target: DgCfScanTarget,
): Promise<void> {
  if (diagSyncBusy) return;
  diagSyncBusy = true;
  dgCfSetScanEnabled(target.scanBtn, false);
  try {
    await dgCfRunSyncDetection(list, esc, target);
  } catch (err) {
    // 低优先③：同上——friendlyError 单源，不再手拼「译文前缀 + 裸 Go 文案」
    list.innerHTML = msgRowHTML("error", friendlyError(err, t("diagnostics.scanFailed")), esc);
  } finally {
    diagSyncBusy = false;
    dgCfSetScanEnabled(target.scanBtn, true);
  }
}

async function dgCfRunSyncDetection(
  list: HTMLElement,
  esc: EscFn,
  target: DgCfScanTarget,
): Promise<void> {
  const { DetectConflicts } = await backendGetApp();
  dgCfRenderRadarPlaceholder(list);
  const result = await DetectConflicts(target.rtype, target.instance);
  if (!result) {
    list.innerHTML = msgRowHTML("error", t("diagnostics.conflictDetectionFailed"), undefined, {
      icon: UI_ICONS.error,
    });
    return;
  }
  const conflicts = result.conflicts || [];
  if (conflicts.length === 0) {
    list.innerHTML = msgRowHTML("success", t("diagnostics.noSyncConflict"), undefined, {
      icon: UI_ICONS.success,
    });
    return;
  }
  renderSyncConflictsResult(list, esc, conflicts, target);
}

// ===== renderSyncConflictsResult 子函数 =====

/**
 * 解决策略单一事实源：token → 文案 key 一一对应，
 * 冲突行标签 / 下拉 option / 默认值三方都从这里取（诊断页审计 C10）。
 */
const RESOLVE_STRATEGIES = [
  { value: "force_remote", labelKey: "diagnostics.resolveForceRemote" satisfies LocaleKey },
  { value: "force_local", labelKey: "diagnostics.resolveForceLocal" satisfies LocaleKey },
  { value: "manual", labelKey: "diagnostics.resolveManual" satisfies LocaleKey },
] as const;

const DEFAULT_RESOLVE_STRATEGY = RESOLVE_STRATEGIES[0];

/** 未知 token 兜底到 manual 文案（与旧 `strategyLabels[x] ?? manual` 同口径）。 */
function resolveStrategyLabel(value: string | undefined): string {
  return t(
    RESOLVE_STRATEGIES.find((s) => s.value === value)?.labelKey ?? "diagnostics.resolveManual",
  );
}

function dgCfBuildSyncConflictRows(conflicts: DgCfFileConflict[], esc: EscFn): string {
  let html = "";
  conflicts.forEach((c, i) => {
    const conflictTypeLabel =
      c.type === "content_modified"
        ? t("diagnostics.conflictTypeContent")
        : t("diagnostics.conflictTypeBoth");
    const suggestedLabel = resolveStrategyLabel(c.suggestedStrategy);
    const delay = stagger(i, 30, 600);
    html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${esc(c.path)}</span>
<span class="conflict-ver">${conflictTypeLabel}</span>
</div>`;
    html += `<div class="conflict-ins" style="animation-delay:${delay + 15}ms">
&nbsp;&nbsp;${UI_ICONS.package} ${esc(String(c.localSize))} ↔ ${esc(String(c.remoteSize))} | ${UI_ICONS.hint} ${suggestedLabel}
</div>`;
  });
  return html;
}

function dgCfBuildResolveSectionHtml(): string {
  return `<div class="diag-sync-resolve" style="margin-top:16px;padding:var(--sp-3);background:var(--surf);border-radius:var(--radius-lg)">
<div class="diag-config-item">
  <label for="resolve-strategy">${UI_ICONS.target} ${t("diagnostics.resolveConflicts")}:</label>
  <select id="resolve-strategy" class="diag-config-select">
    ${RESOLVE_STRATEGIES.map((s) => `<option value="${s.value}">${t(s.labelKey)}</option>`).join("")}
  </select>
</div>
<button id="do-resolve-btn" class="diag-dedup-exec" style="margin-top:8px">${UI_ICONS.success} ${t("diagnostics.resolveConflicts")}</button>
</div>`;
}

async function dgCfExecuteResolve(
  list: HTMLElement,
  esc: EscFn,
  conflicts: DgCfFileConflict[],
  target: DgCfScanTarget,
): Promise<void> {
  const strategyEl = list.querySelector("#resolve-strategy") as HTMLSelectElement;
  const strategy = strategyEl?.value || DEFAULT_RESOLVE_STRATEGY.value;
  try {
    const { ResolveConflicts } = await backendGetApp();
    // 低优先①：冲突列表以 typed struct 数组直传（Go 签名 []ysmsync.FileConflict），
    // 原 JSON.stringify→Unmarshal 文本协议退役——字段漂移现在编译期即报错。
    const result = await ResolveConflicts(conflicts, strategy, target.rtype, target.instance);
    if (!result) {
      list.innerHTML = msgRowHTML("error", t("diagnostics.resolveFailed"), undefined, {
        icon: UI_ICONS.error,
      });
      return;
    }
    // 内容仅 t() 文案 + 后端数字（可信），图标走 UI_ICONS SVG（ADR-238）——外壳单点
    // msgRowHTML 产行（2026-10-13 拆旁路：原 createElement + 手写 className + 行内
    // marginTop 绕过外壳，间距由 CSS 相邻规则承接）。resultMsg 串首已含 success 图标
    // 与计数分隔（可信直插，不传 esc），append 语义保留：结果区已有冲突列表与解决
    // 面板，本行是追加的执行回执（非整替）。
    let resultMsg = `${UI_ICONS.success} ${t("diagnostics.resolvedCount", { n: result.resolved || 0 })}`;
    if (result.failed > 0)
      resultMsg += ` | ${UI_ICONS.error} ${t("diagnostics.failedCount", { n: result.failed })}`;
    if (result.manual > 0)
      resultMsg += ` | ${UI_ICONS.warning} ${t("diagnostics.manualCount", { n: result.manual })}`;
    list.insertAdjacentHTML("beforeend", msgRowHTML("success", resultMsg));
    // 稍后自动复扫（resolve 后刷新冲突态）。守卫：用户已离开诊断页（list 分离）
    // 则作废这次迟到的复扫——省一次后端 RPC，也避免向分离 DOM 写 innerHTML。
    // 复扫按**原目标**重跑（把当次扫描的 target 原样带回来），栏内新选中值不参与本次复扫。
    const prevRescan = pendingRescans.get(list);
    if (prevRescan) clearTimeout(prevRescan);
    pendingRescans.set(
      list,
      setTimeout(() => {
        pendingRescans.delete(list);
        if (!list.isConnected) return;
        // busy 竞态正名（子代理复核 P3）：若窗口内用户手动点扫描占住 diagSyncBusy，
        // 本次迟到复扫被守卫丢弃且不再补排——**良性**：手动那次已完成列表刷新，
        // 「resolve 后必刷新」的语义由它兑现，不产生信息丢失。
        void runSyncConflictScan(list, esc, target);
      }, RESOLVE_RESCAN_MS),
    );
  } catch (err) {
    // 2026-10-13 拆旁路：原 createElement + 手写 className + 行内 marginTop。外壳单点
    // 双通道正好覆盖本形态：msg 传 esc（防注入单点），icon 走 opts（可信 SVG 不转义）。
    // 低优先③口径不变：friendlyError 单源（Code→i18n/中文透传）。
    list.insertAdjacentHTML(
      "beforeend",
      msgRowHTML("error", friendlyError(err, t("diagnostics.resolveFailed")), esc, {
        icon: UI_ICONS.error,
      }),
    );
  }
}

function renderSyncConflictsResult(
  list: HTMLElement,
  esc: EscFn,
  conflicts: DgCfFileConflict[],
  target: DgCfScanTarget,
): void {
  const header = msgRowHTML(
    "error",
    t("diagnostics.syncConflictFound", { n: conflicts.length }),
    undefined,
    { icon: UI_ICONS.warning },
  );
  const rowsHtml = dgCfBuildSyncConflictRows(conflicts, esc);
  const resolveHtml = dgCfBuildResolveSectionHtml();
  const html = header + rowsHtml + resolveHtml;
  list.innerHTML = html;
  list.querySelector("#do-resolve-btn")?.addEventListener("click", async () => {
    await dgCfExecuteResolve(list, esc, conflicts, target);
  });
}
