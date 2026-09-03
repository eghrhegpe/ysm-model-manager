// ===== 诊断页：去重扫描（createDedupSession 会话工厂） =====
// ADR-040 按职责切文件：原 init.ts 拆分——日志加载（logs.ts）/ 去重（本文件）/ 冲突扫描（conflicts.ts）
// 去全局化：原模块级可变全局 _dedupBusy / diagExecBusy / dedupConfig 收敛为会话闭包状态，
// 每会话独立（可 reset、可隔离单测），消除跨调用共享状态的竞态面。
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { loadResourceRegistry } from "../../../services/resource-registry.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { renderDisplayName } from "../../../utils/dom/display.ts";
import { fileIcon } from "../../../utils/icon/icon.ts";
import type { EscFn } from "./logs.ts";

// 默认值冻结为唯一权威源；会话 config 为可编辑副本；reset 从默认值展开。
// 注意：显式标宽 strategy/keepPolicy/priorityPath 为 string，避免 Object.freeze
// 泛型保留字面量类型（"deep_hash"）导致 select.value(string) 赋值失败。
export interface DedupConfigShape {
  strategy: string;
  keepPolicy: string;
  priorityPath: string;
}

const DEDUP_DEFAULTS: Readonly<DedupConfigShape> = Object.freeze({
  strategy: "deep_hash",
  keepPolicy: "oldest",
  priorityPath: "",
});

// ===== getDefaultKeepIdx 子函数：闭包 toTimestamp 升格（纯函数） =====
function toTimestamp(modTime?: string | number): number {
  if (modTime === undefined || modTime === null || modTime === "") return Number.MAX_SAFE_INTEGER;
  const ts = typeof modTime === "number" ? modTime : Date.parse(modTime);
  return isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
}

function reduceOldestIdx(
  files: { path: string; size: number; modTime?: string | number }[],
): number {
  return files.reduce(
    (best, e, i, arr) =>
      toTimestamp(e.modTime) < toTimestamp(arr[best].modTime) ? i : best,
    0,
  );
}

function reduceNewestIdx(
  files: { path: string; size: number; modTime?: string | number }[],
): number {
  return files.reduce(
    (best, e, i, arr) =>
      toTimestamp(e.modTime) > toTimestamp(arr[best].modTime) ? i : best,
    0,
  );
}

function reducePathIdx(
  files: { path: string; size: number; modTime?: string | number }[],
  priorityPath: string,
): number {
  if (priorityPath) {
    const idx = files.findIndex((f) =>
      f.path.toLowerCase().startsWith(priorityPath.toLowerCase()),
    );
    if (idx >= 0) return idx;
  }
  return files.reduce(
    (best, e, i, arr) => (e.size > arr[best].size ? i : best),
    0,
  );
}

function reduceLargestIdx(
  files: { path: string; size: number; modTime?: string | number }[],
): number {
  return files.reduce(
    (best, e, i, arr) => (e.size > arr[best].size ? i : best),
    0,
  );
}

/**
 * 根据保留策略决定默认保留的文件索引
 * - "oldest": 保留最早修改的文件
 * - "newest": 保留最新修改的文件
 * - "path": 保留指定路径前缀匹配的文件
 * - 其他/默认: 保留最大文件（size 最大）
 */
export function getDefaultKeepIdx(
  files: { path: string; size: number; modTime?: string | number }[],
  policy: string,
  priorityPath: string,
): number {
  if (files.length === 0) return 0;

  switch (policy) {
    case "oldest":
      return reduceOldestIdx(files);
    case "newest":
      return reduceNewestIdx(files);
    case "path":
      return reducePathIdx(files, priorityPath);
    default:
      return reduceLargestIdx(files);
  }
}

// ===== 类型提级 =====
interface ScanTarget {
  id: string;
  icon: string;
  label: string;
  dir: string;
}

interface ScanFile {
  path: string;
  name: string;
  size: number;
  modTime?: string;
}

interface ScanGroup {
  files: ScanFile[];
}

interface ScanGroupResult {
  icon: string;
  label: string;
  groups: ScanGroup[];
}

import type { Group as DedupGroup } from "../../../../bindings/ysm-model-manager/go/dedup/models.ts";
type GetRepoRootFn = (rtype: string) => Promise<string>;
type FindDuplicateFilesFn = (dir: string, configStr: string) => Promise<DedupGroup[] | null>;
type MoveToRecycleFn = (path: string) => Promise<void>;
type DedupRegType = Awaited<ReturnType<typeof loadResourceRegistry>>;

