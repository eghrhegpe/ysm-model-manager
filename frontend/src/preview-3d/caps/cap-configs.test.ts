import { describe, it, expect } from "vitest";

import { envState } from "@/preview-3d/state/env-state.ts";
import { deriveDefaultEnvState } from "@/preview-3d/state/env-state-schema.ts";
import { ENV_PRESETS } from "./environment-capability.ts";
import { POSTPROC_PRESETS } from "./postprocessing-capability.ts";
import { MODEL_DEFAULTS } from "@/preview-3d/state/model-defaults.ts";

describe("envState 默认值结构完整性", () => {
  it("envState defaults have required fields", () => {
    expect(envState).toBeDefined();
    expect(envState.skyTimeOfDay).toBeTruthy();
    expect(typeof envState.skyTurbidity).toBe("number");
    expect(typeof envState.fogEnabled).toBe("boolean");
    expect(typeof envState.shadowType).toBe("string");
    expect(typeof envState.reflectorEnabled).toBe("boolean");
    expect(typeof envState.groundVisible).toBe("boolean");
  });

  it("deriveDefaultEnvState returns fresh copy", () => {
    const defaults = deriveDefaultEnvState();
    expect(defaults.skyTimeOfDay).toBe(9);
    expect(defaults.fogEnabled).toBe(false);
    expect(defaults.shadowType).toBe("hard");
  });
});

describe("cap 预设/默认值结构完整性", () => {
  it("ENV_PRESETS has at least 3 presets", () => {
    const keys = Object.keys(ENV_PRESETS);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const k of keys) {
      const p = ENV_PRESETS[k as keyof typeof ENV_PRESETS];
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });

  it("MODEL_DEFAULTS has default key", () => {
    expect(MODEL_DEFAULTS.default).toBeDefined();
  });

  it("MODEL_DEFAULTS 覆盖所有模型类型", () => {
    const expectedTypes = ["default", "ysm", "vrm", "mmd", "mmd-scene", "litematic", "resourcepack"];
    for (const t of expectedTypes) {
      expect(MODEL_DEFAULTS[t as keyof typeof MODEL_DEFAULTS]).toBeDefined();
    }
  });

  it("MODEL_DEFAULTS fog 逐模型调校值齐全（刀5 迁移值级回归锚）", () => {
    // code_review f0b1449f7 #3/#4（P3）：MODEL_DEFAULTS 合并曾整段丢失 FOG_PRESETS
    // 的逐模型雾参数（六模型只剩 fogEnabled:false）——旧测试仅 toBeDefined 存在性
    // 检查零守卫；值级断言防再次漏搬/抄错
    const fog = (t: keyof typeof MODEL_DEFAULTS) =>
      MODEL_DEFAULTS[t] as Record<string, unknown>;
    for (const t of ["ysm", "vrm", "mmd", "mmd-scene", "litematic", "resourcepack"] as const) {
      expect(typeof fog(t).fogNear).toBe("number");
      expect(typeof fog(t).fogFar).toBe("number");
      expect(typeof fog(t).fogDensity).toBe("number");
      expect(fog(t).fogMode).toBe("linear");
    }
    // per-model 差异保留（非全抄 default）
    expect(fog("mmd-scene").fogFar).not.toBe(fog("vrm").fogFar); // 1500 vs 400
    expect(fog("vrm").fogColor).not.toBe(fog("litematic").fogColor);
    // default 回退不写 fog 键（原 FOG_PRESETS.default={} 语义：不强制关用户已开雾）
    expect("fogEnabled" in fog("default")).toBe(false);
  });

  it("POSTPROC_PRESETS has default key", () => {
    expect(POSTPROC_PRESETS.default).toBeDefined();
    expect(typeof POSTPROC_PRESETS.default).toBe("object");
    // per-type preset 携带 enabled 门禁（能力级开关，不入 schema）
    expect(typeof POSTPROC_PRESETS.vrm?.enabled).toBe("boolean");
  });
});
