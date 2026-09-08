// @vitest-environment node
// ===== ysm-meta-parser 纯函数测试（P4 下沉：ysm.json 元数据解析）=====
// parseYsmMetaFromFiles 是纯函数（只读 DecodedFile[]，无 this / ctx / 后端依赖），
// 直接单测两条主分支：无 ysm.json → 空 meta；有 ysm.json → authors/animGroups/orders。
import { describe, it, expect } from "vitest";
import { parseYsmMetaFromFiles, type DecodedFile } from "./ysm-meta-parser.ts";

const enc = new TextEncoder();
const mk = (path: string, obj: unknown): DecodedFile => ({
  path,
  data: enc.encode(JSON.stringify(obj)),
});

describe("parseYsmMetaFromFiles", () => {
  it("空 files（无 ysm.json）→ 空 meta + hasYsmMeta=false", () => {
    const { meta, hasYsmMeta } = parseYsmMetaFromFiles([]);
    expect(hasYsmMeta).toBe(false);
    expect(meta.ysmTexOrder).toBeNull();
    expect(meta.ysmModelOrder).toBeNull();
    expect(meta.ysmDefaultTex).toBeNull();
    expect(meta.animGroups).toEqual([]);
    expect(meta.configMenus).toEqual([]);
    expect(meta.authors).toEqual([]);
    expect(meta.avatars).toEqual({});
  });

  it("含 ysm.json → 解析 texture/model order、default_texture、authors、animGroups/configMenus", () => {
    const ysmJson = {
      files: {
        player: {
          model: "models/main.json",
          texture: ["textures/a.png", "textures/b.png"],
        },
      },
      properties: {
        default_texture: "textures/a.png",
        // extra_animation 键 = 动画 id，值 = 中文展示名（Go 镜像语义）
        extra_animation: { jump: "跳跃" },
        extra_animation_classify: [
          { id: "combat", name: "战斗", extra_animation: { swing: "挥剑" } },
        ],
        extra_animation_buttons: [{ id: "btn1", name: "按钮一" }],
      },
      metadata: {
        authors: [
          { name: "alice", role: "author", avatar: "a.png" },
          { role: "no-name" }, // 无 name → 过滤
        ],
      },
    };
    const { meta, hasYsmMeta } = parseYsmMetaFromFiles([
      mk("ysm.json", ysmJson),
      mk("models/main.json", { bones: [] }),
    ]);
    expect(hasYsmMeta).toBe(true);
    expect(meta.ysmTexOrder).toEqual(["textures/a.png", "textures/b.png"]);
    expect(meta.ysmModelOrder).toEqual(["models/main.json"]);
    expect(meta.ysmDefaultTex).toBe("textures/a.png");
    // authors：过滤无 name 项，avatarUrl 初始 null，avatarPath 取自 avatar
    expect(meta.authors).toEqual([
      { name: "alice", role: "author", avatarUrl: null, avatarPath: "a.png" },
    ]);
    // animGroups：分类组「战斗」+ 松散兜底「其他动画」（跳跃 未被任何分类组引用）
    expect(meta.animGroups).toEqual([
      { name: "战斗", id: "combat", items: ["挥剑"] },
      { id: "_loose", name: "其他动画", items: ["跳跃"] },
    ]);
    expect(meta.configMenus).toEqual([{ name: "按钮一", id: "btn1" }]);
  });
});
