// @vitest-environment node
// ===== 预览共享工具函数测试 =====
// Prefer3DState：实例级偏好状态接口（多实例隔离防串扰）。
// stripYsgpTextHeader 纯函数测试已随 ADR-137 第五刀迁至 preview-3d/decoder/utils.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import type { Prefer3DState } from "./utils.ts";

// 简单的 Prefer3DState 实现（对齐 AppPreview 实例行为）
function createPrefer3DState(): Prefer3DState {
  let _prefer3D = false;
  return {
    getPrefer3D: () => _prefer3D,
    setPrefer3D: (v: boolean) => { _prefer3D = v; },
  };
}

describe("Prefer3DState（实例级 3D 偏好）", () => {
  let state: Prefer3DState;

  beforeEach(() => {
    state = createPrefer3DState();
  });

  it("默认 false", () => {
    expect(state.getPrefer3D()).toBe(false);
  });

  it("set 后 get 生效", () => {
    state.setPrefer3D(true);
    expect(state.getPrefer3D()).toBe(true);
    state.setPrefer3D(false);
    expect(state.getPrefer3D()).toBe(false);
  });

  it("多实例隔离", () => {
    const other = createPrefer3DState();
    state.setPrefer3D(true);
    expect(state.getPrefer3D()).toBe(true);
    expect(other.getPrefer3D()).toBe(false);
  });
});
