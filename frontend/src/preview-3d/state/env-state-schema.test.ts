// ===== env-state-schema 单元测试 =====
// 锁定 deriveDefaultEnvState（全键 + tuple3 深拷贝独立）与 getPresetKeys（分组键派发）。
import { describe, it, expect } from "vitest";
import {
  ENV_STATE_SCHEMA,
  deriveDefaultEnvState,
  getPresetKeys,
} from "./env-state-schema.ts";

describe("env-state-schema", () => {
  it("deriveDefaultEnvState 覆盖 schema 全部键", () => {
    const defs = Object.keys(ENV_STATE_SCHEMA);
    const state = deriveDefaultEnvState();
    for (const k of defs) {
      expect(state, `缺默认键 ${k}`).toHaveProperty(k);
    }
  });

  it("tuple3 默认值返回独立副本（避免跨实例共享可变数组）", () => {
    const a = deriveDefaultEnvState();
    const b = deriveDefaultEnvState();
    const arrA = a.groundColor as number[];
    const arrB = b.groundColor as number[];
    expect(arrA).not.toBe(arrB); // 不同引用
    expect(arrA).toEqual(arrB); // 同值
    arrA[0] = 999;
    expect((b.groundColor as number[])[0]).not.toBe(999); // 互不影响
  });

  it("getPresetKeys 返回分组下全部键", () => {
    const sky = getPresetKeys("sky");
    expect(sky.length).toBeGreaterThan(0);
    expect(sky).toContain("skyTimeOfDay");
    expect(sky).toContain("skyAutoRotate");

    const none = getPresetKeys("__no_such_group__");
    expect(none).toEqual([]);
  });
});
