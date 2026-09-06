// ===== 3D 内模型切换段（ADR-193 第四刀：声明式构建器，fillSwitch DOM 层退役）=====
// 原 fillSwitch（tabBar DOM + renderRows 异步绘制）改写为 buildSwitchNodes：
// 类型 tab = 声明式 select 节点；候选 = row 节点（action 替换 / badge ➕ 追加）。
// 异步候选（getModelsByType）走「数据就绪后 cache + menu.refresh」范式
//（对齐 litematic per-scene registerSchema 精神：builder 同步、数据异步到位后重渲染）。
// 状态（activeTab + 候选缓存）由 makeSwitchState 创建、buildPreviewMenuRouters 持有
//（mount 级一次），builder 每次渲染重跑时读写同一 state——旧闭包 let activeTab 语义平移。

import { tr } from "../../core/i18n/tr.ts";
import type { SlideMenuHandle } from "../../ui/ui-slide-menu.ts";
import { swallowError } from "../../utils/base/async.ts";
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import {
  getPreviewableTypeTabs,
  RESOURCE_TYPE_LABELS,
  resolveTypeSafe,
} from "../../utils/resource/types.ts";
import type { PreviewMenuCtx, PreviewMenuNode } from "./node-types.ts";

/** 上次选中的类型 tab 持久化键（全局记忆，跨模型/跨会话）："" = 当前目录 */
const PREVIEW_LAST_RTYPE_KEY = "ysm.preview.lastRtype";

/** ADR-111：tab 标签统一从 getPreviewableTypeTabs 派生，preview key 兜底 RESOURCE_TYPE_LABELS */
export function switchTabLabelOf(key: string): string {
  const hit = getPreviewableTypeTabs().find((t) => t.key === key);
  return hit?.label ?? RESOURCE_TYPE_LABELS[key] ?? key;
}

/** 路径归一化：统一正斜杠 + 小写（跨平台分隔符比较一致，P2-5） */
export function switchNormPath(s: string): string {
  return s.replace(/\\/g, "/").toLowerCase();
}

/**
 * tab 激活高亮背景（刀②收编：--accent 派生，禁回硬编码 rgba）。
 * DOM 层已随 ADR-193 第四刀退役，本函数保留为高亮口径单一源（测试直断派生不回退）。
 */
export function switchTabHighlightBg(active: boolean): string {
  return active ? "color-mix(in srgb,var(--accent) 35%,transparent)" : "transparent";
}

/** [子函数 1/6] 解析默认高亮 tab：手动记忆 → 当前模型类型 → 首项；兜底 ""（siblings） */
function resolveSwitchActiveTab(rtypes: string[], curRtype: string): string {
  const remembered = safeGet(PREVIEW_LAST_RTYPE_KEY);
  if (remembered !== null && rtypes.includes(remembered)) return remembered;
  if (curRtype && rtypes.includes(curRtype)) return curRtype;
  return rtypes[0] ?? "";
}

/** [子函数 3/6] sameType 同源判定（行点击路由：同源 → switchTo，跨源 → switchExternal）。
 *  类型判定：类型 tab 按 activeTab；当前目录 tab 按候选实际类型（resolveTypeSafe）。
 *  候选类型无法可靠识别（歧义扩展名）时保守判「不同源」。 */
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

/** [子函数 4/6] 行点击替换/追加语义。失败已由 mount 层 catch(logWarn) 记录，此处吞 unhandled rejection。 */
function applySwitchRowClick(
  p: string,
  sameType: boolean,
  ctx: PreviewMenuCtx,
  keepInScene: boolean,
): void {
  const extra: [{ keepInScene?: boolean }?] = keepInScene ? [{ keepInScene: true }] : [];
  const r =
    !sameType && ctx.switchExternal
      ? ctx.switchExternal(p, ctx.getSiblings(), ...extra)
      : ctx.switchTo(p, ...extra);
  if (r && typeof (r as Promise<void>).then === "function") swallowError(r as Promise<void>);
}

/** switch 段可变状态（mount 级一次，builder 每次渲染读写） */
export interface SwitchState {
  activeTab: string;
  /** tab → 候选路径缓存（加载完成后填；切 tab 时 delete 强制重拉，对齐旧 renderRows 每次重扫） */
  cache: Map<string, string[]>;
  inflight: Set<string>;
}

