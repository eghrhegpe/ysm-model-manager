// ===== 统一模态弹窗测试（modal.ts）=====
// 覆盖：closeDlg / registerDlg / modalConfirm / modalPrompt / modalSelect
//       + trapFocus / modalProgress / 键盘与遮罩交互（fmtMB 用例已迁 format/fmt-mb.test.ts）
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
  modalProgress,
  trapFocus,
  __resetModalStateForTest,
} from "./modal.ts";

// 统一清理：恢复真实定时器（防 fake timers 泄漏到下一用例）+ 移除残留 overlay
afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll(".dlg-overlay").forEach((el) => el.remove());
  // isolate:false 共享模块图下兄弟文件可能残留活动弹窗单例 → 每用例清空槽位
  __resetModalStateForTest();
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
    expect(() => closeDlg(null as unknown as HTMLElement, () => {}, null)).not.toThrow();
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

describe("modalConfirm — Enter 守卫（P3/P2 修复：按钮目标与 IME 组合态不抢先确认）", () => {
  it("焦点在取消按钮上按 Enter → 由按钮原生 click 处理，box 不抢先确认", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const cancelBtn = document.querySelector("#mc-cancel") as HTMLElement;
    cancelBtn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 30));
    // promise 未被结算（未被抢先确认）
    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    closeActiveDlg();
  });

  it("IME 组合态按 Enter → 不确认", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const box = document.querySelector(".dlg-box") as HTMLElement;
    box.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
    let settled = false;
    promise.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);
    closeActiveDlg();
  });
});

describe("modalConfirm / modalPrompt / modalSelect — overlay 级 Escape", () => {
  it("confirm：Escape 点在遮罩（overlay）上返回 false", async () => {
    const promise = modalConfirm({ title: "确认?", message: "继续?" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBe(false);
  });

  it("prompt：Escape 点在遮罩上返回 null", async () => {
    const promise = modalPrompt({ title: "命名" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBeNull();
  });

  it("prompt：点击遮罩背景返回 null", async () => {
    const promise = modalPrompt({ title: "命名" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.click();
    await expect(promise).resolves.toBeNull();
  });

  it("select：Escape 点在遮罩上返回 null", async () => {
    const promise = modalSelect({ title: "选择", items: ["A"] });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBeNull();
  });

  it("select：点击遮罩背景返回 null", async () => {
    const promise = modalSelect({ title: "选择", items: ["A"] });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.click();
    await expect(promise).resolves.toBeNull();
  });
});

describe("modalPrompt — 输入框键盘交互", () => {
  it("Enter 提交输入值", async () => {
    const promise = modalPrompt({ title: "命名" });
    const input = document.querySelector("#mp-input") as HTMLInputElement;
    input.value = "新名字";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await expect(promise).resolves.toBe("新名字");
  });

  it("Enter 空输入 → 错误提示且不关闭", async () => {
    const promise = modalPrompt({ title: "命名" });
    const input = document.querySelector("#mp-input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    const errEl = document.querySelector("#mp-err") as HTMLElement;
    expect(errEl?.textContent).toContain("不能为空");
    closeActiveDlg();
  });

  it("Escape 在输入框上返回 null", async () => {
    const promise = modalPrompt({ title: "命名" });
    const input = document.querySelector("#mp-input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBeNull();
  });
});

describe("modalSelect — 下拉框键盘交互", () => {
  it("Enter 提交当前选中项", async () => {
    const promise = modalSelect({ title: "选择", items: ["A", "B"] });
    const select = document.querySelector("#ms-select") as HTMLSelectElement;
    select.value = "B";
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await expect(promise).resolves.toBe("B");
  });

  it("Escape 在 select 上返回 null", async () => {
    const promise = modalSelect({ title: "选择", items: ["A"] });
    const select = document.querySelector("#ms-select") as HTMLSelectElement;
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await expect(promise).resolves.toBeNull();
  });

  it("select 开启期间新弹窗注册 → 旧 select 经 registerDlg 抢占的 cancelClose 结算为 null", async () => {
    const promise = modalSelect({ title: "选择", items: ["A"] });
    const cancelBtn = document.querySelector("#ms-cancel") as HTMLElement;
    expect(cancelBtn).not.toBeNull();
    // 新弹窗注册会调 _closeActive() → 旧 select 的 cancelClose（modal.ts:247）被触发
    modalConfirm({ title: "新弹窗", message: "抢占旧弹窗" });
    await expect(promise).resolves.toBeNull();
  });
});

describe("trapFocus — 焦点陷阱", () => {
  const makeOverlay = (): { overlay: HTMLElement; btn1: HTMLButtonElement; btn2: HTMLButtonElement } => {
    const overlay = document.createElement("div");
    const btn1 = document.createElement("button");
    btn1.id = "f1";
    const btn2 = document.createElement("button");
    btn2.id = "f2";
    overlay.append(btn1, btn2);
    document.body.appendChild(overlay);
    return { overlay, btn1, btn2 };
  };

  it("Shift+Tab 在首元素 → 跳到末元素；Tab 在末元素 → 跳回首元素", () => {
    const { overlay, btn1, btn2 } = makeOverlay();
    const cleanup = trapFocus(overlay);
    btn1.focus();
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    expect(document.activeElement).toBe(btn2);
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(btn1);
    cleanup();
    overlay.remove();
  });

  it("焦点在 overlay 本身 → Tab 跳首元素、Shift+Tab 跳末元素", () => {
    const { overlay, btn1, btn2 } = makeOverlay();
    const cleanup = trapFocus(overlay);
    overlay.focus();
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(btn1);
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    expect(document.activeElement).toBe(btn2);
    cleanup();
    overlay.remove();
  });

  it("非 Tab 键不拦截；无可聚焦元素直接返回", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    const cleanup = trapFocus(empty);
    expect(() =>
      empty.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })),
    ).not.toThrow();
    expect(() =>
      empty.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })),
    ).not.toThrow();
    cleanup();
    empty.remove();
  });

  it("cleanup 后移除监听器（不再拦截 Tab）", () => {
    const { overlay, btn1, btn2 } = makeOverlay();
    const cleanup = trapFocus(overlay);
    cleanup();
    btn1.focus();
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }));
    expect(document.activeElement).toBe(btn1);
    overlay.remove();
  });
});

