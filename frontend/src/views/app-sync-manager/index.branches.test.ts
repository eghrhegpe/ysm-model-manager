// ===== <app-sync-manager> index.ts 生命周期分支补测 =====
// 兄弟文件 index.test.ts 覆盖渲染/交互主链路（renderer 真实）；本文件把 render
// mock 成可控（resolve / reject / 同步 throw），锁 index 的守卫与失败分支：
// attributeChangedCallback 重载、gen 代际守卫、loadRepoRoots 兜底、stats:refresh /
// repo:rtype-changed / repo:subdir-changed 三订阅的重载失败 .catch、_doRender .catch。
// 注意：store.load* 与 loadRepoRoots 内部吞错永不 reject，各 .catch 仅由
// _doRender 内 render 同步抛错触发——这是刻意的 mock 契约，不是绕过。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { waitFor, sleep, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";
import "./index.ts"; // 触发 customElements.define("app-sync-manager")

const { mocks, renderMock } = vi.hoisted(() => ({
  mocks: {
    LoadResourceTypes: vi.fn().mockResolvedValue(
      JSON.stringify({ resourceTypes: [{ id: "ysm", name: "YSM", icon: "💎" }] }),
    ),
    GetInstanceSyncStatus: vi.fn().mockResolvedValue(
      JSON.stringify([{ path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1 }]),
    ),
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
    GetSyncScanDirs: vi.fn().mockResolvedValue(
      JSON.stringify({ global: "/repo", instance: "/mc/x", warningCode: "" }),
    ),
  },
  renderMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadResourceTypes: mocks.LoadResourceTypes,
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    GetRepoRoot: mocks.GetRepoRoot,
    GetSyncScanDirs: mocks.GetSyncScanDirs,
  }),
}));
vi.mock("./renderer.ts", () => ({ render: renderMock }));

type SelfView = {
  _instance: string;
  _defaultType: string;
  _selectedType: string;
  _subtype: string;
  _filesRoots: Record<string, string>;
  _gen: number;
};

