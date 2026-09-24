// @vitest-environment node
// ===== 仓库模型页头部模板测试（自 features/community/render.test.ts 随模板迁入，2026-09-25）=====
import { describe, it, expect } from "vitest";
import { workshopTpl } from "./tpl-workshop.ts";

const header = (over: Partial<Parameters<typeof workshopTpl.repoHeaderHTML>[0]> = {}): string =>
  workshopTpl.repoHeaderHTML({
    repo: "repo",
    source: "",
    mirror: "",
    modelsLength: 3,
    missingCount: 0,
    ...over,
  });

describe("workshopTpl.repoHeaderHTML — 计数徽章", () => {
  it("缺失数 >0 时显示下载徽章", () => {
    const html = header({ missingCount: 2 });
    // ADR-238：图标由 emoji ⬇️ 改走 SVG。断言「缺失徽章里有 SVG 且紧跟数字 2」——
    // 比断言某个具体 path 稳（图标库改路径不该弄红本测试），又比「包含任意 svg」严
    // （后者会放过「徽章换成了别的图标」这类真回归）。
    expect(html).toMatch(/gh-model-badge-missing"[^>]*><svg class="ws-icon"[\s\S]*?<\/svg>\s*2/);
    expect(html).toContain("模型 3");
  });

  it("缺失数 =0 时不渲染缺失徽章（下载按钮的图标恒常存在）", () => {
    expect(header({ missingCount: 0 })).not.toContain("gh-model-badge-missing");
  });
});

describe("workshopTpl.repoHeaderHTML — 仓库名转义", () => {
  it("仓库名经 esc 转义", () => {
    const html = header({ repo: "a<b" });
    expect(html).toContain("a&lt;b");
    expect(html).not.toContain("a<b");
  });
});

describe("workshopTpl.repoHeaderHTML — 来源/镜像徽章矩阵", () => {
  it("source: raw/jsd/api 各渲染对应徽章，未知来源不渲染", () => {
    expect(header({ source: "raw" })).toContain("link-badge-raw");
    expect(header({ source: "jsd" })).toContain("link-badge-jsd");
    expect(header({ source: "api" })).toContain("link-badge-api");
    expect(header({ source: "mystery" })).not.toContain("link-badge");
  });

  it("mirror: jsdelivr/githubapi 各渲染对应徽章，空串不渲染", () => {
    expect(header({ mirror: "jsdelivr" })).toContain("link-badge-cdn");
    expect(header({ mirror: "githubapi" })).toContain("link-badge-ghapi");
    expect(header({ mirror: "" })).not.toContain("link-badge-cdn");
    expect(header({ mirror: "" })).not.toContain("link-badge-ghapi");
  });

  it("source + mirror 徽章叠加（jsd + githubapi）", () => {
    const html = header({ source: "jsd", mirror: "githubapi" });
    expect(html).toContain("link-badge-jsd");
    expect(html).toContain("link-badge-ghapi");
    expect(html).not.toContain("link-badge-raw");
    expect(html).not.toContain("link-badge-cdn");
  });

  it("ADR-238：徽章不残留 ⚡/🐙 emoji 字面量，图标走 ws-icon SVG", () => {
    const html = header({ source: "jsd", mirror: "githubapi" });
    expect(html).not.toContain("⚡");
    expect(html).not.toContain("🐙");
    // 加速/章鱼徽章各带一枚 ws-icon SVG（⚡→performance、🐙→github）
    expect(html).toMatch(/link-badge-jsd[^"]*"[^>]*><svg class="ws-icon"/);
    expect(html).toMatch(/link-badge-ghapi[^"]*"[^>]*><svg class="ws-icon"/);
  });
});
