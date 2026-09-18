// 单点测试：复制回执必须如实（诊断页重复实现审计 C5 的墓碑）
//
// 立因：本页曾自写降级（返回 void）并**无条件**弹「已复制」——失败也说成功。这条测试钉住
// 「失败就说失败」，它是该缺陷的墓碑：任何退回「不看 copyText 的返回值」的写法都会立刻红。
import { beforeEach, describe, expect, it, vi } from "vitest";

const { busEmit, copyText } = vi.hoisted(() => ({
  busEmit: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock("@/bus", () => ({ bus: { emit: busEmit } }));
vi.mock("@/utils/dom/clipboard.ts", () => ({ copyText }));

import { copyWithToast } from "./copy-toast.ts";

/** 取最后一次 toast:show 的载荷（断言只看它，不看调用次数这类易碎细节） */
function lastToast(): { msg: string; duration: number; type?: string } {
  const calls = busEmit.mock.calls.filter((c) => c[0] === "toast:show");
  expect(calls.length).toBe(1);
  return calls[0][1] as { msg: string; duration: number; type?: string };
}

describe("copyWithToast：复制回执如实", () => {
  beforeEach(() => {
    busEmit.mockClear();
    copyText.mockReset();
  });

  it("写入成功 → ✅ + 成功文案，且不带 error 类型", async () => {
    copyText.mockResolvedValue({ ok: true });
    const ok = await copyWithToast("文本", "diagnostics.copiedLog");
    expect(ok).toBe(true);
    const toast = lastToast();
    expect(toast.msg).toContain("已复制");
    expect(toast.type).toBeUndefined();
    expect(copyText).toHaveBeenCalledWith("文本");
  });

  it("写入与降级全失败 → ❌ 复制失败 + error 类型，**绝不**出现「已复制」", async () => {
    copyText.mockResolvedValue({ ok: false, reason: "exec-failed" });
    const ok = await copyWithToast("文本", "diagnostics.copiedLog");
    expect(ok).toBe(false);
    const toast = lastToast();
    expect(toast.msg).not.toContain("已复制");
    expect(toast.msg).toContain("复制失败");
    expect(toast.type).toBe("error");
  });

  it("成功文案键由调用方决定（整份日志带隐私提示、单行日志不带）", async () => {
    copyText.mockResolvedValue({ ok: true });
    await copyWithToast("文本", "diagnostics.copiedLogPrivacy");
    expect(lastToast().msg).toContain("勿公开分享");
  });
});
