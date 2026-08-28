// @vitest-environment node
// ===== YSM 摘要卡片 HTML 测试（ADR-021 扩展）=====
// summaryCardHTML：占位 / 加密头部卡片 / 完整摘要 / 转义 / 徽章。
import { describe, it, expect } from "vitest";
import { summaryCardHTML } from "./summarize.ts";

describe("summaryCardHTML 占位与兜底", () => {
  it("summary 与 header 都为空 → 占位卡片", () => {
    const html = summaryCardHTML(null, null);
    expect(html).toContain("点击左侧仓库文件查看详情");
    expect(html).toContain("dp-placeholder");
  });

  it("无 summary 有 header.isYsm → 加密模型简约卡片", () => {
    const html = summaryCardHTML(null, { isYsm: true, name: "加密模型A" });
    expect(html).toContain("此模型为加密格式");
    expect(html).toContain("加密模型A");
  });

  it("无 summary 且 header 非 isYsm → 走完整卡片路径（名称回退 -）", () => {
    const html = summaryCardHTML(null, { name: "x" });
    expect(html).not.toContain("dp-placeholder");
    expect(html).toContain("model-detail-title");
    expect(html).toContain(">-</h3>");
  });
});

describe("summaryCardHTML 完整摘要", () => {
  const full = {
    name: "测试角色",
    source: "src",
    license: "免费可商用",
    tips: "§a使用说明",
    authors: [{ name: "作者A", bilibili: "https://b23.tv/x", roles: "建模" }],
    stats: { textures: 4, models: 2, animations: 6, texWidth: 128, texHeight: 256 },
    animGroups: [
      { name: "表情", items: ["开心", "range", "checkbox"] },
      { name: "纯内部", items: ["range", "slider"] },
    ],
    configMenus: [{ name: "菜单1" }, { name: "menu_main" }],
    links: { home: "https://example.com" },
  };

  it("渲染名称 / 许可（作者已移至统计卡，摘要卡不再渲染）", () => {
    const html = summaryCardHTML(full, {});
    expect(html).toContain("测试角色");
    expect(html).toContain("免费可商用");
    // 方案 A（2026-08-28）：作者行由统计卡 buildStatsCard 承载（头像+角色），
    // 摘要卡去重不再渲染——避免与详情卡底部统计卡重复
    expect(html).not.toContain("作者A");
  });

  it("渲染资源统计（纹理尺寸已移至统计卡，摘要卡不再渲染）", () => {
    const html = summaryCardHTML(full, {});
    expect(html).toContain("贴图 4 · 模型 2 · 动画 6");
    // 方案 A：纹理尺寸由统计卡彩色分区（pv-section-green）承载
    expect(html).not.toContain("128 × 256 px");
  });

  it("动画分组过滤内部标识符（range/checkbox 等）", () => {
    const html = summaryCardHTML(full, {});
    expect(html).toContain("表情");
    expect(html).toContain("开心");
    expect(html).not.toContain("range");
    // 纯内部标识符的分组整体跳过
    expect(html).not.toContain("纯内部");
  });

  it("配置菜单渲染名称，纯标识符也渲染（与动画分组不同）", () => {
    const html = summaryCardHTML(full, {});
    expect(html).toContain("菜单1");
    expect(html).toContain("menu_main");
  });

  it("渲染主页链接并省略协议前缀", () => {
    const html = summaryCardHTML(full, {});
    expect(html).toContain("example.com");
  });

  it("缺少许可显示未标注", () => {
    const html = summaryCardHTML({ name: "x" }, {});
    expect(html).toContain("未标注");
  });

  it("缩放值格式化为两位小数", () => {
    const html = summaryCardHTML(
      { name: "x", preview: { heightScale: 1.5, widthScale: 2 } },
      {},
    );
    expect(html).toContain("1.50 × 2.00");
  });

  it("只提供 texWidth 无 texHeight → 无 undefined 泄漏（纹理行已移统计卡，P4 语义保留）", () => {
    const html = summaryCardHTML(
      { name: "x", stats: { textures: 1, texWidth: 128 } },
      {},
    );
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("128 ×");
  });
});

