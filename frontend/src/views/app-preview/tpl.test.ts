// @vitest-environment node
// ===== preview HTML 模板测试 =====
// 覆盖：modelDetailHTML（占位/错误/正常+转义）、statsCardHTML（格式后缀/徽标/多纹理）
import { describe, it, expect } from "vitest";
import { DECODE_SOURCE } from "@/preview-3d/decoder/utils.ts";
import {
  bigIconHTML,
  errorPlaceholderHTML,
  modelDetailHTML,
  pageShellHTML,
  placeholderHTML,
  statsCardHTML,
  tabbedShellHTML,
} from "./tpl.ts";

describe("modelDetailHTML", () => {
  it("null → 占位提示", () => {
    const html = modelDetailHTML(null);
    expect(html).toContain("点击左侧仓库文件查看详情");
    expect(html).toContain("preview-content");
  });

  it("hasError → 错误区块（errorMsg 缺省为「未知错误」）", () => {
    const html = modelDetailHTML({ hasError: true });
    expect(html).toContain('class="err"');
    expect(html).toContain("未知错误");
  });

  it("正常 → 渲染各字段并转义特殊字符", () => {
    const html = modelDetailHTML({
      name: "<模型>",
      author: "作者",
      version: "v1",
      bones: 5,
      textures: 2,
      animations: 3,
      vertices: 1234,
      faces: 99,
    });
    expect(html).toContain("&lt;模型&gt;");
    expect(html).toContain("1,234");
    // ADR-238：骨骼/面数图标由 emoji 改走 SVG（断言 SVG + 文案同在）
    expect(html).toMatch(/<svg class="ws-icon"[\s\S]*?<\/svg>\s*骨骼/);
    expect(html).toContain("◻️ 面");
  });

  it("正常（字段缺失）→ 显示 - 与 0", () => {
    const html = modelDetailHTML({ name: "x" });
    expect(html).toContain("-"); // 作者/版本占位
    expect(html).toContain(">0</span>"); // 骨骼计数
  });
});

