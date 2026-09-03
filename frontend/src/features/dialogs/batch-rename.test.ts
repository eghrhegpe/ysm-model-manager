// ===== 批量重命名对话框测试 =====
// 覆盖：updateAll 对 banned 文件（foo.ysm.ban）扩展名/角色名/尾缀的处理、普通文件、应用载荷、
// 键盘交互（Esc/Enter）、解析模式批量应用、替换模式防抖/无效正则、预设、应用失败兜底
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";

const { closeDlgMock, registerDlgMock, trapFocusMock, activeCancelRef } = vi.hoisted(() => {
  // 模拟 modal.ts registerDlg 的真实单例语义：登记新弹窗前先结算旧弹窗的取消回调
  const activeCancelRef = { current: null as (() => void) | null };
  return {
    closeDlgMock: vi.fn((_o: unknown, resolve?: () => void) => resolve?.()),
    registerDlgMock: vi.fn((_overlay: HTMLElement, cancelClose: () => void) => {
      if (activeCancelRef.current) activeCancelRef.current();
      activeCancelRef.current = cancelClose;
    }),
    trapFocusMock: vi.fn(),
    activeCancelRef,
  };
});

vi.mock("./modal.ts", () => ({
  registerDlg: registerDlgMock,
  closeDlg: closeDlgMock,
  trapFocus: trapFocusMock,
  esc: (s: unknown): string => String(s),
}));

import { showBatchRenameDialog } from "./batch-rename.ts";
import type { BatchRenameChange } from "./batch-rename.ts";

async function open(entries: Array<{ Name: string; Path?: string }>) {
  const onApply = vi.fn().mockResolvedValue(undefined);
  const pending = showBatchRenameDialog("/dir", entries, onApply);
  await new Promise((r) => setTimeout(r, 0));
  const dlg = document.querySelector(".dlg-overlay")!;
  return { onApply, pending, dlg };
}

beforeEach(() => {
  document.body.innerHTML = "";
  closeDlgMock.mockClear();
  registerDlgMock.mockClear();
  activeCancelRef.current = null; // 重置单例槽位（防 isolate:false 跨文件残留）
});

afterEach(() => {
  // 防抖/替换用 fake timers 的用例把真实定时器恢复，防泄漏到下一用例
  vi.useRealTimers();
});

