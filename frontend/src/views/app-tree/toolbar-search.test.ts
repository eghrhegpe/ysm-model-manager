// ===== toolbar-search.ts 补盲测试 =====
// 兄弟文件 toolbar-events.test.ts 已覆盖 openAdvFilterDialog 桌面主链路；本文件锁
// 网页版分支：统计角标（showStatsBadge/hideStatsBadge/onStatsProgress 接线）、
// Worker 降级提示（consumeWebSearchDegraded + 3s 自动隐藏）、全空筛选早退
// （advFilterEarlyEmpty）、网页版「导入文件」（pickWebFilesAndImport 的 change 链路）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAdvFilterDialog, pickWebFilesAndImport } from "./toolbar-search.ts";
import { getExts } from "../../utils/resource/extensions.ts";

const {
  emitMock,
  getAppMock,
  modalAdvFilterMock,
  isWebPlatformMock,
  importWebFilesMock,
  consumeWebSearchDegradedMock,
  onStatsProgressMock,
  getStatsPoolSizeMock,
} = vi.hoisted(() => ({
  emitMock: vi.fn(),
  getAppMock: vi.fn(),
  modalAdvFilterMock: vi.fn(),
  isWebPlatformMock: vi.fn(() => false),
  importWebFilesMock: vi.fn(),
  consumeWebSearchDegradedMock: vi.fn(() => false),
  onStatsProgressMock: vi.fn(),
  getStatsPoolSizeMock: vi.fn(() => 2),
}));

vi.mock("../../bus.ts", () => ({ bus: { emit: emitMock, on: vi.fn() } }));
vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/dom/dialogs/adv-filter.ts", () => ({
  modalAdvFilter: modalAdvFilterMock,
}));
// browser-adapter：toolbar-search 消费的 4 函数 + 真平台模块引用空垫
vi.mock("../../backend/browser-adapter.ts", () => ({
  importWebFiles: importWebFilesMock,
  consumeWebSearchDegraded: consumeWebSearchDegradedMock,
  onStatsProgress: onStatsProgressMock,
  getStatsPoolSize: getStatsPoolSizeMock,
  browserAdapter: {},
}));
// isWebPlatform 换可控开关（其余导出保持真实）
vi.mock("../../backend/platform-web.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../backend/platform-web.ts")>();
  return { ...actual, isWebPlatform: isWebPlatformMock };
});

