// ===== sidebar HTML 模板 =====

import { type LocaleKey, t } from "@/core/i18n/t.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { shortLabelOf } from "@/utils/resource/short-label.ts";
import {
  ALL_RESOURCE_TYPES,
  GROUP_META,
  GROUP_OF,
  RESOURCE_TYPES,
  typeIconOf,
} from "@/utils/resource/types.ts";
import { SYNC_TYPE_ALL } from "./data.ts";

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
  // ADR-298 D3：菜单项为 div（非原生 button），必须显式声明 role=menuitem + tabindex=-1
  // ——否则控制器 itemEls() 选得到却聚焦不到，键盘导航与读屏全部失效。
  const render = (id: string, icon: string, text: string): string =>
    '<div class="dd-item" role="menuitem" tabindex="-1" data-testid="sidebar-sync-type" data-sync-type="' +
    esc(id) +
    '">' +
    icon +
    " " +
    esc(text) +
    "</div>";

  // P2-3：按注册表 group 分组，组标题带 groupIcon + groupLabel（零新文案，复用注册表字段）。
  // role=presentation 使读屏与键盘导航（dropdown.ts itemSelector）跳过分隔符。
  const groupSep = (groupId: string): string => {
    const meta = GROUP_META[groupId];
    if (!meta) return "";
    return `<div class="dd-group-sep" role="presentation">${meta.icon} ${esc(meta.name)}</div>`;
  };

  let html = render(SYNC_TYPE_ALL, UI_ICONS.package, t("sidebar.allTypes"));
  let lastGroup = "";
  const emit = (id: string, icon: string, text: string): void => {
    const group = GROUP_OF[id] || "";
    if (group && group !== lastGroup) {
      html += groupSep(group);
      lastGroup = group;
    }
    html += render(id, icon, text);
  };

  // 从 ALL_RESOURCE_TYPES（注册表单一事实来源）驱动生成：
  // 已配置类型按原顺序渲染，注册表新增类型无展示配置时兜底追加，避免菜单与注册表漂移
  const configured = new Set(SYNC_TYPE_MENU.map((m) => m.id));
  for (const m of SYNC_TYPE_MENU) {
    if (ALL_RESOURCE_TYPES.includes(m.id)) {
      emit(m.id, m.icon, m.labelKey ? t(m.labelKey) : (m.label ?? m.id));
    }
  }
  for (const id of ALL_RESOURCE_TYPES) {
    if (!configured.has(id)) {
      // 兜底项同样携带图标（typeIconOf）与可读短标签（shortLabelOf），不再裸显 id
      emit(id, typeIconOf(id), shortLabelOf(id));
    }
  }
  return html;
}

export function listContainerHTML(): string {
  // ADR-308 D2：结构角色在消费端声明（listbox）；交互态（roving tabindex/aria-selected）
  // 归 bindRoving 原语管（utils/dom/bind-roving.ts），模板不碰交互状态
  return `<div class="list" id="sidebar-instance-list" role="listbox" aria-label="${esc(
    t("sidebar.instanceList"),
  )}">${skeletonHTML()}</div>`;
}

/** 同步变更明细浮层容器（2026-10-15 UX 补）：独立于 .list，挂在 sidebar shadow 根下，
 *  push/pull 完成后由 sync-flow 注入内容并显示；默认 hidden，重渲染（index.ts innerHTML
 *  重建）后自动复位为隐藏态（容器本身被重建，内容需由调用方重新触发）。 */
export function syncResultPanelHTML(): string {
  return `<div class="sync-result" id="sync-result-panel" role="dialog" aria-modal="false" aria-label="${esc(
    t("sidebar.syncResultTitle"),
  )}" hidden></div>`;
}

/** 浮层内容渲染：成功/失败/覆盖三类明细逐条点名（量大时前端截断防过长）。
 *  verb 决定标题措辞（push=推送 / pull=拉取）；data 字段见 sync-flow.ts|SyncResultData。 */
export interface SyncResultData {
  verb: "push" | "pull";
  okCount: number;
  failCount: number;
  /** 成功明细（push=各包 ok 汇总文本；pull=拉回的文件相对路径清单） */
  okFiles: string[];
  /** 失败明细（push=错误缘由；pull=首个错误原因） */
  failLines: string[];
  /** 覆盖明细（仅 push：被覆盖的实例侧手改副本路径） */
  overwriteLines: string[];
  /** 文本型异常（skipped/blocked/timeout 等无法逐文件点名的归类） */
  notices: string[];
}

