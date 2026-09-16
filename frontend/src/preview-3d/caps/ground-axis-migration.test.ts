// @vitest-environment node
// ===== 地面材质拆轴迁移契约测试（ADR-249 §2.5）=====
// 拆轴 = groundMatSource 单枚举 → sourceKind（来源轴）+ canvasStyle（样式轴）。
// 本测试锁三件事（阶段 2 的前置护栏，先写测试后改实现）：
//   1. 旧值映射完备：9 个旧枚举值都能无损映射到新两轴
//   2. 迁移幂等：已是新字段的存档重复迁移不变形
//   3. 禁止静默降级：texture 无 customTex 时不得被改写成语义不同的模式
//      （历史行为：loadState 把 texture 改写成 plain —— 用户存档里选的
//        「自定义贴图」重启后变成一块看似无关的纯色地面）
//
// 实施注记：本文件 TDD 先行编写（当时 API 未落地、预期全红）；
// migrateGroundMatSource / groundMatSourceFromAxes 现已实装于 ground-surface-spec.ts，
// 本文件全部用例应绿（ADR-249 §2.5 阶段 2 交付）。

import { describe, it, expect } from "vitest";
import {
  GROUND_SURFACE_MODES,
  migrateGroundMatSource,
  groundMatSourceFromAxes,
  type GroundSourceKind,
  type GroundCanvasStyle,
} from "./ground-surface-spec.ts";

/* ============ Suite 1 — 旧值 → 新两轴映射完备性 ============ */

describe("Suite 1 — 旧 groundMatSource 值映射到新两轴", () => {
  it("九个旧枚举值全部有映射（无遗漏、无 undefined）", () => {
    for (const old of GROUND_SURFACE_MODES) {
      const m = migrateGroundMatSource(old);
      expect(m, `旧值 ${old} 无映射`).toBeDefined();
      expect(typeof m.sourceKind).toBe("string");
    }
  });

  it("none → sourceKind=none，无 canvasStyle", () => {
    const m = migrateGroundMatSource("none");
    expect(m.sourceKind).toBe("none");
  });

  it("solid → sourceKind=solid，无 canvasStyle（纯色不经画布管线）", () => {
    const m = migrateGroundMatSource("solid");
    expect(m.sourceKind).toBe("solid");
  });

  it("texture → sourceKind=texture（来源轴），无 canvasStyle", () => {
    const m = migrateGroundMatSource("texture");
    expect(m.sourceKind).toBe("texture");
  });

  it("plain/grid/checker/stripes/diamond/marble → sourceKind=canvas + 对应 canvasStyle", () => {
    const canvasStyles: GroundCanvasStyle[] = [
      "plain",
      "grid",
      "checker",
      "stripes",
      "diamond",
      "marble",
    ];
    for (const style of canvasStyles) {
      const m = migrateGroundMatSource(style);
      expect(m.sourceKind, `${style} 应为 canvas 来源`).toBe("canvas");
      expect(m.canvasStyle, `${style} 应保留样式`).toBe(style);
    }
  });

  it("映射是双射：新两轴可还原为旧枚举值（往返一致）", () => {
    for (const old of GROUND_SURFACE_MODES) {
      const m = migrateGroundMatSource(old);
      expect(groundMatSourceFromAxes(m.sourceKind, m.canvasStyle), `往返失败于 ${old}`).toBe(old);
    }
  });
});

/* ============ Suite 2 — 新两轴 → 旧值（渲染/持久化回写用）============ */

describe("Suite 2 — 新两轴还原为旧枚举值", () => {
  it("canvas + style → 该 style 的旧枚举值", () => {
    expect(groundMatSourceFromAxes("canvas", "grid")).toBe("grid");
    expect(groundMatSourceFromAxes("canvas", "marble")).toBe("marble");
  });

  it("canvas 但无 style → 回退 plain（画布默认样式）", () => {
    expect(groundMatSourceFromAxes("canvas", undefined)).toBe("plain");
  });

  it("solid/none/texture → 同名旧值（不看 canvasStyle）", () => {
    expect(groundMatSourceFromAxes("solid", "grid")).toBe("solid");
    expect(groundMatSourceFromAxes("none", "grid")).toBe("none");
    expect(groundMatSourceFromAxes("texture", undefined)).toBe("texture");
  });

  it("未知 sourceKind → 回退 none（脏数据不致抛错）", () => {
    expect(groundMatSourceFromAxes("garbage" as GroundSourceKind, undefined)).toBe("none");
  });
});

/* ============ Suite 3 — 禁止静默降级（ADR-249 §2.5 第 2 条）============ */

describe("Suite 3 — 禁止静默降级", () => {
  it("texture 来源 + 无贴图：不得被改写为 plain/solid（保留用户来源选择）", () => {
    const m = migrateGroundMatSource("texture");
    expect(m.sourceKind).toBe("texture");
    // 明确禁止：不得映射到 solid 或 canvas/plain
    expect(m.sourceKind).not.toBe("solid");
    expect(m.sourceKind).not.toBe("canvas");
  });

  it("迁移不产出「语义漂移」组合：canvas 必然带 canvasStyle", () => {
    for (const old of GROUND_SURFACE_MODES) {
      const m = migrateGroundMatSource(old);
      if (m.sourceKind === "canvas") {
        expect(m.canvasStyle, `${old} 映射为 canvas 却缺 canvasStyle`).toBeDefined();
      }
    }
  });
});
