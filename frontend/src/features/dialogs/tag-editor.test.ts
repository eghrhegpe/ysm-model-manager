// ===== 模型标签编辑弹窗测试 =====
// 覆盖：加载失败后禁止保存（P2：空列表写回 → Go SetTags delete 条目 → 标签全清）、正常加载保存
// ADR-190 D3：modal-core 走真实脚手架（overlay/单例/退场为纯 DOM 行为，无需 mock）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    GetModelTags: vi.fn(),
    AllTags: vi.fn(),
    SetModelTags: vi.fn(),
  };
  return { mocks };
});

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetModelTags: mocks.GetModelTags,
    AllTags: mocks.AllTags,
    SetModelTags: mocks.SetModelTags,
  }),
}));

import { modalTagEditor } from "./tag-editor.ts";
import { closeActiveDialog, __resetModalStateForTest } from "./modal-core.ts";
import { t } from "../../core/i18n/t.ts";

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
  __resetModalStateForTest();
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
    // 弹窗未关闭（overlay 仍在文档中）
    expect(document.querySelector(".dlg-overlay")).not.toBeNull();
  });

  it("加载失败后即使按钮状态被绕过，保存守卫仍拒绝写回", async () => {
    mocks.GetModelTags.mockRejectedValue(new Error("boom"));
    const { saveBtn } = await open();

    // 模拟异常路径把按钮重新启用（回归防线：双保险 guard 生效）
    saveBtn.disabled = false;
    saveBtn.click();
    expect(mocks.SetModelTags).not.toHaveBeenCalled();
    expect(document.querySelector(".dlg-overlay")).not.toBeNull();
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

// ===== 覆盖率补强：标签增删 / 建议区 / 关闭路径 / disposed 竞态 =====
describe("modalTagEditor — 标签增删与建议区", () => {
  it("te-tag-del 点击 → 移除对应标签，保存携带剩余项", async () => {
    mocks.GetModelTags.mockResolvedValue(["a", "b"]);
    const { overlay, pending } = await open();
    overlay.querySelector<HTMLButtonElement>(".te-tag-del[data-tag=\"a\"]")!.click();
    expect(overlay.querySelectorAll(".te-tag")).toHaveLength(1);
    overlay.querySelector<HTMLButtonElement>("#te-save")!.click();
    await vi.waitFor(() => expect(mocks.SetModelTags).toHaveBeenCalled());
    expect(mocks.SetModelTags).toHaveBeenCalledWith("/m/a.ysm", ["b"]);
    expect(await pending).toEqual(["b"]);
  });

  it("建议区：未使用标签渲染 + 点击加标签（排序并入）；无未用标签 → 提示占位", async () => {
    mocks.GetModelTags.mockResolvedValue(["a"]);
    mocks.AllTags.mockResolvedValue(["c", "b"]);
    const { overlay, pending } = await open();
    const sug = overlay.querySelector("#te-suggest") as HTMLElement;
    expect(sug.querySelectorAll(".te-sug-btn")).toHaveLength(2);
    sug.querySelector<HTMLButtonElement>(".te-sug-btn[data-tag=\"b\"]")!.click();
    expect(overlay.querySelector("#te-tags")!.textContent).toContain("b");
    // 保存 → ["a","b"]（sort 后）
    overlay.querySelector<HTMLButtonElement>("#te-save")!.click();
    await vi.waitFor(() => expect(mocks.SetModelTags).toHaveBeenCalled());
    expect(await pending).toEqual(["a", "b"]);
  });

  it("全部标签都已使用 → 建议区显示无其他标签占位", async () => {
    mocks.GetModelTags.mockResolvedValue(["a"]);
    mocks.AllTags.mockResolvedValue(["a"]);
    const { overlay } = await open();
    const sug = overlay.querySelector("#te-suggest") as HTMLElement;
    expect(sug.querySelectorAll(".te-sug-btn")).toHaveLength(0);
    expect(sug.textContent).toContain(t("dialog.noOtherTags"));
  });

  it("输入空串 Enter / add 按钮 → 不新增", async () => {
    const { overlay, pending } = await open();
    const input = overlay.querySelector("#te-input") as HTMLInputElement;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(overlay.querySelectorAll(".te-tag")).toHaveLength(0);
    // add 按钮路径：合法标签经按钮新增
    input.value = "k";
    overlay.querySelector<HTMLButtonElement>("#te-add")!.click();
    expect(overlay.querySelectorAll(".te-tag")).toHaveLength(1);
    overlay.querySelector<HTMLButtonElement>("#te-cancel")!.click();
    expect(await pending).toBeNull();
  });
});

describe("modalTagEditor — 关闭路径与 disposed 竞态", () => {
  it("overlay 空白点击 → close(null)；Escape → close(null)", async () => {
    const { overlay, pending } = await open();
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await pending).toBeNull();
  });

  it("Escape 键 → close(null)", async () => {
    const { overlay, pending } = await open();
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await pending).toBeNull();
  });

  it("closeActiveDialog（切页逃逸/android back 路径）→ resolve null", async () => {
    const { pending } = await open();
    expect(closeActiveDialog()).toBe(true);
    expect(await pending).toBeNull();
  });

  it("save 时已 disposed → getApp 后早退，不写回", async () => {
    let resolveTags: (v: string[]) => void = () => {};
    mocks.GetModelTags.mockImplementationOnce(
      () => new Promise<string[]>((r) => (resolveTags = r)),
    );
    const pending = modalTagEditor("/m/d.ysm");
    await new Promise((r) => setTimeout(r, 0)); // 加载链挂起
    const overlay = document.querySelector(".dlg-overlay")!;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); // disposed = true
    expect(await pending).toBeNull();
    resolveTags(["a"]);
    await new Promise((r) => setTimeout(r, 0)); // 恢复后 disposed 早退（162/175）
    // 保存点击：disposed → getApp 后 204 早退，SetModelTags 不调
    (overlay.querySelector("#te-save") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.SetModelTags).not.toHaveBeenCalled();
  });

  it("SetModelTags 在途时关闭 → 恢复后 disposed 早退，不以保存结果关窗（206）", async () => {
    let resolveSet: (v: undefined) => void = () => {};
    mocks.SetModelTags.mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSet = r)),
    );
    const { overlay, pending } = await open();
    overlay.querySelector<HTMLButtonElement>("#te-save")!.click();
    await vi.waitFor(() => expect(mocks.SetModelTags).toHaveBeenCalled());
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(await pending).toBeNull();
    resolveSet(undefined); // SetModelTags 完成 → 206 disposed 早退
    await new Promise((r) => setTimeout(r, 0));
  });

  it("SetModelTags 拒绝 → 错误文案写入 errEl（209）", async () => {
    mocks.SetModelTags.mockRejectedValueOnce(new Error("save boom"));
    const { overlay, pending, errEl } = await open();
    overlay.querySelector<HTMLButtonElement>("#te-save")!.click();
    await vi.waitFor(() => expect(errEl.textContent).toContain("save boom"));
    overlay.querySelector<HTMLButtonElement>("#te-cancel")!.click();
    expect(await pending).toBeNull();
  });
});

describe("依赖注入（ADR-190 D2 注入真化）", () => {
  it("deps.getApp 替代模块 mock 的生产实现，无需 vi.mock backend", async () => {
    const injectedGetApp = vi.fn().mockResolvedValue({
      GetModelTags: vi.fn().mockResolvedValue(["injected-tag"]),
      AllTags: vi.fn().mockResolvedValue([]),
      SetModelTags: vi.fn().mockResolvedValue(undefined),
    });
    const pending = modalTagEditor("/m/b.ysm", { getApp: injectedGetApp });
    await new Promise((r) => setTimeout(r, 0));

    expect(injectedGetApp).toHaveBeenCalled();
    // 注入实现返回的标签已渲染；生产 mock 的 GetModelTags 未被调用
    expect(document.querySelector(".dlg-overlay")!.innerHTML).toContain("injected-tag");
    expect(mocks.GetModelTags).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>("#te-cancel")!.click();
    expect(await pending).toBeNull();
  });
});