describe("statsCardHTML", () => {
  const base = { boneCount: 4, cubeCount: 10, texWidth: 64, texHeight: 64 };

  it(".ysm 路径 → .ysm 格式（无 _decodedBy 时不渲染徽标）", () => {
    const html = statsCardHTML(base, "/repo/a.ysm");
    expect(html).toContain(".ysm");
    expect(html).not.toContain("ysm-badge"); // base 未带 _decodedBy → 不渲染
    expect(html).toContain("64 × 64");
  });

  it(".json 路径 → 解压目录说明", () => {
    const html = statsCardHTML(base, "/repo/a.json");
    expect(html).toContain(".json (解压目录)");
  });

  it(".zip 路径 → .zip；其他格式 → 其他", () => {
    expect(statsCardHTML(base, "/repo/a.zip")).toContain(".zip");
    // .7z 不再支持（网页版），预览不会遇到，显示「其他】
    expect(statsCardHTML(base, "/repo/a.7z")).toContain("其他");
  });

  it("多纹理 → 额外纹理概要行", () => {
    const html = statsCardHTML(
      { ...base, textures: ["t1", "t2", "t3"] },
      "/repo/a.ysm",
    );
    expect(html).toContain("含 2 张额外纹理（共 3 张）");
  });

  it("textureCategories 区分角色/独立模型纹理 → 分类统计行", () => {
    const html = statsCardHTML(
      {
        ...base,
        textures: ["t1", "t2", "t3", "t4"],
        textureCategories: ["player", "player", "projectile", "vehicle"],
      },
      "/repo/a.ysm",
    );
    expect(html).toContain("角色纹理 2 张 · 独立模型 2 张");
  });

  it("subModels → L0 清单角色区块（纹理标题 + 尺寸）", () => {
    const html = statsCardHTML(
      {
        ...base,
        textures: ["t1", "t2"],
        textureNames: ["main", "arm"],
        subModels: [
          { name: "角色A", texSlot: 0 },
          { name: "角色B", texSlot: 1 },
        ],
      },
      "/repo/a.ysm",
    );
    expect(html).toContain("L0 清单角色（2）");
    expect(html).toContain("角色A");
    expect(html).toContain("main");
    expect(html).toContain("角色B");
    expect(html).toContain("arm");
    // 缩放行已删除（无操作价值）
    expect(html).not.toContain("0.80 × 0.80");
  });

  it("subModels → L0 清单角色区块正常渲染", () => {
    const html = statsCardHTML(
      { ...base, subModels: [{ name: "角色A", texSlot: 0 }] },
      "/repo/a.ysm",
    );
    expect(html).not.toContain("0.80 × 0.80");
    expect(html).toContain("L0 清单角色（1）");
  });

  it("subCount > 1 → extraCount = texCount - subCount（多角色包无额外纹理时不出行）", () => {
    const html = statsCardHTML(
      { ...base, textures: ["t1", "t2", "t3", "t4"], subCount: 4 },
      "/repo/a.zip",
    );
    expect(html).not.toContain("额外纹理");
  });

  it("subCount + 额外纹理 → extraCount = texCount - subCount", () => {
    const html = statsCardHTML(
      { ...base, textures: ["t1", "t2", "t3", "t4"], subCount: 2 },
      "/repo/a.zip",
    );
    expect(html).toContain("含 2 张额外纹理（共 4 张）");
  });

  it("_decodedBy 存在 → 文件信息行渲染解码器徽标（SVG 图标 + i18n 文案，缓存命中不再丢标记）", () => {
    const html = statsCardHTML({ ...base, _decodedBy: DECODE_SOURCE.go }, "/repo/a.ysm");
    expect(html).toContain('class="ysm-badge"');
    // ADR-238：图标为 SVG（不再吃 emoji 字形，随 currentColor/字号走）；文案走 i18n（测试环境 zh-CN）
    expect(html).toMatch(/class="ysm-badge"><svg class="ws-icon"[\s\S]*?<\/svg>\s*Go 原生解析/);
    expect(html).not.toContain("📦");
    expect(html).not.toContain("pv-card-title"); // 卡内标题仍已去重，徽标只挂文件信息行
  });

  it("_decodedBy 为未识别的码（旧缓存遗留的展示文案）→ 不渲染徽标，不漏裸串", () => {
    const html = statsCardHTML({ ...base, _decodedBy: "📦 Go 原生解析" }, "/repo/a.ysm");
    expect(html).not.toContain("ysm-badge");
    expect(html).not.toContain("Go 原生解析");
  });

  it("_decodedBy 缺失 → 文件信息行无徽标（不渲染空壳）", () => {
    const html = statsCardHTML(base, "/repo/a.ysm");
    expect(html).not.toContain("ysm-badge");
    expect(html).not.toContain("pv-card-title");
  });

  it("fileInventory → 包内文件清单行（Go 权威归属，非零类目计数 + 文件路径 tooltip）", () => {
    const html = statsCardHTML(
      {
        ...base,
        fileInventory: {
          animations: ["animations/idle.animation.json", "animations/walk.animation.json"],
          controllers: ["controllers/main.animation_controller.json"],
          langFiles: ["lang/zh_CN.lang"],
          avatars: ["avatar/fox.jpg"],
        },
      },
      "/repo/a.zip",
    );
    expect(html).toContain("包内文件");
    expect(html).toContain("动画 2");
    expect(html).toContain("控制器 1");
    expect(html).toContain("语言 1");
    expect(html).toContain("头像 1");
    // tooltip 携带权威路径（转义后）
    expect(html).toContain("animations/idle.animation.json");
    // 未出现的类目（incFiles/legacyModels）不渲染
    expect(html).not.toContain("旧格式");
  });

  it("无 fileInventory → 不渲染包内文件行", () => {
    const html = statsCardHTML(base, "/repo/a.zip");
    expect(html).not.toContain("包内文件");
  });

  it("fileInventory 全类目为空 → 不渲染包内文件行", () => {
    const html = statsCardHTML(
      { ...base, fileInventory: { animations: [], controllers: [] } },
      "/repo/a.zip",
    );
    expect(html).not.toContain("包内文件");
  });
});

