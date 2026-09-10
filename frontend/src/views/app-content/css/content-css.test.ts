// ===== content-css 聚合层哨兵测试 =====
// 防回归：某叶被删/改名/HMR 作用域漂移时，聚合不再等价于 6 叶拼接。
// 不测样式语义——只测「6 源全在场、顺序固定、无空叶吞入」。

import { describe, it, expect } from "vitest";
import { contentCSS } from "./content-css.ts";
import { contentCreatorCSS } from "./content-creator.ts";
import { contentDiagCSS } from "./content-diag.ts";
import { contentLayoutCSS } from "./content-layout.ts";
import { contentRepoCSS } from "./content-repo.ts";
import { contentStgCSS } from "./content-stg.ts";
import { contentUtilCSS } from "./content-util.ts";

// 顺序须与 content-css.ts 的 [layout, repo, creator, diag, util, stg] 一致
const leaves = [
  contentLayoutCSS,
  contentRepoCSS,
  contentCreatorCSS,
  contentDiagCSS,
  contentUtilCSS,
  contentStgCSS,
] as const;

describe("content-css 聚合层", () => {
  it("contentCSS === 6 叶按固定顺序 join(\"\\n\")", () => {
    expect(contentCSS).toBe(leaves.join("\n"));
  });

  it("每叶非空（防空叶静默吞入聚合）", () => {
    for (const css of leaves) expect(css.length).toBeGreaterThan(0);
  });

  it("每叶内容均出现在聚合中（单叶丢失定位）", () => {
    for (const css of leaves) expect(contentCSS).toContain(css);
  });
});
