// @vitest-environment node
// ===== scene-capability.ts 持久化工具单测 =====
// 覆盖 restoreFields 类型分发的全部语义分支（ADR-126 引入的公共持久化 API）：
//   - number/boolean/string 分发各自触发匹配恢复器
//   - 类型错配 / spec 未配对应类型 → 跳过且不置 applied（返回 false）
//   - null 存档 / 损坏数据（真值非对象）→ false，不应用任何字段
//   - 至少一个字段回填 → true（@returns 契约：真实应用与否，而非「有存档」）
import { describe, it, expect, vi } from "vitest";
import { restoreFields } from "./scene-capability.ts";

describe("restoreFields — 类型分发", () => {
  it("number 值触发 number 恢复器", () => {
    const n = vi.fn();
    const ok = restoreFields({ timeOfDay: 15 }, { timeOfDay: { number: n } });
    expect(n).toHaveBeenCalledWith(15);
    expect(ok).toBe(true);
  });

  it("boolean 值触发 boolean 恢复器", () => {
    const b = vi.fn();
    const ok = restoreFields({ enabled: false }, { enabled: { boolean: b } });
    expect(b).toHaveBeenCalledWith(false);
    expect(ok).toBe(true);
  });

  it("string 值触发 string 恢复器", () => {
    const s = vi.fn();
    const ok = restoreFields({ name: "studio" }, { name: { string: s } });
    expect(s).toHaveBeenCalledWith("studio");
    expect(ok).toBe(true);
  });

  it("混合存档：匹配的字段回填，不匹配的跳过，返回 true", () => {
    const n = vi.fn();
    const s = vi.fn();
    const ok = restoreFields(
      { timeOfDay: 9, name: "studio" },
      { timeOfDay: { number: n }, name: { string: s } },
    );
    expect(n).toHaveBeenCalledWith(9);
    expect(s).toHaveBeenCalledWith("studio");
    expect(ok).toBe(true);
  });
});

describe("restoreFields — 不匹配与损坏数据", () => {
  it("类型错配：number 字段存了 string → 跳过且不抛，返回 false", () => {
    const n = vi.fn();
    const ok = restoreFields({ timeOfDay: "15" }, { timeOfDay: { number: n } });
    expect(n).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("spec 未配该类型恢复器（值 number、spec 只配 boolean）→ 不算回填", () => {
    const b = vi.fn();
    const ok = restoreFields({ timeOfDay: 15 }, { timeOfDay: { boolean: b } });
    expect(b).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("null 存档 → false（早退语义）", () => {
    const n = vi.fn();
    expect(restoreFields(null, { timeOfDay: { number: n } })).toBe(false);
    expect(n).not.toHaveBeenCalled();
  });

  it("损坏数据（真值非对象，如 restoreState 对 JSON.parse(\"42\") 的返回）→ false 且不应用", () => {
    const n = vi.fn();
    const corrupt = 42 as unknown as Record<string, unknown>;
    const ok = restoreFields(corrupt, { timeOfDay: { number: n } });
    expect(n).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("存档存在但全部字段都不匹配 → false（「有存档但什么都没恢复」= 早退）", () => {
    const ok = restoreFields(
      { timeOfDay: "15", enabled: 1 },
      { timeOfDay: { number: vi.fn() }, enabled: { boolean: vi.fn() } },
    );
    expect(ok).toBe(false);
  });
});
