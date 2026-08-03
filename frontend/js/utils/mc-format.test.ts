// ===== MC 分节符颜色渲染测试（ADR-021 扩展）=====
// renderFormattedText：§ 颜色码 / 格式码 / §r 重置 / 换行 / 转义。
import { describe, it, expect } from "vitest";
import { renderFormattedText } from "./mc-format.ts";

describe("renderFormattedText 基础", () => {
  it("无分节符纯文本 → 转义后原样", () => {
    expect(renderFormattedText("hello")).toBe("hello");
  });

  it("空字符串/非字符串 → 空串", () => {
    expect(renderFormattedText("")).toBe("");
    expect(renderFormattedText(null as unknown as string)).toBe("");
    expect(renderFormattedText(undefined as unknown as string)).toBe("");
  });

  it("HTML 特殊字符被转义（防 XSS）", () => {
    expect(renderFormattedText("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("换行渲染为 <br>", () => {
    expect(renderFormattedText("a\nb")).toBe("a<br>b");
  });

  it("CRLF 归一化为 <br>", () => {
    expect(renderFormattedText("a\r\nb")).toBe("a<br>b");
    expect(renderFormattedText("a\rb")).toBe("a<br>b");
  });
});

describe("renderFormattedText 颜色码", () => {
  it("§a 开绿色 span", () => {
    expect(renderFormattedText("§a绿")).toBe(
      '<span style="color:#55FF55">绿</span>',
    );
  });

  it("颜色码切换时关闭前一 span", () => {
    expect(renderFormattedText("§a绿§c红")).toBe(
      '<span style="color:#55FF55">绿</span><span style="color:#FF5555">红</span>',
    );
  });

  it("§f 白色映射正确", () => {
    expect(renderFormattedText("§f白")).toBe(
      '<span style="color:#FFFFFF">白</span>',
    );
  });
});

describe("renderFormattedText 格式码", () => {
  it("§l 粗体叠加在当前颜色", () => {
    expect(renderFormattedText("§a§l粗")).toBe(
      '<span style="color:#55FF55"><b>粗</b></span>',
    );
  });

  it("§o 斜体 / §n 下划线 / §m 删除线", () => {
    expect(renderFormattedText("§o斜")).toBe("<i>斜</i>");
    expect(renderFormattedText("§n下")).toBe(
      '<u style="text-decoration:underline">下</u>',
    );
    expect(renderFormattedText("§m删")).toBe(
      '<span style="text-decoration:line-through">删</span>',
    );
  });

  it("§r 重置颜色与格式", () => {
    expect(renderFormattedText("§a绿§r普通")).toBe(
      '<span style="color:#55FF55">绿</span>普通',
    );
    expect(renderFormattedText("§l粗§r普通")).toBe("<b>粗</b>普通");
  });

  it("新颜色码重置此前格式", () => {
    expect(renderFormattedText("§l粗§b蓝粗？")).toBe(
      "<b>粗</b><span style=\"color:#55FFFF\">蓝粗？</span>",
    );
  });
});

describe("renderFormattedText 边界", () => {
  it("无效码原样保留（如 §k 乱码码）", () => {
    expect(renderFormattedText("§k乱码")).toBe("§k乱码");
  });

  it("无效码原样保留（如 §z）", () => {
    expect(renderFormattedText("a§z")).toBe("a§z");
  });

  it("§b 是合法青色码，空 body 渲染空 span", () => {
    expect(renderFormattedText("a§b")).toBe(
      'a<span style="color:#55FFFF"></span>',
    );
  });

  it("行内混合文本与颜色", () => {
    expect(renderFormattedText("前缀 §a绿")).toBe(
      '前缀 <span style="color:#55FF55">绿</span>',
    );
  });
});
