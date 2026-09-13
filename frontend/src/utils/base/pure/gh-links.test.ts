// @vitest-environment node
// ===== gh-links.ts GitHub 仓库链接单一来源（防仓库迁移漂移）测试 =====
import { describe, it, expect } from "vitest";
import { GH_REPO, GH_RELEASES, GH_DOCS } from "./gh-links.ts";

describe("gh-links — 仓库链接常量", () => {
  it("GH_REPO 为合法 github 仓库 URL（仓库改名/迁移时本断言先爆）", () => {
    expect(GH_REPO).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  });

  it("GH_RELEASES 由 GH_REPO 派生", () => {
    expect(GH_RELEASES).toBe(`${GH_REPO}/releases`);
  });

  it("GH_DOCS 由 GH_REPO 派生（tree/main/docs）", () => {
    expect(GH_DOCS).toBe(`${GH_REPO}/tree/main/docs`);
  });
});
