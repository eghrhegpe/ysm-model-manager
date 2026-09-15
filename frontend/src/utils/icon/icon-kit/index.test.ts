// @vitest-environment node
import { describe, it, expect } from "vitest";
import { ICON_KIT, iconKitNames, renderIcon } from "./index.ts";

describe("icon-kit", () => {
  it("enableAll 默认 SVG 源（SVG 优先），渲染 .ws-icon + 24×24", () => {
    expect(ICON_KIT.enableAll.src).toBe("svg");
    const html = renderIcon(ICON_KIT.enableAll);
    expect(html).toMatch(/<svg class="ws-icon" viewBox="0 0 24 24">/);
    expect(html).toContain("<polyline");
  });

  it("disableAll 也是 SVG 源（成对一致），渲染打叉", () => {
    expect(ICON_KIT.disableAll.src).toBe("svg");
    const html = renderIcon(ICON_KIT.disableAll);
    expect(html).toMatch(/<svg class="ws-icon" viewBox="0 0 24 24">/);
    expect(html).toContain('<line x1="8" y1="8" x2="16" y2="16"/>');
  });

  it("svg 源复用 .ws-icon 约定（随主题/字号）", () => {
    const html = renderIcon({ src: "svg", svg: "<line/>" });
    expect(html).toContain('class="ws-icon"');
    expect(html).toContain('viewBox="0 0 24 24"');
  });

  it("emoji 源保留字符原始外观", () => {
    expect(renderIcon({ src: "emoji", char: "⭐" })).toBe(`<span class="eicon">⭐</span>`);
  });

  it("font 源渲染 .ficon + 类名（图标字体预留）", () => {
    expect(renderIcon({ src: "font", className: "fa-solid fa-trash" })).toBe(
      '<span class="ficon fa-solid fa-trash"></span>',
    );
  });

  it("unreachable-but-safe：无效输入回退为空串（防御未来新增源）", () => {
    // 通过先扩展到 unknown 再调用，验证 render 对未知 src 的 default 回退（不破坏结构）
    const bad = { src: "does-not-exist", svg: "" } as unknown as Parameters<typeof renderIcon>[0];
    expect(renderIcon(bad)).toBe("");
  });

  it("iconKitNames 返回全部语义名（稳定排序）", () => {
    const names = iconKitNames();
    expect(names).toContain("enableAll");
    expect(names).toContain("disableAll");
    expect([...names].sort()).toEqual(names);
  });
});