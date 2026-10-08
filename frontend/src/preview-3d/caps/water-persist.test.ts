// @vitest-environment node
// ===== water-persist（水面持久化数据面，锐评 2026-10-08 P1-0/P3-1：
// 原 scene-capability.ts|restoreBySchema 下沉水面叶）=====
// 覆盖：批量恢复的来源纪律（auto-model 戳 + 同轨放行）/ 值短路 / 组外键静默跳过 /
// writeOpts 三件组装语义（省略=manual、RESTORE_SOURCE=auto-model、skipMiddleware 精确写入）。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RESTORE_SOURCE,
  resolveWaterRestoreState,
  restoreWaterSchemaKeys,
  writeOpts,
} from "./water-persist.ts";
import { envState, resetEnvState, setEnvState } from "@/preview-3d/state/env-state.ts";
import { getPresetKeys } from "@/preview-3d/state/env-state-schema.ts";

// resolveWaterRestoreState 的存储源（restoreState）在此 mock：本组测「存档源解析与
// legacy 双轨方言」的分支逻辑，localStorage 形态闸已由 scene-capability 单测覆盖。
vi.mock("./scene-capability.ts", () => ({ restoreState: vi.fn() }));
import { restoreState } from "./scene-capability.ts";

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

describe("resolveWaterRestoreState（loadState 首段下沉：存档源 + legacy ground 双轨）", () => {
  const mockRestore = vi.mocked(restoreState);
  beforeEach(() => mockRestore.mockReset());

  it("water 自有存档优先：原样返回且 fromNestedLegacy=false（不回看 ground）", () => {
    mockRestore.mockReturnValueOnce({ waterEnabled: false });
    expect(resolveWaterRestoreState()).toEqual({
      state: { waterEnabled: false },
      fromNestedLegacy: false,
    });
    expect(mockRestore, "自有档在手不再查 ground").toHaveBeenCalledTimes(1);
    expect(mockRestore).toHaveBeenCalledWith("water");
  });

  it("无 water 档 → 解包 legacy ground 嵌套 water 对象，fromNestedLegacy=true（防下游 nested 判定误判 flat）", () => {
    mockRestore
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ enabled: true, water: { enabled: false, wetness: 0.4 } });
    expect(resolveWaterRestoreState()).toEqual({
      state: { enabled: false, wetness: 0.4 },
      fromNestedLegacy: true,
    });
    expect(mockRestore).toHaveBeenNthCalledWith(2, "ground");
  });

  it("ground 无嵌套 water 对象 → 顶层四键平铺方言（任一为 number 即认）", () => {
    mockRestore
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ wetness: 0.6, waterColor: 0x4488aa, matSource: "checker" });
    expect(resolveWaterRestoreState()).toEqual({
      state: { wetness: 0.6, waterColor: 0x4488aa },
      fromNestedLegacy: false,
    });
  });

  it("ground 嵌套 water 非对象（数字）→ 落回四键判定；四键全非 number → null", () => {
    mockRestore
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ water: 7, matSource: "checker" });
    expect(resolveWaterRestoreState()).toBeNull();
  });

  it("两档皆无 → null（water 一次 + ground 一次，不多查）", () => {
    mockRestore.mockReturnValue(null);
    expect(resolveWaterRestoreState()).toBeNull();
    expect(mockRestore).toHaveBeenCalledTimes(2);
  });
});
