import { describe, it, expect } from "vitest";
import { esc, hl } from "./html.ts";

describe("esc", () => {
  it("escapes &", () => expect(esc("a&b")).toBe("a&amp;b"));
  it("escapes <", () => expect(esc("a<b")).toBe("a&lt;b"));
  it("escapes >", () => expect(esc("a>b")).toBe("a&gt;b"));
  it("escapes double quote", () => expect(esc('a"b')).toBe("a&quot;b"));
  it("escapes single quote", () => expect(esc("a'b")).toBe("a&#39;b"));
  it("returns empty for null", () => expect(esc(null as unknown as string)).toBe(""));
  it("returns empty for undefined", () => expect(esc(undefined as unknown as string)).toBe(""));
});

describe("hl", () => {
  it("returns escaped text when no query", () => {
    expect(hl("hello <world>", "")).toBe("hello &lt;world&gt;");
  });
  it("wraps match in <mark>", () => {
    expect(hl("hello world", "world")).toBe("hello <mark>world</mark>");
  });
  it("is case-insensitive", () => {
    expect(hl("Hello World", "world")).toBe("Hello <mark>World</mark>");
  });
  it("returns escaped text when no match", () => {
    expect(hl("hello", "xyz")).toBe("hello");
  });
  it("escapes HTML in match context", () => {
    expect(hl("<hello>", "hello")).toBe("&lt;<mark>hello</mark>&gt;");
  });
  // P3 补测：判别性用例——「先整体转义再查找」会因 &lt; 错位把 lt 高亮成空，
  // 正确实现在原始 text 上定位、三段各自 esc
  it("&lt; 实体高亮判别（正确实现 vs 先转义再查）", () => {
    expect(hl("&lt;", "lt")).toBe("&amp;<mark>lt</mark>;");
  });
  // P3 补测：Unicode 大小写折叠长度变化（土耳其 İ → "i̇" 2 码元）→ 降级纯转义防错切
  it("Unicode 折叠长度变化时降级纯转义（不产空 mark）", () => {
    const out = hl("AİB", "b");
    expect(out).toBe("AİB");
    expect(out).not.toContain("<mark></mark>");
  });
});
