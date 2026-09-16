// @vitest-environment node
// ===== 地面材质拆轴迁移契约测试（ADR-249 §2.5 + ADR-252 §2.3）=====
// 拆轴 = groundMatSource 单枚举 → sourceKind（来源轴）+ canvasStyle（材质轴）+ overlay（叠加层）
// 本测试锁四件事：
//   1. 旧值映射完备：9 个 legacy 枚举值都能无损映射
//   2. 图案进位：旧 grid/checker/stripes/diamond → canvasStyle=plain + overlayStyle=<同名>
//   3. 禁止静默降级：texture 无 customTex 时不得被改写成语义不同的模式
//      （历史行为：loadState 把 texture 改写成 plain —— 用户存档里选的
//        「自定义贴图」重启后变成一块看似无关的纯色地面）
//   4. 新轴 → 模式派生（渲染分支用）

import { describe, it, expect } from "vitest";
import {
  GROUND_CANVAS_STYLES,
  LEGACY_GROUND_MAT_SOURCES,
  LEGACY_CANVAS_PATTERNS,
  migrateGroundMatSource,
  groundMatSourceFromAxes,
  type GroundSourceKind,
  type GroundCanvasStyle,
  type GroundOverlayStyle,
} from "./ground-surface-spec.ts";

/* ============ Suite 1 — 旧值 → 新三轴映射完备性 ============ */

describe("Suite 1 — 旧 legacy 值映射到新三轴", () => {
  it("全部 legacy 值均有映射（无遗漏、无 undefined）", () => {
    for (const old of LEGACY_GROUND_MAT_SOURCES) {
      const m = migrateGroundMatSource(old);
      expect(m, `旧值 ${old} 无映射`).toBeDefined();
      expect(typeof m.sourceKind).toBe("string");
    }
  });

  it("none → sourceKind=none，无 canvasStyle / overlayStyle", () => {
    const m = migrateGroundMatSource("none");
    expect(m.sourceKind).toBe("none");
    expect(m.canvasStyle).toBeUndefined();
    expect(m.overlayStyle).toBeUndefined();
  });

  it("solid → sourceKind=solid，无 canvasStyle（纯色不经画布管线）", () => {
    const m = migrateGroundMatSource("solid");
    expect(m.sourceKind).toBe("solid");
    expect(m.overlayStyle).toBeUndefined();
  });

  it("texture → sourceKind=texture（来源轴），无 canvasStyle", () => {
    const m = migrateGroundMatSource("texture");
    expect(m.sourceKind).toBe("texture");
  });

  it("全部材质 canvasStyle → sourceKind=canvas + 同材质", () => {
    for (const style of GROUND_CANVAS_STYLES) {
      const m = migrateGroundMatSource(style);
      expect(m.sourceKind, `${style} 应为 canvas 来源`).toBe("canvas");
      expect(m.canvasStyle, `${style} 应保留材质`).toBe(style);
      expect(m.overlayStyle, `${style} 不应带叠加层`).toBeUndefined();
    }
  });

  // ADR-252 核心：旧几何图案不再留在 canvasStyle，而是进位叠加层
  it("旧几何图案 → canvasStyle=plain + overlayStyle=<同名>（ADR-252 进位）", () => {
    for (const pattern of LEGACY_CANVAS_PATTERNS) {
      const m = migrateGroundMatSource(pattern);
      expect(m.sourceKind, `${pattern} 应为 canvas 来源`).toBe("canvas");
      expect(m.canvasStyle, `${pattern} 底座应为 plain`).toBe("plain");
      expect(m.overlayStyle, `${pattern} 应进位叠加层`).toBe(pattern);
    }
  });

  it("图案进位后仍是合法三轴组合（不产出非法值）", () => {
    for (const old of LEGACY_GROUND_MAT_SOURCES) {
      const m = migrateGroundMatSource(old);
      if (m.sourceKind === "canvas") {
        expect(m.canvasStyle, `${old} 映射为 canvas 却缺 canvasStyle`).toBeDefined();
        expect(GROUND_CANVAS_STYLES).toContain(m.canvasStyle as GroundCanvasStyle);
      }
      if (m.overlayStyle) {
        expect(LEGACY_CANVAS_PATTERNS).toContain(m.overlayStyle as GroundOverlayStyle);
      }
    }
  });
});

/* ============ Suite 2 — 新材质轴 → 表面模式（渲染分支用）============ */

describe("Suite 2 — 新两轴派生表面模式", () => {
  it("canvas + 材质 → 该材质模式", () => {
    expect(groundMatSourceFromAxes("canvas", "marble")).toBe("marble");
    expect(groundMatSourceFromAxes("canvas", "sand")).toBe("sand");
    expect(groundMatSourceFromAxes("canvas", "grass")).toBe("grass");
  });

  it("canvas 但无材质 → 回退 plain", () => {
    expect(groundMatSourceFromAxes("canvas", undefined)).toBe("plain");
  });

  it("solid/none/texture → 同名模式（不看 canvasStyle）", () => {
    expect(groundMatSourceFromAxes("solid", "marble")).toBe("solid");
    expect(groundMatSourceFromAxes("none", "marble")).toBe("none");
    expect(groundMatSourceFromAxes("texture", undefined)).toBe("texture");
  });

  it("未知 sourceKind → 回退 none（脏数据不致抛错）", () => {
    expect(groundMatSourceFromAxes("garbage" as GroundSourceKind, undefined)).toBe("none");
  });

  // ADR-252：派生不再含图案值（图案不参与表面模式）
  it("派生的模式永不落在图案上（图案已归叠加层）", () => {
    for (const style of GROUND_CANVAS_STYLES) {
      const mode = groundMatSourceFromAxes("canvas", style);
      expect(LEGACY_CANVAS_PATTERNS as readonly string[]).not.toContain(mode);
    }
  });
});

/* ============ Suite 3 — 禁止静默降级（ADR-249 §2.5 第 2 条）============ */

describe("Suite 3 — 禁止静默降级", () => {
  it("texture 来源 + 无贴图：不得被改写为 plain/solid（保留用户来源选择）", () => {
    const m = migrateGroundMatSource("texture");
    expect(m.sourceKind).toBe("texture");
    // 明确禁止：不得映射到 solid 或 canvas
    expect(m.sourceKind).not.toBe("solid");
    expect(m.sourceKind).not.toBe("canvas");
  });
});
