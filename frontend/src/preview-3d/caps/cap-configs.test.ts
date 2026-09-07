import { describe, it, expect } from "vitest";

import { envState } from "../state/env-state.ts";
import { deriveDefaultEnvState } from "../state/env-state-schema.ts";
import { ENV_PRESETS } from "./environment-capability.ts";
import { POSTPROC_PRESETS } from "./postprocessing-capability.ts";
import { MODEL_DEFAULTS } from "../state/model-defaults.ts";

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

  it("POSTPROC_PRESETS has default key", () => {
    expect(POSTPROC_PRESETS.default).toBeDefined();
    expect(typeof POSTPROC_PRESETS.default).toBe("object");
    // per-type preset 携带 enabled 门禁（能力级开关，不入 schema）
    expect(typeof POSTPROC_PRESETS.vrm?.enabled).toBe("boolean");
  });
});
