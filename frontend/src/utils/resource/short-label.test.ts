// @vitest-environment node
// ===== short-label.ts 运行时翻译回归测试 =====
// 验证 t() 在 shortLabelOf 调用期求值（非常量表烘焙），切语言后返回新语言标签。
import { describe, it, expect, vi } from "vitest";

// vi.hoisted 让 mockT 在 vi.mock 工厂之前初始化（vi.mock 被提升到文件顶）
const { mockT } = vi.hoisted(() => ({ mockT: vi.fn((key: string) => `translated:${key}`) }));

vi.mock("@/core/i18n/t.ts", () => ({ t: mockT }));

import { shortLabelOf } from "./short-label.ts";
import { RESOURCE_TYPES } from "./types.ts";

describe("shortLabelOf — 运行时翻译", () => {
  it("YSM/MMD 返回英文短名（不经过 t）", () => {
    expect(shortLabelOf(RESOURCE_TYPES.YSM)).toBe("YSM");
    expect(shortLabelOf(RESOURCE_TYPES.MMD)).toBe("MMD");
  });

  it("需要 i18n 的类型走 t() 翻译", () => {
    mockT.mockReturnValueOnce("资源包（英）");
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("资源包（英）");
    expect(mockT).toHaveBeenCalledWith("rtype.pack");
  });

  it("未命中 map → 回退全名 → 原始 id", () => {
    expect(shortLabelOf("fbx")).toBe("FBX 模型/动画"); // RESOURCE_TYPE_LABELS["fbx"] 全名
    expect(shortLabelOf("unknown-type")).toBe("unknown-type");
    expect(shortLabelOf("")).toBe("ysm"); // 空串兜底 YSM
  });

  it("核心不变量：t() 在每次 shortLabelOf 调用时执行（非模块加载期烘焙）", () => {
    mockT.mockClear();
    mockT.mockReturnValue("资源包-语言A");
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("资源包-语言A");
    // 模拟切语言：t() 返回值变化
    mockT.mockReturnValue("资源包-语言B");
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("资源包-语言B");
    // 每次调用 buildShortLabelMap() 都会对所有 i18n 条目调 t()（5 个条目），
    // 两次 shortLabelOf → t() 被调用 5×2 = 10 次，且每次取最新返回值
    expect(mockT).toHaveBeenCalledTimes(10);
    // 验证 rtype.pack 的翻译随 mockReturnValue 变化（调用期求值证据）
    const packCalls = mockT.mock.calls.filter((c) => c[0] === "rtype.pack");
    expect(packCalls.length).toBe(2);
  });
});
