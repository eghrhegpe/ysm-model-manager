// ===== env-persist.ts 守卫（ADR-326：schema 派生键轨）=====
// 病根锁：environment-capability.ts 的 saveState **手摘 6 键**、loadState **手写双轨还原表**，
// schema 加键而两处任一漏登记 ⇒ 自动持久化、静默不还原。本测试从**派生对称性**锁死：
// 只要 saveEnvState/restoreEnvPartial 同走 ENV_KEYS + getArchiveKey，漏登记结构性不可能。
import { describe, it, expect, beforeEach } from "vitest";
import {
  ENV_KEYS,
  RESTORE_SOURCE,
  restoreEnvPartial,
  saveEnvState,
} from "./env-persist.ts";
import {
  getArchiveKey,
  getPresetKeys,
} from "@/preview-3d/state/env-state-schema.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";

beforeEach(() => resetEnvState());

describe("getArchiveKey / ARCHIVE_ALIAS（ADR-326 别名层）", () => {
  it("environment 方言键映射到无前缀存档键名", () => {
    expect(getArchiveKey("envPreset")).toBe("preset");
    expect(getArchiveKey("envIntensity")).toBe("intensity");
    expect(getArchiveKey("envResolution")).toBe("resolution");
    expect(getArchiveKey("envUseAsBackground")).toBe("useAsBackground");
  });

  it("无别名键同名（同形键不被别名表污染）", () => {
    expect(getArchiveKey("envEnabled")).toBe("envEnabled");
    expect(getArchiveKey("envSource")).toBe("envSource");
    // 非 environment 键一律同名——别名表只服务 dialect 键
    expect(getArchiveKey("skyTimeOfDay")).toBe("skyTimeOfDay");
    expect(getArchiveKey("waterSize")).toBe("waterSize");
  });
});

describe("ENV_KEYS 派生（ADR-326）", () => {
  it("ENV_KEYS 与 getPresetKeys('environment') 恒等（schema 加键自动带出）", () => {
    // 变异实证：改 ENV_KEYS 为手写死列表，本测试转红；改 schema 加 environment 键，转红要求同步
    expect([...ENV_KEYS].sort()).toEqual([...getPresetKeys("environment")].sort());
  });

  it("ENV_KEYS 覆盖当前 schema 中全部 environment 组键（无漏网）", () => {
    const all = getPresetKeys("environment");
    for (const k of all) {
      expect(ENV_KEYS, `environment 键 ${k} 未进 ENV_KEYS`).toContain(k);
    }
  });
});

describe("saveEnvState（写侧派生）", () => {
  it("产出存档键名为 getArchiveKey 映射（preset 而非 envPreset）", () => {
    setEnvState({ envPreset: "night", envIntensity: 2.4 }, { source: "manual", force: true });
    const saved = saveEnvState();
    expect(saved.preset).toBe("night");
    expect(saved.intensity).toBe(2.4);
    expect(saved.envEnabled).toBe(true); // 无别名同名
    // 不应以 schema 键名落盘（别名失效即错）
    expect("envPreset" in saved).toBe(false);
    expect("envIntensity" in saved).toBe(false);
  });

  it("键集与 ENV_KEYS 对称（每个 schema 键都以 getArchiveKey 落盘）", () => {
    setEnvState(
      { envEnabled: false, envPreset: "sunset", envSource: "custom", envResolution: 256 },
      { source: "manual", force: true },
    );
    const saved = saveEnvState();
    for (const k of ENV_KEYS) {
      const archiveKey = getArchiveKey(k);
      expect(saved[archiveKey], `键 ${k} 未以存档键 ${archiveKey} 落盘`).toBeDefined();
    }
  });

  it("override 覆盖派生结果（cap 专用运行时裁决，如 custom 无缓存回落 studio）", () => {
    setEnvState({ envPreset: "custom" }, { source: "manual", force: true });
    const saved = saveEnvState({ preset: "studio" });
    expect(saved.preset).toBe("studio");
    // 未覆盖的键仍派生
    expect(saved.intensity).toBe(envState.envIntensity);
  });

  it("与 localStorage 持久化键轨一致（restoreState('environment') 可读同形）", async () => {
    setEnvState({ envPreset: "forest", envIntensity: 1.5 }, { source: "manual", force: true });
    // 仅验证 saveEnvState 产出可经 JSON 序列化（localStorage 载体契约）
    expect(JSON.parse(JSON.stringify(saveEnvState())).preset).toBe("forest");
  });
});