function mount(instance = "test"): { el: HTMLElement; self: SelfView } {
  const el = document.createElement("app-sync-manager");
  el.setAttribute("instance", instance);
  document.body.appendChild(el);
  return { el, self: el as unknown as SelfView };
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem("ysm_syncLastType");
  renderMock.mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("app-sync-manager — attributeChangedCallback 与代际守卫", () => {
  it("同值变更 no-op；instance 变更 → 重载；default-type 变更 → 更新字段", async () => {
    const { el, self } = mount();
    await waitFor(() => renderMock.mock.calls.length > 0, 5000);
    const calls0 = mocks.GetInstanceSyncStatus.mock.calls.length;

    el.setAttribute("instance", "test"); // 同值 → oldVal === newVal → no-op
    await sleep(100);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(calls0);

    el.setAttribute("instance", "other"); // 变更 → _init 重载
    await waitFor(() => self._instance === "other", 5000);
    await waitFor(
      () => mocks.GetInstanceSyncStatus.mock.calls.length === calls0 + 1,
      5000,
    );
    expect(self._gen).toBe(2); // 每次进入 _init 代际 +1

    el.setAttribute("default-type", "vrm");
    await sleep(50);
    expect(self._defaultType).toBe("vrm");
    unmountElement(el);
  });

  it("首次 _init 在途时 instance 变更 → 旧代际完成被 gen 守卫丢弃（只渲染一次）", async () => {
    // 第一次 loadData 挂起，制造在途窗口
    let resolveFirst: (v: string) => void = () => {};
    mocks.GetInstanceSyncStatus.mockImplementationOnce(
      () => new Promise<string>((r) => (resolveFirst = r)),
    );
    const { el } = mount();
    // 挂起期间换 instance → 第二次 _init（gen=2）
    el.setAttribute("instance", "other");
    await waitFor(() => mocks.GetInstanceSyncStatus.mock.calls.length >= 2, 5000);
    renderMock.mockClear();
    resolveFirst(JSON.stringify([])); // 旧代际完成 → gen 守卫丢弃
    await sleep(200);
    // gen=1 的收尾不得渲染；gen=2 正常渲染一次
    expect(renderMock).toHaveBeenCalledTimes(1);
    unmountElement(el);
  });
});

describe("app-sync-manager — 失败分支（loadRepoRoots 兜底 / render 抛错链）", () => {
  it("GetRepoRoot 拒绝 → _filesRoots[rtype] 兜底空串（不炸初始化）", async () => {
    mocks.GetRepoRoot.mockRejectedValueOnce(new Error("root down"));
    const { el, self } = mount();
    await waitFor(() => "ysm" in self._filesRoots, 5000);
    expect(self._filesRoots["ysm"]).toBe("");
    unmountElement(el);
  });

  it("render 同步抛错 → _init catch：错误块 + error toast（145-151）", async () => {
    renderMock.mockImplementation(() => {
      throw new Error("sync render boom");
    });
    const toasts: Array<{ msg: string; type?: string }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p as { msg: string; type?: string }));
    const { el } = mount();
    await sleep(200);
    expect(el.innerHTML).toContain("sync render boom");
    const err = toasts.find((t) => t.type === "error");
    expect(err?.msg).toContain("sync render boom");
    off();
    unmountElement(el);
  });

  it("stats:refresh 重载链 render 同步抛错 → console.warn（166）", async () => {
    const { el } = mount();
    await waitFor(() => renderMock.mock.calls.length > 0, 5000);
    await sleep(300); // 等挂载链完全落定，避免残留异步触发 Once
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMock.mockImplementationOnce(() => {
      throw new Error("refresh boom");
    });
    bus.emit("stats:refresh");
    await sleep(200);
    expect(warn).toHaveBeenCalledWith(
      "[sync-manager] stats:refresh 重载失败:",
      expect.any(Error),
    );
    warn.mockRestore();
    unmountElement(el);
  });

  it("repo:rtype-changed：同值早退（176）；重载失败 warn（191）", async () => {
    const { el, self } = mount();
    await waitFor(() => renderMock.mock.calls.length > 0, 5000);
    await sleep(300); // 等挂载链完全落定再取基线
    const calls0 = mocks.GetInstanceSyncStatus.mock.calls.length;

    bus.emit("repo:rtype-changed", self._selectedType); // 同值 → 早退
    await sleep(150);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(calls0);

    // 异值 → 重载，render 同步抛错 → .catch warn
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMock.mockImplementationOnce(() => {
      throw new Error("rtype boom");
    });
    bus.emit("repo:rtype-changed", "shaderpack");
    await sleep(200);
    expect(warn).toHaveBeenCalledWith(
      "[sync-manager] rtype 跟随重载失败:",
      expect.any(Error),
    );
    warn.mockRestore();
    // 恢复全局类型，防模块级 _lastSelectedType 泄漏
    bus.emit("repo:rtype-changed", "ysm");
    await sleep(100);
    unmountElement(el);
  });

  it("repo:subdir-changed：同值早退（200）→ 异值重载渲染 → 失败 warn（209）", async () => {
    const { el, self } = mount();
    await waitFor(() => renderMock.mock.calls.length > 0, 5000);
    await sleep(300); // 等挂载链完全落定再取基线
    const calls0 = mocks.GetInstanceSyncStatus.mock.calls.length;

    bus.emit("repo:subdir-changed", ""); // 与初始 _subtype 同值 → 早退
    await sleep(150);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(calls0);

    bus.emit("repo:subdir-changed", "subA"); // 异值 → 重载 + 渲染
    await waitFor(() => self._subtype === "subA", 5000);
    await waitFor(
      () => mocks.GetInstanceSyncStatus.mock.calls.length === calls0 + 1,
      5000,
    );
    const renderCount = renderMock.mock.calls.length;
    expect(renderCount).toBeGreaterThanOrEqual(2);

    // 再次异值 + render 同步抛错 → .catch warn
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderMock.mockImplementationOnce(() => {
      throw new Error("subdir boom");
    });
    bus.emit("repo:subdir-changed", "subB");
    await sleep(200);
    expect(warn).toHaveBeenCalledWith(
      "[sync-manager] subdir 重载失败:",
      expect.any(Error),
    );
    warn.mockRestore();
    unmountElement(el);
  });

  it("render promise reject → _doRender .catch console.error（234）", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { el } = mount();
    await waitFor(() => renderMock.mock.calls.length > 0, 5000);
    err.mockClear();
    renderMock.mockRejectedValueOnce(new Error("render boom"));
    bus.emit("stats:refresh"); // 复用 _doRender 入口
    await sleep(200);
    expect(err).toHaveBeenCalledWith("[sync-manager] render 失败:", expect.any(Error));
    err.mockRestore();
    unmountElement(el);
  });
});
