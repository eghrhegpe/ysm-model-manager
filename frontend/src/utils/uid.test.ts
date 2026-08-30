// ===== uid 生成器测试 =====
import { describe, expect, it } from "vitest";
import { uid } from "./uid.ts";

describe("uid", () => {
  it("连续调用返回不同值（唯一性）", () => {
    const a = uid();
    const b = uid();
    expect(a).not.toBe(b);
  });

  it("prefix 前缀生效", () => {
    expect(uid("vec3-").startsWith("vec3-")).toBe(true);
  });

  it("无 prefix 时也非空", () => {
    expect(uid().length).toBeGreaterThan(0);
  });
});