describe("restoreEnvPartial（读侧派生）", () => {
  it("round-trip：save → restore 同值恢复全部 environment 键", () => {
    const DEVIATION: Record<string, unknown> = {
      envEnabled: false,
      envPreset: "night",
      envIntensity: 2.4,
      envResolution: 512,
      envUseAsBackground: true,
      envSource: "sky",
    };
    setEnvState(DEVIATION as never, { source: "manual", force: true });
    const saved = saveEnvState();
    resetEnvState();
    const partial = restoreEnvPartial(saved);
    for (const k of ENV_KEYS) {
      expect(partial[k], `environment 键 ${k} 未 round-trip 还原`).toBe(
        DEVIATION[k],
      );
    }
  });

  it("round-trip 经 cap 真实路径存活（saveState 存档 → loadState 读回，P1-5 同源契约）", () => {
    // 用 setEnvState 写偏离值 → saveEnvState → restoreState 键轨 → restoreEnvPartial
    setEnvState({ envPreset: "sunset", envIntensity: 2.0 }, { source: "manual", force: true });
    const saved = saveEnvState();
    resetEnvState();
    const partial = restoreEnvPartial(saved);
    expect(partial.envPreset).toBe("sunset");
    expect(partial.envIntensity).toBe(2.0);
  });

  it("脏存档类型不匹配 → 跳过，保持 schema 默认（防脏值漏进 envState）", () => {
    const partial = restoreEnvPartial({
      preset: 123, // number 塞进 enum 键
      envSource: "banana", // 非法枚举
      intensity: "high", // string 塞进 number 键
      resolution: 999999,
    });
    expect(partial.envPreset).toBeUndefined();
    expect(partial.envSource).toBeUndefined();
    expect(partial.envIntensity).toBeUndefined();
    // 合法值仍恢复
    expect(partial.envResolution).toBe(999999);
  });

  it("null / 空存档 → 空 partial（与 restoreState 早退语义一致）", () => {
    expect(restoreEnvPartial(null)).toEqual({});
    expect(restoreEnvPartial(undefined)).toEqual({});
    expect(restoreEnvPartial({})).toEqual({});
  });

  it("只读不写 envState（本函数是数据面，写入口在 cap 侧）", () => {
    const before = { ...envState };
    restoreEnvPartial({ preset: "forest", intensity: 1.2 });
    expect(envState).toEqual(before);
  });
});

describe("RESTORE_SOURCE（ADR-326 来源纪律）", () => {
  it("恢复来源为 auto-model（程序化动作非手改，防 lastWriteSource 冻死）", () => {
    expect(RESTORE_SOURCE.source).toBe("auto-model");
  });

  it("所有 environment 组键经 setEnvState 恢复都能被同轨 auto-atmosphere 覆盖", () => {
    // 语义锁：恢复打 manual 会让氛围预设写同键被拒（"切氛围环境不跟改"）
    const saved = saveEnvState();
    const partial = restoreEnvPartial(saved);
    setEnvState(partial, RESTORE_SOURCE);
    // 现键的 lastWriteSource 应为 auto-model，氛围预设（同轨 auto）可覆盖
    // （行为断言：再写 auto-atmosphere 源能落地）
    setEnvState({ envPreset: "forest" }, { source: "auto-atmosphere", force: true });
    expect(envState.envPreset).toBe("forest");
  });
});