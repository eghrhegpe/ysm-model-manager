// @vitest-environment node
// ===== event-types.ts 测试 — parseEventPayload 泛型守卫 =====
import { describe, it, expect } from "vitest";
import { parseEventPayload } from "./event-types.ts";

describe("parseEventPayload — Wails 事件 payload 类型化守卫", () => {
  it("合法非空数组 → 返回类型化元组", () => {
    const result = parseEventPayload<[string, number]>({ data: ["ok", 42] }, "test");
    expect(result).toEqual(["ok", 42]);
  });

  it("data 为 null → 返回 null", () => {
    expect(parseEventPayload<[string]>({ data: null }, "test")).toBeNull();
  });

  it("data 为 undefined → 返回 null", () => {
    expect(parseEventPayload<[string]>({ data: undefined }, "test")).toBeNull();
  });

  it("data 为空数组 → 返回 null", () => {
    expect(parseEventPayload<[string]>({ data: [] }, "test")).toBeNull();
  });

  it("data 为非数组 → 返回 null", () => {
    expect(parseEventPayload<[string]>({ data: "string" }, "test")).toBeNull();
    expect(parseEventPayload<[string]>({ data: 123 }, "test")).toBeNull();
    expect(parseEventPayload<[string]>({ data: {} }, "test")).toBeNull();
  });

  it("event 为 null → 返回 null", () => {
    expect(parseEventPayload<[string]>(null as unknown as { data: unknown }, "test")).toBeNull();
  });

  it("event 为 undefined → 返回 null", () => {
    expect(
      parseEventPayload<[string]>(undefined as unknown as { data: unknown }, "test"),
    ).toBeNull();
  });

  it("三元素元组 → 正确解析", () => {
    const result = parseEventPayload<[string, string, string]>(
      { data: ["file.ysm", "ok", ""] },
      "test",
    );
    expect(result).toEqual(["file.ysm", "ok", ""]);
  });

  it("可选 tag 参数 → 不传也不报错", () => {
    const result = parseEventPayload<[number, number]>({ data: [100, 200] });
    expect(result).toEqual([100, 200]);
  });
});
