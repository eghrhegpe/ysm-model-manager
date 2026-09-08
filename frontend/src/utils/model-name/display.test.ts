// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseModelName, renderDisplayName } from "./display.ts";

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

  it("[作者] 包裹为 tag-author span（P3：作者段语义色）", () => {
    expect(renderDisplayName("[作者A]角色")).toBe('<span class="tag-author">[作者A]</span>角色');
  });

  it("日期包裹为 tag-date span", () => {
    expect(renderDisplayName("角色2023")).toBe('角色<span class="tag-date">2023</span>');
  });

  it("多标记按原文顺序着色（[作者]+【作品】+日期）", () => {
    expect(renderDisplayName("[作者]【作品】角色2023-05")).toBe(
      '<span class="tag-author">[作者]</span><span class="tag-work">【作品】</span>角色<span class="tag-date">2023-05</span>'
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

// P3 补测（审核）：日期分隔符三态 / 无分隔 YYYYMM / 尾随 0 防畸形——parseModelName
// 归一化路径（2023.05/2023_05/202305 → 2023-05，20230 → 仅年份）
describe("parseModelName — 日期分隔符与畸形回退", () => {
  it("点分隔 2023.05 → 2023-05", () => {
    const r = parseModelName("角色2023.05.ysm");
    expect(r.date).toBe("2023-05");
    expect(r.chara).toBe("角色");
  });

  it("下划线分隔 2023_05 → 2023-05", () => {
    const r = parseModelName("角色2023_05.ysm");
    expect(r.date).toBe("2023-05");
  });

  it("无分隔 YYYYMM 202305 → 2023-05（恢复月份）", () => {
    const r = parseModelName("角色202305.ysm");
    expect(r.date).toBe("2023-05");
  });

  it("尾随 0 20230 → 仅年份 2023（0 非合法月份，防畸形回退）", () => {
    const r = parseModelName("角色20230.ysm");
    expect(r.date).toBe("2023");
    expect(r.chara).toBe("角色");
  });

  it("非法月份 2023-13 → 仅年份 2023", () => {
    const r = parseModelName("角色2023-13.ysm");
    expect(r.date).toBe("2023");
  });

  it("无扩展名 → ext 空串", () => {
    const r = parseModelName("[作者]角色2023");
    expect(r.ext).toBe("");
    expect(r.date).toBe("2023");
  });

  it(".ban 文件 ext 取 .ban 前的扩展名", () => {
    const r = parseModelName("[A]b.ysm.ban");
    expect(r.isBanned).toBe(true);
    expect(r.ext).toBe("ysm");
    expect(r.chara).toBe("b");
  });
});

// P3 补测（审核）：占位符 token 与文件名碰撞回归——原实现用 %%TOKEN%% 占位，
// 文件名恰含 %%TOKEN%% 时静默丢字；修复后字面量必须保留
describe("renderDisplayName — 占位符碰撞（%%TOKEN%% 字面量保留）", () => {
  it("文件名含 %%TOKEN%% 时原样保留", () => {
    const html = renderDisplayName("角色%%TOKEN%%2023.ysm");
    expect(html).toBe('角色%%TOKEN%%<span class="tag-date">2023</span>');
  });

  it("含 %%TOKEN%% 且带标记段时同样保留", () => {
    const html = renderDisplayName("[A]%%TOKEN%%2023.ysm");
    expect(html).toBe(
      '<span class="tag-author">[A]</span>%%TOKEN%%<span class="tag-date">2023</span>',
    );
  });

  it("《》内日期同样受重叠守卫约束", () => {
    const html = renderDisplayName("《2023》角色.ysm");
    expect(html).toBe('<span class="tag-work">《2023》</span>角色');
    expect(html).not.toContain("tag-date");
  });
});


