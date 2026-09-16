// @vitest-environment happy-dom
// ===== ui-components-styles 契约冒烟测试 =====
// 断言消费者（cap-controls / render / ui-header-toggle / slide-menu-styles）引用的关键 class
// 存在于 componentsCss 字符串中。生成脚本若漏吐某个 class，构建绿但运行时样式崩——此测试兜底。
import { describe, it, expect } from "vitest";
import { componentsCss } from "./components-styles.ts";

// 消费者引用的关键 class（按模块分组，便于定位缺失来源）
const CRITICAL_CLASSES = {
  // cap-controls.ts：自绘滑块（cs-bar + cs-fill + cs-thumb）
  "cap-controls::slider": [".cs-bar", ".cs-fill", ".cs-thumb"],
  // cap-controls.ts：基础行/标签/选择器
  "cap-controls::base": [".slide-item", ".slide-label", ".setting-select"],
  // render.ts：字段行/图标/子标签
  "render::field": [".field-row", ".field-label", ".field-value", ".slide-icon", ".slide-sublabel"],
  // ui-header-toggle.ts：开关四件套
  "ui-header-toggle": [".toggle", ".slider", ".header-toggle", ".toggle-disabled"],
  // slide-menu-styles.ts：折叠组/章节/cs-icon
  "slide-menu-styles": [".collapsible-label", ".section-title", ".collapsible-header", ".cs-icon"],
  // slide-menu.ts：render-card 容器
  "slide-menu::render-card": [".render-card"],
} as const;

describe("componentsCss 契约冒烟", () => {
  for (const [group, selectors] of Object.entries(CRITICAL_CLASSES)) {
    describe(`消费者: ${group}`, () => {
      for (const sel of selectors) {
        it(`包含 ${sel}`, () => {
          expect(componentsCss).toContain(sel);
        });
      }
    });
  }

  // 3D overlay 是唯一 adopt 本串的 shadow 根，UI_ICONS 的 SVG 靠这里的 .ws-icon 着色/定尺。
  // 缺失时不是「图块过大」而是**0×0 不可见**：.slide-icon 是 flex 容器，无 width:1em 的
  // SVG 自动尺寸为 0（2026-09 实测 computed fill=rgb(0,0,0) / stroke=none / box=0x0）。
  it("自带 .ws-icon 规则（3D overlay 行图标唯一可达的着色/尺寸源）", () => {
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*width:\s*1em/);
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*fill:\s*none/);
    expect(componentsCss).toMatch(/\.ws-icon\s*\{[^}]*stroke:\s*currentColor/);
  });
  it("非空字符串", () => {
    expect(componentsCss.length).toBeGreaterThan(1000);
  });
});
