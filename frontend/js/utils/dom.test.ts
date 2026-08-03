import { describe, it, expect } from "vitest";
import { esc, hl } from "./dom.ts";

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
});
