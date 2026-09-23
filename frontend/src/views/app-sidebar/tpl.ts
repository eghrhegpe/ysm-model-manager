// ===== sidebar HTML 模板 =====

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { shortLabelOf } from "@/utils/resource/short-label.ts";
import {
  ALL_RESOURCE_TYPES,
  GROUP_OF,
  RESOURCE_TYPES,
  typeIconOf,
} from "@/utils/resource/types.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
export const VIEW_TESTIDS: readonly string[] = [
  "sidebar-push",
  "sidebar-pull",
  "sidebar-select-all",
  "sidebar-check",
  "sidebar-sync-type",
  // ADR-133 阶段 C+：下拉容器原仅有 #id，e2e 靠 getElementById 绕过契约；补同名 testid 收口
  "sidebar-push-menu",
  "sidebar-pull-menu",
];

export function headerHTML(): string {
  return (
    '<div style="padding:var(--sp-vh-cell);display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:var(--fs-xs);color:var(--muted);flex:1">' +
    '<input type="checkbox" id="sb-select-all" data-testid="sidebar-select-all" style="cursor:pointer"> ' +
    t("common.selectAll") +
    "</label>" +
    syncDropdownHTML({
      icon: UI_ICONS.upload,
      label: t("sidebar.pushSelected"),
      theme: "accent",
    }) +
    syncDropdownHTML({
      icon: UI_ICONS.download,
      label: t("sidebar.pullSelected"),
      theme: "sm-optional",
    }) +
    "</div>"
  );
}

export function footerHTML(): string {
  return `<div class="footer">
<div class="footer-stats" id="footer-stats">
  <span class="stat-item" id="stat-sync">${t("sidebar.syncFully")} -/-</span>
  <button class="btn-base footer-btn btn-mc-dir" id="btn-mc" title="${t("sidebar.configGameDir")}">${UI_ICONS.game} ${t("sidebar.notSet")}</button>
</div>
</div>`;
}

/** 同步菜单类型展示配置（顺序 = 渲染顺序，UX 约定保留；icon 从 JSON 派生防手写漂移——拓展点残留清单 #5） */
const SYNC_TYPE_MENU: ReadonlyArray<{
  id: string;
  icon: string;
  labelKey?: LocaleKey;
  label?: string;
}> = [
  { id: RESOURCE_TYPES.YSM, icon: typeIconOf(RESOURCE_TYPES.YSM), label: "YSM" },
  { id: RESOURCE_TYPES.MMD, icon: typeIconOf(RESOURCE_TYPES.MMD), label: "MMD" },
  { id: RESOURCE_TYPES.PACK, icon: typeIconOf(RESOURCE_TYPES.PACK), labelKey: "rtype.pack" },
  { id: RESOURCE_TYPES.SHADER, icon: typeIconOf(RESOURCE_TYPES.SHADER), labelKey: "rtype.shader" },
  {
    id: RESOURCE_TYPES.BLUEPRINT,
    icon: typeIconOf(RESOURCE_TYPES.BLUEPRINT),
    labelKey: "rtype.blueprint",
  },
  {
    id: RESOURCE_TYPES.LITEMATIC,
    icon: typeIconOf(RESOURCE_TYPES.LITEMATIC),
    labelKey: "rtype.litematic",
  },
];

/** 推送/拉取下拉容器（dd-wrap + 触发按钮 + dd-menu）。参数化按钮图标/文案/主题色。
 * 收敛 headerHTML 里两处手写重复；菜单项由 typeMenuItemsHTML() 统一生成（SYNC_TYPE_MENU 驱动）。
 * 触发按钮与菜单容器 testid 按 theme 派生为固定字面量，保证 test_testid_contract 静态扫描可命中
 *（动态插值 testid 会被契约自然排除）。 */