// ===== 页面骨架四件套（ADR：收口 28 具手写 preview-content 壳，3a 批次） =====
describe("pageShellHTML", () => {
  it("渲染 #preview-content 壳 + h3（图标 + 转义标题）+ body 原样", () => {
    const html = pageShellHTML({ icon: "<svg></svg>", title: "<x>", body: "<p>b</p>" });
    expect(html).toContain('<div class="content" id="preview-content">');
    expect(html).toContain("<h3><svg></svg> &lt;x&gt;</h3>");
    expect(html).toContain("<p>b</p>");
  });
});

describe("bigIconHTML / placeholderHTML", () => {
  it("bigIconHTML 包 big-icon 槽", () => {
    expect(bigIconHTML("ICO")).toBe('<div class="big-icon">ICO</div>');
  });

  it("lead + 多 hint 原样注入", () => {
    const html = placeholderHTML({ lead: bigIconHTML("ICO"), hints: ["a", "b"] });
    expect(html).toBe(
      '<div class="dp-placeholder"><div class="big-icon">ICO</div><div class="dp-hint">a</div><div class="dp-hint">b</div></div>',
    );
  });

  it("无参 → 空占位容器（router 文件夹无信息态无图标）", () => {
    expect(placeholderHTML({})).toBe('<div class="dp-placeholder"></div>');
  });

  it("head → 紧凑头部修饰类（maid 封面态，maid-3d.test 钉死字节串）", () => {
    expect(placeholderHTML({ head: true, lead: "X" })).toBe(
      '<div class="dp-placeholder dp-placeholder--head">X</div>',
    );
  });

  it("对象形态 hint → 挂自定义 attrs（maid head 行内样式特化）", () => {
    const html = placeholderHTML({
      head: true,
      hints: [{ html: "name", attrs: 'style="font-weight:600"' }, "Bedrock"],
    });
    expect(html).toBe(
      '<div class="dp-placeholder dp-placeholder--head"><div class="dp-hint" style="font-weight:600">name</div><div class="dp-hint">Bedrock</div></div>',
    );
  });
});

describe("errorPlaceholderHTML", () => {
  it("warning 图标 + readFailed 前缀 + 消息转义", () => {
    const html = errorPlaceholderHTML("<boom>");
    expect(html).toContain('class="dp-placeholder"');
    expect(html).toContain("读取失败");
    expect(html).toContain("&lt;boom&gt;");
  });
});

describe("tabbedShellHTML", () => {
  const tabs = [
    { key: "detail", icon: "I1", label: "详情" },
    { key: "material", icon: "I2", label: "材料" },
  ];

  it("tab 激活态 + pane 显隐 + body 注入", () => {
    const html = tabbedShellHTML({
      tabs,
      active: "detail",
      panes: [
        { key: "detail", body: "D" },
        { key: "material", body: "M" },
      ],
    });
    expect(html).toContain('data-tab="detail"');
    expect(html).toContain("pv-tab-active");
    expect(html).toContain('<div id="preview-detail">D</div>');
    expect(html).toContain('<div id="preview-material" style="display:none">M</div>');
  });

  it("非默认 tab 激活时对应 pane 无 display:none", () => {
    const html = tabbedShellHTML({
      tabs,
      active: "material",
      panes: [
        { key: "detail", body: "D" },
        { key: "material", body: "M" },
      ],
    });
    expect(html).toContain('<div id="preview-detail" style="display:none">D</div>');
    expect(html).toContain('<div id="preview-material">M</div>');
  });

  it("fabHTML 尾挂（litematic 3D FAB）；缺省不挂", () => {
    expect(
      tabbedShellHTML({
        tabs,
        active: "detail",
        panes: [{ key: "detail", body: "" }],
        fabHTML: "<button>3D</button>",
      }),
    ).toContain("<button>3D</button>");
    expect(
      tabbedShellHTML({ tabs, active: "detail", panes: [{ key: "detail", body: "" }] }),
    ).not.toContain("preview-fab");
  });
});
