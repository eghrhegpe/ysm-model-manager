// ===== perception-controls 感知面板测试（[doc:adr-126-p5] 声明式化：审计 #2）=====
// 覆盖：perceptionNodes（toggle 节点结构 / caps 裁剪 / 空态 / get-set 闭包读写 state）。
// 旧 buildPerceptionControls（89 行手写 DOM，三 adapter 复制）已删除——节点契约由本文件锁定。

import { describe, it, expect } from "vitest";
import { perceptionNodes, type PerceptionState, type PerceptionCapability } from "./perception-controls.ts";

const allCaps: PerceptionCapability[] = [
  { id: "breath", labelKey: "preview.perceptionBreath", fallback: "呼吸" },
  { id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" },
  { id: "blink", labelKey: "preview.perceptionBlink", fallback: "眨眼" },
  { id: "lipSync", labelKey: "preview.perceptionLipSync", fallback: "口型" },
  { id: "autoDance", labelKey: "preview.perceptionAutoDance", fallback: "律动" },
];

const offState = (): PerceptionState => ({ breath: false, gaze: false, blink: false, lipSync: false, autoDance: false });

describe("perceptionNodes（声明式 toggle 节点）", () => {
  it("按 ALL_MODULES 顺序产出 toggle 节点（id/labelKey/fallback 对齐 caps）", () => {
    const state = { ...offState(), breath: true, blink: true };
    const nodes = perceptionNodes(state, allCaps);
    expect(nodes.map((n) => n.id)).toEqual([
      "perception-breath",
      "perception-gaze",
      "perception-blink",
      "perception-lipSync",
      "perception-autoDance",
    ]);
    expect(nodes.every((n) => n.kind === "toggle")).toBe(true);
    expect(nodes[0]).toMatchObject({ labelKey: "preview.perceptionBreath", fallback: "呼吸" });
  });

  it("caps 裁剪：只产出注入的模块（无 chest 骨 → 无 breath）", () => {
    const nodes = perceptionNodes(offState(), [{ id: "gaze", labelKey: "preview.perceptionGaze", fallback: "注视" }]);
    expect(nodes.map((n) => n.id)).toEqual(["perception-gaze"]);
  });

  it("空态（caps 空）→ 提示 field 节点（对齐旧 noPerception 行）", () => {
    const nodes = perceptionNodes(offState(), []);
    expect(nodes).toEqual([
      { id: "perception-empty", kind: "field", labelKey: "preview.noPerception", fallback: "无感知模块", value: "" },
    ]);
  });

  it("control.get/set 闭包读写 state（交互状态语义：set 翻转布尔 + 非布尔归一）", () => {
    const state = { ...offState(), breath: true };
    const nodes = perceptionNodes(state, allCaps);
    const breath = nodes[0];
    expect(breath.control?.get?.(undefined)).toBe(true);
    breath.control?.set?.(false);
    expect(state.breath).toBe(false);
    expect(breath.control?.get?.(undefined)).toBe(false);
    // 非布尔输入归一（Boolean 强转）
    breath.control?.set?.("yes" as never);
    expect(state.breath).toBe(true);
  });
});
