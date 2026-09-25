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

  it("注释体内不得出现 `*/`：提前闭合会吞掉紧随的 @keyframes（曾致全 shadow fadeSlideUp 动画静默失效）", () => {
    // CSS 注释按「首个 */ 闭合」解析。若注释体里再写 */（如 “fadeSlide*/breathe-subtle”），
    // 注释提前结束，其后文本成为裸 CSS，被当作选择器、吞掉紧随的第一个 {...} 块——
    // 2026 实测吞掉 @keyframes fadeSlideUp，使 .stg-card / .settings-group / .setting-row 等
    // 全部入场动画失效（无报错、getAnimations() 为 0，长期潜伏；只有定义在破注释之前的
    // card-in / pageIn 等旧动画仍能播）。判据：按首闭合语义剥注释后，不应再有游离的 */。
    const stripped = contentCSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toContain("*/");
    // 历史上唯一被吞的那条定义必须幸存（防注释再次破口）
    expect(stripped).toContain("@keyframes fadeSlideUp");
  });
});

describe("设置页组间距契约（content-stg）", () => {
  it(".stg-grid 使用可收缩列，窄屏不把卡片压成三列", () => {
    expect(contentStgCSS).toMatch(
      /\.stg-grid\s*\{[^}]*repeat\(auto-fit,\s*minmax\(min\(220px,\s*100%\),\s*1fr\)\)/,
    );
    expect(contentStgCSS).toMatch(/\.stg-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
    expect(contentStgCSS).toMatch(/\.stg-card-hdr\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it("键位网格使用无固定上限的 auto-fit 列数", () => {
    expect(contentStgCSS).toMatch(
      /\.stg-keymap-grid\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(220px,\s*100%\),\s*1fr\)\)/,
    );
    expect(contentStgCSS).not.toMatch(
      /\.stg-keymap-grid\s*\{[^}]*grid-template-columns:\s*repeat\([123],/,
    );
  });

  it("键位动作使用单行紧凑控件而非嵌套卡片", () => {
    expect(contentStgCSS).toMatch(/\.stg-keybind-row\s*\{[^}]*margin-bottom:\s*0/);
    const rowBlock = contentStgCSS.match(/\.stg-keybind-row\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rowBlock).toMatch(/background:\s*transparent/);
    expect(rowBlock).toMatch(/border:\s*1px solid/);
    const buttonBlock = contentStgCSS.match(/\.stg-keybind-button\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(buttonBlock).toMatch(/min-width:\s*64px/);
    expect(buttonBlock).toMatch(/width:\s*auto/);
    expect(buttonBlock).toMatch(/border:/);
    expect(buttonBlock).toMatch(/background:/);
    expect(contentStgCSS).toMatch(/\.stg-keybind-button:focus-visible\s*\{/);
  });

  it("设置页主题卡与路径按钮具备原生控件的视觉重置和 focus 样式", () => {
    const themeBlock = contentUtilCSS.match(/\.theme-card\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(themeBlock).toMatch(/appearance:\s*none/);
    expect(themeBlock).toMatch(/font-family:\s*inherit/);
    expect(contentUtilCSS).toMatch(/\.theme-card:focus-visible\s*\{/);
    const pathBlock = contentStgCSS.match(/\.stg-path-val\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(pathBlock).toMatch(/appearance:\s*none/);
    expect(contentStgCSS).toMatch(/\.stg-path-val:focus-visible\s*\{/);
  });

  it("设置页原生 details 提供摘要、内边距和键盘 focus 契约", () => {
    const detailsBlock = contentStgCSS.match(/\.stg-details\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(detailsBlock).toMatch(/border:/);
    expect(detailsBlock).toMatch(/border-radius:/);
    expect(contentStgCSS).toMatch(/\.stg-details-summary\s*\{[^}]*list-style:\s*none/);
    expect(contentStgCSS).toMatch(/\.stg-details-summary:focus-visible\s*\{/);
    expect(contentStgCSS).toMatch(/\.stg-details-body\s*\{[^}]*padding:/);
  });

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

  it(".section-title 纳入入场动画（与卡片同 keyframe；标题恒定 0ms，卡片经内联 delay 错峰）", () => {
    // 2026：切 tab 时标题瞬时出现、内容再滑入（观感割裂）。标题改用与卡片同源的 fadeSlideUp，
    // class 内显式 animation-delay:0ms——卡片档从 0/60/120ms 起步，标题永不晚于其下方卡片。
    // 本断言防其被静默移除（keyframe 名被注释吞掉的教训见本文件「注释体内不得出现闭合符」用例）。
    expect(contentLayoutCSS).toMatch(/\.section-title\s*\{[^}]*animation:\s*fadeSlideUp[^}]*animation-delay:\s*0ms/);
  });

  it(".stg-desc 为正文段落唯一原语（字号/行高/颜色单点，不带 margin/动画）", () => {
    // 该配方曾内联复制 4 次（解析 tab 导语 + 关于页三张卡）。只声明排版：
    // 顶层条目靠包进 .settings-group 取 12px 下间距 + 入场动画；卡片内直接用作正文（不重复动画）。
    const block = contentStgCSS.match(/\.stg-desc\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toMatch(/font-size:\s*var\(--fs-sm\)/);
    expect(block).toMatch(/color:\s*var\(--muted\)/);
    expect(block).toMatch(/line-height:\s*1\.7/);
    expect(block).not.toMatch(/margin/);
    expect(block).not.toMatch(/animation/);
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
    // 剔注释再断言：块内说明文字自身含 “padding/margin” 字样，不剔会假红
    const block = (
      contentStgCSS.match(/\.settings-group\s*\{([^}]*)\}/)?.[1] ?? ""
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(block).toMatch(/margin-bottom:\s*12px/);
    expect(block).toMatch(/animation:\s*fadeSlideUp/);
    // 不加左右 padding：否则内容比同屏 .stg-card 多缩进 16px（行组已被当单行卡片用）
    expect(block).not.toMatch(/padding/);
  });

  it(".settings-group 紧接节标题时归零 margin（防 12+16=28px 双间距）", () => {
    // 行组出 margin-bottom、下方节标题出 padding-top，两者不折叠→叠加。
    // 靠 :has(+ .section-title) 消掉行组那份，间距归下方标题单供。
    expect(contentStgCSS).toMatch(/\.settings-group:has\(\s*\+\s*\.section-title\s*\)\s*\{[^}]*margin-bottom:\s*0/);
  });

  it(".stg-page 顶部不垫（tab 栏已有下边框；防与首个节标题叠加成 32px 悬空）", () => {
    // 历史：.stg-page 曾写 padding:16px 20px，顶部 16px 与首个 .section-title 的
    // padding-top:16px 叠加 = 32px 顶部悬空。现顶部归零，左右保持 20px。
    const block = contentStgCSS.match(/\.stg-page\s*\{([^}]*)\}/)?.[1] ?? "";
    const m = block.match(/padding:\s*([^;]+);/);
    expect(m?.[1]).toBe("0 20px 16px");
  });
});

describe("居中空态块单一原语（A 族收敛，2026-09 体检）", () => {
  /** 剔注释后逐规则扫描（花括号深度感知：`@keyframes` / `@media` 嵌套块的内层
      selector 单独归因，不被外层头吞成噪声行——旧扁平正则会误归 `sel="to"` 之类）。 */
  function rules(css: string): Array<{ sel: string; body: string }> {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const out: Array<{ sel: string; body: string }> = [];
    // 深度 0 的 selector 缓冲：遇到顶层 `{` 落一条规则；@media/@keyframes 头自身不入规则
    // （它们是块，不是选择器），其内层 selector 在 depth===1 时正常缓冲。
    let depth = 0;
    let buf = "";
    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      if (c === "{") {
        depth += 1;
        if (depth === 1) {
          const sel = buf.trim();
          // @media / @keyframes 等 at-rule 头不算「选择器规则」，跳过
          if (!/^@media|^@keyframes|^@supports|^@font-face/.test(sel)) {
            const bodyStart = i + 1;
            // 取到匹配的顶层 } 之间的 body（再扫一次深度）
            let d = 1;
            let j = bodyStart;
            while (j < clean.length && d > 0) {
              if (clean[j] === "{") d += 1;
              else if (clean[j] === "}") d -= 1;
              j += 1;
            }
            out.push({ sel, body: clean.slice(bodyStart, j - 1) });
            i = j - 1; // 跳到匹配的 }
          }
          buf = "";
        } else {
          buf = ""; // 嵌套块（@media/@keyframes 内）selector 重新起缓冲
        }
        continue;
      }
      if (c === "}") {
        depth -= 1;
        buf = "";
        continue;
      }
      buf += c;
    }
    return out;
  }
  const SCANNED: Array<[string, string]> = [
    ["layout", contentLayoutCSS],
    ["repo", contentRepoCSS],
    ["creator", contentCreatorCSS],
    ["diag", contentDiagCSS],
    ["gh", contentGhCSS],
    ["util", contentUtilCSS],
    ["stg", contentStgCSS],
  ];

  it("「竖排 + 双向居中」配方只出现在 .placeholder-box（防再复刻）", () => {
    // 历史：同一配方曾有三份实现——.placeholder-box（定义在此却零消费者）、
    // 实例页内联副本（还借了 app-preview 的类名 .dp-placeholder，本 shadow 内无规则）、
    // 工坊 .cr-empty-site；值还漂了（--fs-base vs --fs-md）。
    const offenders: string[] = [];
    for (const [domain, css] of SCANNED) {
      for (const r of rules(css)) {
        // 签名 = 竖排 + 双向居中 + muted 文案（空态的语义标记）。
        // 刻意不只用三个 flex 属性：那会误伤「圆环内居中数字」这类正当用法
        //（.health-ring-inner = position:absolute 的体检分数环内层，无 flex:1 无 muted）。
        const centered =
          /flex-direction:\s*column/.test(r.body) &&
          /justify-content:\s*center/.test(r.body) &&
          /align-items:\s*center/.test(r.body) &&
          /color:\s*var\(--muted\)/.test(r.body);
        if (centered && !r.sel.startsWith(".placeholder-box")) {
          offenders.push(`${domain}: ${r.sel}`);
        }
      }
    }
    expect(
      offenders,
      `居中空态配方被复刻（应收编进 content-layout 的 .placeholder-box）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("原语三件套齐备（主体 / 大图标槽 / 留白变体），且不再是死 CSS", () => {
    expect(contentLayoutCSS).toMatch(/\.placeholder-box\s*\{[^}]*flex:1/);
    expect(contentLayoutCSS).toMatch(/\.placeholder-box \.big\s*\{/);
    expect(contentLayoutCSS).toMatch(/\.placeholder-box--roomy\s*\{/);
  });

  it("退役的复刻类不再有规则（.cr-empty-site）", () => {
    expect(contentCreatorCSS).not.toMatch(/\.cr-empty-site\s*\{/);
  });
});

// ===== 诊断页起跑线契约（2026-09-25 收口）=====
// 与上方「间距同源」用例同族：防的是两种留白来源并存 → 同一屏出现多条左起跑线。
describe("诊断页起跑线契约", () => {
  it("子 pill 行左右不留白：与常驻栏/结果区同落 .diag-panel 的 12px", () => {
    // 此前 .diag-sub-bar 用 --btn-padding-std（4px 10px）→ pill 行落在 22px，
    // 而它管辖的 .diag-bar / .diag-result 左右 padding 均为 0 → 落在 12px，
    // 导航比自己的栏右移 10px，三 tab 一致地错位。
    const rule = contentDiagCSS.match(/\.diag-sub-bar\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/padding:\s*var\(--sp-1\)\s+0/);
    expect(rule).not.toContain("--btn-padding-std");
  });

  it("留白唯一来源：.diag-bar 与 .diag-result 均不带左右 padding", () => {
    // 「常驻栏滚走」那次收口把滚动交给 .diag-result 后，留白上交 .diag-panel；
    // 若此处再长出左右 padding，起跑线就重新分裂成 12 / 22 / 28 三档。
    expect(contentDiagCSS).toMatch(/\.diag-bar\s*\{[^}]*padding:\s*0 0 6px/);
    expect(contentDiagCSS).toMatch(/\.diag-result\s*\{[^}]*flex:1/);
    expect(contentDiagCSS).not.toMatch(/\.diag-result\s*\{[^}]*padding:/);
  });
});