// ② targets收集(rtype单目录/全类型遍历)（依赖注入，无会话状态）
async function collectTargets(
  rtype: string | undefined,
  reg: DedupRegType,
  typeIcon: string,
  typeLabel: string,
  GetRepoRoot: GetRepoRootFn,
): Promise<ScanTarget[]> {
  const targets: ScanTarget[] = [];
  if (rtype && rtype !== "all") {
    const dir = await GetRepoRoot(rtype);
    if (dir) targets.push({ id: rtype, icon: typeIcon, label: typeLabel, dir });
  } else {
    for (const rt of Object.values(reg)) {
      const dir = await GetRepoRoot(rt.id);
      if (dir) {
        const rtName = typeof rt.name === "string" ? rt.name : rt.id;
        const rtIcon = typeof rt.icon === "string" ? rt.icon : "📦";
        targets.push({ id: rt.id, icon: rtIcon, label: rtName, dir });
      }
    }
  }
  return targets;
}

// ③ 逐目录 FindDuplicateFiles 扫描（progress占位 + err判别{error}假绿）
async function scanEachDirectory(
  targets: ScanTarget[],
  list: HTMLElement,
  esc: EscFn,
  FindDuplicateFiles: FindDuplicateFilesFn,
  getConfig: () => Readonly<DedupConfigShape>,
): Promise<{ allResults: ScanGroupResult[]; earlyExit: boolean }> {
  const allResults: ScanGroupResult[] = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    list.innerHTML =
      '<div class="stat-row diag-stat diag-stat-muted">' +
      t("diagnostics.scanningProgress", {
        cur: i + 1,
        total: targets.length,
        icon: esc(target.icon),
        label: esc(target.label),
      }) +
      "</div>";
    await new Promise((r) => setTimeout(r, 10));
    const configStr = JSON.stringify(getConfig());
    const groups = await FindDuplicateFiles(target.dir, configStr);
    if (!groups) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error" style="justify-content:center">❌ ' +
        t("diagnostics.scanFailed", { reason: "扫描返回空" }) +
        "</div>";
      return { allResults, earlyExit: true };
    }
    if (groups.length)
      allResults.push({ icon: target.icon, label: target.label, groups: groups.map(g => ({
        files: (g.files || []).map(f => ({ path: f.path, name: f.name, size: f.size, ...(f.modTime ? { modTime: new Date(f.modTime).toISOString() } : {}) }))
      })) });
  }
  return { allResults, earlyExit: false };
}

// ④-1 单个 group 文件列表 HTML 片段
function renderGroupFilesHtml(
  files: ScanFile[],
  defaultIdx: number,
  gi: number,
  esc: EscFn,
): string {
  let html = "";
  files.forEach((e, fi) => {
    const checked = fi === defaultIdx ? " checked" : "";
    const isDefault = fi === defaultIdx;
    const dateStr = e.modTime
      ? new Date(e.modTime).toLocaleDateString()
      : "";
    const lastSep = Math.max(
      e.path.lastIndexOf("/"),
      e.path.lastIndexOf("\\"),
    );
    const dir = lastSep >= 0 ? e.path.substring(0, lastSep) : "";
    html += `<label class="diag-dedup-file${isDefault ? " diag-dedup-file-default" : ""}">
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} class="diag-dedup-radio">
<span class="diag-dedup-file-name">
<span class="diag-dedup-file-name-text" title="${t("oldest.clickDetail", { name: esc(e.path) })}" data-path="${esc(e.path)}"><span class="diag-dedup-file-ic">${fileIcon(e.name)}</span>${renderDisplayName(e.name)}</span>
<span class="diag-dedup-file-dir">📁 ${esc(dir)}</span>
</span>
<span class="diag-dedup-file-size">${(e.size / 1024).toFixed(0)}KB</span>
${dateStr ? '<span class="diag-dedup-file-date">' + dateStr + "</span>" : ""}
${isDefault ? '<span class="diag-dedup-recommend">' + t("diagnostics.recommended") + "</span>" : ""}
</label>`;
  });
  return html;
}

