// ===== content-css 聚合层哨兵测试 =====
// 防回归：某叶被删/改名/HMR 作用域漂移时，聚合不再等价于 7 叶拼接。
// 不测样式语义——只测「7 源全在场、顺序固定、无空叶吞入」。

import { describe, it, expect } from "vitest";
import { contentCSS } from "./content-css.ts";
import { contentCreatorCSS } from "./content-creator.ts";
import { contentDiagCSS } from "./content-diag.ts";
import { contentGhCSS } from "./content-gh.ts";
import { contentLayoutCSS } from "./content-layout.ts";
import { contentRepoCSS } from "./content-repo.ts";
import { contentStgCSS } from "./content-stg.ts";
import { contentUtilCSS } from "./content-util.ts";

// 顺序须与 content-css.ts 的 [layout, repo, creator, diag, gh, util, stg] 一致
const leaves = [
  contentLayoutCSS,
  contentRepoCSS,
  contentCreatorCSS,
  contentDiagCSS,
  contentGhCSS,
  contentUtilCSS,
  contentStgCSS,
] as const;

describe("content-css 聚合层", () => {
  it("contentCSS === 7 叶按固定顺序 join(\"\\n\")", () => {
    expect(contentCSS).toBe(leaves.join("\n"));
  });

  it("每叶非空（防空叶静默吞入聚合）", () => {
    for (const css of leaves) expect(css.length).toBeGreaterThan(0);
  });

  it("每叶内容均出现在聚合中（单叶丢失定位）", () => {
    for (const css of leaves) expect(contentCSS).toContain(css);
  });
});

describe("设置页组间距契约（content-stg）", () => {
  it(".stg-section 提供显式组间距；.stg-grid-2 为两列变体", () => {
    // 不能再依赖 .section-title{padding:16px 16px 8px} 隐式撑间隔：
    // 卡片自带 card-hdr 的组不挂标题，缺了那根「间隔柱」就会与上方贴死
    expect(contentCSS).toContain(".stg-section {");
    expect(contentStgCSS).toMatch(/\.stg-section\s*\{\s*margin-top:\s*16px/);
    expect(contentStgCSS).toMatch(/\.stg-grid-2\s*\{[^}]*repeat\(2/);
  });

  it(".stg-section 与 .section-title 间距同源（16px），避免两种组间距不一致", () => {
    // A（带标题）走 .section-title 的 padding-top；B（无标题）走 .stg-section 的 margin-top。
    // 两者数值须相等，否则同一页内两种组的视觉节奏不一致。
    const titlePadTop = contentLayoutCSS.match(/\.section-title\s*\{[^}]*padding:\s*(\d+)px/);
    const sectionMargin = contentStgCSS.match(/\.stg-section\s*\{\s*margin-top:\s*(\d+)px/);
    expect(titlePadTop?.[1]).toBe(sectionMargin?.[1]);
  });
});
