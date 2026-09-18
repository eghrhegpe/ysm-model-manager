// @vitest-environment node
// ===== toast.ts 通知原语测试 =====
// 覆盖：toast() 默认参数、bus.emit 调用正确性；toastError 友好化组合；toastEmptyRtype i18n key。
import { describe, it, expect, vi, beforeEach } from "vitest";

// mock bus —— toast.ts 通过 bus.emit("toast:show", ...) 发送通知
const mockEmit = vi.fn();
vi.mock("@/bus", () => ({
  bus: { emit: mockEmit },
}));

// mock i18n t() —— 返回 key 本身
vi.mock("@/core/i18n/t.ts", () => ({
  t: (key: string): string => key,
}));

// 必须 resetModules 让 bus/i18n mock 生效（同 errors.test.ts 模式）
vi.resetModules();
const { toast, toastError, toastEmptyRtype } = await import("./toast.ts");

describe("toast", () => {
  beforeEach(() => {
    mockEmit.mockClear();
  });

  it("toast() 默认参数：duration=3000, type='success'", () => {
    toast("操作成功");
    expect(mockEmit).toHaveBeenCalledWith("toast:show", {
      msg: "操作成功",
      duration: 3000,
      type: "success",
    });
  });

  it("toast() 自定义 duration 和 type", () => {
    toast("警告信息", 5000, "warn");
    expect(mockEmit).toHaveBeenCalledWith("toast:show", {
      msg: "警告信息",
      duration: 5000,
      type: "warn",
    });
  });

  it("toast() 传空字符串不抛错", () => {
    expect(() => toast("")).not.toThrow();
    expect(mockEmit).toHaveBeenCalledWith("toast:show", {
      msg: "",
      duration: 3000,
      type: "success",
    });
  });
});

describe("toastError", () => {
  beforeEach(() => {
    mockEmit.mockClear();
  });

  it("toastError 携带 friendlyError 格式化文案 + long duration + error type", () => {
    const err = new Error("quantum flux");
    toastError(err);
    expect(mockEmit).toHaveBeenCalledWith("toast:show", {
      msg: expect.stringContaining("quantum flux"), // ADR-267：type 驱动 error 图标，msg 无 ❌ 前缀
      duration: 5000,
      type: "error",
    });
  });

  it("toastError 自定义 prefix 拼入文案", () => {
    const err = new Error("test");
    toastError(err, undefined, "统计失败");
    const call = mockEmit.mock.calls[0][1] as { msg: string };
    expect(call.msg).toMatch(/^统计失败:/); // ADR-267：无 ❌ 前缀
  });

  it("toastError 自定义 fallback 生效", () => {
    toastError(new Error("boom"), "操作异常");
    const call = mockEmit.mock.calls[0][1] as { msg: string };
    expect(call.msg).toContain("操作异常");
  });

  it("toastError null 输入不抛错", () => {
    expect(() => toastError(null)).not.toThrow();
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });
});

describe("toastEmptyRtype", () => {
  beforeEach(() => {
    mockEmit.mockClear();
  });

  it("toastEmptyRtype 使用 ctx.emptyRtype i18n key + normal duration + error type", () => {
    toastEmptyRtype();
    expect(mockEmit).toHaveBeenCalledWith("toast:show", {
      msg: "ctx.emptyRtype",
      duration: 3000,
      type: "error",
    });
  });
});
