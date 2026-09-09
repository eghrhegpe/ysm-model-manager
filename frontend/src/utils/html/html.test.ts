// @vitest-environment node
import { describe, it, expect } from "vitest";
import { esc, hl } from "./html.ts";

describe("esc", () => {
  it("escapes &", () => expect(esc("a&b")).toBe("a&amp;b"));
  it("escapes <", () => expect(esc("a<b")).toBe("a&lt;b"));
  it("escapes >", () => expect(esc("a>b")).toBe("a&gt;b"));
  it("escapes double quote", () => expect(esc('a"b')).toBe("a&quot;b"));
  it("escapes single quote", () => expect(esc("a'b")).toBe("a&#39;b"));
  it("returns empty for null", () => expect(esc(null)).toBe(""));
  it("returns empty for undefined", () => expect(esc(undefined)).toBe(""));
});

describe("hl", () => {
  it("returns empty for null", () => expect(hl(null)).toBe(""));
  it("returns empty for undefined", () => expect(hl(undefined)).toBe(""));
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
  // 判别性用例——「先整体转义再查找」会因 &lt; 错位把 lt 高亮成空，
  // 正确实现在原始 text 上定位、三段各自 esc
  it("&lt; 实体高亮判别（正确实现 vs 先转义再查）", () => {
    expect(hl("&lt;", "lt")).toBe("&amp;<mark>lt</mark>;");
  });
  // Unicode 大小写折叠长度变化（土耳其 İ → "i̇" 2 码元）→ 降级纯转义防错切
  it("Unicode 折叠长度变化时降级纯转义（不产空 mark）", () => {
    const out = hl("AİB", "b");
    expect(out).toBe("AİB");
    expect(out).not.toContain("<mark></mark>");
  });
  // 全匹配：多处命中均包裹 <mark>
  it("全匹配：多处命中均包裹 <mark>", () => {
    expect(hl("abcabcabc", "abc")).toBe("<mark>abc</mark><mark>abc</mark><mark>abc</mark>");
  });
  it("全匹配：重叠查询非重叠语义", () => {
    // query="aa", text="aaa" → 非重叠：第一个 "aa" 命中后 cursor 跳到 index 2，
    // 剩余 "a" 不够匹配 → 只命中一次
    expect(hl("aaa", "aa")).toBe("<mark>aa</mark>a");
  });
  it("全匹配：大小写混合", () => {
    expect(hl("Hello HELLO hello", "hello")).toBe("<mark>Hello</mark> <mark>HELLO</mark> <mark>hello</mark>");
  });
  it("全匹配：HTML 实体与命中混合", () => {
    expect(hl("<a> & <a>", "a")).toBe("&lt;<mark>a</mark>&gt; &amp; &lt;<mark>a</mark>&gt;");
  });
});
