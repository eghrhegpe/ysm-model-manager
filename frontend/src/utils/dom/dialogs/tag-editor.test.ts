// ===== 模型标签编辑弹窗测试 =====
// 覆盖：加载失败后禁止保存（P2：空列表写回 → Go SetTags delete 条目 → 标签全清）、正常加载保存
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks, closeDlgMock, registerDlgMock } = vi.hoisted(() => {
  const mocks = {
    GetModelTags: vi.fn(),
    AllTags: vi.fn(),
    SetModelTags: vi.fn(),
  };
  return {
    mocks,
    closeDlgMock: vi.fn(
      (_o: unknown, resolve?: (r: unknown) => void, result?: unknown) =>
        resolve?.(result),
    ),
    registerDlgMock: vi.fn(),
  };
});

vi.mock("./modal.ts", () => ({
  closeDlg: closeDlgMock,
  registerDlg: registerDlgMock,
  esc: (s: unknown): string => String(s),
}));

vi.mock("../../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetModelTags: mocks.GetModelTags,
    AllTags: mocks.AllTags,
    SetModelTags: mocks.SetModelTags,
  }),
}));

import { modalTagEditor } from "./tag-editor.ts";

async function open(modelPath = "/m/a.ysm") {
  const pending = modalTagEditor(modelPath);
  // setTimeout(0) 是 macrotask，必然晚于加载链的微任务 → 加载已完成
  await new Promise((r) => setTimeout(r, 0));
  const overlay = document.querySelector(".dlg-overlay")!;
  const saveBtn = overlay.querySelector("#te-save") as HTMLButtonElement;
  const errEl = overlay.querySelector("#te-err") as HTMLElement;
  return { pending, overlay, saveBtn, errEl };
}

beforeEach(() => {
  document.body.innerHTML = "";
  closeDlgMock.mockClear();
  registerDlgMock.mockClear();
  vi.clearAllMocks();
  mocks.GetModelTags.mockResolvedValue([]);
  mocks.AllTags.mockResolvedValue([]);
  mocks.SetModelTags.mockResolvedValue(undefined);
});

describe("modalTagEditor — 加载失败保护（P2 数据丢失）", () => {
  it("GetModelTags 抛错 → 保存按钮保持禁用、不写回、不关闭", async () => {
    mocks.GetModelTags.mockRejectedValue(new Error("boom"));
    const { saveBtn, errEl } = await open();

    expect(errEl.textContent).toContain("加载标签失败");
    expect(saveBtn.disabled).toBe(true);

    // disabled 按钮 click 不派发事件，SetModelTags 绝不被调
    saveBtn.click();
    expect(mocks.SetModelTags).not.toHaveBeenCalled();
    expect(closeDlgMock).not.toHaveBeenCalled();
  });

  it("加载失败后即使按钮状态被绕过，保存守卫仍拒绝写回", async () => {
    mocks.GetModelTags.mockRejectedValue(new Error("boom"));
    const { saveBtn } = await open();

    // 模拟异常路径把按钮重新启用（回归防线：双保险 guard 生效）
    saveBtn.disabled = false;
    saveBtn.click();
    expect(mocks.SetModelTags).not.toHaveBeenCalled();
    expect(closeDlgMock).not.toHaveBeenCalled();
  });
});

describe("modalTagEditor — 正常加载保存", () => {
  it("加载后输入新标签 Enter → 保存时携带去重排序后的全量列表", async () => {
    mocks.GetModelTags.mockResolvedValue(["a"]);
    const { pending, overlay, saveBtn } = await open();

    const input = overlay.querySelector("#te-input") as HTMLInputElement;
    input.value = "b";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    // 已存在的标签重复输入 → 拒绝
    input.value = "a";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    saveBtn.click();
    const result = await pending;

    expect(mocks.SetModelTags).toHaveBeenCalledWith("/m/a.ysm", ["a", "b"]);
    expect(result).toEqual(["a", "b"]);
  });
});