interface SyncDropdownOpts {
  icon: string;
  label: string;
  /** CSS 变量名（不含 `--` 前缀）：accent / sm-optional，切按钮边框/文字主题色；
     同时决定派生 testid：accent→push，sm-optional→pull */
  theme: "accent" | "sm-optional";
}
function syncDropdownHTML(o: SyncDropdownOpts): string {
  const theme = `var(--${o.theme})`;
  const verb = o.theme === "accent" ? "push" : "pull";
  const cls = `sidebar-${verb}-selected`;
  // testid 必须保持**字面量**（非插值）：侧栏的 push/pull testid 声明于 VIEW_TESTIDS
  //（ADR-133 阶段 B 注册表），test_testid_contract 静态扫描 `data-testid="sidebar-..."`
  // 字面量才能命中——插值/模板变量会让契约 MISSING（动态派生才允许从注册表排除，
  // 而 push/pull 是固定两枚，应保留登记保护）。故直接写字面量，不用 `${verb}` 拼。
  const btnTestid =
    o.theme === "accent" ? 'data-testid="sidebar-push"' : 'data-testid="sidebar-pull"';
  const menuAttrs =
    o.theme === "accent"
      ? 'id="sidebar-push-menu" data-testid="sidebar-push-menu"'
      : 'id="sidebar-pull-menu" data-testid="sidebar-pull-menu"';
  return (
    // dd-wrap / dd-menu 外观由共享 dropdownBaseCSS 承载（sidebar-css.ts 注入 + 局部覆盖），不再内联
    '<div class="dd-wrap">' +
    `<button class="${cls}" ${btnTestid} style="padding:var(--btn-padding-tool-lg);border-radius:var(--radius-sm);border:1px solid ${theme};background:transparent;color:${theme};cursor:pointer;font-size:var(--fs-btn-tool);font-family:inherit">` +
    o.icon +
    " " +
    o.label +
    "</button>" +
    `<div class="dd-menu" ${menuAttrs}>` +
    typeMenuItemsHTML() +
    "</div></div>"
  );
}

/** 推送/拉取下拉菜单共用的资源类型选项（两组共用，防 jscpd 重复） */
function typeMenuItemsHTML(): string {
  // 图标为内部可信 SVG（UI_ICONS / 注册表派生 typeIconOf），不转义；
  // 文本（locale / 类型 id）走 esc 防注入。拆分两参避免把 SVG 转义成纯文本。
  const render = (id: string, icon: string, text: string): string =>
    '<div class="dd-item" data-testid="sidebar-sync-type" data-sync-type="' +
    esc(id) +
    '">' +
    icon +
    " " +
    esc(text) +
    "</div>";
  let html = render("all", UI_ICONS.package, t("sidebar.allTypes"));
  // 从 ALL_RESOURCE_TYPES（注册表单一事实来源）驱动生成：
  // 已配置类型按原顺序渲染，注册表新增类型无展示配置时兜底追加，避免菜单与注册表漂移
  const configured = new Set(SYNC_TYPE_MENU.map((m) => m.id));
  for (const m of SYNC_TYPE_MENU) {
    if (ALL_RESOURCE_TYPES.includes(m.id)) {
      html += render(m.id, m.icon, m.labelKey ? t(m.labelKey) : (m.label ?? m.id));
    }
  }
  for (const id of ALL_RESOURCE_TYPES) {
    if (!configured.has(id)) {
      // 兜底项同样携带图标（typeIconOf）与可读短标签（shortLabelOf），不再裸显 id
      html += render(id, typeIconOf(id), shortLabelOf(id));
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
  _status: string,
  idx = -1,
  hasMod = true,
  rtype = RESOURCE_TYPES.YSM,
): string {
  const allZero = synced === 0 && missing === 0 && extra === 0;
  const chips =
    (synced > 0 ? `<span class="tag green" data-role="synced-count">${synced}</span> ` : "") +
    (missing > 0 && hasMod
      ? `<span class="tag red" data-role="missing-count">${missing}</span> `
      : "") +
    (extra > 0 ? `<span class="tag orange" data-role="extra-count">${extra}</span>` : "") +
    (!hasMod
      ? `<span class="tag gray" data-role="no-mods">${t("sidebar.noMods", { type: noModLabelOf(rtype) })}</span>`
      : allZero
        ? `<span class="tag" data-role="all-synced">0</span>`
        : "");
  return `<div class="instance-card-header">
<div class="card-name-row"><span class="name">${esc(name)}</span></div>
<div class="card-status-row"><input type="checkbox" class="chk" data-testid="sidebar-check" data-idx="${idx}" aria-label="${esc(name)}"><span class="pkg-icon" aria-hidden="true">${UI_ICONS.package}</span><span class="instance-card-pkg-count">${chips}</span></div>
</div>`;
}
