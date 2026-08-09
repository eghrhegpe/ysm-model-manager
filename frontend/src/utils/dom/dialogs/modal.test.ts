// ===== 统一模态弹窗测试（modal.ts）=====
// 覆盖：closeDlg / registerDlg / modalConfirm / modalPrompt / modalSelect
// 注意：_activeOverlay/_closeActive 是模块级单例，每个用例必须把弹窗关干净，
// 否则残留的 _closeActive 会在下一个用例 registerDlg 时触发（脏状态）。
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  closeDlg,
  registerDlg,
  closeActiveDialog,
  modalConfirm,
  modalPrompt,
  modalSelect,
} from "./modal.ts";

// 统一清理：恢复真实定时器（防 fake timers 泄漏到下一用例）+ 移除残留 overlay
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll(".dlg-overlay").forEach((el) => el.remove());
});

/** 关闭当前残留弹窗（走 closeDlg 路径清空单例状态） */
function closeActiveDlg(): void {
  const overlay = document.querySelector(".dlg-overlay") as HTMLElement | null;
  if (overlay) closeDlg(overlay, () => {}, null, 0);
}

describe("closeDlg — 退场动画", () => {
  it("添加 dlg-closing class 后移除 overlay", () => {
    vi.useFakeTimers();
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    closeDlg(overlay, () => {}, null, 120);
    expect(overlay.classList.contains("dlg-closing")).toBe(true);
    expect(document.body.contains(overlay)).toBe(true);
    vi.advanceTimersByTime(120);
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("_closing 标记防重复触发", () => {
    vi.useFakeTimers();
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const fn = vi.fn();
    closeDlg(overlay, fn, "first", 120);
    closeDlg(overlay, fn, "second", 120);
    vi.advanceTimersByTime(120);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("first");
  });

  it("nil overlay 不抛错", () => {
    expect(() => closeDlg(null as never, () => {}, null)).not.toThrow();
  });
});

describe("registerDlg — 活动弹窗单例", () => {
  it("新弹窗注册时关闭旧弹窗", () => {
    vi.useFakeTimers();
    const oldOverlay = document.createElement("div");
    document.body.appendChild(oldOverlay);
    const oldClose = vi.fn();
    registerDlg(oldOverlay, oldClose);
    expect(oldClose).not.toHaveBeenCalled();

    const newOverlay = document.createElement("div");
    document.body.appendChild(newOverlay);
    registerDlg(newOverlay, vi.fn());
    // 旧弹窗应被关闭
    expect(oldClose).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(120);
  });
});

describe("closeActiveDialog — android:back 先关弹窗（ADR-047）", () => {
  it("有活动弹窗 → 关闭并返回 true", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const cancelClose = vi.fn();
    registerDlg(overlay, cancelClose);
    expect(closeActiveDialog()).toBe(true);
    expect(cancelClose).toHaveBeenCalledTimes(1);
  });

  it("无活动弹窗 → 返回 false", () => {
    expect(closeActiveDialog()).toBe(false);
  });

  it("closable=false 的进度弹窗 → 不强关，返回 false", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const cancelClose = vi.fn();
    registerDlg(overlay, cancelClose, false);
    expect(closeActiveDialog()).toBe(false);
    expect(cancelClose).not.toHaveBeenCalled();
  });

  it("关闭后再次调用返回 false（槽位已清空）", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    registerDlg(overlay, vi.fn());
    expect(closeActiveDialog()).toBe(true);
    expect(closeActiveDialog()).toBe(false);
  });
});

