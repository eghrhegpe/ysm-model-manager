// @vitest-environment node
// ===== water-persist（水面持久化数据面，锐评 2026-10-08 P1-0/P3-1：
// 原 scene-capability.ts|restoreBySchema 下沉水面叶）=====
// 覆盖：批量恢复的来源纪律（auto-model 戳 + 同轨放行）/ 值短路 / 组外键静默跳过 /
// writeOpts 三件组装语义（省略=manual、RESTORE_SOURCE=auto-model、skipMiddleware 精确写入）。
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  RESTORE_SOURCE,
  restoreWaterSchemaKeys,
  writeOpts,
} from "./water-persist.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { getPresetKeys } from "@/preview-3d/state/env-state-schema.ts";

describe("restoreWaterSchemaKeys", () => {
  beforeEach(() => resetEnvState());
  afterEach(() => resetEnvState());

  it("只接 number/boolean 标量键且打 auto-model 戳（同轨 auto-model 写入不得被冻）", () => {
    const applied = restoreWaterSchemaKeys(
      { waterWaveSpeed: 2.5, waterClarity: 0.7, waterMode: "pool" },
      getPresetKeys("water"),
    );
    expect(applied, "number 键落值").toBe(true);
    expect(envState.waterWaveSpeed).toBeCloseTo(2.5);
    expect(envState.waterClarity).toBeCloseTo(0.7);
    expect(envState.waterMode, "枚举键不归批量路径（spec 单独接），保持默认").toBe("film");
    setEnvState({ waterWaveSpeed: 1.5 }, { source: "auto-model" });
    expect(envState.waterWaveSpeed, "恢复戳 auto-model，同轨写入放行（P1-0 核心断言）").toBeCloseTo(1.5);
  });

  it("同值短路：envState 现值 === 存档值时不写（零无谓派发）", () => {
    setEnvState({ waterWaveSpeed: 2.5 }, { source: "manual" });
    const applied = restoreWaterSchemaKeys({ waterWaveSpeed: 2.5 }, getPresetKeys("water"));
    expect(applied, "同值不写").toBe(false);
  });

  it("水组外键静默跳过（water 叶自陈名实相符——原「通用签名藏 startsWith 后门」已随下沉除名）", () => {
    const before = envState.groundSize;
    const applied = restoreWaterSchemaKeys(
      { groundSize: 999, fogDensity: 0.5 },
      ["groundSize", "fogDensity"],
    );
    expect(applied, "组外键一律不落").toBe(false);
    expect(envState.groundSize, "他组键不受水面叶影响").toBe(before);
  });

  it("脏值（类型不匹配）跳过，保持 schema 默认（与 setEnvState 兜底同口径）", () => {
    const before = envState.waterWaveSpeed;
    const applied = restoreWaterSchemaKeys({ waterWaveSpeed: "fast" }, getPresetKeys("water"));
    expect(applied).toBe(false);
    expect(envState.waterWaveSpeed).toBe(before);
  });
});

describe("RESTORE_SOURCE / writeOpts（三件组装，ground-capability 同款范式）", () => {
  it("省略 = 用户手改语义（manual）；RESTORE_SOURCE = auto-model", () => {
    expect(writeOpts()).toEqual({ source: "manual" });
    expect(writeOpts(RESTORE_SOURCE)).toEqual({ source: "auto-model" });
  });

  it("skipMiddleware 仅显式 true 才写入键（exactOptionalPropertyTypes 纪律）", () => {
    const plain = writeOpts(RESTORE_SOURCE);
    expect("skipMiddleware" in plain, "省略项不得写键（防 {skipMiddleware:undefined} 顶掉默认）").toBe(false);
    const withSkip = writeOpts({ ...RESTORE_SOURCE, skipMiddleware: true });
    expect(withSkip).toEqual({ source: "auto-model", skipMiddleware: true });
  });
});