/** 构造工具栏 DOM（srch + 数值条件 inline 面板输入）与 vm 桩 */
function setupDom(filesRoot = "/repo") {
  const host = document.createElement("div");
  host.innerHTML = `
    <input id="srch" value="狐" />
    <input id="af-minBones" /><input id="af-maxBones" />
    <input id="af-minCubes" /><input id="af-maxCubes" />
    <input id="af-minTex" /><input id="af-maxTex" />
  `;
  document.body.appendChild(host);
  const $ = (id: string): HTMLElement | null => host.querySelector(`#${id}`);
  const vm = {
    _filesRoot: filesRoot,
    _search: "",
    _filterPaths: null as Set<string> | null,
    _renderTree: vi.fn(),
  };
  return { $, vm: vm as unknown as Parameters<typeof openAdvFilterDialog>[1], host };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
  isWebPlatformMock.mockReturnValue(false);
  consumeWebSearchDegradedMock.mockReturnValue(false);
  getAppMock.mockResolvedValue({
    SearchModels: vi.fn(async (_root: string, _kw: string) => [
      { path: "/repo/a.ysm" },
      { path: "/repo/b.ysm" },
    ]),
    ListByTag: vi.fn(async () => ["/repo/a.ysm"]),
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("openAdvFilterDialog — 全空筛选早退（advFilterEarlyEmpty）", () => {
  it("弹窗取消（null）→ 无后续动作", async () => {
    const { $, vm } = setupDom();
    modalAdvFilterMock.mockResolvedValue(null);
    await openAdvFilterDialog($, vm);
    expect(vm._renderTree).not.toHaveBeenCalled();
    expect(vm._filterPaths).toBeNull();
  });

  it("条件全空 → _filterPaths 置 null + 重渲染（清除筛选）", async () => {
    const { $, vm } = setupDom();
    modalAdvFilterMock.mockResolvedValue({ keyword: "", tag: "" });
    await openAdvFilterDialog($, vm);
    expect(vm._filterPaths).toBeNull();
    expect(vm._renderTree).toHaveBeenCalledTimes(1);
    expect(emitMock).not.toHaveBeenCalledWith("toast:show", expect.anything());
  });
});

/** 模块级角标是单例：beforeEach 清空 body 后节点游离，重新挂回才能 getElementById */
let badgeEl: HTMLElement | null = null;

describe("openAdvFilterDialog — 网页版统计角标 + Worker 降级提示", () => {
  it("web + 数值条件 → 角标创建、进度回调接线、完成后隐藏", async () => {
    const { $, vm } = setupDom();
    isWebPlatformMock.mockReturnValue(true);
    // 注册回调全部收集（finally 会再注册 null 注销，不能只留最后一次）
    const progressCbs: Array<((done: number, total: number) => void) | null> = [];
    onStatsProgressMock.mockImplementation((cb: (typeof progressCbs)[number]) => {
      progressCbs.push(cb);
    });
    // SearchModels 用 deferred：让进度回调能在统计进行中（finally 隐藏前）触发
    let resolveSearch: (v: Array<{ path: string }>) => void = () => {};
    getAppMock.mockResolvedValue({
      SearchModels: () =>
        new Promise<Array<{ path: string }>>((r) => {
          resolveSearch = r;
        }),
    });
    modalAdvFilterMock.mockResolvedValue({ keyword: "", minBones: "2" });
    const pending = openAdvFilterDialog($, vm);
    await vi.waitFor(() => expect(progressCbs.length).toBeGreaterThan(0));
    const badge = document.getElementById("web-stats-badge")!;
    badgeEl = badge;
    expect(badge.innerHTML).toContain("🧵×2");
    // 统计进行中触发进度 → 角标刷新为 done/total
    progressCbs[0]!(3, 9);
    expect(badge.innerHTML).toContain("3/9");
    // 完成统计 → finally 注销回调 + 隐藏角标
    resolveSearch([{ path: "/repo/a.ysm" }, { path: "/repo/b.ysm" }]);
    await pending;
    expect(progressCbs[progressCbs.length - 1]).toBeNull();
    expect(badge.style.display).toBe("none");
    // 交集结果：SearchModels 2 条命中 → toast 找到 2 个
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("2 个匹配") }),
    );
  });

  it("web + 数值条件 + Worker 降级 → ⚠️ toast + 角标提示 + 3s 自动隐藏", async () => {
    vi.useFakeTimers();
    const { $, vm } = setupDom();
    if (badgeEl) document.body.appendChild(badgeEl); // 重挂游离的模块级角标
    isWebPlatformMock.mockReturnValue(true);
    consumeWebSearchDegradedMock.mockReturnValue(true);
    onStatsProgressMock.mockImplementation(() => {});
    modalAdvFilterMock.mockResolvedValue({ keyword: "", minBones: "2" });
    const pending = openAdvFilterDialog($, vm);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    const badge = document.getElementById("web-stats-badge")!;
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("统计引擎不可用") }),
    );
    expect(badge.innerHTML).toContain("Worker 降级");
    expect(badge.style.display).toBe(""); // 刚显示
    await vi.advanceTimersByTimeAsync(3000);
    expect(badge.style.display).toBe("none"); // 3s 自动隐藏
  });
});

