// @vitest-environment node
// ===== 感知层：暂停引用 测试（core.ts，#9 实例级）=====
import { describe, expect, it } from "vitest";
import { createPerceptionPauseRef } from "./core.ts";

describe("createPerceptionPauseRef", () => {
  it("初始 paused=false", () => {
    const ref = createPerceptionPauseRef();
    expect(ref.paused).toBe(false);
  });

  it("paused 可写切换，且实例间互不影响（多模型同框语义）", () => {
    const a = createPerceptionPauseRef();
    const b = createPerceptionPauseRef();
    a.paused = true;
    expect(a.paused).toBe(true);
    expect(b.paused).toBe(false); // B 不受 A 动画激活影响
  });
});