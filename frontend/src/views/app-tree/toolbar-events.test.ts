// ===== 工具栏事件测试（bindToolbarEvents）=====
// 覆盖：高级筛选全链路（回填/交集/清空/失败）、全选反选、导出、视图切换、
//       作者菜单填充、批量按钮、更多菜单（打开文件夹/导入/刷新/生成索引）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "../../bus.ts";
import { selectState } from "./data.ts";
import type { AppTree } from "./index.ts";

const {
  SearchModelsMock,
  ListByTagMock,
  GetRepoRootMock,
  OpenFolderMock,
  SelectImportFileMock,
  ImportByTypeMock,
  SelectDirectoryMock,
  GenerateRepoIndexMock,
  modalAdvFilterMock,
  setRenderModeMock,
  getAndroidBridgeMock,
  isViewerModeMock,
  resolveAndroidRepoDirMock,
} = vi.hoisted(() => ({
  SearchModelsMock: vi.fn(),
  ListByTagMock: vi.fn(),
  GetRepoRootMock: vi.fn(),
  OpenFolderMock: vi.fn(),
  SelectImportFileMock: vi.fn(),
  ImportByTypeMock: vi.fn(),
  SelectDirectoryMock: vi.fn(),
  GenerateRepoIndexMock: vi.fn(),
  modalAdvFilterMock: vi.fn(),
  setRenderModeMock: vi.fn(),
  getAndroidBridgeMock: vi.fn(),
  isViewerModeMock: vi.fn().mockReturnValue(false), // 默认桌面（非查看器模式）
  resolveAndroidRepoDirMock: vi.fn(),
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    SearchModels: SearchModelsMock,
    ListByTag: ListByTagMock,
    GetRepoRoot: GetRepoRootMock,
    OpenFolder: OpenFolderMock,
    SelectImportFile: SelectImportFileMock,
    ImportByType: ImportByTypeMock,
    SelectDirectory: SelectDirectoryMock,
    GenerateRepoIndex: GenerateRepoIndexMock,
  }),
}));

vi.mock("../../utils/dom/dialogs/adv-filter.ts", () => ({
  modalAdvFilter: modalAdvFilterMock,
}));

vi.mock("./render.ts", () => ({
  setRenderMode: setRenderModeMock,
  setRenderModeToRoot: vi.fn(),
}));

vi.mock("../../utils/debug/debug.ts", () => ({
  dbg: vi.fn(),
}));

// Android 双端桥（import-dir 分支）：桥存在判定 + 查看器模式门控 + 公共目录解析
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  getAndroidBridge: getAndroidBridgeMock,
  isViewerMode: isViewerModeMock,
}));
vi.mock("../../utils/dom/directory-picker.ts", () => ({
  resolveAndroidRepoDir: resolveAndroidRepoDirMock,
}));

