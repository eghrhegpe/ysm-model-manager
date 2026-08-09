import { describe, it, expect } from "vitest";
import { parseModelName, renderDisplayName, renderModelName, renderModelNameWithHighlight } from "./display.ts";

describe("parseModelName", () => {
  it("parses [author]name.ysm", () => {
    const r = parseModelName("[作者A]角色模型.ysm");
    expect(r.author).toBe("作者A");
    expect(r.chara).toBe("角色模型");
    expect(r.ext).toBe("ysm");
  });

  it("parses [author]【work】name.ysm", () => {
    const r = parseModelName("[作者B]【作品X】角色.ysm");
    expect(r.author).toBe("作者B");
    expect(r.work).toBe("作品X");
    expect(r.chara).toBe("角色");
  });

  it("parses [[author]] double bracket", () => {
    const r = parseModelName("[[double]]角色.ysm");
    expect(r.author).toBe("double");
  });

  it("parses 《work》 guillemet", () => {
    const r = parseModelName("[作者C]《作品Y》角色.zip");
    expect(r.author).toBe("作者C");
    expect(r.work).toBe("作品Y");
    expect(r.ext).toBe("zip");
  });

  it("extracts year date", () => {
    const r = parseModelName("[作者]name2023.ysm");
    expect(r.date).toBe("2023");
  });

  it("extracts year-month date", () => {
    const r = parseModelName("[作者]name2023-05.ysm");
    expect(r.date).toBe("2023-05");
  });

  it("handles .ban suffix", () => {
    const r = parseModelName("[作者]name.ysm.ban");
    expect(r.isBanned).toBe(true);
    expect(r.raw).toBe("[作者]name.ysm.ban");
  });

  it("works without brackets", () => {
    const r = parseModelName("单纯文件名.7z");
    expect(r.author).toBe("");
    expect(r.chara).toBe("单纯文件名");
    expect(r.ext).toBe("7z");
  });

  it("underscores become spaces in chara", () => {
    const r = parseModelName("[作者]角色_变体.json");
    expect(r.chara).toBe("角色 变体");
  });

  it("empty author returns empty string", () => {
    const r = parseModelName("[][]name.ysm");
    expect(r.author).toBe("");
  });
});

describe("renderDisplayName", () => {
  it("banned 文件直接返回转义原文，不着色", () => {
    expect(renderDisplayName("[作者]name.ysm.ban")).toBe("[作者]name.ysm.ban");
  });

  it("无标记纯文件名走 renderFormattedText 转义", () => {
    expect(renderDisplayName("单纯文件名")).toBe("单纯文件名");
  });

  it("[作者] 包裹为 tag-work span", () => {
    expect(renderDisplayName("[作者A]角色")).toBe('<span class="tag-work">[作者A]</span>角色');
  });

  it("日期包裹为 tag-date span", () => {
    expect(renderDisplayName("角色2023")).toBe('角色<span class="tag-date">2023</span>');
  });

  it("多标记按原文顺序着色（[作者]+【作品】+日期）", () => {
    expect(renderDisplayName("[作者]【作品】角色2023-05")).toBe(
      '<span class="tag-work">[作者]</span><span class="tag-work">【作品】</span>角色<span class="tag-date">2023-05</span>'
    );
  });

  it("《作品》尖括号同样着 tag-work", () => {
    expect(renderDisplayName("《作品Y》角色")).toBe('<span class="tag-work">《作品Y》</span>角色');
  });

  it("§ 分节符颜色渲染", () => {
    expect(renderDisplayName("§c红色角色")).toBe('<span style="color:#FF5555">红色角色</span>');
  });

  it("HTML 特殊字符转义", () => {
    expect(renderDisplayName("角色<脚本>")).toBe("角色&lt;脚本&gt;");
  });
});

describe("renderModelName", () => {
  it("等价 renderDisplayName（无 showExt）", () => {
    expect(renderModelName("[作者]角色.ysm")).toBe('<span class="tag-work">[作者]</span>角色');
  });

  it("showExt 追加 tag-ext span", () => {
    expect(renderModelName("[作者]角色.ysm", { showExt: true })).toBe(
      '<span class="tag-work">[作者]</span>角色<span class="tag-ext">.ysm</span>'
    );
  });

  it("showExt 但无扩展名不追加", () => {
    expect(renderModelName("[作者]角色", { showExt: true })).toBe('<span class="tag-work">[作者]</span>角色');
  });
});

describe("renderModelNameWithHighlight", () => {
  it("无 keyword 等价 renderDisplayName", () => {
    expect(renderModelNameWithHighlight("角色模型")).toBe("角色模型");
  });

  it("keyword 包裹 <mark>", () => {
    expect(renderModelNameWithHighlight("角色模型", "模型")).toBe("角色<mark>模型</mark>");
  });

  it("keyword 含正则特殊字符被转义（+ 不当量词）", () => {
    expect(renderModelNameWithHighlight("文件a+b", "a+b")).toBe("文件<mark>a+b</mark>");
  });

  it("keyword 大小写不敏感", () => {
    expect(renderModelNameWithHighlight("文件ABC", "abc")).toBe("文件<mark>ABC</mark>");
  });
});

// P3 补测（code_review）：日期命中与括号段区间重叠谓词——括号内日期不得产 tag-date
// span 且不得泄漏 %%TOKEN%% 残渣；括号外日期仍须高亮
describe("renderDisplayName — 日期括号重叠守卫", () => {
  it("括号内日期不产 tag-date（且无 token 残渣）", () => {
    const html = renderDisplayName("【2023】角色.ysm");
    // 注：renderDisplayName 剥离扩展名（parseModelName.ext），输出不含 .ysm
    expect(html).toBe('<span class="tag-work">【2023】</span>角色');
    expect(html).not.toContain("tag-date");
    expect(html).not.toContain("%%TOKEN%%");
    expect(html).not.toContain("KEN%%");
  });

  it("括号外日期仍高亮", () => {
    const html = renderDisplayName("【作品】2023角色.ysm");
    expect(html).toContain('<span class="tag-date">2023</span>');
  });
});
