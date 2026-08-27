// ===== 诊断页：冲突扫描（scanConflicts） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（本文件）
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "../../../utils/resource/types.ts";
import { resolveWebMode } from "../../../backend/platform.ts";
import { stagger } from "../../../utils/animation/stagger.ts";
import type { EscFn } from "./logs.ts";
import type { AppConfig, VersionInstance } from "../../../utils/types-re-export.ts";

// P3 修复（子代理审计，重入守卫）：scanConflicts 并发标志——快速 3 连点会并发扫描
// 同一 list 互相覆盖（结果写 innerHTML 竞争）；busy 命中直接返回
let diagScanning = false;

// 同步冲突扫描并发标志
let diagSyncBusy = false;

interface DgCfInstanceFile {
  name: string;
}

// ===== 同步冲突绑定 JSON 契约类型 =====
// DetectConflicts / ResolveConflicts 是字符串绑定（Go 侧 json.Marshal 后返回），
// 解析后形状对齐 Go go/sync/conflict.go FileConflict / ConflictReport 与
// internal/app/error_json.go ErrorJSON（error 字段附加）。
interface DgCfFileConflict {
  path: string;
  type: "content_modified" | "size_mismatch";
  localModTime: string;
  remoteModTime: string;
  localSize: number;
  remoteSize: number;
  localHash?: string;
  remoteHash?: string;
  suggestedStrategy: "force_remote" | "force_local" | "manual";
}

interface DgCfSyncDetectionResult {
  conflicts: DgCfFileConflict[];
  totalConflicts: number;
  error?: string;
}

interface DgCfResolveResult {
  resolved: number;
  failed: number;
  manual: number;
  error?: string;
}

// ===== scanConflicts 子函数 =====