describe("modalConfirm — 确认框", () => {
  it("确定返回 true", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const okBtn = document.querySelector("#mc-ok") as HTMLElement;
    expect(okBtn).not.toBeNull();
    okBtn.click();
    await expect(promise).resolves.toBe(true);
  });

  it("取消返回 false", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const cancelBtn = document.querySelector("#mc-cancel") as HTMLElement;
    cancelBtn.click();
    await expect(promise).resolves.toBe(false);
  });

  it("danger 模式按钮有对应 class", () => {
    modalConfirm({ title: "危险", message: "确定?", danger: true });
    const okBtn = document.querySelector("#mc-ok") as HTMLElement;
    expect(okBtn.classList.contains("dlg-btn-danger")).toBe(true);
    closeActiveDlg();
  });

  it("自定义 width", () => {
    modalConfirm({ title: "宽", message: "宽屏", width: "600px" });
    const box = document.querySelector(".dlg-box") as HTMLElement;
    expect(box.style.width).toBe("600px");
    closeActiveDlg();
  });

  it("bodyHTML 替代 message 文本", () => {
    modalConfirm({
      title: "自定义",
      message: "不应出现",
      bodyHTML: "<div id='custom-body'>自定义内容</div>",
    });
    expect(document.querySelector("#custom-body")).not.toBeNull();
    expect(document.querySelector(".dlg-box")?.innerHTML).not.toContain("不应出现");
    closeActiveDlg();
  });

  it("overlay 点击（背景）返回 false", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.click();
    await expect(promise).resolves.toBe(false);
  });

  it("Enter 键确认返回 true（P3 修复：文案声明 (Enter) 但原实现只有 Esc）", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const box = document.querySelector(".dlg-box") as HTMLElement;
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await expect(promise).resolves.toBe(true);
  });

  it("Escape 键取消返回 false", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const box = document.querySelector(".dlg-box") as HTMLElement;
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBe(false);
  });

  it("icon 经 esc 转义（P3 修复：标题 icon 裸插 innerHTML 会注入）", async () => {
    modalConfirm({ title: "确认", icon: '<img src=x onerror="alert(1)">', message: "m" });
    const titleEl = document.querySelector(".dlg-title") as HTMLElement;
    expect(titleEl.querySelector("img")).toBeNull(); // 未生成 img 元素
    expect(titleEl.innerHTML).toContain("&lt;img"); // 原文以转义形式保留
    closeActiveDlg();
  });
});

describe("modalPrompt — 输入框", () => {
  it("确定返回输入值", async () => {
    const promise = modalPrompt({ title: "命名", value: "默认名" });
    const okBtn = document.querySelector("#mp-ok") as HTMLElement;
    okBtn.click();
    await expect(promise).resolves.toBe("默认名");
  });

  it("取消返回 null", async () => {
    const promise = modalPrompt({ title: "命名" });
    const cancelBtn = document.querySelector("#mp-cancel") as HTMLElement;
    cancelBtn.click();
    await expect(promise).resolves.toBeNull();
  });

  it("空输入时确定按钮不关闭弹窗（显示错误提示）", async () => {
    const promise = modalPrompt({ title: "命名" });
    const okBtn = document.querySelector("#mp-ok") as HTMLElement;
    okBtn.click();
    // promise 不应被 resolve（空输入拦截）
    const errEl = document.querySelector("#mp-err") as HTMLElement;
    expect(errEl?.textContent).toContain("不能为空");
    // 显式关闭清空单例（closeDlg 会清 _activeOverlay）
    closeActiveDlg();
  });

  it("input 后清空错误提示", () => {
    modalPrompt({ title: "命名" });
    const errEl = document.querySelector("#mp-err") as HTMLElement;
    const input = document.querySelector("#mp-input") as HTMLInputElement;
    // 先触发空输入错误
    const okBtn = document.querySelector("#mp-ok") as HTMLElement;
    okBtn.click();
    expect(errEl?.textContent).toContain("不能为空");
    // 输入内容后清除
    input.value = "test";
    input.dispatchEvent(new Event("input"));
    expect(errEl?.textContent).toBe("");
    closeActiveDlg();
  });
});

describe("modalSelect — 下拉框", () => {
  it("确定返回当前选中项", async () => {
    const promise = modalSelect({
      title: "选择类型",
      items: ["类型A", "类型B", "类型C"],
    });
    const select = document.querySelector("#ms-select") as HTMLSelectElement;
    select.value = "类型B";
    const okBtn = document.querySelector("#ms-ok") as HTMLElement;
    okBtn.click();
    await expect(promise).resolves.toBe("类型B");
  });

  it("取消返回 null", async () => {
    const promise = modalSelect({ title: "选择", items: ["A", "B"] });
    const cancelBtn = document.querySelector("#ms-cancel") as HTMLElement;
    cancelBtn.click();
    await expect(promise).resolves.toBeNull();
  });

  it("默认选中第一项", () => {
    modalSelect({ title: "选择", items: ["默认项", "其他"] });
    const select = document.querySelector("#ms-select") as HTMLSelectElement;
    expect(select.value).toBe("默认项");
    closeActiveDlg();
  });
});
