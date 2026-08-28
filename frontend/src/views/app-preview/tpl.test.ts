// @vitest-environment node
// ===== preview HTML 模板测试 =====
// 覆盖：modelDetailHTML（占位/错误/正常+转义）、statsCardHTML（格式后缀/徽标/多纹理）
import { describe, it, expect } from "vitest";
import { modelDetailHTML, statsCardHTML } from "./tpl.ts";

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
    expect(html).toContain("🦴 骨骼");
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

  it(".ysm 路径 → .ysm 格式（徽标已移至 summaryCardHTML 标题行）", () => {
    const html = statsCardHTML(base, "/repo/a.ysm");
    expect(html).toContain(".ysm");
    expect(html).not.toContain("ysm-badge"); // badge 已移到 summaryCardHTML
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

  it("statsCardHTML 不再渲染 badge（已移至 summaryCardHTML）", () => {
    const html = statsCardHTML(base, "/repo/a.ysm");
    expect(html).not.toContain("ysm-badge");
    expect(html).not.toContain("pv-card-title");
  });
});
