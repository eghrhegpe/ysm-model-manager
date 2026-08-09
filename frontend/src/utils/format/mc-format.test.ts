// ===== Minecraft § 分节符颜色渲染测试 =====
// 覆盖：空输入、普通文本、单行颜色、多行（含空行）、格式码叠加、§r 重置、无效码保留、§k 忽略、XSS 转义
import { describe, it, expect } from "vitest";
import { renderFormattedText } from "./mc-format.ts";

describe("renderFormattedText", () => {
  it("空值 / 非字符串 → 空串", () => {
    expect(renderFormattedText("")).toBe("");
    expect(renderFormattedText(null as unknown as string)).toBe("");
    expect(renderFormattedText(undefined as unknown as string)).toBe("");
  });

  it("纯文本（无 §）→ 转义后原样返回", () => {
    expect(renderFormattedText("Hello World")).toBe("Hello World");
  });

  it("普通文本含换行 → <br> 连接", () => {
    expect(renderFormattedText("line1\nline2")).toBe("line1<br>line2");
  });

  it("空行 → 1 个 <br>（不翻倍：join 已补分隔）", () => {
    // split=["a","","b"] → join("<br>") = "a<br><br>b" → 视觉 1 个空行
    expect(renderFormattedText("a\n\nb")).toBe("a<br><br>b");
  });

  it("连续空行 → 各自 1 个 <br>", () => {
    // split=["","",""] → join("<br>") = "<br><br>"
    expect(renderFormattedText("\n\n")).toBe("<br><br>");
  });

  it("§a 绿色", () => {
    expect(renderFormattedText("§agreen")).toBe('<span style="color:#55FF55">green</span>');
  });

  it("§c 红色 + 后续文本", () => {
    expect(renderFormattedText("§cred")).toBe('<span style="color:#FF5555">red</span>');
  });

  it("§l 粗体", () => {
    expect(renderFormattedText("§lBold")).toBe("<b>Bold</b>");
  });

  it("颜色后叠加粗体", () => {
    expect(renderFormattedText("§a§ltext")).toBe(
      '<span style="color:#55FF55"><b>text</b></span>',
    );
  });

  it("颜色后换新颜色 → 先关旧 span", () => {
    // §a=绿 #55FF55，§b=青 #55FFFF
    expect(renderFormattedText("§ared§bblue")).toBe(
      '<span style="color:#55FF55">red</span><span style="color:#55FFFF">blue</span>',
    );
  });

  it("§r 重置所有格式", () => {
    expect(renderFormattedText("§a§lcolored§rplain")).toBe(
      '<span style="color:#55FF55"><b>colored</b></span>plain',
    );
  });

  it("无效码 → 原样保留", () => {
    expect(renderFormattedText("§zinvalid")).toBe("§zinvalid");
  });

  it("连续 § 后接有效色码 → 按第二个码解析", () => {
    // "§§double" split → ["","","double"] → i=1 空跳过 → i=2 code='d'(粉) body='ouble'
    expect(renderFormattedText("§§double")).toBe(
      '<span style="color:#FF55FF">ouble</span>',
    );
  });

  it("XSS：<script> 被转义", () => {
    expect(renderFormattedText("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("XSS：颜色正文中注入标签也被转义", () => {
    expect(renderFormattedText("§a<img src=x onerror=alert(1)>")).toBe(
      '<span style="color:#55FF55">&lt;img src=x onerror=alert(1)&gt;</span>',
    );
  });

  it("§k 乱码码 → 忽略，仅输出正文", () => {
    expect(renderFormattedText("§kobfuscated")).toBe("obfuscated");
  });

  it("大小写格式码兼容：§A 与 §a 等价", () => {
    expect(renderFormattedText("§Atext")).toBe('<span style="color:#55FF55">text</span>');
  });

  it("\\r\\n → 归一化为换行", () => {
    expect(renderFormattedText("a\r\nb")).toBe("a<br>b");
  });

  // P3 补测：行尾孤立 § 原样保留（原实现 if(!part) continue 丢弃，修复无测试锁定）
  it("行尾孤立 § 原样保留", () => {
    expect(renderFormattedText("abc§")).toBe("abc§");
  });

  it("整行孤立 § 原样保留", () => {
    expect(renderFormattedText("§")).toBe("§");
  });

  it("换行后行尾孤立 § 原样保留", () => {
    expect(renderFormattedText("a\n§\nb")).toBe("a<br>§<br>b");
  });
});