describe("showBatchRenameDialog — banned 文件处理", () => {
  it("foo2024.ysm.ban → 新名迁移 .disabled 尾缀且扩展名为 ysm（不误判为 .ban）", async () => {
    const { onApply, pending, dlg } = await open([
      { Name: "foo2024.ysm.ban", Path: "/dir/foo2024.ysm.ban" },
    ]);

    // 默认 updateAll 已生成新名（日期规范化 " (2024)"），预览应含 .ysm.disabled
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).toContain(".ysm.disabled");

    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await pending;

    expect(onApply).toHaveBeenCalledTimes(1);
    const changes = onApply.mock.calls[0][0] as BatchRenameChange[];
    expect(changes[0].oldName).toBe("foo2024.ysm.ban");
    expect(changes[0].newName).toMatch(/\.ysm\.disabled$/);
    // 扩展名是 ysm 而非 ban，角色名无 .ysm 残留
    expect(changes[0].newName).toContain("foo (2024).ysm.disabled");
  });

  it("普通文件 a2024.ysm → 新名以 .ysm 结尾，无 .ban", async () => {
    const { onApply, pending, dlg } = await open([{ Name: "a2024.ysm", Path: "/dir/a.ysm" }]);
    const btn = dlg.querySelector("#br-apply") as HTMLElement;
    btn.click();
    await pending;

    const changes = onApply.mock.calls[0][0] as BatchRenameChange[];
    expect(changes[0].newName).toMatch(/\.ysm$/);
    expect(changes[0].newName).not.toContain(".ban");
  });

  it("无变更（新名===原名）→ 提示不应用", async () => {
    // 已规范命名的文件 updateAll 后不变 → changed 空，只 toast 不调 onApply（弹窗不关闭）
    const { onApply, dlg } = await open([{ Name: "[A]【W】C.ysm", Path: "/dir/x.ysm" }]);

    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(onApply).not.toHaveBeenCalled();
  });

  it("重名冲突（两个文件规范化后同名）→ 拦截不调 onApply（P2 修复：防后端静默覆盖丢文件）", async () => {
    const { onApply, dlg } = await open([
      { Name: "foo2024.ysm", Path: "/dir/foo2024.ysm" },
      { Name: "foo2024.ysm", Path: "/dir/foo2024-copy.ysm" },
    ]);
    // 两个条目同名 → 规范化后 newName 相同 → apply 应被冲突检测拦截
    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("showBatchRenameDialog — 键盘交互（Esc/Enter）", () => {
  it("Escape 关闭弹窗并结算 pending（不调 onApply）", async () => {
    const { onApply, pending, dlg } = await open([{ Name: "a2024.ysm" }]);
    const before = closeDlgMock.mock.calls.length;
    dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await pending;
    expect(closeDlgMock.mock.calls.length).toBe(before + 1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it("Enter 在非按钮目标上触发应用（复用 apply 点击路径，含 busy/disabled 保护）", async () => {
    const { onApply, pending, dlg } = await open([{ Name: "a2024.ysm" }]);
    dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await pending;
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("Enter 焦点在按钮上或 IME 组合态时不触发应用", async () => {
    const { onApply, dlg } = await open([{ Name: "a2024.ysm" }]);
    const cancelBtn = dlg.querySelector("#br-cancel") as HTMLElement;
    // 焦点在按钮上：事件从按钮冒泡到 dialogEl，守卫应拦截（不抢先确认）
    cancelBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    // IME 组合态：isComposing=true，不提交
    dlg.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(onApply).not.toHaveBeenCalled();
    expect(closeDlgMock).not.toHaveBeenCalled();
  });
});

describe("showBatchRenameDialog — 解析模式批量应用", () => {
  it("作者输入防抖 200ms 后批量更新预览，取消勾选行不进入应用载荷", async () => {
    vi.useFakeTimers();
    const onApply = vi.fn().mockResolvedValue(undefined);
    const pending = showBatchRenameDialog(
      "/dir",
      [
        { Name: "foo2024.ysm", Path: "/dir/foo2024.ysm" },
        { Name: "bar2024.ysm", Path: "/dir/bar2024.ysm" },
      ],
      onApply,
    );
    const dlg = document.querySelector(".dlg-overlay") as HTMLElement;
    const author = dlg.querySelector("#br-batch-author") as HTMLInputElement;
    author.value = "张三";
    author.dispatchEvent(new Event("input"));
    // 防抖窗口内连续输入只触发一次
    author.value = "张三";
    author.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(200);

    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).toContain("张三");
    // checkbox 状态恢复（默认全选）
    const cb0 = preview.querySelector('[data-ci="0"]') as HTMLInputElement;
    expect(cb0.checked).toBe(true);

    // 取消勾选第一行 → 计数降为 1
    cb0.checked = false;
    cb0.dispatchEvent(new Event("change", { bubbles: true }));
    const cnt = document.getElementById("br-changed") as HTMLElement;
    expect(cnt?.textContent).toBe("1");

    // 再次触发 applyBatch（作者输入）→ renderPreview 重渲染未勾选行（plain 行、半透明）
    author.value = "李四";
    author.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(200);
    const plain = preview.querySelector('[data-ci="0"] ~ .br-name-plain') as HTMLElement;
    expect(plain).not.toBeNull();
    expect(plain.style.opacity).toBe("0.5");
    expect(cnt?.textContent).toBe("1");

    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await pending;
    const changes = onApply.mock.calls[0][0] as BatchRenameChange[];
    expect(changes).toHaveLength(1);
    expect(changes[0].oldName).toBe("bar2024.ysm");
    expect(changes[0].newName).toContain("李四");
  });

  it("切换模式：replace 显示替换区；切回 parse 清空作者/作品输入框", async () => {
    const { dlg } = await open([{ Name: "foo2024.ysm" }]);
    const mode = dlg.querySelector("#br-mode") as HTMLSelectElement;
    const parseEl = dlg.querySelector("#br-parse-mode") as HTMLElement;
    const replaceEl = dlg.querySelector("#br-replace-mode") as HTMLElement;
    const author = dlg.querySelector("#br-batch-author") as HTMLInputElement;
    author.value = "残留值";

    mode.value = "replace";
    mode.dispatchEvent(new Event("change"));
    expect(parseEl.style.display).toBe("none");
    expect(replaceEl.style.display).toBe("flex");

    // 切回解析模式：输入框显示值与内部解析状态一起清空
    mode.value = "parse";
    mode.dispatchEvent(new Event("change"));
    expect(parseEl.style.display).toBe("flex");
    expect(replaceEl.style.display).toBe("none");
    expect(author.value).toBe("");
  });
});

describe("showBatchRenameDialog — 替换模式", () => {
  const openReplace = (entries: Array<{ Name: string; Path?: string }>): HTMLElement => {
    showBatchRenameDialog("/dir", entries, vi.fn().mockResolvedValue(undefined));
    const dlg = document.querySelector(".dlg-overlay") as HTMLElement;
    const mode = dlg.querySelector("#br-mode") as HTMLSelectElement;
    mode.value = "replace";
    mode.dispatchEvent(new Event("change"));
    return dlg;
  };

  it("替换输入防抖：find 输入 200ms 后预览更新为替换结果", async () => {
    vi.useFakeTimers();
    const dlg = openReplace([{ Name: "foo2024.ysm" }]);
    const find = dlg.querySelector("#br-find") as HTMLInputElement;
    find.value = "2024";
    find.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(200);
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).toContain("foo.ysm");
    // 旧名仍在预览（changed 行显示 旧名 → 新名）
    expect(preview.innerHTML).toContain("foo2024.ysm");
    const cnt = document.getElementById("br-changed") as HTMLElement;
    expect(cnt?.textContent).toBe("1");
  });

  it("无效正则 → regexErr 标记 + warn toast（原名保留不破坏预览）", async () => {
    vi.useFakeTimers();
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    // 已规范命名的文件 updateAll 后 unchanged → 预览无箭头；无效正则应保持原名
    const dlg = openReplace([{ Name: "[A]【W】C.ysm" }]);
    const find = dlg.querySelector("#br-find") as HTMLInputElement;
    const regexCb = dlg.querySelector("#br-regex") as HTMLInputElement;
    regexCb.checked = true;
    find.value = "("; // 无效正则
    find.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(200);

    const cnt = document.getElementById("br-changed") as HTMLElement;
    expect(cnt?.dataset.regexErr).toBe("1");
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("正则表达式无效");
    // 保持原名 → 预览无箭头（无变更行）
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).not.toContain("→");
    unsubToast();
  });

  it("预设按钮展开/收起菜单（文案随状态切换）", async () => {
    const dlg = openReplace([{ Name: "foo2024.ysm" }]);
    const btn = dlg.querySelector("#br-presets") as HTMLElement;
    const menu = dlg.querySelector("#br-presets-menu") as HTMLElement;
    btn.click();
    expect(menu.style.display).toBe("flex");
    expect(btn.textContent).toContain("收起");
    btn.click();
    expect(menu.style.display).toBe("none");
    expect(btn.textContent).toContain("预设");
  });

  it("点击预设芯片 → 填充 find/replace/regex 并立即应用（无防抖）", async () => {
    vi.useFakeTimers();
    // 用括号转换预设（无反斜杠，happy-dom 解析属性值不剥字符）；【A】 → [A]
    const dlg = openReplace([{ Name: "【A】foo.ysm" }]);
    const preset = dlg.querySelectorAll(".br-preset")[2] as HTMLElement;
    preset.click();
    const find = dlg.querySelector("#br-find") as HTMLInputElement;
    expect(find.value).toBe("【(.+?)】");
    const regexCb = dlg.querySelector("#br-regex") as HTMLInputElement;
    expect(regexCb.checked).toBe(true);
    const menu = dlg.querySelector("#br-presets-menu") as HTMLElement;
    expect(menu.style.display).toBe("none");
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    expect(preview.innerHTML).toContain("[A]foo.ysm");
  });
});

describe("showBatchRenameDialog — 应用失败与单例收尾", () => {
  it("onApply 抛错 → 错误 toast + 按钮恢复可用 + 弹窗关闭（陷阱 #3 防按钮卡死）", async () => {
    const onApply = vi.fn().mockRejectedValue(new Error("boom"));
    const pending = showBatchRenameDialog("/dir", [{ Name: "a2024.ysm" }], onApply);
    const dlg = document.querySelector(".dlg-overlay") as HTMLElement;
    const toastSpy = vi.fn();
    const unsubToast = bus.on("toast:show", (p) => toastSpy(p.msg));
    const before = closeDlgMock.mock.calls.length;
    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await pending;
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("boom");
    const btn = dlg.querySelector("#br-apply") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("执行重命名");
    expect(closeDlgMock.mock.calls.length).toBe(before + 1);
    unsubToast();
  });

  it("重复打开：旧弹窗 pending 先被结算，旧 cancelClose 不误关新弹窗（身份捕获）", async () => {
    const onApplyA = vi.fn().mockResolvedValue(undefined);
    const pendingA = showBatchRenameDialog("/a", [{ Name: "a2024.ysm" }], onApplyA);
    const [, cancelA] = registerDlgMock.mock.calls[0] as unknown as [HTMLElement, () => void];

    // 打开第二个弹窗 → 首个弹窗被 close() 结算（旧 pending 不悬挂）
    const pendingB = showBatchRenameDialog(
      "/b",
      [{ Name: "b2024.ysm" }],
      vi.fn().mockResolvedValue(undefined),
    );
    await pendingA;
    expect(closeDlgMock).toHaveBeenCalledTimes(1);

    // 旧 cancelClose 在新弹窗期间被调用 → dialogEl 已是新元素，身份不符 → 不关闭
    cancelA();
    expect(closeDlgMock).toHaveBeenCalledTimes(1);

    // 新弹窗的 cancelClose 正常关闭自身
    const [, cancelB] = registerDlgMock.mock.calls[1] as unknown as [HTMLElement, () => void];
    cancelB();
    await pendingB;
    expect(closeDlgMock).toHaveBeenCalledTimes(2);
  });

  it("全选/取消全选联动所有行勾选与计数", async () => {
    const { dlg } = await open([
      { Name: "a2024.ysm", Path: "/a.ysm" },
      { Name: "b2024.ysm", Path: "/b.ysm" },
    ]);
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    const selectAll = preview.querySelector("#br-select-all") as HTMLInputElement;
    selectAll.checked = false;
    selectAll.dispatchEvent(new Event("change"));
    const cnt = document.getElementById("br-changed") as HTMLElement;
    expect(cnt?.textContent).toBe("0");
    preview.querySelectorAll(".br-file-cb").forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(false);
    });
    // 全选恢复
    selectAll.checked = true;
    selectAll.dispatchEvent(new Event("change"));
    expect(cnt?.textContent).toBe("2");
  });

  it("空条目列表：无预填、apply 无变更 → 只 toast 不调 onApply", async () => {
    const { onApply, dlg } = await open([]);
    const author = dlg.querySelector("#br-batch-author") as HTMLInputElement;
    expect(author.value).toBe("");
    (dlg.querySelector("#br-apply") as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("checkbox data-ci 缺失/越界 → 忽略不崩（事件委托守卫）", async () => {
    const { dlg } = await open([{ Name: "a2024.ysm" }]);
    const preview = dlg.querySelector("#br-preview") as HTMLElement;
    // 缺 data-ci 的 br-file-cb（NaN idx）与越界 idx 均被忽略
    const badCb = document.createElement("input");
    badCb.type = "checkbox";
    badCb.className = "br-file-cb";
    preview.appendChild(badCb);
    badCb.dispatchEvent(new Event("change", { bubbles: true }));
    const outOfRange = document.createElement("input");
    outOfRange.type = "checkbox";
    outOfRange.className = "br-file-cb";
    outOfRange.dataset.ci = "99";
    preview.appendChild(outOfRange);
    outOfRange.dispatchEvent(new Event("change", { bubbles: true }));
    // 计数仍为 1（唯一条目的变更未被误触）
    const cnt = document.getElementById("br-changed") as HTMLElement;
    expect(cnt?.textContent).toBe("1");
  });
});