// ④ 分组结果 allResults 汇总渲染（group HTML + 默认保留索引）——config 注入取代模块全局
function renderResultsHtml(
  allResults: ScanGroupResult[],
  esc: EscFn,
  config: Readonly<DedupConfigShape>,
): string {
  const totalGroups = allResults.reduce((s, r) => s + r.groups.length, 0);
  const totalDups = allResults.reduce(
    (s, r) => s + r.groups.reduce((s2, g) => s2 + g.files.length - 1, 0),
    0,
  );

  let html = `<div class="diag-dedup-summary">
${t("diagnostics.dupSummary", { groups: totalGroups, dups: totalDups })}
<span class="diag-dedup-summary-hint">${t("diagnostics.dupSummaryHint")}</span>
</div>`;

  let groupIndex = 0;
  for (const rtResult of allResults) {
    html += `<div class="diag-dedup-rt">
${rtResult.icon} ${rtResult.label}
<span class="diag-dedup-rt-sep"></span>
<span class="diag-dedup-rt-count">${t("diagnostics.fileCount", { n: rtResult.groups.reduce((s, g) => s + g.files.length, 0) })}</span>
</div>`;

    for (const group of rtResult.groups) {
      const files = group.files || [];
      const defaultIdx = getDefaultKeepIdx(files, config.keepPolicy, config.priorityPath);
      const totalSize = files.reduce((s, e) => s + e.size, 0);
      const gi = groupIndex++;

      html += `<div class="diag-dedup-group">
<div class="diag-dedup-group-head">
<span>📎 ${t("diagnostics.group", { n: gi + 1 })}</span>
<span class="diag-dedup-group-fill"></span>
<span class="diag-dedup-group-info">${t("diagnostics.groupInfo", { n: files.length, size: totalSize })}</span>
</div>`;
      html += renderGroupFilesHtml(files, defaultIdx, gi, esc);
      html += `<label class="diag-dedup-keep-all">
<input type="radio" name="dedup-keep-${gi}" value="-1" class="diag-dedup-radio">
<span class="diag-dedup-keep-all-label">🔀 ${t("diagnostics.keepAll")}</span>
</label>`;
      html += `</div>`;
    }
  }

  html += `<div class="diag-dedup-actions">
<button id="diag-dedup-exec" class="diag-dedup-exec">🗑️ ${t("diagnostics.deleteUnselected")}</button>
<button id="diag-dedup-cancel" class="diag-dedup-cancel">${t("common.cancel")}</button>
</div>`;
  return html;
}

// ④ 文件名预览点击绑定
function bindPreviewClicks(list: HTMLElement): void {
  list.querySelectorAll("[data-path]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = (el as HTMLElement).dataset.path;
      if (path) bus.emit("model:select", { path });
    });
  });
}

// ④ cancel 按钮绑定
function bindCancelButton(list: HTMLElement): void {
  list.querySelector("#diag-dedup-cancel")?.addEventListener("click", () => {
    list.innerHTML =
      '<div class="stat-row diag-msg diag-msg-muted">' + t("diagnostics.dedupCancelled") + "</div>";
  });
}

export interface DedupSession {
  initConfig(list: HTMLElement): void;
  start(list: HTMLElement, esc: EscFn, rtype?: string): Promise<void>;
  getConfig(): Readonly<DedupConfigShape>;
  resetConfig(): void;
}

/**
 * 去重扫描会话。所有可变状态（busy 重入守卫 / exec 重入守卫 / 配置）收进闭包：
 * - 每会话独立，会话间无共享状态，可直接实例化隔离单测
 * - getConfig() 返回冻结快照防外部篡改；resetConfig() 从默认值展开
 */
