// @vitest-environment node
// ===== schema.ts allResourceTypes 单测 =====
// 覆盖：正常解析（非空数组 + 必要字段 + extensions 数组）/ 降级路径（空 JSON → console.error）
import { describe, it, expect, vi } from "vitest";

describe("allResourceTypes（正常解析）", () => {
  it("是非空数组", async () => {
    const { allResourceTypes } = await import("./schema.ts");
    expect(Array.isArray(allResourceTypes)).toBe(true);
    expect(allResourceTypes.length).toBeGreaterThan(0);
  });

  it("每个元素含必要字段 id/preview/extensions", async () => {
    const { allResourceTypes } = await import("./schema.ts");
    for (const rt of allResourceTypes) {
      expect(typeof rt.id).toBe("string");
      expect(rt.id.length).toBeGreaterThan(0);
      expect(rt.preview).toBeDefined();
    }
  });

  it("每个 resource type 的 extensions 是数组（若有）", async () => {
    const { allResourceTypes } = await import("./schema.ts");
    for (const rt of allResourceTypes) {
      if (rt.extensions !== undefined) {
        expect(Array.isArray(rt.extensions)).toBe(true);
      }
    }
  });
});

describe("降级路径（空 JSON）", () => {
  it("空 JSON 时 console.error 被调用且 allResourceTypes 为空数组", async () => {
    vi.resetModules();
    vi.doMock("#root/resource_types.json", () => ({ default: {} }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { allResourceTypes } = await import("./schema.ts");
    expect(allResourceTypes).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      "[resource] resource_types.json 解析为空或结构异常，前端资源类型派生降级为空表",
    );
    spy.mockRestore();
  });
});
