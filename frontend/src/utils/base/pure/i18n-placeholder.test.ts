// @vitest-environment node
// ===== i18n 占位符提取测试 =====
// extractPlaceholders 是占位符检测的单一事实源（core/i18n/t.ts 残留守卫 + locales-consistency.test.ts 一致性校验双消费），
// 锁定其 JS 标识符约束：字母/_/$ 开头（拒绝数字开头的 {1}），与 interpolate 的 split/join 键空间一致。
import { describe, it, expect } from "vitest";
import { extractPlaceholders } from "./i18n-placeholder.ts";

describe("extractPlaceholders", () => {
  it("提取单个占位符", () => {
    expect(extractPlaceholders("已加入队列: {n} 个文件")).toEqual(["n"]);
  });

  it("提取多个占位符（去重 + 稳定排序）", () => {
    expect(extractPlaceholders("{total} 个文件（{failed} 个失败）")).toEqual(["failed", "total"]);
  });

  it("重复占位符去重", () => {
    expect(extractPlaceholders("{n} / {n}")).toEqual(["n"]);
  });

  it("无占位符 → 空数组", () => {
    expect(extractPlaceholders("纯文本")).toEqual([]);
  });

  it("拒绝数字开头的占位符（非 JS 标识符）", () => {
    // 旧一致性正则 [a-zA-Z0-9_]+ 会误匹配 {1}；JS 标识符约束下应排除
    expect(extractPlaceholders("{1} + {2}")).toEqual([]);
  });

  it("允许 $ 开头的占位符（JS 标识符合法）", () => {
    expect(extractPlaceholders("{$foo}")).toEqual(["$foo"]);
  });

  it("允许 _ 开头的占位符", () => {
    expect(extractPlaceholders("{_bar}")).toEqual(["_bar"]);
  });

  it("忽略非标识符形态（含连字符 / 空格）", () => {
    expect(extractPlaceholders("{a-b} {c d}")).toEqual([]);
  });
});
