// ===== recycleHTML 模板（从 tpl.ts 拆出，ADR-040 P2 chunk 实效修复）=====
// 动态导入目标：init-pages.ts 按需加载，使 Vite 真正按功能拆分 chunk。
// P3（ADR-190 D1/D1a）：renderRecycleListHtml 从 features/maintenance/recycle-bin.ts 回迁至此——
// DOM HTML 模板归 views（同页面模板归拢）；features 侧经 RecycleDeps.renderListHtml 注入本函数。
import { t } from "../../core/i18n/t.ts";
import type { RecycleBinEntry } from "../../features/maintenance/recycle-bin.ts";
import { stagger } from "../../utils/animation/stagger.ts";
import { renderDisplayName } from "../../utils/dom/display.ts";
import { formatBytes } from "../../utils/dom/format.ts";
import { esc } from "../../utils/dom/html.ts";

export function recycleHTML(): string {
  return `<div class="recy-page" style="flex:1;display:flex;flex-direction:column;overflow:hidden;padding:12px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
<span id="recy-count" style="font-size:11px;color:var(--muted)">${t("common.loading")}</span>
<button class="btn-base sm" id="recy-refresh" style="margin-left:auto">🔄 ${t("common.refresh")}</button>
<button class="btn-base danger sm" id="recy-empty">♻️ ${t("recycle.empty")}</button>
</div>
<div id="recy-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px"></div>
</div>`;
}

/**
 * 回收站列表条目 HTML（数据 → 字符串，纯模板；原 features 侧实现原样回迁）。
 * 原 `_getCurrentType` 参数实测未使用，随迁移删除。
 */
export function renderRecycleListHtml(entries: RecycleBinEntry[]): string {
  return entries
    .map((e, i) => {
      const name = e.Name.replace(/\.(ysm|zip|7z)\.(disabled|ban)$/i, ".$1");
      const size = Number.isFinite(e.Size) ? formatBytes(e.Size as number) : "?";
      return `<div class="recy-item" data-testid="recy-item" style="animation-delay:${stagger(i, 25, 400)}ms;display:flex;flex-direction:column;gap:2px;padding:5px 8px;border-radius:5px;background:var(--bg);font-size:var(--fs-sm)">
<div style="display:flex;align-items:center;gap:6px">
<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt);cursor:pointer" title="${t("oldest.clickDetail", { name: esc(e.Path) })}" data-path="${esc(e.Path)}">${renderDisplayName(name)}</span>
<span style="font-size:var(--fs-xs);color:var(--muted)">${size}</span>
<button class="recy-restore" data-testid="recy-restore" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--bd);background:var(--surf);color:var(--txt);cursor:pointer;font-size:var(--fs-xs)">↩️ ${t("recycle.restore")}</button>
<button class="recy-del" data-testid="recy-del" data-path="${esc(e.Path)}" style="padding:2px 6px;border-radius:3px;border:1px solid var(--paid);background:transparent;color:var(--paid);cursor:pointer;font-size:var(--fs-xs)">🗑️ ${t("recycle.delete")}</button>
</div>
<div style="font-size:var(--fs-xs);color:var(--muted);padding-left:2px;word-break:break-all">📂 ${esc(e.Path)}</div>
</div>`;
    })
    .join("");
}
