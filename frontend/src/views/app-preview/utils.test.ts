// @vitest-environment node
// ===== 预览共享工具函数测试 =====
// getPrefer3D / setPrefer3D：模块级偏好状态单例。
// stripYsgpTextHeader 纯函数测试已随 ADR-137 第五刀迁至 preview-3d/decoder/utils.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getPrefer3D, setPrefer3D } from "./utils.ts";

describe("getPrefer3D / setPrefer3D", () => {
  beforeEach(() => setPrefer3D(false));

  it("默认 false", () => {
    expect(getPrefer3D()).toBe(false);
  });

  it("set 后 get 生效", () => {
    setPrefer3D(true);
    expect(getPrefer3D()).toBe(true);
    setPrefer3D(false);
    expect(getPrefer3D()).toBe(false);
  });
});
