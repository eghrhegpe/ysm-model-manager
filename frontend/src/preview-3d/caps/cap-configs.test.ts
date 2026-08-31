import { describe, it, expect } from "vitest";

// ===== 消费 DEFAULT_*_PARAMS + *_PRESETS（防 knip 死代码告警）=====
// 同时断言结构完整性：默认值非空、预设至少含一个字段
import {
  DEFAULT_ENV_PARAMS,
  ENV_PRESETS,
  ENV_PRESET_BY_MODEL,
} from "./environment-capability.ts";
import { DEFAULT_FOG_PARAMS, FOG_PRESETS } from "./fog-capability.ts";
import {
  DEFAULT_SHADOW_PARAMS,
  SHADOW_PRESETS,
} from "./shadow-capability.ts";
import {
  DEFAULT_REFLECTOR_PARAMS,
  REFLECTOR_PRESETS,
} from "./reflector-capability.ts";
import {
  DEFAULT_POSTPROC_PARAMS,
  POSTPROC_PRESETS,
} from "./postprocessing-capability.ts";

describe("cap DEFAULT_*_PARAMS 结构完整性", () => {
  it("environment defaults have required fields", () => {
    expect(DEFAULT_ENV_PARAMS).toBeDefined();
    expect(DEFAULT_ENV_PARAMS.preset).toBeTruthy();
    expect(typeof DEFAULT_ENV_PARAMS.intensity).toBe("number");
  });

  it("fog defaults have required fields", () => {
    expect(DEFAULT_FOG_PARAMS).toBeDefined();
    expect(typeof DEFAULT_FOG_PARAMS.enabled).toBe("boolean");
    expect(typeof DEFAULT_FOG_PARAMS.mode).toBe("string");
    expect(typeof DEFAULT_FOG_PARAMS.color).toBe("number");
  });

  it("shadow defaults have required fields", () => {
    expect(DEFAULT_SHADOW_PARAMS).toBeDefined();
    expect(typeof DEFAULT_SHADOW_PARAMS.enabled).toBe("boolean");
    expect(typeof DEFAULT_SHADOW_PARAMS.type).toBe("string");
    expect(typeof DEFAULT_SHADOW_PARAMS.mapSize).toBe("number");
  });

  it("reflector defaults have required fields", () => {
    expect(DEFAULT_REFLECTOR_PARAMS).toBeDefined();
    expect(typeof DEFAULT_REFLECTOR_PARAMS.enabled).toBe("boolean");
    expect(typeof DEFAULT_REFLECTOR_PARAMS.size).toBe("number");
    expect(typeof DEFAULT_REFLECTOR_PARAMS.opacity).toBe("number");
  });

  it("postprocessing defaults have required fields", () => {
    expect(DEFAULT_POSTPROC_PARAMS).toBeDefined();
    expect(typeof DEFAULT_POSTPROC_PARAMS.enabled).toBe("boolean");
    expect(typeof DEFAULT_POSTPROC_PARAMS.bloomStrength).toBe("number");
    expect(typeof DEFAULT_POSTPROC_PARAMS.ssaoEnabled).toBe("boolean");
    expect(typeof DEFAULT_POSTPROC_PARAMS.reflectionMode).toBe("string");
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
    expect(FOG_PRESETS.default!.mode).toBeTruthy();
  });

  it("SHADOW_PRESETS has default key", () => {
    expect(SHADOW_PRESETS.default).toBeDefined();
    expect(SHADOW_PRESETS.default!.type).toBeTruthy();
  });

  it("REFLECTOR_PRESETS has default key", () => {
    expect(REFLECTOR_PRESETS.default).toBeDefined();
    expect(typeof REFLECTOR_PRESETS.default!.opacity).toBe("number");
  });

  it("POSTPROC_PRESETS has default key", () => {
    expect(POSTPROC_PRESETS.default).toBeDefined();
    expect(typeof POSTPROC_PRESETS.default!.bloomStrength).toBe("number");
  });
});
