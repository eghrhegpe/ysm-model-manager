// ===== sidebar HTML 模板 =====
import { RESOURCE_TYPES } from "../../utils/resource/resource-types.ts";
import { esc } from "../../utils/dom/dom.ts";

/** rtype 短标签映射（vcHeaderHTML 徽章） */
const RTYPE_LABELS: Record<string, string> = {
  ysm: "YSM",
  "mmd-skin": "MMD",
  "vrchat-avatar": "VRC",
  resourcepack: "资源包",
  shaderpack: "光影包",
  "create-blueprint": "蓝图",
  litematic: "投影文件",
};

export function headerHTML(): string {
  return (
    '<div style="padding:4px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px;color:var(--muted);flex:1">' +
    '<input type="checkbox" id="sb-select-all" style="cursor:pointer"> 全选</label>' +
    '<div class="dd-wrap" style="position:relative;display:inline-block">' +
    '<button class="sidebar-push-selected" data-testid="sidebar-push" style="padding:3px 8px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:9px;font-family:inherit">⬆️ 推送所选 ▾</button>' +
    '<div class="dd-menu" id="sidebar-push-menu" style="display:none;position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-size:10px;white-space:nowrap">' +
    typeMenuItemsHTML() +
    "</div></div>" +
    '<div class="dd-wrap" style="position:relative;display:inline-block">' +
    '<button class="sidebar-pull-selected" data-testid="sidebar-pull" style="padding:3px 8px;border-radius:4px;border:1px solid var(--sm-optional);background:transparent;color:var(--sm-optional);cursor:pointer;font-size:9px;font-family:inherit">⬇️ 拉取所选 ▾</button>' +
    '<div class="dd-menu" id="sidebar-pull-menu" style="display:none;position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-size:10px;white-space:nowrap">' +
    typeMenuItemsHTML() +
    "</div></div>" +
    "</div>"
  );
}

export function footerHTML(): string {
  return `<div class="footer">
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-sync">完全同步 -/-</span>
  <button class="btn-base footer-btn btn-mc-dir" id="btn-mc" title="配置游戏目录">🎮 未设置</button>
</div>
</div>`;
}

/** 推送/拉取下拉菜单共用的资源类型选项（两组共用，防 jscpd 重复） */
function typeMenuItemsHTML(): string {
  return (
    '<div class="dd-item" data-sync-type="all" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">📦 全部类型</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.YSM + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">💎 YSM</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.MMD + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🎭 MMD</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.VRC + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🥽 VRC</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.PACK + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">🎨 资源包</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.SHADER + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">☀️ 光影包</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.BLUEPRINT + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">⚙️ 蓝图</div>' +
    '<div class="dd-item" data-sync-type="' + RESOURCE_TYPES.LITEMATIC + '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">📐 投影</div>'
  );
}

export function listContainerHTML(): string {
  return `<div class="list" id="vg">${skeletonHTML()}</div>`;
}

/** 加载骨架屏 */
/** 加载骨架屏（内部被 listContainerHTML 引用，无需导出） */
function skeletonHTML(): string {
  let h = "";
  for (let i = 0; i < 4; i++) {
    h += `<div class="sk-item">
<div class="sk-line sk-w80"></div>
<div class="sk-line sk-w40"></div>
</div>`;
  }
  return h;
}

/** 单个整合包卡片头部。
 *  idx 用于绑定安装缺失按钮的 data-idx */
export function vcHeaderHTML(
  name: string,
  synced: number,
  missing: number,
  extra: number,
  status: string,
  idx = -1,
  hasMod = true,
  rtype = "ysm",
): string {
  const allZero = synced === 0 && missing === 0 && extra === 0;
  const chips =
    (synced > 0 ? `<span class="tag green">${synced}</span> ` : "") +
    (missing > 0 && hasMod ? `<span class="tag red">${missing}</span> ` : "") +
    (extra > 0 ? `<span class="tag orange">${extra}</span>` : "") +
    (!hasMod
      ? `<span class="tag gray">🚫 无${RTYPE_LABELS[rtype] || rtype}</span>`
      : allZero
        ? `<span class="tag">0</span>`
        : "");
  return `<div class="vc-header">
<div class="vc-hdr-row1"><span class="name">${esc(name)}</span></div>
<div class="vc-hdr-row2"><input type="checkbox" class="chk" data-idx="${idx}">📦${chips}</div>
</div>`;
}
