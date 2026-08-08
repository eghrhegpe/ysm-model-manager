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

  it(".ysm 路径 → .ysm 格式 + 徽标", () => {
    const html = statsCardHTML(base, "/repo/a.ysm", "YSMParser");
    expect(html).toContain(".ysm");
    expect(html).toContain('class="ysm-badge">YSMParser');
    expect(html).toContain("64 × 64");
  });

  it(".json 路径 → 解压目录说明", () => {
    const html = statsCardHTML(base, "/repo/a.json", "");
    expect(html).toContain(".json (解压目录)");
  });

  it(".zip 路径 → .zip；其他 → .7z", () => {
    expect(statsCardHTML(base, "/repo/a.zip", "")).toContain(".zip");
    expect(statsCardHTML(base, "/repo/a.7z", "")).toContain(".7z");
  });

  it("多纹理 → 额外纹理概要行", () => {
    const html = statsCardHTML(
      { ...base, textures: ["t1", "t2", "t3"] },
      "/repo/a.ysm",
      "",
    );
    expect(html).toContain("含 2 张额外纹理（共 3 张）");
  });

  it("无徽标（decodedBy 空）→ 不含 badge", () => {
    const html = statsCardHTML(base, "/repo/a.ysm", "");
    expect(html).not.toContain("ysm-badge");
  });
});
