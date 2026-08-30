// ===== 高级筛选弹窗测试 =====
// 覆盖：初始值回填、应用/清除/取消/Esc/overlay 点击、验证失败拦截、Enter 提交、标签提示加载
import { describe, it, expect, vi, beforeEach } from "vitest";

const { closeDlgMock, registerDlgMock, trapFocusMock, AllTagsMock } = vi.hoisted(() => ({
  closeDlgMock: vi.fn(
    (_o: unknown, resolve?: (r: unknown) => void, result?: unknown) =>
      resolve?.(result),
  ),
  registerDlgMock: vi.fn(),
  trapFocusMock: vi.fn(),
  AllTagsMock: vi.fn(),
}));

vi.mock("./modal.ts", () => ({
  closeDlg: closeDlgMock,
  registerDlg: registerDlgMock,
  trapFocus: trapFocusMock,
  esc: (s: unknown): string => String(s),
}));

vi.mock("../../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({ AllTags: AllTagsMock }),
}));

import { modalAdvFilter } from "./adv-filter.ts";

async function open(opts: { value?: Record<string, unknown> } = {}) {
  const pending = modalAdvFilter(opts as unknown as Parameters<typeof modalAdvFilter>[0]);
  // macrotask 晚于内部异步标签加载链
  await new Promise((r) => setTimeout(r, 0));
  const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
  const q = <T extends HTMLElement>(sel: string): T =>
    overlay.querySelector(sel) as T;
  return {
    pending,
    overlay,
    kw: q<HTMLInputElement>("#afv-kw"),
    minBones: q<HTMLInputElement>("#afv-minBones"),
    maxBones: q<HTMLInputElement>("#afv-maxBones"),
    minTex: q<HTMLInputElement>("#afv-minTex"),
    errEl: q<HTMLElement>("#afv-err"),
    tagHint: q<HTMLElement>("#afv-tag-hint"),
    ok: q<HTMLButtonElement>("#afv-ok"),
    cancel: q<HTMLButtonElement>("#afv-cancel"),
    clear: q<HTMLButtonElement>("#afv-clear"),
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  closeDlgMock.mockClear();
  registerDlgMock.mockClear();
  vi.clearAllMocks();
  AllTagsMock.mockResolvedValue([]);
});

describe("modalAdvFilter — 渲染与初始值", () => {
  it("默认无初始值时输入框为空", async () => {
    const { kw, minBones, minTex } = await open();
    expect(kw.value).toBe("");
    expect(minBones.value).toBe("");
    expect(minTex.value).toBe("");
  });

  it("opts.value 回填各字段", async () => {
    const { kw, minBones, maxBones, minTex } = await open({
      value: {
        keyword: "Steve",
        minBones: 3,
        maxBones: 10,
        minTex: 64,
      },
    });
    expect(kw.value).toBe("Steve");
    expect(minBones.value).toBe("3");
    expect(maxBones.value).toBe("10");
    expect(minTex.value).toBe("64");
  });

  it("AllTags 成功 → 显示已有标签提示", async () => {
    AllTagsMock.mockResolvedValue(["近代", "武侠"]);
    const { tagHint } = await open();
    expect(tagHint.textContent).toContain("已有标签: 近代, 武侠");
  });

  it("AllTags 抛错 → 静默（无标签提示、不抛）", async () => {
    AllTagsMock.mockRejectedValue(new Error("boom"));
    const { tagHint } = await open();
    expect(tagHint.textContent).toBe("");
  });
});

describe("modalAdvFilter — 关闭路径", () => {
  it("应用有效条件 → resolve 收集值并清 keyword 空白", async () => {
    const { kw, minBones, ok, pending } = await open({
      value: { keyword: " a ", minBones: 2 },
    });
    kw.value = "  Alex  ";
    minBones.value = "5";
    ok.click();
    await expect(pending).resolves.toMatchObject({
      keyword: "Alex",
      minBones: 5,
    });
  });

  it("min > max 验证失败 → 显示错误、不关闭", async () => {
    const { minBones, maxBones, errEl, ok, pending } = await open();
    minBones.value = "10";
    maxBones.value = "3";
    ok.click();
    expect(errEl.textContent).toContain("骨骼数");
    // closeDlg 未被调用 → promise 未 resolve
    await expect(
      Promise.race([pending, Promise.resolve("pending")]),
    ).resolves.toBe("pending");
  });

  it("清除全部 → resolve { cleared: true }", async () => {
    const { clear, pending } = await open({
      value: { keyword: "x", minBones: 1 },
    });
    clear.click();
    await expect(pending).resolves.toEqual({ cleared: true });
  });

  it("取消按钮 → resolve null", async () => {
    const { cancel, pending } = await open();
    cancel.click();
    await expect(pending).resolves.toBeNull();
  });

  it("Esc 键 → resolve null", async () => {
    const { overlay, pending } = await open();
    overlay.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await expect(pending).resolves.toBeNull();
  });

  it("点击 overlay 空白 → resolve null（e.target 为 overlay）", async () => {
    const { overlay, pending } = await open();
    overlay.click();
    await expect(pending).resolves.toBeNull();
  });

  it("点击输入框内部 → 不关闭", async () => {
    const { kw, pending } = await open();
    kw.click(); // target 是 input，非 overlay
    await expect(
      Promise.race([pending, Promise.resolve("pending")]),
    ).resolves.toBe("pending");
  });

  it("registerDlg 的取消回调 → resolve null（切页逃逸）", async () => {
    await open();
    const cancelClose = registerDlgMock.mock.calls[0][1] as () => void;
    cancelClose();
    // closeDlg mock 已 resolve null，验证被调用
    expect(closeDlgMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      null,
    );
  });
});

describe("modalAdvFilter — Enter 提交", () => {
  it("输入框 Enter → 收集并提交", async () => {
    const { minBones, pending } = await open();
    minBones.value = "8";
    minBones.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await expect(pending).resolves.toMatchObject({ minBones: 8 });
  });

  it("输入框 Enter 且验证失败 → 显示错误不提交", async () => {
    const { minBones, maxBones, errEl, pending } = await open();
    minBones.value = "9";
    maxBones.value = "1";
    maxBones.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(errEl.textContent).toContain("骨骼数");
    await expect(
      Promise.race([pending, Promise.resolve("pending")]),
    ).resolves.toBe("pending");
  });
});
