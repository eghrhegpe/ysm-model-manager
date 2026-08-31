// ===== 3D 内模型切换面板（自 preview-menu.ts 抽出，ADR-076 v3 拆分收尾）=====
// 各资源类型 tab 懒加载候选，当前项高亮。默认高亮优先级：
// ① 用户手动记忆的类型（localStorage）② 当前模型自身类型（getCurrentRtype）③ 第一个类型 tab。
// 「当前目录」tab 已移除（记忆/当前类型生效后可少一个 tab）；
// rtypes 为空（无注册路由）时仍走 siblings 列表兜底，不空白。

import { RESOURCE_TYPE_LABELS, resolveTypeSafe, getPreviewableTypeTabs } from "../../utils/resource/types.ts";
import { attachTooltip } from "../../utils/dom/tooltip.ts";
import { swallowError } from "../../utils/core/async.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewMenuCtx } from "./core.ts";

/** i18n 安全取值：键缺失时回退，杜绝菜单项退化显示原始键名 */
const tr = (key: string, fallback: string): string => {
  const v = t(key);
  return v === key ? fallback : v;
};

/** 上次选中的类型 tab 持久化键（全局记忆，跨模型/跨会话）："" = 当前目录 */
const PREVIEW_LAST_RTYPE_KEY = "ysm.preview.lastRtype";

// ===================================================================
// fillSwitch — 子函数（原 3 闭包升格：mkTab / draw / renderRows）
// ===================================================================

/** ADR-111：tab 标签统一从 getPreviewableTypeTabs 派生，preview key 兜底 RESOURCE_TYPE_LABELS */
function switchTabLabelOf(key: string): string {
  const hit = getPreviewableTypeTabs().find((t) => t.key === key);
  return hit?.label ?? RESOURCE_TYPE_LABELS[key] ?? key;
}

/** 路径归一化：统一正斜杠 + 小写（跨平台分隔符比较一致，P2-5） */
function switchNormPath(s: string): string {
  return s.replace(/\\/g, "/").toLowerCase();
}

/** [子函数 1/6] 解析默认高亮 tab：手动记忆 → 当前模型类型 → 首项；兜底 ""（siblings） */
function resolveSwitchActiveTab(rtypes: string[], curRtype: string): string {
  const remembered = safeGet(PREVIEW_LAST_RTYPE_KEY);
  if (remembered !== null && rtypes.includes(remembered)) return remembered;
  if (curRtype && rtypes.includes(curRtype)) return curRtype;
  return rtypes[0] ?? "";
}

/**
 * [子函数 2/6] 构建 tabBar 容器并返回更新句柄。
 *   mkTab 闭包升格为包级函数；点击时透传 onSwitchTab 回调刷新 activeTab + 高亮 + 重渲染。
 */
function buildSwitchTabBar(
  rtypes: string[],
  initialActive: string,
  onSwitchTab: (key: string) => void,
): HTMLElement {
  const tabBar = document.createElement("div");
  tabBar.style.cssText =
    "display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.12);flex-wrap:wrap;flex-shrink:0";
  tabBar.dataset.testid = "preview-switch-tabs";
  const highlightTab = (key: string): void => {
    for (const tb of Array.from(tabBar.children)) {
      (tb as HTMLElement).style.background =
        (tb as HTMLElement).dataset.rtype === key ? "rgba(124,131,255,0.35)" : "transparent";
    }
  };
  for (const r of rtypes) {
    const b = document.createElement("button");
    b.dataset.testid = "preview-switch-tab";
    b.dataset.rtype = r;
    b.textContent = switchTabLabelOf(r);
    b.style.cssText =
      "font-size:12px;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:rgba(255,255,255,0.7);background:transparent" +
      (r === initialActive ? ";background:rgba(124,131,255,0.35);color:#fff" : "");
    b.onclick = (): void => {
      // 持久化选中类型（「当前目录」空串不持久化——临时视图）
      if (r !== "") safeSet(PREVIEW_LAST_RTYPE_KEY, r);
      highlightTab(r);
      onSwitchTab(r);
    };
    tabBar.appendChild(b);
  }
  return tabBar;
}

/**
 * [子函数 3/6] sameType 同源判定。
 *   sameType 仅用于行点击路由：同源 → switchTo 复用外壳替换，跨源 → switchExternal。
 *   类型判定：类型 tab 按 activeTab；当前目录 tab 按候选实际类型（resolveTypeSafe 解析）。
 *   候选类型无法可靠识别（歧义扩展名，resolveTypeSafe 返回 null）时保守判「不同源」。
 */
function switchSameTypeOf(
  viaType: boolean,
  activeTab: string,
  candType: string | null,
  curType: string,
): boolean {
  return viaType
    ? activeTab === curType || (curType === "" && activeTab === candType)
    : !!candType && (candType === curType || curType === "");
}

/**
 * [子函数 4/6] 执行点击行的替换/追加语义（原两段 10+ 行重复 inline onclick）。
 *   keepInScene=true→追加；false→替换。失败已由 mount 层 catch(logWarn) 记录，此处吞 unhandled rejection。
 */
