// @vitest-environment node
// ===== 标签取值决策测试（label.ts）=====
// 纯函数裸测：翻译器以桩注入，零 i18n / 零 DOM 依赖（pure 层准入③）。
import { describe, it, expect, vi } from "vitest";
import { resolveLabel } from "./label.ts";

/** 桩翻译器：命中表返回值，否则原样回 key（模拟 tOf 三级回退的末端行为） */
function stub(dict: Record<string, string> = {}) {
  return vi.fn((key: string): string => dict[key] ?? key);
}

describe("resolveLabel — 三级回退顺序", () => {
  it("① labelKey 非空 → 走 translate（优先于 plain 明文）", () => {
    const tr = stub({ "preview.perceptionBreath": "呼吸" });
    expect(resolveLabel({ labelKey: "preview.perceptionBreath", plain: "FB" }, tr)).toBe("呼吸");
    expect(tr).toHaveBeenCalledWith("preview.perceptionBreath");
  });

  it("① labelKey 缺失键 → translate 末端原样回 key（不回落到 plain）", () => {
    expect(resolveLabel({ labelKey: "not-a-key", plain: "FB" }, stub())).toBe("not-a-key");
  });

  it("② 无 labelKey + valueOverride → 显示值压过 plain（field 行语义）", () => {
    expect(resolveLabel({ plain: "骨骼" }, stub(), 128)).toBe("128");
    expect(resolveLabel({ plain: "骨骼" }, stub(), "x.png")).toBe("x.png");
    // 假值覆盖同样生效（0 / 空串是合法显示值，只以 undefined 判缺席）
    expect(resolveLabel({ plain: "骨骼" }, stub(), 0)).toBe("0");
    expect(resolveLabel({ plain: "骨骼" }, stub(), "")).toBe("");
  });

  it("② 有 labelKey 时 valueOverride 不参与（i18n 优先）", () => {
    const tr = stub({ k: "键值" });
    expect(resolveLabel({ labelKey: "k", plain: "FB" }, tr, "override")).toBe("键值");
  });

  it("③ 无 labelKey 无 override → plain 明文（表情名场景）", () => {
    expect(resolveLabel({ plain: "Left Breast Squish Inwards" }, stub())).toBe(
      "Left Breast Squish Inwards",
    );
  });

  it("空 labelKey 视为未提供 → 落 plain（★ 表情面板空白行的病根：空串进 tOf 回退成空串）", () => {
    const tr = stub();
    expect(resolveLabel({ labelKey: "", plain: "哀" }, tr)).toBe("哀");
    // 空 labelKey 不得触碰翻译器——否则 tOf("") 会把明文换成空串
    expect(tr).not.toHaveBeenCalled();
  });

  it("全空来源 → 空串（不抛错）", () => {
    expect(resolveLabel({}, stub())).toBe("");
    expect(resolveLabel({ labelKey: "", plain: "" }, stub())).toBe("");
  });
});