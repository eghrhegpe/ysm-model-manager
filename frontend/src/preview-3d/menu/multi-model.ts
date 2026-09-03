// ===== multi-model.ts — 多模型选择菜单原语（ADR-132）=====
// 跨资源类型统一的多模型 select 菜单节点工厂。
// 现状三套并存（MMD zip 手写 select / 资源包 topBar 切换 / YSM maid 状态层 select），
// 本原语收编为「声明式 select 工厂 + per-scene 会话态闭包」，任何 adapter 一行调用即得。
//
// 铁律对齐（AGENTS.md）：
// - 返回声明式 PreviewMenuNode（kind: "select"），零手写 DOM
// - 状态走 per-scene 闭包（activeId），不落全局状态层（对齐 6b080b33 Bug B 范式）
// - 单候选时不注入（entries.length < 2 → null），调用方自行跳过
//
// i18n：复用 preview.component / preview.allComponents（三语言包已就位，零新增键）。

import type { PreviewMenuNode } from "./node-types.ts";

/** 多模型选择原语入参 */
export interface MultiModelSelectOpts {
  /** 多模型候选（id = 切换目标稳定标识；label = 显示名） */
  entries: Array<{ id: string; label: string }>;
  /** 当前选中（per-scene 会话态闭包；返回 entries 中某 id，找不到时调用方回退首项） */
  activeId: () => string;
  /** 切换副作用（adapter 注入：switchTo / showModelGroup 等） */
  onSelect: (id: string) => void;
  /** i18n labelKey（缺省 preview.component） */
  labelKey?: string;
  /** i18n 缺失时回退文案（缺省「模型」） */
  fallback?: string;
  /** 稳定节点 id（缺省 "multi-model-select"） */
  nodeId?: string;
  /** [doc:adr-132] 切档后重渲染当前面板（menu.refresh()）——YSM 组件 select 切档后
   *  stats/纹理行需按新会话态重建（对齐 render.ts select 分支的 refreshOnChange 语义） */
  refreshOnChange?: boolean;
}

/**
 * 多模型选择 select 节点工厂。
 * 单候选（entries.length < 2）→ 返回 null（调用方不注入——没有「选择」语义）。
 * 返回节点：kind="select"，control.options / get / set 全部装配好，零手写 DOM。
 */
export function multiModelSelectNode(opts: MultiModelSelectOpts): PreviewMenuNode | null {
  const { entries, activeId, onSelect, labelKey = "preview.component", fallback = "模型", nodeId = "multi-model-select", refreshOnChange } = opts;
  if (entries.length < 2) return null;
  // [审核修复] 预计算合法 id 集合：get/set 判存在 O(1)，避免每次控件读写全量线性扫 entries
  const ids = new Set(entries.map((e) => e.id));
  return {
    id: nodeId,
    kind: "select",
    labelKey,
    fallback,
    control: {
      options: entries.map((e) => ({ value: e.id, label: e.label })),
      get: (): string => {
        const cur = activeId();
        return ids.has(cur) ? cur : (entries[0]?.id ?? "");
      },
      set: (v: unknown): string => {
        const id = String(v);
        if (ids.has(id)) onSelect(id);
        return id;
      },
      // [doc:adr-132] 切档后重渲染当前面板（YSM 组件 select 语义；MMD/资源包不传则保持默认）
      // refreshOnChange 为 PreviewControlSpec 可选键（node-types，非本域）——仅真实存在时附带
      ...(refreshOnChange !== undefined ? { refreshOnChange } : {}),
    },
  };
}
