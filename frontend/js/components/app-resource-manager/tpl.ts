// ===== 资源管理器布局模板 =====
import { renderFormattedText } from "../../utils/mc-format.ts";
import { describeVersionRange, type PackMeta } from "../../utils/pack-format.ts";
import { esc } from "../../utils/dom.ts";

/** 详情面板元数据（ReadPackMeta / ReadShaderpackLang 返回 JSON 的兼容视图） */
export interface PackMetaDetail extends PackMeta {
  description?: string;
  thumbnail?: string | null;
  name?: string;
  entries?: Record<string, string>;
}

/**
 * 侧栏布局（路径 + 操作栏 + 列表）
 * @param repoRoot - 资源包目录路径
 * @param actions - 可用操作列表
 * @param label - 资源类型名称
 */
export function sidebarHTML(
  repoRoot: string,
  actions: string[],
  label: string,
): string {
  let html =
    '<div class="rm-sidebar" style="width:220px;overflow-y:auto;padding:8px;border-right:1px solid var(--bd);display:flex;flex-direction:column">' +
    '<div style="font-size:var(--fs-sm);color:var(--muted);padding:4px;word-break:break-all">📂 ' +
    esc(repoRoot) +
    "</div>";
  let btns = "";
  if (actions.includes("import")) {
    btns +=
      '<button class="btn-base sm rm-import-btn" data-testid="rm-import" style="flex:1">📥 导入</button>';
  }
  if (actions.includes("openFolder")) {
    btns +=
      '<button class="btn-base sm rm-open-btn" data-testid="rm-open">📁</button>';
  }
  if (btns) {
    html +=
      '<div style="display:flex;gap:4px;padding:4px 0;border-bottom:1px solid var(--bd);margin-bottom:4px">' +
      btns +
      "</div>";
  }
  html +=
    '<input class="rm-search" type="text" placeholder="🔍 搜索' +
    esc(label) +
    '..." style="width:100%;box-sizing:border-box;padding:4px 6px;font-size:var(--fs-xs);border:1px solid var(--bd);border-radius:4px;background:var(--bg);color:var(--txt);outline:none;margin-bottom:4px">' +
    '<div class="rm-list" style="flex:1;overflow-y:auto"><div style="padding:12px;text-align:center;color:var(--muted)">⏳ 加载中...</div></div>' +
    "</div>";
  return html;
}

/**
 * 列表项 HTML
 * @param path - 完整路径
 * @param name - 显示名称
 * @param enabled - 是否启用
 */
export function itemHTML(
  path: string,
  name: string,
  enabled: boolean,
  icon: string,
  idx: number,
): string {
  return (
    '<div class="rm-item" data-testid="rm-item" data-path="' +
    esc(path) +
    '" data-name="' +
    esc(name) +
    '" style="animation-delay:' + Math.min((idx || 0) * 20, 400) + 'ms;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:var(--fs-sm);transition:background var(--tr-fast);display:flex;align-items:center;gap:6px;opacity:' +
    (enabled ? 1 : 0.5) +
    '">' +
    '<span class="rm-toggle" style="cursor:pointer;font-size:12px;flex-shrink:0">' +
    (enabled ? "✅" : "⏹️") +
    "</span>" +
    '<span style="flex-shrink:0;font-size:12px">' +
    (icon || "📦") +
    "</span>" +
    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    esc(name) +
    "</span>" +
    "</div>"
  );
}

/**
 * 详情面板 HTML
 * @param name - 包名
 * @param meta - 元数据 {description, pack_format, thumbnail?}
 * @param enabled - 是否启用
 * @param path - 完整路径
 * @param label - 资源类型名称
 * @param actions - 可用操作
 */
export function detailHTML(
  name: string,
  meta: PackMetaDetail,
  enabled: boolean,
  path: string,
  label: string,
  actions: string[],
): string {
  const desc = renderFormattedText(meta.description || "");
  let html =
    '<div style="display:flex;flex-direction:column;gap:8px;font-size:var(--fs-sm);padding:12px">';
  if (meta.thumbnail) {
    html +=
      '<img src="' +
      esc(meta.thumbnail) +
      '" alt="pack" style="width:128px;height:128px;object-fit:contain;border-radius:6px;border:1px solid var(--bd);align-self:center;image-rendering:pixelated">';
  } else {
    html +=
      '<div style="width:128px;height:128px;border-radius:6px;border:1px solid var(--bd);align-self:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--bg)">' +
      '<div style="font-size:40px;line-height:1">❌</div>' +
      '<div style="font-size:var(--fs-sm);color:var(--muted)">无pack.png</div>' +
      '</div>';
  }
  html +=
    '<div style="font-weight:600;font-size:var(--fs-md)">' +
    esc(name) +
    "</div>";
  if (desc) {
    html +=
      '<div style="color:var(--muted);line-height:1.6">' + desc + "</div>";
  }
  const rv = describeVersionRange(meta);
  html +=
    '<div style="color:var(--muted);font-size:var(--fs-xs)">pack_format: ' +
    esc(rv.format) +
    (rv.version ? "（" + esc(rv.version) + "）" : "") +
    "</div>" +
    '<div style="color:var(--muted);font-size:var(--fs-xs)">状态: ' +
    (enabled ? "✅ 启用" : "⛔ 禁用") +
    "</div>" +
    '<div style="color:var(--muted);font-size:var(--fs-xs);word-break:break-all">📂 ' +
    esc(path) +
    "</div>";
  if (actions.includes("delete")) {
    html +=
      '<button class="btn-base danger sm rm-del-btn" style="align-self:flex-start;margin-top:8px">🗑️ 删除此' +
      esc(label) +
      "</button>";
  }
  html += "</div>";
  return html;
}

/**
 * 空状态占位
 * @param label - 资源类型名称
 */
export function placeholderHTML(label: string): string {
  return (
    '<div class="dp-placeholder" style="display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px;height:100%">' +
    '<div style="font-size:24px">📦</div>' +
    "<div>请选择一个" +
    esc(label) +
    "查看详情</div>" +
    "</div>"
  );
}