import { bindToolbarEvents } from "./toolbar-events.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 构造 toolbar ShadowRoot（与 tpl.ts 结构对应的最小 DOM）
function makeRoot(): { root: ShadowRoot; get: (id: string) => HTMLElement | null; getByTestId: (tid: string) => HTMLElement | null } {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <input id="srch" data-testid="tree-srch" />
    <input id="af-minBones" data-testid="tree-af-min-bones" />
    <input id="af-maxBones" data-testid="tree-af-max-bones" />
    <input id="af-minCubes" data-testid="tree-af-min-cubes" />
    <input id="af-maxCubes" data-testid="tree-af-max-cubes" />
    <input id="af-minTex" data-testid="tree-af-min-tex" />
    <input id="af-maxTex" data-testid="tree-af-max-tex" />
    <button id="sel-all" data-testid="tree-sel-all">全选</button>
    <button id="btn-repo" data-testid="tree-repo">仓库</button>
    <select id="sort" data-testid="tree-sort"><option value="name">名称</option><option value="size">大小</option><option value="date">日期</option></select>
    <button id="btn-view-mode" data-testid="tree-view-mode">☰</button>
    <button id="btn-adv-filter" data-testid="tree-adv-filter">筛选</button>
    <button id="af-clear" data-testid="tree-af-clear">清除</button>
    <div class="dd-wrap" id="dd-authors"><div id="menu-authors"></div></div>
    <div id="menu-batch">
      <button data-batch="enable-all" data-testid="tree-batch-enable">全部启用</button>
      <button data-batch="disable-all" data-testid="tree-batch-disable">全部禁用</button>
    </div>
    <div id="menu-more">
      <button data-more="open-folder" data-testid="tree-more-open-folder">打开文件夹</button>
      <button data-more="import-file" data-testid="tree-more-import-file">导入文件</button>
      <button data-more="import-dir" data-testid="tree-more-import-dir">导入文件夹</button>
      <button data-more="refresh" data-testid="tree-more-refresh">刷新</button>
      <button data-more="genindex" data-testid="tree-more-genindex">生成索引</button>
    </div>
    <div id="tree"></div>
    <span id="ftr-stat" data-testid="tree-ftr-stat">共 0 项</span>
  `;
  const get = (id: string): HTMLElement | null => root.getElementById(id);
  const getByTestId = (tid: string): HTMLElement | null =>
    root.querySelector(`[data-testid="${tid}"]`);
  return { root, get, getByTestId };
}

interface VM {
  _root: ShadowRoot;
  _filesRoot: string | null;
  _search: string;
  _sort: string;
  _renderMode: string;
  _rootAttr: string;
  _authors: Array<{ Name?: string; Count?: number } | string>;
  _filterPaths: Set<string> | null;
  _renderTree: ReturnType<typeof vi.fn>;
  _load: ReturnType<typeof vi.fn>;
}

function makeVM(root: ShadowRoot): VM {
  const vm: VM = {
    _root: root,
    _filesRoot: "/repo",
    _search: "",
    _sort: "name",
    _renderMode: "list",
    _rootAttr: "ysm",
    _authors: [],
    _filterPaths: null,
    _renderTree: vi.fn(),
    _load: vi.fn().mockResolvedValue(undefined),
  };
  return vm;
}

// bus 事件收集器
const toasts: Array<{ msg: string; type: string }> = [];
const navs: string[] = [];
const batchEvts: string[] = [];
const offs: Array<() => void> = [];

beforeEach(() => {
  toasts.length = 0;
  navs.length = 0;
  batchEvts.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as { msg: string; type: string })));
  offs.push(bus.on("nav:changed", (p) => navs.push((p as { page: string }).page)));
  offs.push(bus.on("batch:enable-all", () => batchEvts.push("enable-all")));
  offs.push(bus.on("batch:disable-all", () => batchEvts.push("disable-all")));

  vi.clearAllMocks();
  GetRepoRootMock.mockResolvedValue("/repo");
  ListByTagMock.mockResolvedValue([]);
  SearchModelsMock.mockResolvedValue([]);
  OpenFolderMock.mockResolvedValue(undefined);
  SelectImportFileMock.mockResolvedValue("/x/a.ysm");
  SelectDirectoryMock.mockResolvedValue("/x/dir");
  ImportByTypeMock.mockResolvedValue(null);
  GenerateRepoIndexMock.mockResolvedValue(undefined);
  modalAdvFilterMock.mockResolvedValue(null);
  getAndroidBridgeMock.mockReturnValue(null); // 默认桌面（无 Android 桥）
  isViewerModeMock.mockReturnValue(false); // 默认桌面（非查看器模式）
  resolveAndroidRepoDirMock.mockResolvedValue("/storage/emulated/0/YSM-Model-Manager");
  selectState.keys.clear();
  selectState.lastKey = null;
});

afterEach(() => {
  offs.forEach((fn) => fn());
  offs.length = 0;
  vi.restoreAllMocks(); // 恢复 spyOn 的 URL 补丁，防跨用例泄漏
});

describe("bindToolbarEvents — 高级筛选弹窗", () => {
  it("点击筛选按钮 → modalAdvFilter 收到当前输入框值", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    (getByTestId("tree-srch") as HTMLInputElement).value = "Alex";
    (getByTestId("tree-af-min-bones") as HTMLInputElement).value = "3";
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();

    expect(modalAdvFilterMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: expect.objectContaining({ keyword: "Alex", minBones: "3" }),
      }),
    );
  });

  it("弹窗返回 null（取消）→ 不渲染树", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await Promise.resolve();

    expect(vm._renderTree).not.toHaveBeenCalled();
  });

  it("弹窗返回全空条件 → 清空筛选并渲染", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._filterPaths = new Set(["/a.ysm"]);
    modalAdvFilterMock.mockResolvedValue({
      cleared: true,
      keyword: undefined,
      minBones: undefined,
      maxBones: undefined,
      minCubes: undefined,
      maxCubes: undefined,
      minTex: undefined,
      maxTex: undefined,
      tag: undefined,
    });
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._filterPaths).toBeNull();
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("弹窗返回筛选值 → 回填 inline + SearchModels/ListByTag 交集", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "Alex",
      minBones: 2,
      maxBones: 10,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "近代",
    });
    ListByTagMock.mockResolvedValue(["/r/a.ysm", "/r/b.ysm"]);
    SearchModelsMock.mockResolvedValue([{ path: "/r/a.ysm" }, { path: "/r/c.ysm" }]);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    // 交集：tag ∩ search = /r/a.ysm
    expect(vm._filterPaths).toEqual(new Set(["/r/a.ysm"]));
    expect(vm._search).toBe("Alex");
    expect((getByTestId("tree-af-min-bones") as HTMLInputElement).value).toBe("2");
    expect(ListByTagMock).toHaveBeenCalledWith("近代");
    expect(SearchModelsMock).toHaveBeenCalledWith(
      "/repo",
      "Alex",
      2,
      10,
      0,
      0,
      0,
      0,
    );
    expect(toasts.some((t) => t.msg.includes("找到 1 个匹配"))).toBe(true);
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("仅有 tag → _filterPaths 直接用 tagPaths", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "",
      minBones: null,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "近代",
    });
    ListByTagMock.mockResolvedValue(["/r/t1.ysm"]);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._filterPaths).toEqual(new Set(["/r/t1.ysm"]));
    expect(SearchModelsMock).not.toHaveBeenCalled();
  });

  it("仅有范围条件 → 走 SearchModels 不查标签", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "",
      minBones: 5,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "",
    });
    SearchModelsMock.mockResolvedValue([{ path: "/r/s1.ysm" }]);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._filterPaths).toEqual(new Set(["/r/s1.ysm"]));
    expect(ListByTagMock).not.toHaveBeenCalled();
  });

  it("匹配 0 个 → warn toast 且保留空筛选", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "无",
      minBones: null,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "",
    });
    SearchModelsMock.mockResolvedValue([]);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._filterPaths?.size).toBe(0);
    expect(toasts.some((t) => t.type === "warn" && t.msg.includes("无匹配"))).toBe(true);
  });

  it("_filesRoot 空 → warn toast 且不搜索", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._filesRoot = null; // toolbar-search.ts 读 vm._filesRoot，非 GetRepoRoot
    modalAdvFilterMock.mockResolvedValue({
      keyword: "x",
      minBones: null,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "",
    });
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("请先配置仓库目录"))).toBe(true);
    expect(SearchModelsMock).not.toHaveBeenCalled();
  });

  it("ListByTag 失败 → error toast 且继续按范围搜索", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "x",
      minBones: null,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "近代",
    });
    ListByTagMock.mockRejectedValue(new Error("tag boom"));
    SearchModelsMock.mockResolvedValue([{ path: "/r/a.ysm" }]);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("标签查询失败"))).toBe(true);
    expect(vm._filterPaths).toEqual(new Set(["/r/a.ysm"]));
  });

  it("SearchModels 失败 → error toast + 清空筛选", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    modalAdvFilterMock.mockResolvedValue({
      keyword: "x",
      minBones: null,
      maxBones: null,
      minCubes: null,
      maxCubes: null,
      minTex: null,
      maxTex: null,
      tag: "",
    });
    SearchModelsMock.mockRejectedValue(new Error("search boom"));
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-adv-filter")!.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.type === "error" && t.msg.includes("高级筛选失败"))).toBe(true);
    expect(vm._filterPaths).toBeNull();
    expect(vm._renderTree).toHaveBeenCalled();
  });
});

describe("bindToolbarEvents — 全选/反选", () => {
  it("首次点击 → 全选可见文件行", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    // #tree 上的 _vsRows（模拟渲染结果）
    const tree = get("tree") as HTMLElement & {
      _vsRows?: Array<{ id: number; type: "file" | "folder"; key: string; depth: number; html: string }>;
    };
    tree._vsRows = [
      { id: 0, type: "file", key: "/r/a.ysm", depth: 0, html: "" },
      { id: 1, type: "file", key: "/r/b.ysm", depth: 0, html: "" },
      { id: 2, type: "folder", key: "/r/dir", depth: 0, html: "" },
    ];
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-sel-all")!.click();

    expect(selectState.keys.has("/r/a.ysm")).toBe(true);
    expect(selectState.keys.has("/r/b.ysm")).toBe(true);
    // 文件夹行不参与全选
    expect(selectState.keys.has("/r/dir")).toBe(false);
    // 使用点接线：flashBtn 同步加 flash class（审核回归锁）
    expect(getByTestId("tree-sel-all")!.classList.contains("flash")).toBe(true);
  });

  it("再次点击 → 全部反选", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    const tree = get("tree") as HTMLElement & {
      _vsRows?: Array<{ id: number; type: "file" | "folder"; key: string; depth: number; html: string }>;
    };
    tree._vsRows = [{ id: 0, type: "file", key: "/r/a.ysm", depth: 0, html: "" }];
    selectState.keys.add("/r/a.ysm");
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-sel-all")!.click();

    expect(selectState.keys.size).toBe(0);
  });
});

describe("bindToolbarEvents — 导出/导航/搜索/排序/视图", () => {
  it("btn-repo → nav:change settings", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-repo")!.click();

    expect(navs).toContain("settings");
  });

  it("srch 输入 → _search 立即更新，渲染 debounce 150ms", () => {
    vi.useFakeTimers();
    try {
      const { root, get, getByTestId } = makeRoot();
      const vm = makeVM(root);
      bindToolbarEvents(root, vm as unknown as AppTree);

      const srch = getByTestId("tree-srch") as HTMLInputElement;
      srch.value = "neko";
      srch.dispatchEvent(new Event("input", { bubbles: true }));

      expect(vm._search).toBe("neko"); // 状态立即更新
      expect(vm._renderTree).not.toHaveBeenCalled(); // 渲染延迟
      vi.advanceTimersByTime(200);
      expect(vm._renderTree).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("连续输入多个字符 → debounce 合并为一次渲染（用最新值）", () => {
    vi.useFakeTimers();
    try {
      const { root, get, getByTestId } = makeRoot();
      const vm = makeVM(root);
      bindToolbarEvents(root, vm as unknown as AppTree);

      const srch = getByTestId("tree-srch") as HTMLInputElement;
      ["n", "ne", "nek", "neko"].forEach((v) => {
        srch.value = v;
        srch.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(50); // 每次间隔 <150ms，定时器持续重置
      });

      expect(vm._search).toBe("neko");
      expect(vm._renderTree).not.toHaveBeenCalled(); // 全部被合并
      vi.advanceTimersByTime(200);
      expect(vm._renderTree).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sort 切换 → 更新 _sort 并渲染", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const sort = getByTestId("tree-sort") as HTMLSelectElement;
    sort.value = "date";
    sort.dispatchEvent(new Event("change", { bubbles: true }));

    expect(vm._sort).toBe("date");
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("btn-view-mode 点击 → 切换 list⇄grid + setRenderMode + 图标更新", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._renderMode = "list";
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-view-mode")!.click();

    expect(vm._renderMode).toBe("grid");
    expect(setRenderModeMock).toHaveBeenCalledWith("grid");
    // 使用点接线：flashBtn 同步加 flash class（审核回归锁）
    expect(getByTestId("tree-view-mode")!.classList.contains("flash")).toBe(true);

    getByTestId("tree-view-mode")!.click();
    expect(vm._renderMode).toBe("list");
  });

  it("af-clear → 清空全部输入与筛选", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._filterPaths = new Set(["/r/a.ysm"]);
    vm._search = "x";
    (getByTestId("tree-af-min-bones") as HTMLInputElement).value = "5";
    (getByTestId("tree-srch") as HTMLInputElement).value = "x";
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-af-clear")!.click();

    expect((getByTestId("tree-af-min-bones") as HTMLInputElement).value).toBe("");
    expect((getByTestId("tree-srch") as HTMLInputElement).value).toBe("");
    expect(vm._search).toBe("");
    expect(vm._filterPaths).toBeNull();
    expect(vm._renderTree).toHaveBeenCalled();
  });
});

describe("bindToolbarEvents — 作者菜单", () => {
  it("hover 填充作者按钮（含数量）", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._authors = [{ Name: "Alex", Count: 3 }, "Bob"];
    bindToolbarEvents(root, vm as unknown as AppTree);

    const ddWrap = root.getElementById("dd-authors")!;
    ddWrap.dispatchEvent(new PointerEvent("pointerenter"));

    const menu = get("menu-authors")!;
    expect(menu.children.length).toBe(2);
    expect(menu.querySelector('[data-author="Alex"]')?.textContent).toContain("Alex (3)");
    expect(menu.querySelector('[data-author="Bob"]')?.textContent).toContain("Bob");
  });

  it("作者为空 → 显示暂无作者", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._authors = [];
    bindToolbarEvents(root, vm as unknown as AppTree);

    root.getElementById("dd-authors")!.dispatchEvent(new PointerEvent("pointerenter"));

    expect(get("menu-authors")!.textContent).toContain("暂无作者");
  });

  it("点击作者 → 填充搜索框并触发 input 事件（渲染 debounce）", () => {
    vi.useFakeTimers();
    try {
      const { root, get, getByTestId } = makeRoot();
      const vm = makeVM(root);
      vm._authors = [{ Name: "Alex", Count: 1 }];
      bindToolbarEvents(root, vm as unknown as AppTree);

      root.getElementById("dd-authors")!.dispatchEvent(new MouseEvent("click"));
      const menu = get("menu-authors")!;
      (menu.querySelector('[data-author="Alex"]') as HTMLButtonElement).click();

      expect((getByTestId("tree-srch") as HTMLInputElement).value).toBe("Alex");
      expect(vm._search).toBe("Alex"); // 状态立即更新
      expect(vm._renderTree).not.toHaveBeenCalled();
      vi.advanceTimersByTime(200);
      expect(vm._renderTree).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bindToolbarEvents — 批量与更多菜单", () => {
  it("menu-batch enable-all / disable-all → bus 事件", () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    getByTestId("tree-batch-enable")!.click();
    getByTestId("tree-batch-disable")!.click();

    expect(batchEvts).toEqual(["enable-all", "disable-all"]);
  });

  it("menu-more open-folder → OpenFolder(repoRoot)", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-open-folder") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(OpenFolderMock).toHaveBeenCalledWith("/repo");
  });

  it("menu-more open-folder Android → 定位公共仓库目录（resolveAndroidRepoDir），不调 OpenFolder", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() });
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android）
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-open-folder") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(resolveAndroidRepoDirMock).toHaveBeenCalledTimes(1);
    expect(OpenFolderMock).not.toHaveBeenCalled();
  });

  it("menu-more open-folder 未配置仓库 → 不调后端", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    vm._filesRoot = null;
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-open-folder") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(OpenFolderMock).not.toHaveBeenCalled();
  });

  it("menu-more import-file 成功 → ImportByType + 刷新 + toast", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-file") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(SelectImportFileMock).toHaveBeenCalled();
    expect(ImportByTypeMock).toHaveBeenCalledWith("ysm", "/x/a.ysm");
    expect(vm._load).toHaveBeenCalled();
    expect(vm._renderTree).toHaveBeenCalled();
    expect(toasts.some((t) => t.msg.includes("导入成功"))).toBe(true);
  });

  it("menu-more import-file 取消选择 → 不导入", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    SelectImportFileMock.mockResolvedValue("");
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-file") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(ImportByTypeMock).not.toHaveBeenCalled();
  });

  it("menu-more import-file 后端失败 → warn toast", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    ImportByTypeMock.mockResolvedValue("文件已存在");
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-file") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("导入失败"))).toBe(true);
  });

  it("menu-more import-dir 桌面成功 → SelectDirectory + ImportByType + 刷新", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-dir") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(SelectDirectoryMock).toHaveBeenCalled();
    expect(ImportByTypeMock).toHaveBeenCalledWith("ysm", "/x/dir");
    expect(vm._load).toHaveBeenCalled();
    expect(vm._renderTree).toHaveBeenCalled();
    expect(resolveAndroidRepoDirMock).not.toHaveBeenCalled();
  });

  it("menu-more import-dir Android 未授权 → 引导授权（resolveAndroidRepoDir 返回 null），不复制导入", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() });
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android）
    resolveAndroidRepoDirMock.mockResolvedValue(null);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-dir") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // 未授权：已走授权引导（requestStoragePermission 由 resolveAndroidRepoDir 内部处理）
    expect(resolveAndroidRepoDirMock).toHaveBeenCalledTimes(1);
    expect(SelectDirectoryMock).not.toHaveBeenCalled();
    expect(ImportByTypeMock).not.toHaveBeenCalled();
    expect(vm._load).not.toHaveBeenCalled();
  });

  it("menu-more import-dir Android 已授权 → 定位公共仓库目录 + 刷新，不走桌面 Dialog", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    getAndroidBridgeMock.mockReturnValue({ requestStoragePermission: vi.fn() });
    isViewerModeMock.mockReturnValue(true); // 查看器模式（Android）
    resolveAndroidRepoDirMock.mockResolvedValue("/storage/emulated/0/YSM-Model-Manager");
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-import-dir") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(resolveAndroidRepoDirMock).toHaveBeenCalledTimes(1);
    expect(SelectDirectoryMock).not.toHaveBeenCalled();
    expect(ImportByTypeMock).not.toHaveBeenCalled();
    expect(vm._load).toHaveBeenCalled();
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("menu-more refresh → 渲染 spinner + 重新加载", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-refresh") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(vm._load).toHaveBeenCalled();
    expect(vm._renderTree).toHaveBeenCalled();
  });

  it("menu-more genindex 成功 → toast + 按钮恢复", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-genindex") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(GenerateRepoIndexMock).toHaveBeenCalledWith("/repo");
    expect(toasts.some((t) => t.msg.includes("index.json 已生成"))).toBe(true);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("menu-more genindex 未配置仓库 → warn toast 且不生成", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    GetRepoRootMock.mockResolvedValue("");
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-genindex") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(toasts.some((t) => t.msg.includes("请先配置存储路径"))).toBe(true);
    expect(GenerateRepoIndexMock).not.toHaveBeenCalled();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("menu-more genindex 后端报错 → error toast + 按钮恢复", async () => {
    const { root, get, getByTestId } = makeRoot();
    const vm = makeVM(root);
    GenerateRepoIndexMock.mockRejectedValue(new Error("EACCES"));
    bindToolbarEvents(root, vm as unknown as AppTree);

    const btn = getByTestId("tree-more-genindex") as HTMLElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 0));

    // ADR-051：裸 JS Error 无 AppError.Code → 走默认 fallback（不依赖具体文案）
    expect(toasts.some((t) => t.type === "error")).toBe(true);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
