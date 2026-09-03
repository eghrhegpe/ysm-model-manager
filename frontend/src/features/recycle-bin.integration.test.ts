// ===== initRecycleBin 集成测试 =====
// 覆盖：加载渲染、路径过滤、恢复/删除/清空、类型切换、事件委托、清理函数、异常路径
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../bus.ts";

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

vi.mock("../services/resource-registry.ts", () => ({
  loadResourceRegistry: mocks.loadResourceRegistry,
}));

vi.mock("../utils/resource/types.ts", () => ({
  RESOURCE_TYPES: { YSM: "ysm", PACK: "resourcepack" },
}));

vi.mock("../backend/app.ts", () => ({
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
  host = { _root: root };
  mocks.GetRepoRoot.mockResolvedValue("/mc");
  mocks.ListRecycleBin.mockResolvedValue([]);
  mocks.loadResourceRegistry.mockResolvedValue({ ysm: { icon: "💎" } });
  // 默认成功值，防单个用例 mockRejectedValue/mockResolvedValueOnce 残留给后续用例
  mocks.RestoreFromRecycle.mockResolvedValue(undefined);
  mocks.DeleteFromRecycle.mockResolvedValue(undefined);
  mocks.EmptyRecycleBin.mockResolvedValue(0);
  mocks.modalConfirm.mockResolvedValue(true);
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

  it("委托 Go 按 root 过滤 → 渲染 Go 返回的全部条目，前端不再 re-filter", async () => {
    // 当前 root = /mc（由 GetRepoRoot mock 决定）；作用域过滤已移交 Go 端 ListRecycleBin(recyclePath)
    mocks.ListRecycleBin.mockResolvedValue([
      entry("a.ysm", "/mc/a.ysm"),
      entry("b.ysm", "/mc/sub/b.ysm"),
    ]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    // 前端只把 root 透传给 Go，不再做路径前缀过滤——Go 返回几条就渲染几条
    expect(mocks.ListRecycleBin).toHaveBeenCalledWith("/mc");
    expect(root.querySelectorAll('[data-testid="recy-item"]')).toHaveLength(2);
    expect(root.getElementById("recy-count")!.textContent).toContain("2 个文件");
    expect(mocks.renderDisplayName).toHaveBeenCalled();
  });

  it("读取失败 → 错误渲染 + count 加载失败", async () => {
    mocks.ListRecycleBin.mockRejectedValue(new Error("io err"));
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(mocks.friendlyError).toHaveBeenCalled();
    expect(root.getElementById("recy-count")!.textContent).toBe("加载失败");
  });

  it("空 Path 条目被过滤（不渲染空 data-path 幽灵项）", async () => {
    mocks.ListRecycleBin.mockResolvedValue([
      entry("ok.ysm", "/mc/ok.ysm"),
      { Name: "ghost.ysm", Path: "", Size: 100 },
    ]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(root.querySelectorAll('[data-testid="recy-item"]')).toHaveLength(1);
    expect(root.querySelector('[data-path=""]')).toBeNull();
  });

  it("Size 非有限值 → 显示 ?", async () => {
    mocks.ListRecycleBin.mockResolvedValue([
      { Name: "a.ysm", Path: "/mc/a.ysm", Size: Number.NaN },
    ]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(root.querySelector('[data-testid="recy-item"]')!.textContent).toContain("?");
  });

  it("渲染剥离 .ban 后缀后再走 renderDisplayName", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm.ban", "/mc/a.ysm")]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(mocks.renderDisplayName).toHaveBeenCalledWith("a.ysm");
    expect(root.querySelector('[data-testid="recy-item"]')!.textContent).toContain("a.ysm");
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

    root.querySelector<HTMLButtonElement>('[data-testid="recy-restore"]')!.click();
    await flushLong();
    await flush();
    await flush();

    expect(mocks.RestoreFromRecycle).toHaveBeenCalledWith("/mc/a.ysm", "");
    expect(toasts.some((t) => t.type === "success" && t.msg.length > 0)).toBe(true);
    expect(stats).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it("恢复失败 → error toast + 按钮复位 + leaving 类移除", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    mocks.RestoreFromRecycle.mockRejectedValue(new Error("locked"));
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const btn = root.querySelector<HTMLButtonElement>('[data-testid="recy-restore"]')!;
    btn.click();
    await flushLong();
    await flush();

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("locked"))).toBe(true);
    // 错误路径必须复位：按钮重新可用 + 移除 leaving 动画类，否则条目永久卡在禁用/滑出态
    expect(btn.disabled).toBe(false);
    expect(btn.closest(".recy-item")!.classList.contains("leaving")).toBe(false);
  });

  it("删除失败 → error toast + 按钮复位（误删防护错误路径）", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    mocks.DeleteFromRecycle.mockRejectedValue(new Error("权限不足"));
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const btn = root.querySelector<HTMLButtonElement>('[data-testid="recy-del"]')!;
    btn.click();
    await flushLong();
    await flush();

    expect(mocks.DeleteFromRecycle).toHaveBeenCalledWith("/mc/a.ysm");
    expect(toasts.some((t) => t.type === "error" && t.msg.includes("权限不足"))).toBe(true);
    expect(btn.disabled).toBe(false);
    expect(btn.closest(".recy-item")!.classList.contains("leaving")).toBe(false);
  });

  it("恢复按钮 leaving 期间重复点击 → RestoreFromRecycle 只调用一次（busy 守卫）", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    let resolveRestore!: () => void;
    const slowRestore = new Promise<void>((r) => {
      resolveRestore = r;
    });
    mocks.RestoreFromRecycle.mockReturnValueOnce(slowRestore);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const btn = root.querySelector<HTMLButtonElement>('[data-testid="recy-restore"]')!;
    btn.click();
    btn.click(); // 第二次点击应立即被 btn.disabled 守卫拦下
    await flushLong(); // 150ms leaving 结束后 binding 挂起在 slowRestore
    expect(mocks.RestoreFromRecycle).toHaveBeenCalledTimes(1);

    resolveRestore();
    await flush();
    await flush();
  });

  it("清空在途重复点击 → EmptyRecycleBin 只调用一次（_emptyBusy 守卫）", async () => {
    let resolveEmpty!: (v: number) => void;
    const slowEmpty = new Promise<number>((r) => {
      resolveEmpty = r;
    });
    mocks.EmptyRecycleBin.mockReturnValueOnce(slowEmpty);
    mocks.modalConfirm.mockResolvedValue(true);

    root.getElementById("recy-empty")!.click();
    await flush(); // 确认通过 → _emptyBusy=true，EmptyRecycleBin 挂起
    root.getElementById("recy-empty")!.click(); // 第二次点击 → 守卫直接返回
    await flush();
    expect(mocks.EmptyRecycleBin).toHaveBeenCalledTimes(1);

    resolveEmpty(2);
    await flush();
    await flush();
  });

  it("删除按钮（确认）→ DeleteFromRecycle + toast；取消 → 不删除", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    const toasts = spyToasts();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    // 取消
    mocks.modalConfirm.mockResolvedValueOnce(false);
    root.querySelector<HTMLButtonElement>('[data-testid="recy-del"]')!.click();
    await flush();
    expect(mocks.DeleteFromRecycle).not.toHaveBeenCalled();

    // 确认
    mocks.modalConfirm.mockResolvedValueOnce(true);
    root.querySelector<HTMLButtonElement>('[data-testid="recy-del"]')!.click();
    await flushLong();
    await flush();
    await flush();
    expect(mocks.DeleteFromRecycle).toHaveBeenCalledWith("/mc/a.ysm");
    expect(toasts.some((t) => t.type === "success" && t.msg.length > 0)).toBe(true);
  });

  it("清空按钮（确认）→ EmptyRecycleBin + 联动刷新", async () => {
    mocks.EmptyRecycleBin.mockResolvedValue(3);
    mocks.modalConfirm.mockResolvedValue(true);
    const toasts = spyToasts();
    const stats = vi.fn();
    const reload = vi.fn();
    cleanups.push(bus.on("stats:refresh", stats), bus.on("tree:reload", reload));
    root.getElementById("recy-empty")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    expect(mocks.EmptyRecycleBin).toHaveBeenCalledWith("");
    expect(stats).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(toasts.some((t) => t.type === "success" && t.msg.length > 0)).toBe(true);
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

  it("点击恢复/删除按钮 → 不触发 model:select（事件委托跳过操作区）", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();

    const sel = vi.fn();
    cleanups.push(bus.on("model:select", sel));

    root.querySelector<HTMLButtonElement>('[data-testid="recy-restore"]')!.click();
    root.querySelector<HTMLButtonElement>('[data-testid="recy-del"]')!.click();
    await flushLong();
    await flush();
    expect(sel).not.toHaveBeenCalled();
  });

  it("清理函数清空列表并移除 empty 监听（条目按钮 handler 随之失效）", async () => {
    mocks.ListRecycleBin.mockResolvedValue([entry("a.ysm", "/mc/a.ysm")]);
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click"));
    await flush();
    await flush();
    expect(root.querySelectorAll('[data-testid="recy-item"]')).toHaveLength(1);

    cleanup();
    expect(root.querySelectorAll('[data-testid="recy-item"]')).toHaveLength(0);

    root.getElementById("recy-empty")!.click();
    await flush();
    expect(mocks.EmptyRecycleBin).not.toHaveBeenCalled();
  });

  it("并发加载：旧请求的迟到结果被丢弃（generation 守卫）", async () => {
    let resolveSlow!: (v: unknown[]) => void;
    const slowList = new Promise<unknown[]>((r) => {
      resolveSlow = r;
    });
    mocks.GetRepoRoot.mockResolvedValue("/mc");
    mocks.ListRecycleBin.mockReturnValueOnce(slowList); // 请求 A：挂起
    mocks.ListRecycleBin.mockResolvedValueOnce([entry("fresh.ysm", "/mc/fresh.ysm")]); // 请求 B

    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click")); // A 开始
    await flush();
    root.getElementById("recy-refresh")!.dispatchEvent(new Event("click")); // B 开始
    await flush();
    await flush();

    const list = root.getElementById("recy-list")!;
    expect(list.innerHTML).toContain("fresh.ysm");

    resolveSlow([entry("stale.ysm", "/mc/stale.ysm")]); // A 迟到 → 应被 gen 比对丢弃
    await flush();
    expect(list.innerHTML).toContain("fresh.ysm");
    expect(list.innerHTML).not.toContain("stale.ysm");
  });
});
