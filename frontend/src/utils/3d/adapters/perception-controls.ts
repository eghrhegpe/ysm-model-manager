// ===== 感知层控件面板（ADR-076：底部根菜单 motion 组）=====
// [doc:adr-126-p5] 声明式化（审计 #2）：感知面板 = 纯 toggle 集合，走 A 层 renderMenu
// toggle 分支（ADR-125 §3.3 预留的「确有面板需要时再补」场景）——比 morph/play 更该先迁。
// buildPerceptionControls（89 行手写 DOM，三 adapter 复制同一份）已删除，
// perceptionNodes 是纯数据工厂（零 DOM，R1 合规）。

import type { PreviewMenuNode } from "./preview-menu/node-types.ts";

/** 感知层状态：各模块开关（adapter build 时创建，update 循环读取，面板 UI 写入） */
export interface PerceptionState {
  breath: boolean;
  gaze: boolean;
  blink: boolean;
  lipSync: boolean;
  autoDance: boolean;
}

/** 可用感知模块描述（由 adapter 按实际能力填写） */
export interface PerceptionCapability {
  id: keyof PerceptionState;
  labelKey: string;
  fallback: string;
}

/** 所有可能的感知模块（fallback 文案，i18n 缺失时使用） */
const ALL_MODULES: Array<{ id: keyof PerceptionState; labelKey: string; fallback: string }> = [
  { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
  { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
  { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
  { id: "lipSync", labelKey: "preview.perceptionLipSync", fallback: "口型" },
  { id: "autoDance", labelKey: "preview.perceptionAutoDance", fallback: "律动" },
];

/** 感知面板声明式节点（纯数据工厂零 DOM）：toggle kind 节点，
 *  control.get/set 闭包读写 adapter 内 perception state（非状态层路径，不走 bind） */
export function perceptionNodes(state: PerceptionState, caps: PerceptionCapability[]): PreviewMenuNode[] {
  // 按 ALL_MODULES 顺序排列（保证跨适配器顺序一致）
  const ordered = ALL_MODULES.filter((m) => caps.some((c) => c.id === m.id));
  if (ordered.length === 0) {
    // 空态提示（对齐旧 buildPerceptionControls 的 noPerception 行）
    return [{ id: "perception-empty", kind: "field" as const, labelKey: "preview.noPerception", fallback: "无感知模块", value: "" }];
  }
  return ordered.map((mod) => ({
    id: `perception-${mod.id}`,
    kind: "toggle" as const,
    labelKey: mod.labelKey,
    fallback: mod.fallback,
    control: {
      get: () => state[mod.id],
      set: (v: unknown) => {
        state[mod.id] = Boolean(v);
      },
    },
  }));
}