function applySwitchRowClick(
  p: string,
  sameType: boolean,
  ctx: PreviewMenuCtx,
  keepInScene: boolean,
): void {
  // 追加语义才带 opts；替换语义保持旧签名形态（不传第二/三参），调用方契约按参数个数区分
  const extra: [{ keepInScene?: boolean }?] = keepInScene ? [{ keepInScene: true }] : [];
  const r = !sameType && ctx.switchExternal
    ? ctx.switchExternal(p, ctx.getSiblings(), ...extra)
    : ctx.switchTo(p, ...extra);
  if (r && typeof (r as Promise<void>).then === "function") swallowError(r as Promise<void>);
}

/** [子函数 5/6] 绘制单条候选行：图标 / 标签 / ➕追加按钮 / 替换行点击。 */
function renderSwitchCandidateRow(
  listBody: HTMLElement,
  p: string,
  ctx: PreviewMenuCtx,
  curNorm: string,
  activeTab: string,
  viaType: boolean,
): void {
  const isCur = switchNormPath(p) === curNorm;
  const candType = resolveTypeSafe(p);
  const curType = ctx.getCurrentRtype?.() ?? "";
  const sameType = switchSameTypeOf(viaType, activeTab, candType, curType);
  const row = document.createElement("div");
  row.className = "ysm-preview-menu-row";
  row.dataset.testid = "preview-switch-item";
  row.style.cssText =
    "display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px" +
    (isCur ? ";background:rgba(124,131,255,0.25)" : "");
  const ic = document.createElement("span");
  ic.textContent = isCur ? "✓" : "📦";
  ic.style.cssText = "font-size:15px;width:18px;text-align:center";
  const lb = document.createElement("span");
  lb.textContent = p.split(/[/\\]/).pop() || p;
  row.append(ic, lb);
  if (!isCur) {
    const append = document.createElement("button");
    append.dataset.testid = "preview-switch-append";
    append.textContent = "➕";
    attachTooltip(append, () => tr("preview.appendModel", "追加到场景"));
    append.style.cssText =
      "width:22px;height:22px;flex-shrink:0;background:rgba(255,255,255,0.08);border:none;border-radius:4px;cursor:pointer;font-size:12px;line-height:1;margin-left:auto";
    append.onclick = (ev): void => {
      ev.stopPropagation();
      applySwitchRowClick(p, sameType, ctx, true);
    };
    row.appendChild(append);
  }
  row.onclick = (): void => {
    applySwitchRowClick(p, sameType, ctx, false);
  };
  listBody.appendChild(row);
}

/** [子函数 6/6] renderRows：代际守卫 + 异步扫描 + 空态 + 候选列表绘制。 */
function runSwitchRenderRows(
  listBody: HTMLElement,
  ctx: PreviewMenuCtx,
  getActiveTab: () => string,
  reqGen: { v: number },
): void {
  const gen = ++reqGen.v;
  listBody.innerHTML = "";
  const curNorm = switchNormPath(ctx.getCurrentPath());

  const draw = (paths: string[], viaType: boolean): void => {
    // 类型 tab 过滤当前项（siblings 分支已由 getSiblings 去当前项）
    const shown = viaType ? paths.filter((p) => switchNormPath(p) !== curNorm) : paths;
    if (shown.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:8px 10px;color:rgba(255,255,255,0.5);font-size:12px";
      empty.textContent = viaType
        ? tr("preview.noTypeModel", "（该类型暂无模型）")
        : tr("preview.noOtherModel", "（无其他模型）");
      listBody.appendChild(empty);
      return;
    }
    const activeTab = getActiveTab();
    for (const p of shown) {
      renderSwitchCandidateRow(listBody, p, ctx, curNorm, activeTab, viaType);
    }
  };

  const activeTab = getActiveTab();
  if (activeTab === "") {
    draw(ctx.getSiblings(), false);
    return;
  }
  void Promise.resolve(
    ctx.getModelsByType?.(activeTab, ctx.getCurrentSubtype?.()) ?? Promise.resolve([]),
  )
    .then((paths) => {
      if (gen !== reqGen.v) return; // 过期请求丢弃（P1-3）
      if (!listBody.parentNode) return; // 面板已关闭
      draw(paths ?? [], true);
    })
    .catch(() => {
      // P3-3：扫描失败优雅降级为空列表
      if (gen !== reqGen.v) return;
      if (!listBody.parentNode) return;
      draw([], true);
    });
}

// ===================================================================
// fillSwitch — 主函数
// ===================================================================

export function fillSwitch(list: HTMLElement, ctx: PreviewMenuCtx): void {
  const rtypes = ctx.getTypeTabs?.() ?? [];
  const curRtype = ctx.getCurrentRtype?.() ?? "";
  // 阶段 1：默认高亮 tab 解析（记忆 → 当前类型 → 首项）
  let activeTab = resolveSwitchActiveTab(rtypes, curRtype);
  // 阶段 2：tabBar + 高亮更新回写
  const tabBar = buildSwitchTabBar(rtypes, activeTab, (key) => {
    activeTab = key;
    // runSwitchRenderRows 内部读 reqGen，直接触发重新拉取+绘制
    runSwitchRenderRows(listBody, ctx, () => activeTab, reqGen);
  });
  // 阶段 3：列表容器 + 代际守卫 state
  const listBody = document.createElement("div");
  listBody.style.cssText = "max-height:240px;overflow-y:auto";
  const reqGen = { v: 0 };
  // 阶段 4：挂 DOM + 首调 renderRows
  list.append(tabBar, listBody);
  runSwitchRenderRows(listBody, ctx, () => activeTab, reqGen);
}