function dgCfWebGate(): boolean {
  if (resolveWebMode()) {
    bus.emit("toast:show", {
      msg: "网页版不支持冲突扫描",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return true;
  }
  return false;
}

function dgCfSetScanBtnState(scanBtn: HTMLElement | null, scanning: boolean): void {
  if (!scanBtn) return;
  if (scanning) {
    scanBtn.classList.add("scanning");
    scanBtn.textContent = t("diagnostics.scanningDot");
  } else {
    scanBtn.classList.remove("scanning");
    scanBtn.textContent = t("diagnostics.startScan");
  }
}

function dgCfRenderRadarPlaceholder(list: HTMLElement): void {
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">' +
    t("diagnostics.scanningConflicts") +
    "</div>";
}

async function dgCfLoadCfgAndInstances(): Promise<{
  cfg: AppConfig;
  mcRoot: string;
  instances: VersionInstance[];
  errorHtml: string | null;
}> {
  const { LoadAppConfig, ListVersionInstances } = await getApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    return {
      cfg,
      mcRoot: "",
      instances: [],
      errorHtml:
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configGameDir") + "</div>",
    };
  }
  const instances = (await ListVersionInstances(mcRoot)) || [];
  if (!instances || !instances.length) {
    return {
      cfg,
      mcRoot,
      instances: [],
      errorHtml:
        '<div class="stat-row diag-msg diag-msg-muted">' + t("diagnostics.noModpacks") + "</div>",
    };
  }
  return { cfg, mcRoot, instances, errorHtml: null };
}

async function dgCfCollectInstanceFiles(instances: VersionInstance[]): Promise<Record<string, DgCfInstanceFile[]>> {
  const { ScanModelEntriesWithLabel } = await getApp();
  const instanceFiles: Record<string, DgCfInstanceFile[]> = {};
  for (const ins of instances) {
    if (!ins.Exists) continue;
    const entries = (await ScanModelEntriesWithLabel(ins.CustomDir, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) || [];
    instanceFiles[ins.Name] = entries.map((e) => ({
      name: e.Name.replace(/\.(disabled|ban)$/i, ""),
    }));
  }
  return instanceFiles;
}

function dgCfBuildNameConflictMap(
  instanceFiles: Record<string, DgCfInstanceFile[]>,
): [string, string[]][] {
  const nameMap: Record<string, string[]> = {};
  for (const [insName, files] of Object.entries(instanceFiles)) {
    for (const f of files) {
      if (!nameMap[f.name]) nameMap[f.name] = [];
      nameMap[f.name].push(insName);
    }
  }
  return Object.entries(nameMap)
    .filter(([, v]) => v.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
}

function dgCfRenderConflictList(
  conflicts: [string, string[]][],
  esc: EscFn,
): string {
  if (!conflicts.length) {
    return '<div class="stat-row diag-msg diag-msg-success">✅ ' + t("diagnostics.noNameConflict") + "</div>";
  }
  let html = `<div class="stat-row diag-msg diag-msg-error" style="animation:conflictRowIn .3s ease">⚠️ ${t("diagnostics.conflictsFound", { n: conflicts.length })}</div>`;
  conflicts.slice(0, 50).forEach(([name, insNames], i) => {
    const delay = stagger(i, 30, 600);
    html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${renderDisplayName(name)}</span>
<span class="conflict-ver">${t("diagnostics.modpackCount", { n: insNames.length })}</span>
</div>`;
    insNames.forEach((n, j) => {
      html += `<div class="conflict-ins" style="animation-delay:${delay + (j + 1) * 15}ms">&nbsp;&nbsp;📦 ${esc(n)}</div>`;
    });
  });
  if (conflicts.length > 50) {
    html += `<div class="stat-row diag-msg diag-msg-muted" style="font-size:10px">...${t("diagnostics.moreCount", { n: conflicts.length - 50 })}</div>`;
  }
  return html;
}

export async function scanConflicts(root: ShadowRoot, esc: EscFn): Promise<void> {
  if (dgCfWebGate()) return;
  const list = root.getElementById("diag-conflict-list");
  if (!list) return;
  if (diagScanning) return;
  diagScanning = true;

  const scanBtn = root.getElementById("diag-scan-conflict") as HTMLElement | null;
  dgCfSetScanBtnState(scanBtn, true);
  dgCfRenderRadarPlaceholder(list as HTMLElement);

  try {
    const { instances, errorHtml } = await dgCfLoadCfgAndInstances();
    if (errorHtml) {
      dgCfSetScanBtnState(scanBtn, false);
      list.innerHTML = errorHtml;
      return;
    }
    const instanceFiles = await dgCfCollectInstanceFiles(instances);
    const conflicts = dgCfBuildNameConflictMap(instanceFiles);
    list.innerHTML = dgCfRenderConflictList(conflicts, esc);
  } catch (err) {
    list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">${t("diagnostics.scanFailed")}: ${esc(String(err))}</div>`;
  } finally {
    dgCfSetScanBtnState(scanBtn, false);
    diagScanning = false;
  }
}

// ===== 同步冲突检测与解决（P1 优先级） =====

// ===== scanSyncConflicts 子函数 =====

function dgCfSyncWebGate(): boolean {
  if (resolveWebMode()) {
    bus.emit("toast:show", {
      msg: "网页版不支持同步冲突扫描",
      duration: TOAST_MS.normal,
      type: "warn",
    });
    return true;
  }
  return false;
}

async function dgCfLoadSyncContext(): Promise<{
  mcRoot: string;
  availableInstances: string[];
  errorHtml: string | null;
}> {
  const { ListVersionInstances, LoadAppConfig } = await getApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    return {
      mcRoot: "",
      availableInstances: [],
      errorHtml:
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configGameDir") + "</div>",
    };
  }
  const instances = (await ListVersionInstances(mcRoot)) || [];
  const availableInstances = instances.filter((ins) => ins.Exists).map((ins) => ins.Name);
  return { mcRoot, availableInstances, errorHtml: null };
}

async function dgCfRunSyncDetection(
  list: HTMLElement,
  esc: EscFn,
  rtype: string,
  instanceName: string,
): Promise<void> {
  const { DetectConflicts } = await getApp();
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">' +
    t("diagnostics.scanningConflicts") +
    "</div>";
  const resultJSON = await DetectConflicts(rtype, instanceName);
  const result = JSON.parse(resultJSON) as DgCfSyncDetectionResult;
  if (result.error) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-error">❌ ' + esc(result.error) + "</div>";
    return;
  }
  const conflicts = result.conflicts || [];
  if (conflicts.length === 0) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-success">✅ ' + t("diagnostics.noSyncConflict") + "</div>";
    return;
  }
  renderSyncConflictsResult(list, esc, conflicts, rtype, instanceName);
}

export async function scanSyncConflicts(
  list: HTMLElement,
  esc: EscFn,
  rtype?: string,
  instanceName?: string,
): Promise<void> {
  if (dgCfSyncWebGate()) return;
  if (diagSyncBusy) return;
  diagSyncBusy = true;

  try {
    const { availableInstances, errorHtml } = await dgCfLoadSyncContext();
    if (errorHtml) {
      list.innerHTML = errorHtml;
      return;
    }
    if (!rtype || !instanceName) {
      renderSyncConfigPanel(list, esc, availableInstances);
      return;
    }
    await dgCfRunSyncDetection(list, esc, rtype, instanceName);
  } catch (err) {
    list.innerHTML =
      `<div class="stat-row diag-msg diag-msg-error">${t("diagnostics.scanFailed")}: ${esc(String(err))}</div>`;
  } finally {
    diagSyncBusy = false;
  }
}

// ===== renderSyncConfigPanel 子函数 =====

function dgCfBuildConfigPanelHtml(
  instances: string[],
  selectedInstance: string,
  selectedRtype: string,
  esc: EscFn,
): string {
  const instanceOptions = instances
    .map((ins) => `<option value="${esc(ins)}"${ins === selectedInstance ? " selected" : ""}>${esc(ins)}</option>`)
    .join("");
  const rtypeOptions = Object.entries(RESOURCE_TYPE_LABELS)
    .map(([id, label]) => `<option value="${esc(id)}"${id === selectedRtype ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
  return `
      <div class="diag-sync-config">
        <div class="diag-config-item">
          <label for="sync-rtype">📦 ${t("diagnostics.selectResourceType")}:</label>
          <select id="sync-rtype" class="diag-config-select">
            ${rtypeOptions}
          </select>
        </div>
        <div class="diag-config-item">
          <label for="sync-instance">🎮 ${t("diagnostics.selectInstance")}:</label>
          <select id="sync-instance" class="diag-config-select">
            ${instanceOptions}
          </select>
        </div>
        <button id="sync-scan-btn" class="diag-dedup-exec">🔍 ${t("diagnostics.scanSyncConflict")}</button>
      </div>
    `;
}

function dgCfBindConfigPanelEvents(
  list: HTMLElement,
  esc: EscFn,
  state: { selectedInstance: string; selectedRtype: string },
): void {
  list.querySelector("#sync-rtype")?.addEventListener("change", (e) => {
    state.selectedRtype = (e.target as HTMLSelectElement).value;
  });
  list.querySelector("#sync-instance")?.addEventListener("change", (e) => {
    state.selectedInstance = (e.target as HTMLSelectElement).value;
  });
  list.querySelector("#sync-scan-btn")?.addEventListener("click", async () => {
    await scanSyncConflicts(list, esc, state.selectedRtype, state.selectedInstance);
  });
}

function renderSyncConfigPanel(
  list: HTMLElement,
  esc: EscFn,
  instances: string[],
): void {
  const rtypeOptions = Object.entries(RESOURCE_TYPE_LABELS);
  const state = {
    selectedInstance: instances[0] || "",
    selectedRtype: rtypeOptions[0]?.[0] || "",
  };
  list.innerHTML = dgCfBuildConfigPanelHtml(instances, state.selectedInstance, state.selectedRtype, esc);
  dgCfBindConfigPanelEvents(list, esc, state);
}

// ===== renderSyncConflictsResult 子函数 =====

function dgCfBuildSyncConflictRows(conflicts: DgCfFileConflict[], esc: EscFn): string {
  let html = "";
  const strategyLabels: Record<string, string> = {
    force_remote: t("diagnostics.resolveForceRemote"),
    force_local: t("diagnostics.resolveForceLocal"),
    manual: t("diagnostics.resolveManual"),
  };
  conflicts.forEach((c, i) => {
    const conflictTypeLabel = c.type === "content_modified"
      ? t("diagnostics.conflictTypeContent")
      : t("diagnostics.conflictTypeBoth");
    const suggestedLabel = strategyLabels[c.suggestedStrategy] ?? t("diagnostics.resolveManual");
    const delay = stagger(i, 30, 600);
    html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${esc(c.path)}</span>
<span class="conflict-ver">${conflictTypeLabel}</span>
</div>`;
    html += `<div class="conflict-ins" style="animation-delay:${delay + 15}ms">
&nbsp;&nbsp;📏 ${esc(String(c.localSize))} ↔ ${esc(String(c.remoteSize))} | 💡 ${suggestedLabel}
</div>`;
  });
  return html;
}

