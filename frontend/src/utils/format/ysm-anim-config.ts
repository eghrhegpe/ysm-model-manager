// ===== YSM 动画分组 / 配置菜单提取（前端镜像 Go appendAnimGroupsAndConfigs）=====
// 加密 .ysm 经 WASM 解码后，ysm.json 的 properties 已可读，但 wasm.ts 原仅取
// files / default_texture / authors。本模块把「其他动画 / 模型配置 / 自定义表情」
// 两块信息从 properties 抽出，供详情卡（summaryCardHTML）渲染。
//
// 逻辑与 Go 端 summary.go:appendAnimGroupsAndConfigs 保持对齐：
//  - 分类组 extra_animation_classify：组名取自本身 name，为空时按 #id 回查 extra_animation
//  - 组内项目：取 extra_animation 中非 # 开头的中文名；整组皆内部引用则跳过
//  - 松散动画兜底：未被任何分类组引用、且非 # 内部引用的顶层动画 → 归并到「其他动画」组
//  - 配置菜单 extra_animation_buttons：每个按钮即一个配置项（仅取 name/id）
import type { SummaryAnimGroup, SummaryConfigMenu } from "./summarize.ts";

/** WASM 解码产物 ysm.json 的 properties 相关字段（仅取本模块需要的部分） */
export interface YsmProperties {
  extra_animation?: Record<string, unknown> | null;
  extra_animation_classify?: Array<{
    id?: string;
    name?: string;
    extra_animation?: Record<string, unknown> | null;
  }> | null;
  extra_animation_buttons?: Array<{
    id?: string;
    name?: string;
    config_forms?: unknown;
  }> | null;
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * 从 ysm.json properties 提取动画分组与配置菜单。
 * 返回空数组表示无可用信息（调用方据此跳过渲染）。
 */
export function extractAnimGroupsAndConfigs(
  p?: YsmProperties | null,
): { animGroups: SummaryAnimGroup[]; configMenus: SummaryConfigMenu[] } {
  const animGroups: SummaryAnimGroup[] = [];
  const configMenus: SummaryConfigMenu[] = [];
  if (!p) return { animGroups, configMenus };

  const extraAnim = p.extra_animation ?? {};
  const hasOwn = (o: unknown): o is Record<string, unknown> =>
    !!o && typeof o === "object";

  // 1) 分类组：extra_animation_classify
  for (const g of p.extra_animation_classify ?? []) {
    let name = g.name ?? "";
    if (!name && g.id) {
      const v = asStr(extraAnim["#" + g.id]);
      if (v) name = v;
    }
    const items: string[] = [];
    const ea = hasOwn(g.extra_animation) ? g.extra_animation : {};
    for (const k of Object.keys(ea)) {
      const dv = asStr(ea[k]);
      // 跳过内部引用（# 开头的值），只留中文展示名
      if (dv && !dv.startsWith("#")) items.push(dv);
    }
    // 整组都是内部引用时跳过整个组（与 Go 行为一致）
    if (items.length > 0) animGroups.push({ name, items, ...(g.id != null ? { id: g.id } : {}) });
  }

  // 2) 松散动画兜底：未被任何分类组引用、且非 # 内部引用的顶层动画
  const classified = new Set<string>();
  for (const g of p.extra_animation_classify ?? []) {
    const ea = hasOwn(g.extra_animation) ? g.extra_animation : {};
    for (const k of Object.keys(ea)) classified.add(k);
  }
  const loose: string[] = [];
  for (const [k, v] of Object.entries(extraAnim)) {
    if (k.startsWith("#")) continue; // 组名跳过
    const dv = asStr(v);
    if (dv && !dv.startsWith("#") && !classified.has(k)) loose.push(dv);
  }
  if (loose.length > 0) {
    animGroups.push({ id: "_loose", name: "其他动画", items: loose });
  }

  // 3) 配置菜单：每个按钮即一个配置项
  for (const b of p.extra_animation_buttons ?? []) {
    if (b.name) configMenus.push({ name: b.name, ...(b.id != null ? { id: b.id } : {}) });
  }

  return { animGroups, configMenus };
}
