// ===== 去重扫描：结果渲染 + 配置面板 + 事件绑定（2026-09 锐评 P1 自 dedup.ts 拆出）=====
// ④ 段：分组结果 HTML / 配置面板 HTML / 预览·取消·配置事件绑定。
// 配置面板函数改为显式接收 config 副本（原闭包绑定 state.config，拆出后参数化）。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { fileIcon } from "@/utils/icon/icon.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderDisplayName } from "@/utils/model-name/display.ts";
import { getDefaultKeepIdx } from "./dedup-policy.ts";
import type { DedupConfigShape, ScanFile, ScanGroupResult } from "./dedup-types.ts";
import type { EscFn } from "./logs.ts";
import { msgRowHTML } from "./status-row.ts";

// ===== 结果渲染 =====

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
    const dateStr = e.modTime ? new Date(e.modTime).toLocaleDateString() : "";
    const lastSep = Math.max(e.path.lastIndexOf("/"), e.path.lastIndexOf("\\"));
    const dir = lastSep >= 0 ? e.path.substring(0, lastSep) : "";
    html += `<label class="diag-dedup-file${isDefault ? " diag-dedup-file-default" : ""}">
<input type="radio" name="dedup-keep-${gi}" value="${fi}"${checked} class="diag-dedup-radio">
<span class="diag-dedup-file-name">
<span class="diag-dedup-file-name-text" title="${t("common.viewDetail", { name: esc(e.path) })}" data-path="${esc(e.path)}"><span class="diag-dedup-file-ic">${fileIcon(e.name)}</span>${renderDisplayName(e.name)}</span>
<span class="diag-dedup-file-dir">${UI_ICONS.folder} ${esc(dir)}</span>
</span>
<span class="diag-dedup-file-size">${(e.size / 1024).toFixed(0)}KB</span>
${dateStr ? `<span class="diag-dedup-file-date">${dateStr}</span>` : ""}
${isDefault ? `<span class="diag-dedup-recommend">${t("diagnostics.recommended")}</span>` : ""}
</label>`;
  });
  return html;
}

// ④ 分组结果 allResults 汇总渲染（group HTML + 默认保留索引）——config 注入取代模块全局
export function renderResultsHtml(
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
<span>${UI_ICONS.attach} ${t("diagnostics.group", { n: gi + 1 })}</span>
<span class="diag-dedup-group-fill"></span>
<span class="diag-dedup-group-info">${t("diagnostics.groupInfo", { n: files.length, size: totalSize })}</span>
</div>`;
      html += renderGroupFilesHtml(files, defaultIdx, gi, esc);
      html += `<label class="diag-dedup-keep-all">
<input type="radio" name="dedup-keep-${gi}" value="-1" class="diag-dedup-radio">
<span class="diag-dedup-keep-all-label">${UI_ICONS.shuffle} ${t("diagnostics.keepAll")}</span>
</label>`;
      html += `</div>`;
    }
  }

  html += `<div class="diag-dedup-actions">
<button id="diag-dedup-exec" class="diag-dedup-exec">${UI_ICONS.delete} ${t("diagnostics.deleteUnselected")}</button>
<button id="diag-dedup-cancel" class="diag-dedup-cancel">${t("common.cancel")}</button>
</div>`;
  return html;
}

// ===== 事件绑定 =====

// ④ 文件名预览点击绑定
export function bindPreviewClicks(list: HTMLElement): void {
  list.querySelectorAll("[data-path]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const path = (el as HTMLElement).dataset.path;
      if (path) bus.emit("model:select", { path });
    });
  });
}

// ④ cancel 按钮绑定
export function bindCancelButton(list: HTMLElement): void {
  list.querySelector("#diag-dedup-cancel")?.addEventListener("click", () => {
    list.innerHTML = msgRowHTML("muted", t("diagnostics.dedupCancelled"));
  });
}

// ===== 配置面板（可编辑副本 config 由调用方传入） =====

export function renderConfigHtml(list: HTMLElement, config: DedupConfigShape): void {
  list.innerHTML = `
    <div class="diag-dedup-config">
      <div class="diag-config-item">
        <label for="dedup-strategy">${UI_ICONS.search} ${t("diagnostics.dedupStrategy")}:</label>
        <select id="dedup-strategy" class="diag-config-select">
          <option value="deep_hash"${config.strategy === "deep_hash" ? " selected" : ""}>${t("diagnostics.strategyDeepHash")} (SHA256)</option>
          <option value="quick_hash"${config.strategy === "quick_hash" ? " selected" : ""}>${t("diagnostics.strategyQuickHash")} (MD5)</option>
          <option value="name_size"${config.strategy === "name_size" ? " selected" : ""}>${t("diagnostics.strategyNameSize")} (${t("diagnostics.fastest")})</option>
        </select>
      </div>
      <div class="diag-config-item">
        <label for="keep-policy">${UI_ICONS.save} ${t("diagnostics.keepPolicy")}:</label>
        <select id="keep-policy" class="diag-config-select">
          <option value="oldest"${config.keepPolicy === "oldest" ? " selected" : ""}>${t("diagnostics.keepOldest")}</option>
          <option value="newest"${config.keepPolicy === "newest" ? " selected" : ""}>${t("diagnostics.keepNewest")}</option>
          <option value="path"${config.keepPolicy === "path" ? " selected" : ""}>${t("diagnostics.keepByPath")}</option>
        </select>
      </div>
      <div class="diag-config-item" id="priority-path-item" style="${config.keepPolicy === "path" ? "" : "display:none"}">
        <label for="priority-path">${UI_ICONS.folder} ${t("diagnostics.priorityPath")}:</label>
        <input type="text" id="priority-path" class="diag-config-input" placeholder="/path/to/priority" value="">
      </div>
    </div>
  `;
}

export function bindStrategyChange(list: HTMLElement, config: DedupConfigShape): void {
  list.querySelector("#dedup-strategy")?.addEventListener("change", (e) => {
    config.strategy = (e.target as HTMLSelectElement).value;
  });
}

export function bindKeepPolicyChange(list: HTMLElement, config: DedupConfigShape): void {
  list.querySelector("#keep-policy")?.addEventListener("change", (e) => {
    config.keepPolicy = (e.target as HTMLSelectElement).value;
    const pathItem = list.querySelector("#priority-path-item") as HTMLElement;
    if (pathItem) {
      pathItem.style.display = config.keepPolicy === "path" ? "" : "none";
    }
  });
}

export function bindPriorityPathInput(list: HTMLElement, config: DedupConfigShape): void {
  list.querySelector("#priority-path")?.addEventListener("input", (e) => {
    config.priorityPath = (e.target as HTMLInputElement).value;
  });
}

export function buildConfigPanel(list: HTMLElement, config: DedupConfigShape): void {
  renderConfigHtml(list, config);
  bindStrategyChange(list, config);
  bindKeepPolicyChange(list, config);
  bindPriorityPathInput(list, config);
}
