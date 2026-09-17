// @vitest-environment node
// ===== 诊断页日志工具栏：类名 ↔ CSS 规则 契约测试（2026-09 立）=====
//
// 立因：ADR-258（e21010837）重构诊断页导航时，把 `.diag-log-fbtn` 的三条规则
// 随 `.diag-btn*` 左栏残留一并删除，但该类的 4 个筛选按钮**仍在使用**——
// 结果裸渲染（无边框/无圆角/无选中态），且无任何测试发现。
//
// 本测试锁住这条不变量：**tpl 里出现的类名，生效样式表里必须有规则**。
// 它防的是「删 CSS 忘删用途」这一类静默回归，不是样式语义。
//
// 判定域用 **contentCSS 聚合**（而非单叶 content-diag）：筛选组规则按「同 shadow 根共享」
// 原则写在 content-creator.ts（.cr-tag-filter-btn, .diag-log-fbtn 合并选择器），
// 单看 content-diag 会误判为缺失。
import { describe, it, expect, vi } from "vitest";
import { diagnosticsHTML } from "@/views/app-content/tpl.ts";
import { contentCSS } from "./content-css.ts";

vi.mock("@/backend/platform.ts", () => ({
  getAndroidBridge: vi.fn().mockReturnValue(null),
  isViewerMode: vi.fn().mockReturnValue(false),
}));
vi.mock("@/backend/platform-web.ts", () => ({
  isWebPlatform: vi.fn().mockReturnValue(false),
  canBinding: vi.fn().mockReturnValue(true),
}));

/** 抽出指定前缀的类名（诊断页日志工具栏相关） */
function classesWithPrefix(html: string, prefix: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (c.startsWith(prefix)) found.add(c);
    }
  }
  return [...found];
}

/**
 * 类名是否有「实质样式」。
 *
 * 分两类判据（一刀切会误伤布局类）：
 *  - **交互类**（-btn / -tab 结尾，或含 filter/button）：规则体须含外观属性
 *    （border / background / color）——纯字号覆盖（如 .diag-log-fbtn { font-size }）
 *    会让弱判据假绿，而该类实际已退化成裸渲染。
 *  - **布局类**（bar / scroll / spacer / subtabs 等）：有规则即算通过，
 *    它们本就只写 display / flex / gap / overflow。
 *
 * ⚠️ 匹配前必须剥离 CSS 注释：否则注释文本会被当成选择器片段，
 *    紧随其后的其它规则体被误配到它身上（实测：删除共享选择器后仍假绿）。
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function hasSubstantiveRule(rawCss: string, cls: string): boolean {
  const css = stripComments(rawCss);
  const esc = cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`(^|[},])\\s*([^{}]*\\.${esc}(?![\\w-])[^{}]*)\\{([^}]*)\\}`, "gm");
  // 交互类判据：名字以 btn/-btn / -tab 结尾，或含 filter/button。
  // ⚠️ 不能用「含 tab」——会把容器 .diag-log-subtabs（display:flex 容器）误判为按钮。
  // 交互类判据：含 btn（覆盖 -btn / -fbtn 等缩写）或 filter/button，或 -tab 结尾。
  // ⚠️ 不能用「含 tab」——会把容器 .diag-log-subtabs（display:flex 容器）误判为按钮。
  // ⚠️ 必须用「含 btn」而非「-btn$」：.diag-log-fbtn 的 -fbtn 不以 -btn 结尾（实测漏判致假绿）。
  const interactive = /(btn|filter|button|-tab$)/.test(cls);
  for (const m of css.matchAll(re)) {
    const body = m[3];
    if (!interactive) return true;
    if (/\b(border|background|color)\s*:/.test(body)) return true;
  }
  return false;
}

describe("诊断页日志工具栏：HTML 类名必须有 CSS 规则", () => {
  const html = diagnosticsHTML();
  const css = contentCSS;

  it("解析器自检：确实抽到日志工具栏类名（防正则静默失效假绿）", () => {
    const cls = classesWithPrefix(html, "diag-log-");
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).toContain("diag-log-fbtn");
  });

  // ADR-258 回归的具体锁定：这三个类曾整体丢失规则
  it.each(["diag-log-fbtn", "diag-sub-tab", "diag-log-filter"])(
    ".%s 在生效样式表（contentCSS 聚合）里有规则",
    (cls) => {
      expect(hasSubstantiveRule(css, cls)).toBe(true);
    },
  );

  it("日志工具栏所有 diag-log-* / diag-sub-tab 类均有规则（防再次误删）", () => {
    const cls = [
      ...classesWithPrefix(html, "diag-log-"),
      ...classesWithPrefix(html, "diag-sub-tab"),
    ];
    // 排除仅作 JS 钩子、无需样式的占位类（当前无；若新增请显式登记并说明）
    const exempt = new Set<string>();
    const missing = cls.filter((c) => !exempt.has(c) && !hasSubstantiveRule(css, c));
    expect(missing).toEqual([]);
  });

  it("选中态统一为 accent 18% 淡化（非实心 accent）——同工具栏内一致", () => {
    // .diag-sub-tab.active 与 .diag-log-fbtn.active 必须同款，防再次分叉
    const subTabActive = css.match(/\.diag-sub-tab\.active\s*\{([^}]*)\}/)?.[1] ?? "";
    const fbtnActive = css.match(/\.diag-log-fbtn\.active[^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(subTabActive).toContain("color-mix(in srgb, var(--accent) 18%, transparent)");
    expect(fbtnActive).toContain("color-mix(in srgb, var(--accent) 18%, transparent)");
    // 两者都不应回退到实心 accent 底
    expect(subTabActive).not.toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(fbtnActive).not.toMatch(/background:\s*var\(--accent\)\s*;/);
  });
});
