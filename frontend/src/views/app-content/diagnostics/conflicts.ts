// ===== 诊断页：冲突扫描（scanConflicts） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（本文件）

import { isWebPlatform } from "@/backend/platform-web.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { stagger } from "@/utils/animation/stagger.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { AppConfig, FileConflict, VersionInstance } from "@/utils/types-re-export.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import type { EscFn } from "./logs.ts";

// P3 修复（子代理审计，重入守卫）：scanConflicts 并发标志——快速 3 连点会并发扫描
// 同一 list 互相覆盖（结果写 innerHTML 竞争）；busy 命中直接返回。
// 【范式豁免】本模块无跨调用配置状态（不像 dedup.ts 的 keepPolicy/priorityPath 需跨调用保持），
// 纯并发守卫故保留模块级 busy；try/finally 兜底复位（见 :276）。改造会话工厂 ROI 低，不立项。
let diagScanning = false;

// 同步冲突扫描并发标志（同 diagScanning 豁免理由；try/finally 兜底复位 :277）
let diagSyncBusy = false;

interface DgCfInstanceFile {
  name: string;
}

// ===== 同步冲突绑定类型（已 struct 化，ADR-143 P0） =====
// DetectConflicts / ResolveConflicts 现返回 typed struct，失败走 error 通道（Promise reject）

// 兼容旧 interface，实际使用 binding 生成的类型
type DgCfFileConflict = FileConflict;

// ===== scanConflicts 子函数 =====