function dgCfBuildResolveSectionHtml(): string {
  return `<div class="diag-sync-resolve" style="margin-top:16px;padding:12px;background:var(--diag-stat-bg);border-radius:8px">
<div class="diag-config-item">
  <label for="resolve-strategy">🎯 ${t("diagnostics.resolveConflicts")}:</label>
  <select id="resolve-strategy" class="diag-config-select">
    <option value="force_remote">${t("diagnostics.resolveForceRemote")}</option>
    <option value="force_local">${t("diagnostics.resolveForceLocal")}</option>
    <option value="manual">${t("diagnostics.resolveManual")}</option>
  </select>
</div>
<button id="do-resolve-btn" class="diag-dedup-exec" style="margin-top:8px">✅ ${t("diagnostics.resolveConflicts")}</button>
</div>`;
}

async function dgCfExecuteResolve(
  list: HTMLElement,
  esc: EscFn,
  conflicts: DgCfFileConflict[],
  rtype: string,
  instanceName: string,
): Promise<void> {
  const strategyEl = list.querySelector("#resolve-strategy") as HTMLSelectElement;
  const strategy = strategyEl?.value || "force_remote";
  try {
    const { ResolveConflicts } = await getApp();
    const conflictsJSON = JSON.stringify(conflicts);
    const resultJSON = await ResolveConflicts(conflictsJSON, strategy, rtype, instanceName);
    const result = JSON.parse(resultJSON) as DgCfResolveResult;
    let resultMsg = `✅ ${t("diagnostics.resolvedCount", { n: result.resolved || 0 })}`;
    if (result.failed > 0) resultMsg += ` | ❌ ${t("diagnostics.failedCount", { n: result.failed })}`;
    if (result.manual > 0) resultMsg += ` | ⚠️ ${t("diagnostics.manualCount", { n: result.manual })}`;
    if (result.error) {
      list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">❌ ${esc(result.error)}</div>`;
    } else {
      list.innerHTML += `<div class="stat-row diag-msg diag-msg-success" style="margin-top:12px">${resultMsg}</div>`;
      setTimeout(() => scanSyncConflicts(list, esc, rtype, instanceName), 1500);
    }
  } catch (err) {
    list.innerHTML += `<div class="stat-row diag-msg diag-msg-error" style="margin-top:12px">❌ ${esc(String(err))}</div>`;
  }
}

function renderSyncConflictsResult(
  list: HTMLElement,
  esc: EscFn,
  conflicts: DgCfFileConflict[],
  rtype: string,
  instanceName: string,
): void {
  const header = `<div class="stat-row diag-msg diag-msg-error">⚠️ ${t("diagnostics.syncConflictFound", { n: conflicts.length })}</div>`;
  const rowsHtml = dgCfBuildSyncConflictRows(conflicts, esc);
  const resolveHtml = dgCfBuildResolveSectionHtml();
  const html = header + rowsHtml + resolveHtml;
  list.innerHTML = html;
  list.querySelector("#do-resolve-btn")?.addEventListener("click", async () => {
    await dgCfExecuteResolve(list, esc, conflicts, rtype, instanceName);
  });
}
