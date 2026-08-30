// ===== sidebar HTML 模板 =====
import { ALL_RESOURCE_TYPES, GROUP_OF, RESOURCE_TYPES, typeIconOf } from "../../utils/resource/types.ts";
import { shortLabelOf } from "../../utils/resource/short-label.ts";
import { esc } from "../../utils/dom/html.ts";
import { t } from "../../core/i18n/t.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  'sidebar-push',
  'sidebar-pull',
  'sidebar-select-all',
  'sidebar-check',
  'sidebar-sync-type',
  // ADR-133 阶段 C+：下拉容器原仅有 #id，e2e 靠 getElementById 绕过契约；补同名 testid 收口
  'sidebar-push-menu',
  'sidebar-pull-menu',
];


export function headerHTML(): string {
  return (
    '<div style="padding:4px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:10px;color:var(--muted);flex:1">' +
    '<input type="checkbox" id="sb-select-all" data-testid="sidebar-select-all" style="cursor:pointer"> ' + t("common.selectAll") + '</label>' +
    '<div class="dd-wrap" style="position:relative;display:inline-block">' +
    '<button class="sidebar-push-selected" data-testid="sidebar-push" style="padding:3px 8px;border-radius:4px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:9px;font-family:inherit">⬆️ ' + t("sidebar.pushSelected") + ' ▾</button>' +
    '<div class="dd-menu" id="sidebar-push-menu" data-testid="sidebar-push-menu" style="display:none;position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-size:10px;white-space:nowrap">' +
    typeMenuItemsHTML() +
    "</div></div>" +
    '<div class="dd-wrap" style="position:relative;display:inline-block">' +
    '<button class="sidebar-pull-selected" data-testid="sidebar-pull" style="padding:3px 8px;border-radius:4px;border:1px solid var(--sm-optional);background:transparent;color:var(--sm-optional);cursor:pointer;font-size:9px;font-family:inherit">⬇️ ' + t("sidebar.pullSelected") + ' ▾</button>' +
    '<div class="dd-menu" id="sidebar-pull-menu" data-testid="sidebar-pull-menu" style="display:none;position:absolute;top:100%;left:0;z-index:100;background:var(--surf);border:1px solid var(--bd);border-radius:6px;padding:4px;min-width:160px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-size:10px;white-space:nowrap">' +
    typeMenuItemsHTML() +
    "</div></div>" +
    "</div>"
  );
}

export function footerHTML(): string {
  return `<div class="footer">
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-sync">${t("sidebar.syncFully")} -/-</span>
  <button class="btn-base footer-btn btn-mc-dir" id="btn-mc" title="${t("sidebar.configGameDir")}">🎮 ${t("sidebar.notSet")}</button>
</div>
</div>`;
}

/** 同步菜单类型展示配置（顺序 = 渲染顺序，UX 约定保留；icon 从 JSON 派生防手写漂移——拓展点残留清单 #5） */
const SYNC_TYPE_MENU: ReadonlyArray<{ id: string; icon: string; labelKey?: string; label?: string }> = [
  { id: RESOURCE_TYPES.YSM, icon: typeIconOf(RESOURCE_TYPES.YSM), label: "YSM" },
  { id: RESOURCE_TYPES.MMD, icon: typeIconOf(RESOURCE_TYPES.MMD), label: "MMD" },
  { id: RESOURCE_TYPES.PACK, icon: typeIconOf(RESOURCE_TYPES.PACK), labelKey: "rtype.pack" },
  { id: RESOURCE_TYPES.SHADER, icon: typeIconOf(RESOURCE_TYPES.SHADER), labelKey: "rtype.shader" },
  { id: RESOURCE_TYPES.BLUEPRINT, icon: typeIconOf(RESOURCE_TYPES.BLUEPRINT), labelKey: "rtype.blueprint" },
  { id: RESOURCE_TYPES.LITEMATIC, icon: typeIconOf(RESOURCE_TYPES.LITEMATIC), labelKey: "rtype.litematic" },
];

/** 推送/拉取下拉菜单共用的资源类型选项（两组共用，防 jscpd 重复） */
function typeMenuItemsHTML(): string {
  const render = (id: string, text: string): string =>
    '<div class="dd-item" data-testid="sidebar-sync-type" data-sync-type="' +
    esc(id) +
    '" style="padding:4px 8px;cursor:pointer;border-radius:4px;color:var(--txt)">' +
    esc(text) +
    "</div>";
  let html = render("all", "📦 " + t("sidebar.allTypes"));
  // 从 ALL_RESOURCE_TYPES（注册表单一事实来源）驱动生成：
  // 已配置类型按原顺序渲染，注册表新增类型无展示配置时兜底追加，避免菜单与注册表漂移
  const configured = new Set(SYNC_TYPE_MENU.map((m) => m.id));
  for (const m of SYNC_TYPE_MENU) {
    if (ALL_RESOURCE_TYPES.includes(m.id)) {
      html += render(m.id, m.icon + " " + (m.labelKey ? t(m.labelKey) : m.label ?? m.id));
    }
  }
  for (const id of ALL_RESOURCE_TYPES) {
    if (!configured.has(id)) {
      html += render(id, id);
    }
  }
  return html;
}

export function listContainerHTML(): string {
  return `<div class="list" id="sidebar-instance-list">${skeletonHTML()}</div>`;
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

/** 无模组徽章的模组名（≠资源类型短标签）：
 *  MMD 组下 PMX 模型/场景模型/动画/表情/舞台/着色器共用 MMD Skin 模组，
 *  缺失时统一提示「无MMD」，避免把「场景模型」这类资源类型名误当模组名（语义塌陷）。
 *  ADR-111：VRM 已合并进 EntityPlayer 的 variants，不再需要特殊处理 */
function noModLabelOf(rtype: string): string {
  if (GROUP_OF[rtype] === "mmd") {
    return shortLabelOf(RESOURCE_TYPES.MMD);
  }
  return shortLabelOf(rtype) || rtype;
}

/** 单个整合包卡片头部。
 *  idx 用于绑定安装缺失按钮的 data-idx */
export function instanceCardHeaderHTML(
  name: string,
  synced: number,
  missing: number,
  extra: number,
  status: string,
  idx = -1,
  hasMod = true,
  rtype = RESOURCE_TYPES.YSM,
): string {
  const allZero = synced === 0 && missing === 0 && extra === 0;
  const chips =
    (synced > 0 ? `<span class="tag green" data-role="synced-count">${synced}</span> ` : "") +
    (missing > 0 && hasMod ? `<span class="tag red" data-role="missing-count">${missing}</span> ` : "") +
    (extra > 0 ? `<span class="tag orange" data-role="extra-count">${extra}</span>` : "") +
    (!hasMod
      ? `<span class="tag gray" data-role="no-mods">${t("sidebar.noMods", { type: noModLabelOf(rtype) })}</span>`
      : allZero
        ? `<span class="tag" data-role="all-synced">0</span>`
        : "");
  return `<div class="instance-card-header">
<div class="card-name-row"><span class="name">${esc(name)}</span></div>
<div class="card-status-row"><input type="checkbox" class="chk" data-testid="sidebar-check" data-idx="${idx}"><span class="pkg-icon" aria-hidden="true">📦</span><span class="instance-card-pkg-count">${chips}</span></div>
</div>`;
}
