// ===== renderIconHtml：图标字段「字符串版」三态契约（applyIcon 的模板串孪生）=====
// 背景：innerHTML 模板拼接消费方（card-shell / detail / 各 tpl）拿到的 icon 字段三源并存——
// 预构建 SVG 常量、语义名、DataGlyph 字形。单走 resolveIcon||esc 会把 SVG 常量误转义成
// 字面文本（初版方案实测破口），三态判别由本函数收口；R8 模板闸按 render* builder 命名信任。
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderIconHtml } from "./resolve.ts";
import { UI_ICONS } from "./ui-icons.ts";

describe("renderIconHtml 三态", () => {
  it("预构建 SVG 常量 → 原样透传（不得二次转义成字面文本）", () => {
    expect(renderIconHtml(UI_ICONS.search)).toBe(UI_ICONS.search);
  });
  it("语义名 → resolveIcon 产物 SVG（preview-router 的 icon:\"unknown\" 字面名回归）", () => {
    const html = renderIconHtml("unknown");
    expect(html).toBe(UI_ICONS.unknown); // 强断言：产物须恰好是 UI_ICONS.unknown（防外壳被改后仍 toContain("<svg") 假绿）
  });
  it("数据图标字形（DataGlyph）→ 文本原样落位", () => {
    expect(renderIconHtml("☀️")).toBe("☀️");
    expect(renderIconHtml("🦴")).toBe("🦴");
  });
  it("含 HTML 元字符的文本 → esc 收口为文本面（注入防御）", () => {
    expect(renderIconHtml('<img src=x onerror=1>')).toContain("&lt;img");
  });
  it("空 / undefined → 空串（无图标位）", () => {
    expect(renderIconHtml(undefined)).toBe("");
    expect(renderIconHtml("")).toBe("");
  });
});
