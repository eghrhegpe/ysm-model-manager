// ===== stg-card.test.ts — 统一卡片头/外壳构造器契约（防「图标+标题」漂移成独立 flex 项）=====
import { describe, expect, it } from "vitest";
import { stgCard, stgCardHeader } from "./stg-card.ts";

const ICON = '<svg class="ws-icon" viewBox="0 0 24 24"></svg>';
const TITLE = "游戏根目录";

describe("stgCardHeader", () => {
  it("图标与标题合并为单一标题元素（不拆成独立 flex 项）", () => {
    const html = stgCardHeader(ICON, TITLE);
    // 标题元素内部同时含图标与文字 → 二者同处一个 flex 项（label 或 span.label 皆可）
    const titleEl = html.match(/<(label|span[^>]*)\b[^>]*>([\s\S]*?)<\/(label|span)>/);
    expect(titleEl).not.toBeNull();
    expect(titleEl![2]).toContain(ICON);
    expect(titleEl![2]).toContain(TITLE);
  });

  it("默认 space-between 推标题左、actions 右", () => {
    const html = stgCardHeader(ICON, TITLE, {
      actions: '<button id="x">搜索</button>',
    });
    expect(html).toContain("justify-content:space-between;");
    // actions 在 label 之后（右侧独立项）
    const labelEnd = html.indexOf("</label>");
    expect(html.indexOf('<button id="x"')).toBeGreaterThan(labelEnd);
  });

  it("forId 生成可关联控件的 <label for=...>", () => {
    const html = stgCardHeader(ICON, TITLE, { forId: "set-link-mode" });
    expect(html).toContain('<label for="set-link-mode"');
  });

  it("无 forId 时退回 <span class=\"label\">（不与控件绑定）", () => {
    const html = stgCardHeader(ICON, TITLE);
    expect(html).toContain('<span class="label"');
    expect(html).not.toContain("<label");
  });

  it("spaceBetween:false 不注入 justify-content", () => {
    const html = stgCardHeader(ICON, TITLE, { spaceBetween: false });
    expect(html).not.toContain("justify-content");
  });

  it("titleSize:base 不注入字号样式", () => {
    const html = stgCardHeader(ICON, TITLE, { titleSize: "base" });
    expect(html).not.toContain("font-size:var(--fs-md)");
  });
});

describe("stgCard", () => {
  it("外壳包裹 header + 单一 .stg-card-body 容纳 body 插槽", () => {
    const body = '<div id="x">内容</div>';
    const html = stgCard(ICON, TITLE, body);
    expect(html).toMatch(/^<div class="stg-card">/);
    // header 在 body 之前、body 被 .stg-card-body 包裹
    const headerEnd = html.indexOf('stg-card-hdr">') + 'stg-card-hdr">'.length;
    const bodyStart = html.indexOf('<div class="stg-card-body">');
    const bodyEnd = html.indexOf(body);
    expect(bodyStart).toBeGreaterThan(headerEnd);
    expect(bodyEnd).toBeGreaterThan(bodyStart);
    expect(html).toContain(body);
  });

  it("delayMs / marginTop / cardId 经参数注入外壳", () => {
    const html = stgCard(ICON, TITLE, "", {
      cardId: "stg-files-card",
      delayMs: 180,
      marginTop: 8,
    });
    expect(html).toContain('id="stg-files-card"');
    expect(html).toContain("animation-delay:180ms");
    expect(html).toContain("margin-top:8px");
  });

  it("无 cardId 时不生成空 id 属性", () => {
    const html = stgCard(ICON, TITLE, "");
    expect(html).not.toContain('id=""');
    expect(html).not.toMatch(/<div class="stg-card"\s+>/);
  });

  it("header 选项透传给 stgCardHeader（forId 生成 label）", () => {
    const html = stgCard(ICON, TITLE, "", { header: { forId: "set-link-mode" } });
    expect(html).toContain('<label for="set-link-mode"');
  });
});
