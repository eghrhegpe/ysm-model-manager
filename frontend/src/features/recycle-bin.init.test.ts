// ===== initRecycleBin 集成测试 =====
// 覆盖：加载渲染、路径过滤、恢复/删除/清空、类型切换、事件委托、清理函数、异常路径
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";
import { isPathInRoot } from "./recycle-bin.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    modalConfirm: vi.fn(),
    renderDisplayName: vi.fn((s: string) => s),
    friendlyError: vi.fn((e: unknown, fallback: string) =>
      e instanceof Error ? e.message : fallback,
    ),
    loadResourceRegistry: vi.fn(),
    GetRepoRoot: vi.fn(),
    ListRecycleBin: vi.fn(),
    RestoreFromRecycle: vi.fn(),
    DeleteFromRecycle: vi.fn(),
    EmptyRecycleBin: vi.fn(),
  };
  return { mocks };
});

vi.mock("../utils/dom/dialogs/modal.ts", () => ({
  modalConfirm: mocks.modalConfirm,
}));

vi.mock("../utils/dom/display.ts", () => ({
  renderDisplayName: mocks.renderDisplayName,
}));

vi.mock("../utils/dom/errors.ts", () => ({
  friendlyError: mocks.friendlyError,
}));

vi.mock("../utils/resource/registry.ts", () => ({
  loadResourceRegistry: mocks.loadResourceRegistry,
}));

vi.mock("../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { YSM: "ysm", PACK: "resourcepack" },
}));

vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: mocks.GetRepoRoot,
    ListRecycleBin: mocks.ListRecycleBin,
    RestoreFromRecycle: mocks.RestoreFromRecycle,
    DeleteFromRecycle: mocks.DeleteFromRecycle,
    EmptyRecycleBin: mocks.EmptyRecycleBin,
  }),
}));

import { initRecycleBin, type RecycleHost } from "./recycle-bin.ts";

function entry(name: string, path: string, size = 100) {
  return { Name: name, Path: path, Size: size };
}

let host: RecycleHost;
let root: ShadowRoot;
let cleanup: () => void;
let cleanups: Array<() => void> = [];

beforeEach(async () => {
  vi.clearAllMocks();
  cleanups = [];
  localStorage.clear();
  localStorage.setItem("repo_rtype", "ysm");
  root = document.createElement("div").attachShadow({ mode: "open" });
  root.innerHTML = `
    <span id="recy-count">加载中...</span>
    <button id="recy-refresh">🔄 刷新</button>
    <button id="recy-empty">♻️ 清空回收站</button>
    <div id="recy-list"></div>`;
  host = {
    _root: root,
    _esc: (s) => s,
    _fmtSize: (n) => `${n}B`,
  };
  mocks.GetRepoRoot.mockResolvedValue("/mc");
  mocks.ListRecycleBin.mockResolvedValue([]);
  mocks.loadResourceRegistry.mockResolvedValue({ ysm: { icon: "💎" } });
  cleanup = initRecycleBin(host);
  await flush();
});

afterEach(() => {
  cleanup?.();
  cleanups.splice(0).forEach((fn) => fn());
});

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** 按钮执行有 150ms leaving 动画延迟，需长等待 */
function flushLong(): Promise<void> {
  return new Promise((r) => setTimeout(r, 220));
}

function spyToasts() {
  const toasts: Array<{ msg: string; type: string }> = [];
  cleanups.push(bus.on("toast:show", (t) => toasts.push(t as { msg: string; type: string })));
  return toasts;
}

