import { describe, it, expect } from "vitest";

// ===== 消费 envState 默认值 + *_PRESETS（防 knip 死代码告警）=====
import { envState } from "../state/env-state.ts";
import { deriveDefaultEnvState } from "../state/env-state-schema.ts";
import { ENV_PRESETS, ENV_PRESET_BY_MODEL } from "./environment-capability.ts";
import { FOG_PRESETS } from "./fog-capability.ts";
import { REFLECTOR_PRESETS } from "./reflector-capability.ts";
import { POSTPROC_PRESETS } from "./postprocessing-capability.ts";

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

describe("cap *_PRESETS 结构完整性", () => {
  it("ENV_PRESETS has at least 3 presets", () => {
    const keys = Object.keys(ENV_PRESETS);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const k of keys) {
      const p = ENV_PRESETS[k as keyof typeof ENV_PRESETS];
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
    }
  });

  it("ENV_PRESET_BY_MODEL has default key", () => {
    expect(ENV_PRESET_BY_MODEL.default).toBeDefined();
  });

  it("FOG_PRESETS has default key", () => {
    expect(FOG_PRESETS.default).toBeDefined();
  });

  it("REFLECTOR_PRESETS has default key", () => {
    expect(REFLECTOR_PRESETS.default).toBeDefined();
    // default preset is empty (uses envState defaults); vrm preset carries overrides
    expect(typeof REFLECTOR_PRESETS.vrm?.reflectorOpacity).toBe("number");
  });

  it("POSTPROC_PRESETS has default key", () => {
    expect(POSTPROC_PRESETS.default).toBeDefined();
    expect(typeof POSTPROC_PRESETS.default!.bloomStrength).toBe("number");
  });
});
