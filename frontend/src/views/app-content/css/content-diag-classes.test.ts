// @vitest-environment node
// ===== 诊断页日志工具栏：类名 ↔ CSS 规则 契约测试（2026-09 立）=====
//
// 立因：ADR-258（e21010837）重构诊断页导航时，把 `.diag-log-fbtn` 的三条规则
// 随 `.diag-btn*` 左栏残留一并删除，但该类的 4 个筛选按钮**仍在使用**——
// 结果裸渲染（无边框/无圆角/无选中态），且无任何测试发现。
//
// 本测试锁住这条不变量：**tpl 里出现的类名，CSS 里必须有对应规则**。
// 它防的是「删 CSS 忘删用途」这一类静默回归，不是样式语义。
import { describe, it, expect, vi } from "vitest";
import { diagnosticsHTML } from "@/views/app-content/tpl.ts";
import { contentDiagCSS } from "./content-diag.ts";

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

/** CSS 文本里是否存在该类的规则（`.cls {` 或 `.cls,` / `.cls:` / `.cls.` 组合） */
function hasRule(css: string, cls: string): boolean {
  return new RegExp(`\\.${cls.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w-])`).test(css);
}

describe("诊断页日志工具栏：HTML 类名必须有 CSS 规则", () => {
  const html = diagnosticsHTML();
  const css = contentDiagCSS;

  it("解析器自检：确实抽到日志工具栏类名（防正则静默失效假绿）", () => {
    const cls = classesWithPrefix(html, "diag-log-");
    expect(cls.length).toBeGreaterThan(0);
    expect(cls).toContain("diag-log-fbtn");
  });

  // ADR-258 回归的具体锁定：这三个类曾整体丢失规则
  it.each(["diag-log-fbtn", "diag-sub-tab", "diag-log-filter"])(
    ".%s 在 content-diag CSS 里有规则",
    (cls) => {
      expect(hasRule(css, cls)).toBe(true);
    },
  );

  it("日志工具栏所有 diag-log-* / diag-sub-tab 类均有规则（防再次误删）", () => {
    const cls = [
      ...classesWithPrefix(html, "diag-log-"),
      ...classesWithPrefix(html, "diag-sub-tab"),
    ];
    // 排除仅作 JS 钩子、无需样式的占位类（当前无；若新增请显式登记并说明）
    const exempt = new Set<string>();
    const missing = cls.filter((c) => !exempt.has(c) && !hasRule(css, c));
    expect(missing).toEqual([]);
  });

  it("选中态统一为 accent 18% 淡化（非实心 accent）——同工具栏内一致", () => {
    // .diag-sub-tab.active 与 .diag-log-fbtn.active 必须同款，防再次分叉
    const subTabActive = css.match(/\.diag-sub-tab\.active\s*\{([^}]*)\}/)?.[1] ?? "";
    const fbtnActive = css.match(/\.diag-log-fbtn\.active\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(subTabActive).toContain("color-mix(in srgb, var(--accent) 18%, transparent)");
    expect(fbtnActive).toContain("color-mix(in srgb, var(--accent) 18%, transparent)");
    // 两者都不应回退到实心 accent 底
    expect(subTabActive).not.toMatch(/background:\s*var\(--accent\)\s*;/);
    expect(fbtnActive).not.toMatch(/background:\s*var\(--accent\)\s*;/);
  });
});