describe("summaryCardHTML 徽章与转义", () => {
  it("hasFree+isFree → 🆓 免费徽章", () => {
    const html = summaryCardHTML({ name: "x" }, { hasFree: true, isFree: true });
    expect(html).toContain("🆓 免费");
    expect(html).not.toContain("🔒");
  });

  it("hasFree+非 isFree → 🔒 付费徽章", () => {
    const html = summaryCardHTML({ name: "x" }, { hasFree: true, isFree: false });
    expect(html).toContain("🔒 付费");
  });

  it("名称含 HTML 字符被转义（防 XSS）", () => {
    const html = summaryCardHTML({ name: '<img src=x onerror=alert(1)>' }, {});
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

// 方案 A（2026-08-28）：作者行（含文件名 [作者] 回退）已随统计卡 buildStatsCard 承载，
// 摘要卡不再渲染作者——下述断言从「渲染回退作者」改为「不再渲染作者行（去重）」
describe("summaryCardHTML 作者去重（方案 A）", () => {
  it("basename 含 [作者] → 摘要卡不再渲染作者行（统计卡承载）", () => {
    const html = summaryCardHTML(
      { name: "十六夜咲夜", stats: { textures: 1 } },
      {},
      "[碎de帆]【东方project】十六夜咲夜Izayoi_Sakuya2025-06.zip",
    );
    expect(html).not.toContain('<span class="md-label">作者</span>');
    expect(html).not.toContain("📎 文件名");
  });

  it("summary 有 metadata authors → 摘要卡不再渲染作者行", () => {
    const html = summaryCardHTML(
      { name: "x", authors: [{ name: "元数据作者" }] },
      {},
      "[碎de帆]角色.zip",
    );
    expect(html).not.toContain("元数据作者");
    expect(html).not.toContain("碎de帆");
  });

  it("basename 无 [作者] 前缀 → 不渲染作者行", () => {
    const html = summaryCardHTML(
      { name: "x", stats: { textures: 1 } },
      {},
      "【作品】角色.zip",
    );
    expect(html).not.toContain('<span class="md-label">作者</span>');
  });

  it("summary 为空（极端空 zip）且 basename 含 [作者] → 不再回退渲染作者行", () => {
    const html = summaryCardHTML(
      null,
      { isYsm: false },
      "[碎de帆]角色.zip",
    );
    expect(html).not.toContain('class="tag-author">碎de帆');
    expect(html).not.toContain("📎 文件名");
  });
});

// ===== header-only 卡 basename 作者/作品分行（P3 修复回归测试）=====
// 覆盖 p 路径的 4 种组合：作者+作品 / 仅作品 / 仅作者 / 两者皆无，
// 锁定「作者行与作品行分开、作品不被标为作者」的修复
describe("summaryCardHTML header-only basename 作者/作品分行", () => {
  it("作者+作品 → 标题含作者、作品行含 tag-work", () => {
    const html = summaryCardHTML(null, { isYsm: true }, "[作者A]【作品B】角色.ysm");
    expect(html).toContain('class="tag-author">作者A');
    expect(html).toContain('class="tag-work">作品B');
    expect(html).toContain('<span class="md-label">作品</span>');
  });

  it("仅作品 → 作品行渲染且不被标为作者", () => {
    const html = summaryCardHTML(null, { isYsm: true }, "【作品B】角色.ysm");
    expect(html).toContain('class="tag-work">作品B');
    // 作者行不应出现（作品不得被标为作者）
    expect(html).not.toContain('<span class="md-label">作者</span>');
  });

  it("仅作者 → 标题含作者、无作品行", () => {
    const html = summaryCardHTML(null, { isYsm: true }, "[作者A]角色.ysm");
    expect(html).toContain('class="tag-author">作者A');
    expect(html).not.toContain('<span class="md-label">作品</span>');
  });

  it("无作者无作品 → 标题显示角色名、无作者/作品行", () => {
    const html = summaryCardHTML(null, { isYsm: true }, "角色.ysm");
    expect(html).toContain("角色");
    expect(html).not.toContain('<span class="md-label">作者</span>');
    expect(html).not.toContain('<span class="md-label">作品</span>');
  });
});

// P3 补测：安全红线与折叠不变量（原零测试）
describe("summaryCardHTML 安全与折叠", () => {
  it("safeUrl 过滤 javascript:/data:/非 http 外链 → href=#", () => {
    // code_review：header 必须带 name + authorName 才能走到 authorBilibili 链接分支——
    // 原 fixture 无 name（p 走 parseModelName else 分支）且无 authorName（链接不渲染），
    // ftp 断言是死断言；现补 name+authorName 使三个 scheme 分支都真实执行
    const header: Parameters<typeof summaryCardHTML>[1] = {
      isYsm: true,
      name: "角色",
      authorName: "作者",
      linkHome: "javascript:alert(1)",
      linkUpdate: "data:text/html,<b>x</b>",
      authorBilibili: "ftp://evil.example",
    };
    const html = summaryCardHTML(null, header, "角色.ysm");
    // href 属性无危险值（显示文本泄漏原始串属 P4 观感，非 XSS——href 已 safeUrl 过滤）
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="ftp:');
  });

  it("加密卡 format/crypto 缺字段 → 输出无 undefined（?? 0 归一）", () => {
    const html = summaryCardHTML(null, { isYsm: true }, "角色.ysm");
    expect(html).not.toContain("undefined");
  });

  it("徽章超过 8 个折叠为 +N（第 9 个不单独出现）", () => {
    // 折叠是「单组内 items > 8」而非组数——构造 1 组 10 个 item
    const summary: Parameters<typeof summaryCardHTML>[0] = {
      animGroups: [
        {
          name: "group",
          items: Array.from({ length: 10 }, (_, i) => "item" + i),
        },
      ],
    };
    const html = summaryCardHTML(summary, { isYsm: true, name: "角色" }, "角色.ysm");
    expect(html).toContain("+2"); // 10 - 8
    expect(html).not.toContain("item8");
    expect(html).not.toContain("item9");
  });
});