describe("loadRecycleBin 渲染", () => {
  it("空列表 → 列表清空 + count 显示空", () => {
    const list = root.getElementById("recy-list")!;
    expect(list.innerHTML).toBe("");
    expect(root.getElementById("recy-count")!.textContent).toBe("空");
  });

  it("有条目 → 渲染 item + 计数，按 root 过滤", async () => {
    mocks.ListRecycleBin.mockResolvedValue([
      entry("a.ysm", "/mc/a.ysm"),
      entry("b.ysm", "/other/b.ysm"), // 不在当前 root 下 → 过滤
    ]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(root.querySelectorAll(".recy-item")).toHaveLength(1);
    expect(root.getElementById("recy-count")!.textContent).toContain("💎 1 个文件");
    expect(mocks.renderDisplayName).toHaveBeenCalled();
  });

  it("读取失败 → 错误渲染 + count 加载失败", async () => {
    mocks.ListRecycleBin.mockRejectedValue(new Error("io err"));
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const list = root.getElementById("recy-list")!;
    expect(list.innerHTML).toContain("io err");
    expect(root.getElementById("recy-count")!.textContent).toBe("加载失败");
  });
});

describe("恢复 / 删除 / 清空", () => {
  it("恢复按钮 → RestoreFromRecycle + success toast + 刷新联动", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    mocks.RestoreFromRecycle.mockResolvedValue(undefined);
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const stats = vi.fn();
    const reload = vi.fn();
    cleanups.push(bus.on("stats:refresh", stats), bus.on("tree:reload", reload));

    root.querySelector<HTMLButtonElement>(".recy-restore")!.click();
    await flushLong();
    await flush();
    await flush();

    expect(mocks.RestoreFromRecycle).toHaveBeenCalledWith("/mc/a.ysm", "");
    expect(toasts.some((t) => t.msg === "✅ 已恢复")).toBe(true);
    expect(stats).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("恢复失败 → error toast", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    mocks.RestoreFromRecycle.mockRejectedValue(new Error("locked"));
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    root.querySelector<HTMLButtonElement>(".recy-restore")!.click();
    await flushLong();
    await flush();

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("locked"))).toBe(true);
  });

  it("删除按钮（确认）→ DeleteFromRecycle + toast；取消 → 不删除", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    // 取消
    mocks.modalConfirm.mockResolvedValueOnce(false);
    root.querySelector<HTMLButtonElement>(".recy-del")!.click();
    await flush();
    expect(mocks.DeleteFromRecycle).not.toHaveBeenCalled();

    // 确认
    mocks.modalConfirm.mockResolvedValueOnce(true);
    root.querySelector<HTMLButtonElement>(".recy-del")!.click();
    await flushLong();
    await flush();
    await flush();
    expect(mocks.DeleteFromRecycle).toHaveBeenCalledWith("/mc/a.ysm");
    expect(toasts.some((t) => t.msg === "✅ 已删除")).toBe(true);
  });

  it("清空按钮（确认）→ EmptyRecycleBin + 联动刷新", async () => {
    mocks.EmptyRecycleBin.mockResolvedValue(3);
    mocks.modalConfirm.mockResolvedValue(true);
    const toasts = spyToasts();
    root.getElementById("recy-empty")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(mocks.EmptyRecycleBin).toHaveBeenCalledWith("");
    expect(toasts.some((t) => t.msg === "♻️ 已清空 3 个文件")).toBe(true);
  });

  it("清空取消 → 不调用 EmptyRecycleBin", async () => {
    mocks.modalConfirm.mockResolvedValue(false);
    root.getElementById("recy-empty")!.dispatchEvent(new Event("click"));
    await flush();
    expect(mocks.EmptyRecycleBin).not.toHaveBeenCalled();
  });

  it("清空失败 → error toast", async () => {
    mocks.EmptyRecycleBin.mockRejectedValue(new Error("权限不足"));
    mocks.modalConfirm.mockResolvedValue(true);
    const toasts = spyToasts();
    root.getElementById("recy-empty")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("权限不足"))).toBe(true);
  });
});

describe("类型切换 / 事件委托 / 清理", () => {
  it("repo:rtype-changed 触发重新加载", async () => {
    const spy = vi.fn();
    cleanups.push(bus.on("tree:reload", spy));
    bus.emit("repo:rtype-changed", "resourcepack");
    await flush();
    await flush();
    expect(mocks.GetRepoRoot).toHaveBeenCalledWith("resourcepack");
  });

  it("同名类型不重复加载", async () => {
    const before = mocks.GetRepoRoot.mock.calls.length;
    bus.emit("repo:rtype-changed", "ysm");
    await flush();
    expect(mocks.GetRepoRoot.mock.calls.length).toBe(before);
  });

  it("文件名点击（事件委托）→ model:select", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const sel = vi.fn();
    cleanups.push(bus.on("model:select", sel));
    root.querySelector<HTMLElement>('[data-path="/mc/a.ysm"]')!.click();
    await flush();
    expect(sel).toHaveBeenCalledWith({ path: "/mc/a.ysm" });
  });

  it("清理函数移除刷新监听", async () => {
    const before = mocks.GetRepoRoot.mock.calls.length;
    cleanup();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    expect(mocks.GetRepoRoot.mock.calls.length).toBe(before);
  });
});

describe("isPathInRoot（与实现一致性回归）", () => {
  it("边界语义不变", () => {
    expect(isPathInRoot("/mc/a.ysm", "/mc")).toBe(true);
    expect(isPathInRoot("/mc2/a.ysm", "/mc")).toBe(false);
  });
});