/** 浮层单项行（带语义色标：ok 绿 / fail 红 / overwrite 橙 / notice 灰） */
function syncResultRow(kind: "ok" | "fail" | "overwrite" | "notice", text: string): string {
  return `<li class="sr-row sr-${kind}"><span class="sr-dot" aria-hidden="true"></span><span class="sr-text">${esc(
    text,
  )}</span></li>`;
}

const SYNC_RESULT_MAX_FILES = 100;

export function syncResultContentHTML(data: SyncResultData): string {
  const titleKey = data.verb === "push" ? "sidebar.syncResultPush" : "sidebar.syncResultPull";
  const rows: string[] = [];
  for (const f of data.okFiles.slice(0, SYNC_RESULT_MAX_FILES)) rows.push(syncResultRow("ok", f));
  for (const f of data.failLines.slice(0, SYNC_RESULT_MAX_FILES))
    rows.push(syncResultRow("fail", f));
  for (const f of data.overwriteLines.slice(0, SYNC_RESULT_MAX_FILES))
    rows.push(syncResultRow("overwrite", f));
  for (const n of data.notices) rows.push(syncResultRow("notice", n));
  const listedTotal = data.okFiles.length + data.failLines.length + data.overwriteLines.length;
  const omitted = listedTotal - rows.length;
  const more =
    omitted > 0
      ? `<li class="sr-row sr-more">${esc(t("import.moreSuffix"))}（${omitted}）</li>`
      : "";
  const summary = t(titleKey, { ok: data.okCount, fail: data.failCount });
  return (
    `<div class="sr-head"><span class="sr-title">${esc(summary)}</span>` +
    `<button class="btn-base sr-close" data-sync-result-close aria-label="${esc(
      t("common.close"),
    )}">${UI_ICONS.close}</button></div>` +
    `<ul class="sr-list">${rows.join("")}${more}</ul>`
  );
}

/** 空列表态：无匹配整合包 + 就地配置入口（自动搜索 / HMCL·PCL 检测）。
 *  配置入口原在设置页，2026-10 搬家至此——用户在哪遇到问题就在哪解决。
 *  注意 role 不在此声明：调用方按状态摘/挂 listbox role（本态非 option 列表）。 */
export function emptyInstanceStateHTML(): string {
  return `<div class="ws-empty" style="padding:var(--sp-5);text-align:center">${UI_ICONS.inboxEmpty} ${t(
    "sidebar.noMatchInstances",
  )}
<div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
<button class="btn-base sm" data-sidebar-mc-search>${UI_ICONS.search} ${t("settings.paths.autoSearch")}</button>
<button class="btn-base sm" data-sidebar-launcher-detect>${UI_ICONS.game} HMCL / PCL</button>
</div>
</div>`;
}

/** 加载失败态：与空态**分流**（读取失败≠没装整合包，混用会误导用户去查不存在的配置问题）。
 *  role=alert + 重试入口；重试监听由调用方自挂自摘（首帧即失败时 bindCardEvents 尚未绑定，
 *  不能依赖列表事件委托）——模板不绑事件，与 footerHTML / listContainerHTML 同形。 */
export function loadErrorStateHTML(): string {
  return `<div class="ws-empty" style="padding:var(--sp-5);text-align:center" role="alert">
${UI_ICONS.error} ${t("sidebar.loadFailed")}
<div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
<button class="btn-base sm" data-sidebar-retry>${UI_ICONS.refresh} ${t("common.refresh")}</button>
</div>
</div>`;
}

/** 加载骨架屏 */
/** 加载骨架屏（内部被 listContainerHTML 引用，无需导出）。
 *  aria-hidden：装饰性占位不是 option，不进 listbox 的 accessibility 结构（读屏跳过） */