describe("pickWebFilesAndImport — 网页版导入文件", () => {
  /** 捕获 pickWebFilesAndImport 内部创建的 <input type=file> */
  function captureCreatedInput(): { inputs: HTMLInputElement[]; restore: () => void } {
    const inputs: HTMLInputElement[] = [];
    const orig = document.createElement.bind(document);
    const spy = vi
      .spyOn(document, "createElement")
      .mockImplementation(((tag: string) => {
        const el = orig(tag as keyof HTMLElementTagNameMap);
        if (tag === "input") inputs.push(el as HTMLInputElement);
        return el;
      }) as typeof document.createElement);
    return { inputs, restore: () => spy.mockRestore() };
  }

  async function triggerChange(files: File[]): Promise<HTMLInputElement> {
    const { inputs, restore } = captureCreatedInput();
    const pending = pickWebFilesAndImport(
      "ysm",
      async () => {},
      () => {},
    );
    await Promise.resolve();
    const input = inputs[0]!;
    Object.defineProperty(input, "files", { value: files, configurable: true });
    input.dispatchEvent(new Event("change"));
    await pending;
    await Promise.resolve();
    await Promise.resolve();
    restore();
    return input;
  }

  it("accept 取注册表扩展名 + click 触发选择器", async () => {
    const { inputs, restore } = captureCreatedInput();
    try {
      const p = pickWebFilesAndImport("ysm", async () => {}, () => {});
      await p;
      const input = inputs[0]!;
      expect(input.type).toBe("file");
      expect(input.multiple).toBe(true);
      const exts = getExts("ysm");
      expect(input.accept).toBe(exts.length ? exts.join(",") : "*.*");
      expect(input.accept).toContain(".ysm");
    } finally {
      restore();
    }
  });

  it("change 且有文件 → importWebFiles + onLoaded/onRendered + 成功 toast", async () => {
    importWebFilesMock.mockResolvedValue({ imported: 3, failed: 0 });
    let loaded = false;
    let rendered = false;
    const { inputs, restore } = captureCreatedInput();
    const p = pickWebFilesAndImport(
      "ysm",
      async () => {
        loaded = true;
      },
      () => {
        rendered = true;
      },
    );
    await Promise.resolve();
    const input = inputs[0]!;
    const file = new File(["x"], "a.ysm");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await p;
    await Promise.resolve();
    await Promise.resolve();
    restore();
    expect(importWebFilesMock).toHaveBeenCalledWith([file], "ysm");
    expect(loaded).toBe(true);
    expect(rendered).toBe(true);
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("3 个模型已导入") }),
    );
  });

  it("部分失败 → warn toast；importWebFiles 拒绝 → error toast", async () => {
    importWebFilesMock.mockResolvedValueOnce({ imported: 1, failed: 2 });
    const { inputs, restore } = captureCreatedInput();
    const p = pickWebFilesAndImport("ysm", async () => {}, () => {});
    await Promise.resolve();
    Object.defineProperty(inputs[0]!, "files", {
      value: [new File(["x"], "a.ysm")],
      configurable: true,
    });
    inputs[0]!.dispatchEvent(new Event("change"));
    await p;
    await Promise.resolve();
    await Promise.resolve();
    restore();
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "warn", msg: expect.stringContaining("2 个失败") }),
    );

    importWebFilesMock.mockRejectedValueOnce(new Error("import boom"));
    const r2 = captureCreatedInput();
    const p2 = pickWebFilesAndImport("ysm", async () => {}, () => {});
    await Promise.resolve();
    Object.defineProperty(r2.inputs[0]!, "files", {
      value: [new File(["x"], "a.ysm")],
      configurable: true,
    });
    r2.inputs[0]!.dispatchEvent(new Event("change"));
    await p2;
    await Promise.resolve();
    await Promise.resolve();
    r2.restore();
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error", msg: expect.stringContaining("import boom") }),
    );
  });

  it("change 但无文件 → 早退（不调 importWebFiles）", async () => {
    const { inputs, restore } = captureCreatedInput();
    const p = pickWebFilesAndImport("ysm", async () => {}, () => {});
    await Promise.resolve();
    Object.defineProperty(inputs[0]!, "files", { value: [], configurable: true });
    inputs[0]!.dispatchEvent(new Event("change"));
    await p;
    await Promise.resolve();
    restore();
    expect(importWebFilesMock).not.toHaveBeenCalled();
  });
});