function dgCfWebGate(): boolean {
  if (isWebPlatform()) {
    bus.emit("toast:show", {
      msg: t("diagnostics.webNoConflictScan"),
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
  const { LoadAppConfig, ListVersionInstances } = await backendGetApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    return {
      cfg,
      mcRoot: "",
      instances: [],
      errorHtml:
        '<div class="stat-row diag-msg diag-msg-error">' +
        t("diagnostics.configGameDir") +
        "</div>",
    };
  }
  const instances = (await ListVersionInstances(mcRoot)) || [];
  if (!instances?.length) {
    return {
      cfg,
      mcRoot,
      instances: [],
      errorHtml: `<div class="stat-row diag-msg diag-msg-muted">${t("diagnostics.noModpacks")}</div>`,
    };
  }
  return { cfg, mcRoot, instances, errorHtml: null };
}

async function dgCfCollectInstanceFiles(
  instances: VersionInstance[],
): Promise<Record<string, DgCfInstanceFile[]>> {
  const { ScanModelEntriesWithLabel } = await backendGetApp();
  const instanceFiles: Record<string, DgCfInstanceFile[]> = {};
  for (const ins of instances) {
    if (!ins.Exists) continue;
    const entries =
      (await ScanModelEntriesWithLabel(ins.CustomDir, RESOURCE_TYPE_LABELS[RESOURCE_TYPES.YSM])) ||
      [];
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

function dgCfRenderConflictList(conflicts: [string, string[]][], esc: EscFn): string {
  if (!conflicts.length) {
    return (
      '<div class="stat-row diag-msg diag-msg-success">' +
      UI_ICONS.success +
      " " +
      t("diagnostics.noNameConflict") +
      "</div>"
    );
  }
  let html = `<div class="stat-row diag-msg diag-msg-error" style="animation:conflictRowIn .3s ease">${UI_ICONS.warning} ${t("diagnostics.conflictsFound", { n: conflicts.length })}</div>`;
  conflicts.slice(0, 50).forEach(([name, insNames], i) => {
    const delay = stagger(i, 30, 600);
    html += `<div class="conflict-row" style="animation-delay:${delay}ms">
<span class="conflict-name">${renderDisplayName(name)}</span>
<span class="conflict-ver">${t("diagnostics.modpackCount", { n: insNames.length })}</span>
</div>`;
    insNames.forEach((n, j) => {
      html += `<div class="conflict-ins" style="animation-delay:${delay + (j + 1) * 15}ms">&nbsp;&nbsp;${UI_ICONS.package} ${esc(n)}</div>`;
    });
  });
  if (conflicts.length > 50) {
    html += `<div class="stat-row diag-msg diag-msg-muted" style="font-size:var(--fs-xs)">...${t("diagnostics.moreCount", { n: conflicts.length - 50 })}</div>`;
  }
  return html;
}

export async function scanConflicts(root: ShadowRoot, esc: EscFn): Promise<void> {
  if (dgCfWebGate()) return;
  const list = root.getElementById("diag-conflict-list");
  if (!list) return;
  if (diagScanning) return;
  diagScanning = true;

  const scanBtn = root.getElementById("diag-scan-conflict");
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
  if (isWebPlatform()) {
    bus.emit("toast:show", {
      msg: t("diagnostics.webNoSyncConflictScan"),
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
  const { ListVersionInstances, LoadAppConfig } = await backendGetApp();
  const cfg = await LoadAppConfig();
  const mcRoot = cfg.mcRoot || "";
  if (!mcRoot) {
    return {
      mcRoot: "",
      availableInstances: [],
      errorHtml:
        '<div class="stat-row diag-msg diag-msg-error">' +
        t("diagnostics.configGameDir") +
        "</div>",
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
  const { DetectConflicts } = await backendGetApp();
  list.innerHTML =
    '<div class="scan-radar-wrap"><div class="scan-radar"></div><div class="scan-radar-dot"></div></div><div class="stat-row diag-msg diag-msg-muted" style="text-align:center">' +
    t("diagnostics.scanningConflicts") +
    "</div>";
  const result = await DetectConflicts(rtype, instanceName);
  if (!result) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-error">' +
      UI_ICONS.error +
      " " +
      t("diagnostics.conflictDetectionFailed") +
      "</div>";
    return;
  }
  const conflicts = result.conflicts || [];
  if (conflicts.length === 0) {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-success">' +
      UI_ICONS.success +
      " " +
      t("diagnostics.noSyncConflict") +
      "</div>";
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
    list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">${t("diagnostics.scanFailed")}: ${esc(String(err))}</div>`;
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
    .map(
      (ins) =>
        `<option value="${esc(ins)}"${ins === selectedInstance ? " selected" : ""}>${esc(ins)}</option>`,
    )
    .join("");
  const rtypeOptions = Object.entries(RESOURCE_TYPE_LABELS)
    .map(
      ([id, label]) =>
        `<option value="${esc(id)}"${id === selectedRtype ? " selected" : ""}>${esc(label)}</option>`,
    )
    .join("");
  return `
      <div class="diag-sync-config">
        <div class="diag-config-item">
          <label for="sync-rtype">${UI_ICONS.package} ${t("diagnostics.selectResourceType")}:</label>
          <select id="sync-rtype" class="diag-config-select">
            ${rtypeOptions}
          </select>
        </div>
        <div class="diag-config-item">
          <label for="sync-instance">${UI_ICONS.game} ${t("diagnostics.selectInstance")}:</label>
          <select id="sync-instance" class="diag-config-select">
            ${instanceOptions}
          </select>
        </div>
        <button id="sync-scan-btn" class="diag-dedup-exec">${UI_ICONS.search} ${t("diagnostics.scanSyncConflict")}</button>
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

function renderSyncConfigPanel(list: HTMLElement, esc: EscFn, instances: string[]): void {
  const rtypeOptions = Object.entries(RESOURCE_TYPE_LABELS);
  const state = {
    selectedInstance: instances[0] || "",
    selectedRtype: rtypeOptions[0]?.[0] || "",
  };
  list.innerHTML = dgCfBuildConfigPanelHtml(
    instances,
    state.selectedInstance,
    state.selectedRtype,
    esc,
  );
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
    const conflictTypeLabel =
      c.type === "content_modified"
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
  return `<div class="diag-sync-resolve" style="margin-top:16px;padding:12px;background:var(--diag-stat-bg);border-radius:var(--radius-lg)">
<div class="diag-config-item">
  <label for="resolve-strategy">${UI_ICONS.target} ${t("diagnostics.resolveConflicts")}:</label>
  <select id="resolve-strategy" class="diag-config-select">
    <option value="force_remote">${t("diagnostics.resolveForceRemote")}</option>
    <option value="force_local">${t("diagnostics.resolveForceLocal")}</option>
    <option value="manual">${t("diagnostics.resolveManual")}</option>
  </select>
</div>
<button id="do-resolve-btn" class="diag-dedup-exec" style="margin-top:8px">${UI_ICONS.success} ${t("diagnostics.resolveConflicts")}</button>
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
    const { ResolveConflicts } = await backendGetApp();
    const conflictsJSON = JSON.stringify(conflicts);
    const result = await ResolveConflicts(conflictsJSON, strategy, rtype, instanceName);
    if (!result) {
      list.innerHTML = `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.error} ${t("diagnostics.resolveFailed")}</div>`;
      return;
    }
    let resultMsg = `✅ ${t("diagnostics.resolvedCount", { n: result.resolved || 0 })}`;
    if (result.failed > 0)
      resultMsg += ` | ❌ ${t("diagnostics.failedCount", { n: result.failed })}`;
    if (result.manual > 0)
      resultMsg += ` | ⚠️ ${t("diagnostics.manualCount", { n: result.manual })}`;
    // appendChild + textContent：杜绝「读改写 innerHTML +=」反模式（每次全量重解析 + 未来引入用户可写串时的注入面）
    const okDiv = document.createElement("div");
    okDiv.className = "stat-row diag-msg diag-msg-success";
    okDiv.style.marginTop = "12px";
    okDiv.textContent = resultMsg;
    list.appendChild(okDiv);
    // 1.5s 后自动复扫（resolve 后刷新冲突态）。守卫：用户已离开诊断页（list 分离）
    // 则作废这次迟到的复扫——省一次后端 RPC，也避免向分离 DOM 写 innerHTML。
    setTimeout(() => {
      if (!list.isConnected) return;
      void scanSyncConflicts(list, esc, rtype, instanceName);
    }, 1500);
  } catch (err) {
    const errDiv = document.createElement("div");
    errDiv.className = "stat-row diag-msg diag-msg-error";
    errDiv.style.marginTop = "12px";
    errDiv.textContent = `❌ ${String(err)}`; // textContent 天然防注入，无需 esc()
    list.appendChild(errDiv);
  }
}

function renderSyncConflictsResult(
  list: HTMLElement,
  esc: EscFn,
  conflicts: DgCfFileConflict[],
  rtype: string,
  instanceName: string,
): void {
  const header = `<div class="stat-row diag-msg diag-msg-error">${UI_ICONS.warning} ${t("diagnostics.syncConflictFound", { n: conflicts.length })}</div>`;
  const rowsHtml = dgCfBuildSyncConflictRows(conflicts, esc);
  const resolveHtml = dgCfBuildResolveSectionHtml();
  const html = header + rowsHtml + resolveHtml;
  list.innerHTML = html;
  list.querySelector("#do-resolve-btn")?.addEventListener("click", async () => {
    await dgCfExecuteResolve(list, esc, conflicts, rtype, instanceName);
  });
}