export function createDedupSession(): DedupSession {
  const state = {
    busy: false, // startDedup 重入守卫：大量 await，快速连点并发扫描会互相覆盖并重复移入回收站
    execBusy: false, // exec 重入守卫：执行期间大量 MoveToRecycle await，重复点击并行二次删除
    config: { ...DEDUP_DEFAULTS } as DedupConfigShape,
  };

  function getConfig(): Readonly<DedupConfigShape> {
    return Object.freeze({
      strategy: state.config.strategy,
      keepPolicy: state.config.keepPolicy,
      priorityPath: state.config.priorityPath,
    });
  }

  function resetConfig(): void {
    Object.assign(state.config, DEDUP_DEFAULTS);
  }

  // ===== 配置面板（可编辑副本 state.config） =====
  function renderConfigHtml(list: HTMLElement): void {
    list.innerHTML = `
    <div class="diag-dedup-config">
      <div class="diag-config-item">
        <label for="dedup-strategy">🔍 ${t("diagnostics.dedupStrategy")}:</label>
        <select id="dedup-strategy" class="diag-config-select">
          <option value="deep_hash"${state.config.strategy === "deep_hash" ? " selected" : ""}>${t("diagnostics.strategyDeepHash")} (SHA256)</option>
          <option value="quick_hash"${state.config.strategy === "quick_hash" ? " selected" : ""}>${t("diagnostics.strategyQuickHash")} (MD5)</option>
          <option value="name_size"${state.config.strategy === "name_size" ? " selected" : ""}>${t("diagnostics.strategyNameSize")} (${t("diagnostics.fastest")})</option>
        </select>
      </div>
      <div class="diag-config-item">
        <label for="keep-policy">💾 ${t("diagnostics.keepPolicy")}:</label>
        <select id="keep-policy" class="diag-config-select">
          <option value="oldest"${state.config.keepPolicy === "oldest" ? " selected" : ""}>${t("diagnostics.keepOldest")}</option>
          <option value="newest"${state.config.keepPolicy === "newest" ? " selected" : ""}>${t("diagnostics.keepNewest")}</option>
          <option value="path"${state.config.keepPolicy === "path" ? " selected" : ""}>${t("diagnostics.keepByPath")}</option>
        </select>
      </div>
      <div class="diag-config-item" id="priority-path-item" style="${state.config.keepPolicy === "path" ? "" : "display:none"}">
        <label for="priority-path">📁 ${t("diagnostics.priorityPath")}:</label>
        <input type="text" id="priority-path" class="diag-config-input" placeholder="/path/to/priority" value="">
      </div>
    </div>
  `;
  }

  function bindStrategyChange(list: HTMLElement): void {
    list.querySelector("#dedup-strategy")?.addEventListener("change", (e) => {
      state.config.strategy = (e.target as HTMLSelectElement).value;
    });
  }

  function bindKeepPolicyChange(list: HTMLElement): void {
    list.querySelector("#keep-policy")?.addEventListener("change", (e) => {
      state.config.keepPolicy = (e.target as HTMLSelectElement).value;
      const pathItem = list.querySelector("#priority-path-item") as HTMLElement;
      if (pathItem) {
        pathItem.style.display = state.config.keepPolicy === "path" ? "" : "none";
      }
    });
  }

  function bindPriorityPathInput(list: HTMLElement): void {
    list.querySelector("#priority-path")?.addEventListener("input", (e) => {
      state.config.priorityPath = (e.target as HTMLInputElement).value;
    });
  }

  function buildConfigPanel(list: HTMLElement): void {
    renderConfigHtml(list);
    bindStrategyChange(list);
    bindKeepPolicyChange(list);
    bindPriorityPathInput(list);
  }

  function initConfig(list: HTMLElement): void {
    buildConfigPanel(list);
  }

  // ⑤ exec 按钮：逐组 MoveToRecycle + success/fail 统计 + treeReload
  async function runExecDelete(
    list: HTMLElement,
    allResults: ScanGroupResult[],
    MoveToRecycle: MoveToRecycleFn,
    esc: EscFn,
  ): Promise<void> {
    if (state.execBusy) return;
    state.execBusy = true;
    let del = 0,
      fail = 0,
      gi2 = 0;
    try {
      for (const rtResult of allResults) {
        for (const group of rtResult.groups) {
          const files = group.files || [];
          const selEl = list.querySelector(
            'input[name="dedup-keep-' + gi2 + '"]:checked',
          ) as HTMLInputElement | null;
          const selected = selEl ? parseInt(selEl.value, 10) : 0;
          if (selected === -1) {
            gi2++;
            continue;
          }
          for (let fi = 0; fi < files.length; fi++) {
            if (fi === selected) continue;
            try {
              await MoveToRecycle(files[fi].path);
              del++;
            } catch {
              fail++;
            }
          }
          gi2++;
        }
      }
      if (del > 0) {
        bus.emit("stats:refresh");
        bus.emit("tree:reload");
      }
      list.innerHTML =
        '<div class="stat-row diag-msg ' +
        (fail > 0 ? "diag-msg-warn" : "diag-msg-success") +
        '">✅ ' +
        t("diagnostics.dedupDone", { del, fail }) +
        "</div>";
    } catch (err) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' +
        t("diagnostics.dedupFailed") +
        ": " +
        esc(String(err)) +
        "</div>";
    } finally {
      state.execBusy = false;
    }
  }

  // ⑤ exec 按钮绑定壳
  function bindExecButton(
    list: HTMLElement,
    allResults: ScanGroupResult[],
    MoveToRecycle: MoveToRecycleFn,
    esc: EscFn,
  ): void {
    list
      .querySelector("#diag-dedup-exec")
      ?.addEventListener("click", async () => {
        await runExecDelete(list, allResults, MoveToRecycle, esc);
      });
  }

  // ②→③→④→⑤ executeDedupScan 核心协调壳
  async function executeScanCore(
    list: HTMLElement,
    esc: EscFn,
    rtype: string | undefined,
    reg: DedupRegType,
    typeIcon: string,
    typeLabel: string,
    GetRepoRoot: GetRepoRootFn,
    FindDuplicateFiles: FindDuplicateFilesFn,
    MoveToRecycle: MoveToRecycleFn,
  ): Promise<void> {
    // ② targets 收集
    const targets = await collectTargets(rtype, reg, typeIcon, typeLabel, GetRepoRoot);
    if (!targets.length) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' + t("diagnostics.configResourceDir") + "</div>";
      return;
    }

    // ③ 逐目录扫描
    const { allResults, earlyExit } = await scanEachDirectory(
      targets,
      list,
      esc,
      FindDuplicateFiles,
      getConfig,
    );
    if (earlyExit) return;

    const totalGroups = allResults.reduce((s, r) => s + r.groups.length, 0);
    if (!totalGroups) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-success" style="justify-content:center">✅ ' +
        t("diagnostics.noDups") +
        "</div>";
      return;
    }

    // ④ 渲染结果 HTML + 绑定预览/取消
    list.innerHTML = renderResultsHtml(allResults, esc, getConfig());
    bindPreviewClicks(list);
    bindCancelButton(list);

    // ⑤ exec 按钮绑定
    bindExecButton(list, allResults, MoveToRecycle, esc);
  }

  // 编排壳 + 外层 try-catch（异常路径渲染）
  async function executeScan(
    list: HTMLElement,
    esc: EscFn,
    rtype: string | undefined,
    reg: DedupRegType,
    typeIcon: string,
    typeLabel: string,
    GetRepoRoot: GetRepoRootFn,
    FindDuplicateFiles: FindDuplicateFilesFn,
    MoveToRecycle: MoveToRecycleFn,
  ): Promise<void> {
    try {
      await executeScanCore(
        list,
        esc,
        rtype,
        reg,
        typeIcon,
        typeLabel,
        GetRepoRoot,
        FindDuplicateFiles,
        MoveToRecycle,
      );
    } catch (err) {
      list.innerHTML =
        '<div class="stat-row diag-msg diag-msg-error">' +
        t("diagnostics.dedupFailed") +
        ": " +
        esc(String(err)) +
        "</div>";
    }
  }

  /**
   * 去重结果容器统一显式传入（消除 mock root 包装 + 幽灵 id diag-dedup-list）。
   */
  async function start(
    list: HTMLElement,
    esc: EscFn,
    rtype?: string,
  ): Promise<void> {
    // ① 重入守卫：busy 命中直接返回；整段包 try/finally，busy 仅在此单点复位
    if (state.busy) return;
    state.busy = true;
    try {
      // ① loadResourceRegistry（early return err）
      let reg: DedupRegType | null = null;
      let typeLabel = "";
      let typeIcon = "📦";
      try {
        reg = await loadResourceRegistry();
        const entry = rtype ? reg[rtype] : undefined;
        const entryName = entry && typeof entry.name === "string" ? entry.name : "";
        const entryIcon = entry && typeof entry.icon === "string" ? entry.icon : "";
        typeLabel = rtype ? entryName || rtype : t("diagnostics.all");
        typeIcon = rtype ? entryIcon || "📦" : "📦";
        list.innerHTML =
          '<div class="stat-row diag-stat diag-stat-muted">' +
          t("diagnostics.scanHash", { icon: esc(typeIcon), label: esc(typeLabel) }) +
          "</div>";
      } catch (e) {
        list.innerHTML =
          '<div class="stat-row diag-stat diag-stat-muted">❌ ' +
          esc(friendlyError(e, t("diagnostics.loadResourceTypesFailed"))) +
          "</div>";
        return;
      }

      try {
        const { FindDuplicateFiles, GetRepoRoot, MoveToRecycle } = await getApp();
        await executeScan(
          list,
          esc,
          rtype,
          reg,
          typeIcon,
          typeLabel,
          GetRepoRoot,
          FindDuplicateFiles,
          MoveToRecycle,
        );
      } catch (e) {
        list.innerHTML =
          '<div class="stat-row diag-stat diag-stat-muted">❌ ' +
          esc(friendlyError(e, t("diagnostics.loadDedupConfigFailed"))) +
          "</div>";
      }
    } finally {
      state.busy = false;
    }
  }

  return { initConfig, start, getConfig, resetConfig };
}