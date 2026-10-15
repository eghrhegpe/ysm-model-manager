// @vitest-environment node
// ===== short-label.ts 运行时翻译回归测试 =====
// 验证 t()  在 shortLabelOf 调用期求值（非常量表烘焙），切语言后返回新语言标签。
import { describe, it, expect, vi, beforeEach } from "vitest";
import { tOfChain } from "@/test-utils/i18n-chain.ts";

// vi.hoisted 让 mockT / mockGetLang 在 vi.mock 工厂之前初始化（vi.mock 被提升到文件顶）
const { mockT, mockTOf, mockGetLang } = vi.hoisted(() => ({
  mockT: vi.fn((key: string) => `translated:${key}`),
  // 回落段 2026-10-15 起走 `types.ts|rtypeLabelOf`（其内部用 **tOf**）：工厂必须同时
  // 提供 tOf，否则 types.ts 拿到 undefined、回落一调即 TypeError。
  // 与 mockT **分开**计数——「短名表命中时 t() 不重复调用」的不变量才不被回落污染。
  mockTOf: vi.fn((key: string, p?: Record<string, string>) => tOfChain({ mode: "real" })(key, p)),
  mockGetLang: vi.fn(() => "zh-CN"),
}));

vi.mock("@/core/i18n/t.ts", () => ({ t: mockT, tOf: mockTOf }));
vi.mock("@/core/i18n/locale.ts", () => ({ getLang: mockGetLang }));

import { shortLabelOf, __resetShortLabelCacheForTest } from "./short-label.ts";
import { RESOURCE_TYPES } from "./types.ts";

beforeEach(() => {
  __resetShortLabelCacheForTest();
});

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

  it("未命中短名表 → 走 rtypeLabelOf 出口（locale 全名）→ 原始 id → YSM 兜底", () => {
    // ⚠️ 旧断言写 "FBX 模型/动画"（注册表 name），那是**中文回落被固化成契约**的形态：
    // 短名表没有 fbx，此前直取 RESOURCE_TYPE_LABELS 故落中文全名。改走出口后 en/ja 得译文，
    // zh 得 locale 键值。2026-10-15 命名终审把 fbx 定名「FBX 模型/动画」（该类型覆盖模型+动画
    // 两义），locale 与注册表对齐同词——出口值与注册表一致是终审结果，非中文回落。
    expect(shortLabelOf("fbx")).toBe("FBX 模型/动画");
    expect(shortLabelOf("unknown-type")).toBe("unknown-type");
    expect(shortLabelOf("")).toBe("ysm"); // 空串兜底 YSM
  });

  it("核心不变量：语言未变时缓存命中，t() 不重复调用", () => {
    mockT.mockClear();
    mockGetLang.mockReturnValue("zh-CN");
    mockT.mockReturnValue("资源包-语言A");
    // 首次调用：构建缓存，t() 被调用 5 次（5 个 i18n 条目）
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("资源包-语言A");
    expect(mockT).toHaveBeenCalledTimes(5);
    // 第二次调用（同语言）：缓存命中，t() 不再调用
    mockT.mockClear();
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("资源包-语言A");
    expect(mockT).toHaveBeenCalledTimes(0);
    // 模拟切语言：getLang 返回新语言 → 缓存失效 → 重建映射
    mockGetLang.mockReturnValue("en");
    mockT.mockReturnValue("Resource Pack");
    expect(shortLabelOf(RESOURCE_TYPES.PACK)).toBe("Resource Pack");
    expect(mockT).toHaveBeenCalledTimes(5); // 重建缓存，5 个 i18n 条目各调一次
    // 验证 rtype.pack 的翻译随语言变化（调用期求值证据）
    const packCalls = mockT.mock.calls.filter((c) => c[0] === "rtype.pack");
    expect(packCalls.length).toBe(1);
  });
});
