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

  it(".stg-sub-title 不再叠加 margin-top（防与 .section-title 双重 16px）", () => {
    // 历史 bug：「字体与布局」「3D 预览」「鸣谢」同时挂 .section-title + .stg-sub-title，
    // .section-title 的 padding-top:16px 与 .stg-sub-title 的 margin-top:16px 叠加 = 32px。
    // 现 .stg-sub-title 归零（类保留兼容，但不提供间距）。
    // 匹配 0 / 0px 两种写法（归零即可，勿再给正间距）
    const m = contentStgCSS.match(/\.stg-sub-title\s*\{\s*margin-top:\s*(\d+)(?:px)?;/);
    expect(m?.[1]).toBe("0");
  });

  it(".stg-title 不提供 margin（标题下间距单一来源 = .section-title 的 padding-bottom）", () => {
    // 历史 bug：.stg-title{margin-bottom:8px} 与 .section-title{padding-bottom:8px} 叠加成 16px——
    // padding 与 margin 不折叠，两个旋钮管同一件事，只改一个不生效。
    // 先剔注释：规则块内的说明文字本身含 “margin” 字样，不剔会自触发假红
    const block = (contentStgCSS.match(/\.stg-title\s*\{([^}]*)\}/)?.[1] ?? "").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(block).not.toMatch(/margin/);
  });

  it(".settings-group 常量入类：间距/动画由类宣告，不再靠内联副本", () => {
    // 历史：本类曾只有 padding:0 16px，垂直间距靠 7 处手写内联 margin-bottom:12px。
    const block = contentStgCSS.match(/\.settings-group\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/margin-bottom:\s*12px/);
    expect(block).toMatch(/animation:\s*card-in/);
  });

  it(".settings-group 紧接节标题时归零 margin（防 12+16=28px 双间距）", () => {
    // 行组出 margin-bottom、下方节标题出 padding-top，两者不折叠→叠加。
    // 靠 :has(+ .section-title) 消掉行组那份，间距归下方标题单供。
    expect(contentStgCSS).toMatch(/\.settings-group:has\(\s*\+\s*\.section-title\s*\)\s*\{[^}]*margin-bottom:\s*0/);
  });
});
