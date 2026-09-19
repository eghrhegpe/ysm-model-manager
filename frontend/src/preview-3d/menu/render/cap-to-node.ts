// ===== cap-to-node.ts — ADR-195：控件定义 → MenuNode 同构映射 =====
// 目标：cap 控件单类型化（终态 3D 菜单只允许 MenuNode schema + 单渲染链
// renderMenu → renderCapControls）。
//
// 架构真相（2026-09-06 全仓实证）：渲染层早已单源——render.ts 的节点
// select/slider/toggle 经 nodeControlToCapControl 投影进 renderCapControls 渲染
// （rmAppendSelect/Slider/Toggle 已退役）。真正分裂的是**声明入口**：
//   - cap.getMenuControls(): PreviewControlDef[]（平行数组自报）
//   - PreviewMenuNode[]（节点树）
// 本文件把 cap 控件映射进节点树，让两入口合一。
//
// 映射分级：
//   - 可被原生节点 kind 无损承载（spec 与 PreviewControlDef 同构后）：
//     toggle/slider/select/divider/color → 节点 kind，control 字段承载全部
//     能力（unit/onCommit/hintKey/getValue/setValue 闭包）。
//     注：button 刻意留在 controls 通道——cap button 带 variant/disabled/getHint/
//     hintKey，节点 button 是简单动作行壳（rmAppendButton）不承载（见下方注释）。
//   - 无法纯数据化（canvas 时间轴/直方图/缩略图/HDR 图 + button）：
//     timeline/histogram/image/preset-thumb/button → controls 通道（节点树内嵌
//     PreviewControlDef 数组，仍经 renderMenu 统一调度 + renderCapControls 统一渲染）。
//     controls 通道是受控委托，不触发 renderCustom 审计门（那是「手写 DOM 逃生舱」）。
//   - group 折叠语义 → folder 节点（节点体系原生折叠，替代 .cap-section）。
//
// 生命周期：本文件是过渡映射层；刀2 逐 cap 直接产节点后，本层映射逻辑内联进
// cap 自身（旧 getMenuControls 退役），控件定义统一 PreviewControlDef。
// 本文件纯转换，零注册表依赖，可单测。

import type { PreviewControlDef } from "@/preview-3d/caps/scene-capability.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/node-types.ts";

/**
 * 该 kind 是否走原生节点（true）还是 controls 通道（false）。
 * 判据：能否被节点 kind + control spec 无损承载。
 *   - 原生：toggle/slider/select/divider/color（spec 同构后无损）。
 *   - controls 通道：button（cap button 有 variant/disabled/getHint/hintKey，节点
 *     button 是简单动作行壳 rmAppendButton 不承载——保持 cap 渲染器形态，语义上
 *     「参数操作钮」归控件）、timeline/histogram/image/preset-thumb（无法纯数据化）。
 * controls 通道是节点树内嵌 PreviewControlDef 的受控委托，仍经 renderMenu 调度 +
 * renderCapControls 渲染，不触发 renderCustom 审计门。
 * 原生名单随 spec/节点能力补齐扩展（单一事实源）。
 */
export function canNodeRepresent(c: PreviewControlDef): boolean {
  return (
    c.kind === "toggle" ||
    c.kind === "slider" ||
    c.kind === "select" ||
    c.kind === "divider" ||
    c.kind === "color"
  );
}

/**
 * 单个 PreviewControlDef → 原生控件节点。
 * 仅对 canNodeRepresent=true 的 kind 调用（toggle/slider/select/divider/color）。
 * control 字段承载 PreviewControlDef 全部能力（spec 与 PreviewControlDef 同构——
 * 见 node-types PreviewControlSpec），nodeControlToCapControl 反向纯搬运零损失。
 */
export function capControlToNode(c: PreviewControlDef): PreviewMenuNode {
  const node: PreviewMenuNode = {
    id: c.id,
    kind: c.kind as "toggle" | "slider" | "select" | "divider" | "color",
  };
  if (c.labelKey) node.labelKey = c.labelKey;
  if (c.fallback) node.label = c.fallback;
  if (c.hintKey) node.hintKey = c.hintKey;
  if (c.visibleWhen) node.visibleWhen = c.visibleWhen;
  if (c.settingsOrder !== undefined) node.settingsOrder = c.settingsOrder;

  if (c.kind === "divider") return node; // divider 无 control

  // control spec = PreviewControlDef 同构（getValue/setValue 闭包直迁）
  const spec: NonNullable<PreviewMenuNode["control"]> = {
    get: () => c.getValue(),
    set: (v) => c.setValue(v as never),
    ...(c.onChange ? { onChange: c.onChange } : {}),
  };
  if (c.kind === "slider" && c.slider) {
    spec.min = c.slider.min;
    spec.max = c.slider.max;
    spec.step = c.slider.step;
    if (c.slider.unit !== undefined) spec.unit = c.slider.unit;
    if (c.slider.numeric !== undefined) spec.numeric = c.slider.numeric;
    if (c.slider.onCommit) spec.onCommit = c.slider.onCommit;
  }
  if (c.kind === "select" && c.select) spec.options = c.select;
  node.control = spec;
  return node;
}

/**
 * PreviewControlDef[]（含 group 语义）→ PreviewMenuNode[]。
 * - 简单控件：原生节点（顶层平铺或按 group 包 folder）。
 * - 复杂控件（timeline/histogram/image/preset-thumb）：controls 节点
 *   （单控件数组，保序平铺；复杂控件 group 由外部 folder 语义处理）。
 * - group 折叠转 folder 嵌套：同 group 连续控件包 folder（节点体系折叠，替代
 *   .cap-section）。连续同组合并；组间断开另起。divider 强制断组平铺。
 */
export function capControlsToNodes(controls: PreviewControlDef[]): PreviewMenuNode[] {
  const out: PreviewMenuNode[] = [];
  let currentGroup: string | null = null;
  let folder: PreviewMenuNode | null = null;
  const flushFolder = (): void => {
    if (folder) {
      out.push(folder);
      folder = null;
    }
    currentGroup = null;
  };
  for (const c of controls) {
    const g = c.kind === "divider" ? null : (c.group ?? null); // divider 永不入组
    if (g !== currentGroup) {
      flushFolder();
      currentGroup = g;
      if (g !== null) {
        folder = {
          id: `cap-group-${c.id}`,
          kind: "folder",
          labelKey: g,
          children: [],
        };
      }
    }
    const node = canNodeRepresent(c)
      ? capControlToNode(c)
      : {
          // 复杂控件：controls 通道（节点树内嵌 PreviewControlDef 数组）
          id: `cap-${c.id}`,
          kind: "controls" as const,
          // 剥掉 group——同 group 复杂控件已被外部
          // folder 承载折叠语义，若原样保留 c.group，renderCapControls 的
          // ensureCapSection 会在 folder body 内再建同名 .cap-section 节头
          // （folder 头 + 内嵌 N 个重复节头 + 双折叠壳的可见回归，env 的
          // envGroupCustomHdr/preset/background、ground MAT_GROUP 均触发）。
          // 顶层无 group 的复杂控件不受影响，仍平铺直渲。
          controls: [c.group ? { ...c, group: undefined } : c] as PreviewControlDef[],
          ...(c.visibleWhen ? { visibleWhen: c.visibleWhen } : {}),
        };
    if (folder) {
      const kids = folder.children;
      if (kids) kids.push(node);
    } else {
      out.push(node);
    }
  }
  flushFolder();
  return out;
}
