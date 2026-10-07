// @vitest-environment node
// ===== ground-surface-defaults 唯一事实源钉值（ADR-249 §2.6）=====
// 本叶是地面材质默认值 / 取值集的一处事实源：caps/ground-surface-spec.ts 与
// state/env-state-schema.ts 都从这里读（schema 逐键 `GROUND_DEFAULTS.x`，cap re-export）。
// 既有测试（ground-surface-spec.test / env-state-schema.test / ground-capability.test）
// 全部**消费**该叶当基准，没有任何一处钉住它自己的字面量——若 matGridSize 8 → 10、
// matRoughness 0.85 → 0.8（正是 ADR-249 记录的历史 4 处分歧），整套测试仍恒绿。
// 本测试 = 特征测试（characterization）：把当前唯一事实源的字面量与集合结构锁死，
// 防止「schema 读叶、cap 读叶、唯独没人校验叶本身」的静默漂移。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUND_SURFACE_PARAMS,
  GROUND_CANVAS_STYLES,
  GROUND_MATERIAL_PRESET_IDS,
  GROUND_OVERLAY_STYLES,
  GROUND_SOURCE_KINDS,
  type GroundCanvasStyle,
  type GroundMaterialParams,
  type GroundOverlayStyle,
  type GroundSourceKind,
  type GroundSurfaceMode,
} from "./ground-surface-defaults.ts";

describe("DEFAULT_GROUND_SURFACE_PARAMS — 唯一事实源字面量", () => {
  it("13 个字段逐一钉值（历史 4 分歧的落点：matGridSize 8 / matRoughness 0.85 / matColor2 单源 / 无 matLineColor）", () => {
    expect(DEFAULT_GROUND_SURFACE_PARAMS).toEqual({
      matSource: "none",
      matColor: 0x9a8b78,
      matColor2: 0x6b5d4c,
      matGridSize: 8,
      matOpacity: 1,
      matScale: 1,
      matRotationDeg: 0,
      matRoughness: 0.85,
      matMetalness: 0,
      matDensity: 1,
      matAngleDeg: 0,
      matMicroNoise: 6,
      matEnvMapIntensity: 0.15,
    } satisfies GroundMaterialParams);
  });

  it("全部字段键与接口一致（新增字段漏补默认值 → 编译期已拒，此处钉运行时形状）", () => {
    const keys = Object.keys(DEFAULT_GROUND_SURFACE_PARAMS).sort();
    expect(keys).toEqual(
      [
        "matAngleDeg",
        "matColor",
        "matColor2",
        "matDensity",
        "matEnvMapIntensity",
        "matGridSize",
        "matMetalness",
        "matMicroNoise",
        "matOpacity",
        "matRotationDeg",
        "matRoughness",
        "matScale",
        "matSource",
      ].sort(),
    );
  });

  it("数字字段全部有限值（无 NaN/Infinity，防渲染端 NaN 漂移）", () => {
    for (const [k, v] of Object.entries(DEFAULT_GROUND_SURFACE_PARAMS)) {
      if (k === "matSource") continue;
      expect(Number.isFinite(v as number), `字段 ${k} 应为有限数`).toBe(true);
    }
  });

  it("值域自洽：不透明度/粗糙度/金属度 ∈ [0,1]；微噪点与 IBL 强度非负", () => {
    const p = DEFAULT_GROUND_SURFACE_PARAMS;
    for (const k of ["matOpacity", "matRoughness", "matMetalness"] as const) {
      expect(p[k], `${k} ∈ [0,1]`).toBeGreaterThanOrEqual(0);
      expect(p[k]).toBeLessThanOrEqual(1);
    }
    expect(p.matMicroNoise).toBeGreaterThanOrEqual(0);
    expect(p.matEnvMapIntensity).toBeGreaterThanOrEqual(0);
  });
});

describe("取值集合 — 集合结构不变量", () => {
  it("来源轴取值集精确 = none/solid/canvas/texture（无重复、无孤儿）", () => {
    expect([...GROUND_SOURCE_KINDS]).toEqual(["none", "solid", "canvas", "texture"]);
    expect(new Set(GROUND_SOURCE_KINDS).size).toBe(GROUND_SOURCE_KINDS.length);
    // 每个取值都是类型允许值（satisfies 已编译期保证；此处锁「集合=类型全集」语义）
    for (const k of GROUND_SOURCE_KINDS) {
      const allowed: GroundSourceKind[] = ["none", "solid", "canvas", "texture"];
      expect(allowed).toContain(k);
    }
  });

  it("样式轴取值集精确 = plain/marble/sand/grass；且与材质预设 ID 集合**完全一致**（预设即样式轴）", () => {
    expect([...GROUND_CANVAS_STYLES]).toEqual(["plain", "marble", "sand", "grass"]);
    expect([...GROUND_MATERIAL_PRESET_IDS]).toEqual([...GROUND_CANVAS_STYLES]);
    expect(new Set(GROUND_CANVAS_STYLES).size).toBe(GROUND_CANVAS_STYLES.length);
  });

  it("叠加层样式取值集精确 = none/grid/checker/stripes/diamond", () => {
    expect([...GROUND_OVERLAY_STYLES]).toEqual(["none", "grid", "checker", "stripes", "diamond"]);
    expect(new Set(GROUND_OVERLAY_STYLES).size).toBe(GROUND_OVERLAY_STYLES.length);
  });

  it("类型封面完备：SurfaceMode 合法集 = 三轴并集（防新增模式漏登记进任一集合）", () => {
    const modeUnion = new Set<GroundSurfaceMode>([
      ...GROUND_SOURCE_KINDS as readonly GroundSurfaceMode[],
      ...GROUND_CANVAS_STYLES as readonly GroundSurfaceMode[],
      "none", // 来源集已含 none（模式枚举的「无地面」态）
    ]);
    const allowed: GroundSurfaceMode[] = [
      "none", "solid", "plain", "marble", "sand", "grass", "texture",
    ];
    for (const m of allowed) expect(modeUnion, `模式 ${m} 应被某轴集合覆盖`).toContain(m);
  });

  it("叠加层类型封面：GroundOverlayStyle 全集 = GROUND_OVERLAY_STYLES 集合", () => {
    const allowed: GroundOverlayStyle[] = ["none", "grid", "checker", "stripes", "diamond"];
    for (const s of allowed) expect(GROUND_OVERLAY_STYLES).toContain(s);
    expect(GROUND_OVERLAY_STYLES.length).toBe(allowed.length);
  });

  it("GroundCanvasStyle 全集 = GROUND_CANVAS_STYLES 集合", () => {
    const allowed: GroundCanvasStyle[] = ["plain", "marble", "sand", "grass"];
    for (const s of allowed) expect(GROUND_CANVAS_STYLES).toContain(s);
    expect(GROUND_CANVAS_STYLES.length).toBe(allowed.length);
  });
});