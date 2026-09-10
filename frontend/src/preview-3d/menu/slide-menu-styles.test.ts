// @vitest-environment happy-dom
// ===== ui-slide-menu-styles 契约冒烟测试 =====
// 断言 slide-menu.ts 引用的关键 DOM 类存在于 slideMenuCss 字符串中。
import { describe, it, expect } from "vitest";
import { slideMenuCss } from "./slide-menu-styles.ts";

// slide-menu.ts 构建的 DOM 树使用的类名
const CRITICAL_CLASSES = {
  // smBuildShell 构建的外壳结构
  "shell::structure": [
    ".menu-wrapper",
    ".slide-menu",
    ".slide-viewport",
    ".slide-header",
    ".slide-panel",
    ".slide-list",
    ".render-card",
  ],
  // smBuildShell 构建的标题栏
  "shell::header": [".slide-back", ".slide-title"],
  // smRenderTop 引用的内部组件类（slide-menu-styles 强制白色调）
  "inner-components": [
    ".slide-item",
    ".slide-label",
    ".field-label",
    ".field-value",
    ".collapsible-label",
    ".section-title",
    ".slide-icon",
    ".cs-icon",
    ".collapsible-header",
  ],
} as const;

describe("slideMenuCss 契约冒烟", () => {
  for (const [group, selectors] of Object.entries(CRITICAL_CLASSES)) {
    describe(`消费者: ${group}`, () => {
      for (const sel of selectors) {
        it(`包含 ${sel}`, () => {
          expect(slideMenuCss).toContain(sel);
        });
      }
    });
  }

  it("非空字符串", () => {
    expect(slideMenuCss.length).toBeGreaterThan(100);
  });
});
