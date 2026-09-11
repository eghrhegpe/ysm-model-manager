// ===== preview-paths 不变量测试 =====
// 类型一致性（KNOWN_PATHS ⇄ PathValue）已由 typecheck 守护；此处锁 typecheck 查不出的
// 运行时不变量：无重复键、namespace.field 形态、六项横切键防整体误删。
import { describe, it, expect } from "vitest";
import { KNOWN_PATHS } from "./preview-paths.ts";

// 同步设置契约形状：namespace.field（首段小写字母开头）
const PATH_RE = /^[a-z][a-zA-Z0-9]*\.[a-zA-Z][a-zA-Z0-9]*$/;

describe("preview-paths 不变量", () => {
  it("KNOWN_PATHS 非空且无重复键（typecheck 查不出重复）", () => {
    expect(KNOWN_PATHS.length).toBeGreaterThan(0);
    expect(new Set(KNOWN_PATHS).size).toBe(KNOWN_PATHS.length);
  });

  it("每个路径符合同步设置契约形状（namespace.field）", () => {
    for (const p of KNOWN_PATHS) {
      expect(p, `路径 "${p}" 应为 namespace.field 形式`).toMatch(PATH_RE);
    }
  });

  it("保留 ADR-125 六项横切路径（防整体误删）", () => {
    const core = [
      "render.frustumCull",
      "render.maxFps",
      "render.maxPixelRatio",
      "render.bloom",
      "render.wireframe",
      "env.pmrem",
    ];
    for (const c of core) {
      expect(KNOWN_PATHS, `缺核心横切键 ${c}`).toContain(c);
    }
  });
});
