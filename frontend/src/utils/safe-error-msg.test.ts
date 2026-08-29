// @vitest-environment node
// ===== safe-error-msg 测试（Worker 安全的错误消息提取，无 DOM / 无 i18n）=====
// 覆盖四条分支：Error 实例 → .message；null/undefined → "unknown error"；
// 含 string message 的对象 → .message；其余 → String(err)。
import { describe, it, expect } from "vitest";
import { safeErrorMessage } from "./safe-error-msg.ts";

describe("safeErrorMessage", () => {
  it("Error 实例 → .message", () => {
    expect(safeErrorMessage(new Error("boom"))).toBe("boom");
    expect(safeErrorMessage(new TypeError("not a func"))).toBe("not a func");
  });

  it("null / undefined → \"unknown error\"", () => {
    expect(safeErrorMessage(null)).toBe("unknown error");
    expect(safeErrorMessage(undefined)).toBe("unknown error");
  });

  it("含 string message 属性的普通对象 → .message（非 Error 抛出物，如 Go 桥错误包装）", () => {
    expect(safeErrorMessage({ message: "custom failure" })).toBe("custom failure");
    expect(safeErrorMessage({ code: 1, message: "with context" })).toBe("with context");
  });

  it("message 非字符串（数字）→ 走 String(err) 兜底，不透传非字符串", () => {
    expect(safeErrorMessage({ message: 123 })).toBe("[object Object]");
  });

  it("其他类型 → String(err) 兜底", () => {
    expect(safeErrorMessage("plain string")).toBe("plain string");
    expect(safeErrorMessage(42)).toBe("42");
    expect(safeErrorMessage(true)).toBe("true");
    expect(safeErrorMessage({})).toBe("[object Object]");
    expect(safeErrorMessage(["e0"])).toBe("e0");
  });
});