describe("modalProgress — 进度弹窗", () => {
  it("update 已知总大小 → 百分比/字节文案与条幅宽度", () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载" });
    h.update(25 * 1024 * 1024, 100 * 1024 * 1024);
    const fill = document.querySelector(".dlg-box > div:nth-child(2) > div") as HTMLElement;
    expect(fill.style.width).toBe("25%");
    const pctEl = document.querySelector(".dlg-box > div:nth-child(3)") as HTMLElement;
    expect(pctEl.textContent).toContain("25%");
    expect(pctEl.textContent).toContain("25.0 MB / 100.0 MB");
    // 超 100 钳制
    h.update(200 * 1024 * 1024, 100 * 1024 * 1024);
    expect(fill.style.width).toBe("100%");
  });

  it("update 未知大小（total<=0）→ 不确定态 60% + 已下载文案", () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载" });
    h.update(7 * 1024 * 1024, 0);
    const fill = document.querySelector(".dlg-box > div:nth-child(2) > div") as HTMLElement;
    expect(fill.style.width).toBe("60%");
    const pctEl = document.querySelector(".dlg-box > div:nth-child(3)") as HTMLElement;
    expect(pctEl.textContent).toContain("7.0 MB");
  });

  it("update 非有限数值 → 忽略不写样式（NaN% 防注入）", () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载" });
    h.update(50, 100);
    const fill = document.querySelector(".dlg-box > div:nth-child(2) > div") as HTMLElement;
    fill.style.width = "50%";
    h.update(NaN, 100);
    h.update(50, NaN);
    expect(fill.style.width).toBe("50%");
  });

  it("closable=true（默认）Esc/点遮罩均可关闭；关闭后 update 无副作用", async () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.click();
    // _closing 防重复：Escape 再触发也不会双重移除/结算
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.advanceTimersByTimeAsync(120);
    expect(document.body.contains(overlay)).toBe(false);
    // 关闭后 update 静默忽略（不抛错、不复活）
    expect(() => h.update(10, 100)).not.toThrow();
  });

  it("自定义 width 应用在弹窗盒子上", () => {
    vi.useFakeTimers();
    modalProgress({ title: "下载", width: "420px" });
    const box = document.querySelector(".dlg-box") as HTMLElement;
    expect(box.style.width).toBe("420px");
    closeActiveDlg();
  });

  it("closable=false 进度弹窗 → Esc/点遮罩/back 均不关闭", () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载", closable: false });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    overlay.click();
    expect(closeActiveDialog()).toBe(false);
    expect(document.body.contains(overlay)).toBe(true);
    // 显式 close() 仍可关
    h.close();
    vi.advanceTimersByTime(120);
    expect(document.body.contains(overlay)).toBe(false);
  });

  it("close() 幂等：重复调用只关闭一次", () => {
    vi.useFakeTimers();
    const h = modalProgress({ title: "下载" });
    const overlay = document.querySelector(".dlg-overlay") as HTMLElement;
    h.close();
    h.close();
    vi.advanceTimersByTime(120);
    expect(document.body.contains(overlay)).toBe(false);
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
