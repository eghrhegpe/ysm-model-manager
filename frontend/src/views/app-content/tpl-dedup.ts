// ===== dedup 面板模板（从 init-pages.ts 内联拼接拆出，2026-10 收债）=====
// 与 recycle/oldest 同构（ADR-040 P2 chunk 实效 + ADR-190 D1a）：DOM 模板归 views 叶模板，
// init 只做数据编排。动态导入目标：initDedupTab 按需加载，使 Vite 按功能拆分 chunk。
import { t } from "@/core/i18n/t.ts";
import { msgRowHTML } from "@/utils/dom/status-row.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";

/**
 * 去重组面板外层骨架：提示条 + 开始按钮 / 配置面板挂载点 / 结果列表挂载点。
 * 三个 id（dedup-start-btn / dedup-config-panel / dedup-result-list）由 initDedupTab
 * 按 id 接线，本函数只产出结构，不绑定行为（结构正确性由代码保证、不靠人肉记忆）。
 *
 * 结果区**首屏带「未扫描」空闲态**（2026-10-15 收口老锐评 P2）：原先整块留白，与「扫描
 * 完成但无重复」视觉不可区分（同分区回收站/资历最深两面板三态齐备）。空闲态是**初始内容**
 * 而非独立分支——扫描链一律 `list.innerHTML = …` 整块覆写（`dedup.ts` 结果/无重复/取消/错误
 * 四条出口皆是），故不需要额外清理路径，也就不会出现「空闲态与结果并存」。
 */
export function dedupPanelHTML(): string {
  return (
    '<div style="display:flex;flex-direction:column;height:100%">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd)">' +
    '<span style="flex:1;font-size:var(--fs-sm);color:var(--muted)">' +
    UI_ICONS.pin +
    " " +
    t("dedup.sha256Hint") +
    "</span>" +
    '<button class="btn-base accent" id="dedup-start-btn">' +
    UI_ICONS.link +
    " " +
    t("dedup.startDedup") +
    "</button>" +
    "</div>" +
    '<div id="dedup-config-panel" style="padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd)"></div>' +
    '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:var(--pad-v-8)">' +
    // 文案走 t() 直插（状态行外壳契约：调用点喂 t() 即视为可信 HTML，不二次转义）
    msgRowHTML("muted", t("dedup.idleScanHint"), undefined, { icon: UI_ICONS.search }) +
    "</div>" +
    "</div>"
  );
}