function skeletonHTML(): string {
  let h = "";
  for (let i = 0; i < 4; i++) {
    h += `<div class="sk-item" aria-hidden="true">
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

/** 单个整合包卡片头的入参。
 *  收成对象而非 7 个位置参数（2026-10-14，`check-params` 参数闸 7≥6 报警）：
 *  位置参数是「陪跑参数」温床——本函数已删过一个零消费的 `_status`（第 5 位），
 *  因为按位置传参时「多一个少一个」不会被类型系统指出，全靠人核对调用点。
 *  对象入参让每个字段自带名，且调用点即文档。 */
export interface InstanceCardHeaderData {
  name: string;
  synced: number;
  missing: number;
  extra: number;
  /** 已禁用（.ban）单元数。2026-10 锐评 P0-1：Go 侧 foldUnit 独立分桶（绝不进 synced），
   *  侧栏此前弃用该维度——全禁用整合包漏显「完全同步 ✓」。灰标显形，零新增 i18n。 */
  disabled?: number;
  idx?: number;
  hasMod?: boolean;
  rtype?: string;
}

/** 单个整合包卡片头部。
 *  `idx` 用于绑定安装缺失按钮的 data-idx（缺省 -1）。
 *  ⚠️ 原第 5 位 `_status` 陪跑参数已删（2026-10 锐评收口：函数体零消费——徽章展示
 *  全由三计数 + hasMod 驱动；该参数只是调用方按 loader 派生字段顺位递进来的「陪跑」）。 */
export function instanceCardHeaderHTML(d: InstanceCardHeaderData): string {
  const { name, synced, missing, extra } = d;
  const disabled = d.disabled ?? 0;
  const idx = d.idx ?? -1;
  const hasMod = d.hasMod ?? true;
  const rtype = d.rtype ?? RESOURCE_TYPES.YSM;
  // 2026-10 锐评 P2-5：原 allZero（含 synced===0）把「该类型下无任何资源」也标成「完全同步 ✓」——
  // 空包不是「已同步」而是「无内容」。改为 synced>0 且无差异且无禁用（有内容且全部已同步）才显 ✓；
  // 全零空包不再显任何状态徽章（诚实留白，优于误导性的 ✓）。
  const fullySynced = synced > 0 && missing === 0 && extra === 0 && disabled === 0;
  // 徽章补 title 语义锚点（颜色码不自解释——绿/红/橙三色图例此前只存在于文档）：
  // 文案复用同步面板既有 key（已同步/待推送/可拉取），零新增 i18n；侧栏 extra 的
  // 用户操作即「拉取」，与面板 optional（可拉取）语义吻合。裸 `0` 改 success SVG + 完全同步
  // title——「0 什么？」不再需要猜（emoji 字形 ✓ 被设计令牌闸拦，走 utils/icon SVG 体系）。
  const chips =
    (synced > 0
      ? `<span class="tag green" data-role="synced-count" title="${t("syncManager.status.synced")}">${synced}</span> `
      : "") +
    (missing > 0 && hasMod
      ? `<span class="tag red" data-role="missing-count" title="${t("syncManager.status.missing")}">${missing}</span> `
      : "") +
    (extra > 0
      ? `<span class="tag orange" data-role="extra-count" title="${t("syncManager.status.optional")}">${extra}</span> `
      : "") +
    // 2026-10 锐评 P0-1：disabled 灰标显形（此前侧栏弃用该维度，全禁用包漏显「完全同步 ✓」）。
    // 与 Go foldUnit 同源——禁用单元独立分桶、绝不计入 synced；title 复用面板既有 key，零新增 i18n。
    (disabled > 0
      ? `<span class="tag gray" data-role="disabled-count" title="${t("syncManager.status.disabled")}">${disabled}</span> `
      : "") +
    (!hasMod
      ? `<span class="tag gray" data-role="no-mods">${t("sidebar.noMods", { type: noModLabelOf(rtype) })}</span>`
      : fullySynced
        ? `<span class="tag" data-role="all-synced" title="${t("sidebar.syncFully")}">${UI_ICONS.success}</span>`
        : "");
  return `<div class="instance-card-header">
<div class="card-name-row"><span class="name">${esc(name)}</span></div>
<div class="card-status-row"><input type="checkbox" class="chk" data-testid="sidebar-check" data-idx="${idx}" aria-label="${esc(name)}"><span class="pkg-icon" aria-hidden="true">${UI_ICONS.package}</span><span class="instance-card-pkg-count">${chips}</span></div>
</div>`;
}