/** 创建 switch 段状态（buildPreviewMenuRouters 调一次；activeTab 解析含持久化记忆） */
export function makeSwitchState(ctx: PreviewMenuCtx): SwitchState {
  return {
    activeTab: resolveSwitchActiveTab(ctx.getTypeTabs?.() ?? [], ctx.getCurrentRtype?.() ?? ""),
    cache: new Map(),
    inflight: new Set(),
  };
}

/** 候选行构造：✓ 当前项 / ➕ 追加 badge / 整行点击替换 */
function switchCandidateRows(
  ctx: PreviewMenuCtx,
  paths: string[],
  viaType: boolean,
  activeTab: string,
): PreviewMenuNode[] {
  const curNorm = switchNormPath(ctx.getCurrentPath());
  const curType = ctx.getCurrentRtype?.() ?? "";
  const shown = viaType ? paths.filter((p) => switchNormPath(p) !== curNorm) : paths;
  if (shown.length === 0) {
    return [
      {
        id: "switch-empty",
        kind: "sectionTitle",
        labelKey: "",
        fallback: viaType
          ? tr("preview.noTypeModel", "（该类型暂无模型）")
          : tr("preview.noOtherModel", "（无其他模型）"),
      },
    ];
  }
  return shown.map((p, i) => {
    const isCur = switchNormPath(p) === curNorm;
    const candType = resolveTypeSafe(p);
    const sameType = switchSameTypeOf(viaType, activeTab, candType, curType);
    return {
      id: `switch-cand-${i}`,
      kind: "row",
      fallback: `${isCur ? "✓" : "📦"} ${p.split(/[/\\]/).pop() || p}`,
      action: () => applySwitchRowClick(p, sameType, ctx, false),
      ...(isCur
        ? {}
        : {
            badge: {
              label: "➕",
              title: tr("preview.appendModel", "追加到场景"),
              onClick: () => applySwitchRowClick(p, sameType, ctx, true),
            },
          }),
    };
  });
}

/**
 * [主函数] switch 段声明式节点（roles 面板底部加载入口）。
 * 类型分支：cache 未命中 → 发起异步扫描（inflight 去重）+ loading 占位，
 * 数据就绪 menu.refresh() 重跑 builder 读缓存；每次切 tab 强制重拉（对齐旧 renderRows）。
 */
export function buildSwitchNodes(
  ctx: PreviewMenuCtx,
  menu: SlideMenuHandle,
  st: SwitchState,
): PreviewMenuNode[] {
  const rtypes = ctx.getTypeTabs?.() ?? [];
  const nodes: PreviewMenuNode[] = [];
  if (rtypes.length > 0) {
    nodes.push({
      id: "switch-tab",
      kind: "select",
      labelKey: "preview.switchTypeTab",
      fallback: "类型",
      control: {
        options: rtypes.map((r) => ({ value: r, label: switchTabLabelOf(r) })),
        get: () => st.activeTab,
        set: (v) => {
          st.activeTab = String(v);
          if (st.activeTab) safeSet(PREVIEW_LAST_RTYPE_KEY, st.activeTab);
          st.cache.delete(st.activeTab); // 强制重拉（对齐旧「每次切 tab 重新扫描」）
          menu.refresh();
        },
      },
    });
  }
  if (st.activeTab === "") {
    nodes.push(...switchCandidateRows(ctx, ctx.getSiblings(), false, st.activeTab));
    return nodes;
  }
  if (!st.cache.has(st.activeTab)) {
    if (!st.inflight.has(st.activeTab)) {
      st.inflight.add(st.activeTab);
      void Promise.resolve(
        ctx.getModelsByType?.(st.activeTab, ctx.getCurrentSubtype?.()) ?? Promise.resolve([]),
      )
        .then((paths) => {
          st.cache.set(st.activeTab, paths ?? []);
        })
        .catch(() => {
          st.cache.set(st.activeTab, []); // P3-3：扫描失败优雅降级为空列表
        })
        .finally(() => {
          st.inflight.delete(st.activeTab);
          menu.refresh(); // 数据就绪重跑 builder 读缓存
        });
    }
    nodes.push({
      id: "switch-loading",
      kind: "sectionTitle",
      labelKey: "",
      fallback: tr("preview.loadingModels", "加载中…"),
    });
    return nodes;
  }
  nodes.push(...switchCandidateRows(ctx, st.cache.get(st.activeTab) ?? [], true, st.activeTab));
  return nodes;
}
