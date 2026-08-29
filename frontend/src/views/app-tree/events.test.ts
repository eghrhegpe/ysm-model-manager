// ===== 树事件层测试（events.ts bindTreeEvents 事件委托）=====
// 覆盖：updateSelectCount 统计、行点击分派（文件夹/文件/Ctrl/Shift/悬停操作）、
// 复选框启停（单文件 + 文件夹批量的忙碌/能力/失败分支）、双击重命名（Enter/focusout/Escape）、
// 右键菜单（dir/file/batch 三态）。按事件名分组断言 bus 副作用。
// 无同名测试先例（app-tree.component / render / toolbar-events 等均不 import events.ts）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { bus } from "../../bus.ts";
import { selectState, selectSingle } from "./data.ts";
import type { AppTree } from "./index.ts";
import type { TreeEntry } from "./loader.ts";
import { bindTreeEvents, updateSelectCount } from "./events.ts";

const {
  getAppMock,
  ToggleEnableMock,
  RenameFileMock,
  OpenInBrowserMock,
  canMock,
  isViewerModeMock,
  rememberModelPathMock,
  parseModelNameMock,
} = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  ToggleEnableMock: vi.fn(),
  RenameFileMock: vi.fn(),
  OpenInBrowserMock: vi.fn(),
  canMock: vi.fn(() => true),
  isViewerModeMock: vi.fn(() => false),
  rememberModelPathMock: vi.fn(),
  parseModelNameMock: vi.fn(() => ({ author: "" })),
}));

vi.mock("../../backend/app.ts", () => ({ getApp: getAppMock }));
vi.mock("../../utils/dom/capabilities.ts", () => ({ can: canMock }));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  isViewerMode: isViewerModeMock,
}));
// init-pages.ts 是页面装配大模块（含诊断/回收站等 import 链），events 只用 rememberModelPath
vi.mock("../app-content/init-pages.ts", () => ({
  rememberModelPath: rememberModelPathMock,
}));
vi.mock("../../utils/dom/display.ts", () => ({
  parseModelName: parseModelNameMock,
}));

// ===== 测试 DOM 装配 =====

function fileRow(path: string, name: string, ckOn = true): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "fl";
  row.dataset.fullpath = path;
  row.innerHTML =
    `<span class="nm">🏷 ${name}</span>` +
    `<span class="ck${ckOn ? " on" : ""}" data-fullpath="${path}"></span>` +
    `<span class="ha-preview" data-path="${path}"></span>` +
    `<span class="ha-copy" data-path="${path}"></span>`;
  return row;
}

function folderRow(dir: string, name: string, withCk = true): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "fh";
  row.dataset.dir = dir;
  row.innerHTML =
    (withCk ? `<span class="ck" data-dir="${dir}"></span>` : "") +
    `<span class="nm">📁 ${name}</span>`;
  return row;
}

function makeEntry(path: string, fullPath: string, banned: boolean): TreeEntry {
  return {
    name: path.split("/").pop() || path,
    path,
    fullPath,
    size: 0,
    modTime: 0,
    banned,
    type: "file",
  };
}

interface Harness {
  container: HTMLDivElement;
  vm: AppTree;
  root: ShadowRoot;
  stat: HTMLElement;
}

function makeHarness(): Harness {
  const container = document.createElement("div");
  (container as unknown as { _vsRows: Array<{ key: string; type: string }> })._vsRows =
    [];
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<div id="ftr-stat"></div>`;
  const stat = root.getElementById("ftr-stat") as HTMLElement;
  const vm = {
    _rootAttr: null,
    _typeFilter: "ysm",
    _dirOpen: {} as Record<string, boolean>,
    _gen: 0,
    _load: vi.fn().mockResolvedValue(undefined),
    _renderTree: vi.fn(),
    _root: root,
    _toggleBusy: false,
    _batchBusy: false,
    _entries: [] as TreeEntry[],
  } as unknown as AppTree;
  return { container, vm, root, stat };
}

const click = (el: Element, init: MouseEventInit = {}): void => {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
};

/** 微任务/宏任务排空（getApp 链全是微任务，一个 setTimeout 足够） */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let emitSpy: MockInstance;
let clipboardWrite: MockInstance;

function emitted(name: string): unknown[] {
  return emitSpy.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({
    ToggleEnable: ToggleEnableMock,
    RenameFile: RenameFileMock,
    OpenInBrowser: OpenInBrowserMock,
  });
  ToggleEnableMock.mockResolvedValue(undefined);
  RenameFileMock.mockResolvedValue(undefined);
  selectState.keys.clear();
  selectState.lastKey = null;
  localStorage.clear();
  emitSpy = vi.spyOn(bus, "emit");
  clipboardWrite = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: clipboardWrite },
    configurable: true,
  });
});

afterEach(() => {
  emitSpy.mockRestore();
});

// ===== updateSelectCount =====

describe("updateSelectCount 选中统计", () => {
  it("有选中 → 文本「已选 N 个文件」+ accent 色", () => {
    const { root, stat } = makeHarness();
    selectState.keys.add("/a.ysm");
    selectState.keys.add("/b.ysm");
    updateSelectCount(root);
    expect(stat.textContent).toBe("已选 2 个文件");
    expect(stat.style.color).toBe("var(--accent)");
  });

  it("空选中 → 重置颜色（文本不动）", () => {
    const { root, stat } = makeHarness();
    stat.textContent = "已选 2 个文件";
    stat.style.color = "var(--accent)";
    updateSelectCount(root);
    expect(stat.style.color).toBe("");
  });

  it("无 #ftr-stat 节点 → 安全返回不抛", () => {
    const host = document.createElement("div");
    const emptyRoot = host.attachShadow({ mode: "open" });
    expect(() => updateSelectCount(emptyRoot)).not.toThrow();
  });
});

// ===== click：行分派 =====

describe("click 行分派（文件夹展开/收起）", () => {
  it("点击文件夹头 → 首次展开：dirOpen 翻转 + 持久化 + model:select(isDir) + rememberModelPath(null)", () => {
    const h = makeHarness();
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh") as Element);
    expect(h.vm._dirOpen["dirA"]).toBe(true);
    expect(JSON.parse(localStorage.getItem("at_dirs") || "{}")).toEqual({ dirA: true });
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
    expect(emitted("model:select")).toEqual([{ path: "dirA", isDir: true }]);
    expect(rememberModelPathMock).toHaveBeenCalledWith(null);
  });

  it("再次点击收起 → 子目录键清理 + 不再发射 model:select", () => {
    const h = makeHarness();
    (h.vm as unknown as { _dirOpen: Record<string, boolean> })._dirOpen = {
      dirA: true,
      "dirA/sub": true,
      other: true,
    };
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh") as Element);
    const dirOpen = (h.vm as unknown as { _dirOpen: Record<string, boolean> })._dirOpen;
    expect(dirOpen["dirA"]).toBe(false);
    expect(dirOpen["dirA/sub"]).toBeUndefined(); // 前缀清理
    expect(dirOpen["other"]).toBe(true); // 非前缀保留
    expect(emitted("model:select")).toEqual([]);
  });
});

describe("click 行分派（文件选中）", () => {
  it("普通单击 → selectSingle + model:select(带 rtype) + rememberModelPath + 统计更新", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl") as Element);
    expect(selectState.keys.has("/repo/a.ysm")).toBe(true);
    expect(emitted("model:select")).toEqual([
      { path: "/repo/a.ysm", rtype: "ysm" },
    ]);
    expect(rememberModelPathMock).toHaveBeenCalledWith("/repo/a.ysm");
    expect(h.stat.textContent).toBe("已选 1 个文件");
  });

  it("Ctrl 单击 → toggleSelect 切换（再点同项取消且清 lastKey），不发射 model:select", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    const row = h.container.querySelector(".fl") as Element;
    click(row, { ctrlKey: true });
    expect(selectState.keys.has("/repo/a.ysm")).toBe(true);
    expect(selectState.lastKey).toBe("/repo/a.ysm");
    click(row, { ctrlKey: true });
    expect(selectState.keys.size).toBe(0);
    expect(selectState.lastKey).toBeNull();
    expect(emitted("model:select")).toEqual([]);
  });

  it("Shift 范围选择 → lastKey 到目标间全部 file 行加入选中，不发射 model:select", () => {
    const h = makeHarness();
    for (const p of ["/repo/a.ysm", "/repo/b.ysm", "/repo/c.ysm"]) {
      h.container.appendChild(fileRow(p, p.split("/").pop() || p));
    }
    (
      h.container as unknown as { _vsRows: Array<{ key: string; type: string }> }
    )._vsRows = [
      { key: "/repo/a.ysm", type: "file" },
      { key: "/repo/b.ysm", type: "file" },
      { key: "/repo/c.ysm", type: "file" },
    ];
    bindTreeEvents(h.container, h.vm);
    selectSingle("/repo/a.ysm"); // 锚点
    const rows = h.container.querySelectorAll(".fl");
    click(rows[2], { shiftKey: true });
    expect(selectState.keys.size).toBe(3);
    expect(selectState.lastKey).toBe("/repo/c.ysm");
    expect(h.stat.textContent).toBe("已选 3 个文件");
    expect(emitted("model:select")).toEqual([]);
  });

  it("Shift 但无 lastKey 锚点 → 不选不渲染，直接 return", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl") as Element, { shiftKey: true });
    expect(selectState.keys.size).toBe(0);
    expect(h.vm._renderTree).not.toHaveBeenCalled();
    expect(emitted("model:select")).toEqual([]);
  });
});

describe("click 行分派（悬停操作）", () => {
  it("ha-preview 有作者 → isViewerMode 走 desktop 分支 OpenInBrowser(bilibili 搜索)", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/小明模型.ysm", "小明模型.ysm"));
    parseModelNameMock.mockReturnValue({ author: "小明" });
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".ha-preview") as Element);
    await flush();
    const url =
      "https://search.bilibili.com/all?keyword=" + encodeURIComponent("小明");
    expect(OpenInBrowserMock).toHaveBeenCalledWith(url);
    expect(parseModelNameMock).toHaveBeenCalledWith("小明模型.ysm");
  });

  it("ha-preview 无作者 → toast「未解析到作者名」", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/无主.ysm", "无主.ysm"));
    parseModelNameMock.mockReturnValue({ author: "" });
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".ha-preview") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string }>;
    expect(toasts.some((t) => t.msg === "未解析到作者名")).toBe(true);
    expect(OpenInBrowserMock).not.toHaveBeenCalled();
  });

  it("ha-copy → clipboard.writeText(文件名) + toast「已复制」", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".ha-copy") as Element);
    await flush();
    expect(clipboardWrite).toHaveBeenCalledWith("a.ysm");
    const toasts = emitted("toast:show") as Array<{ msg: string }>;
    expect(toasts.some((t) => t.msg === "📋 已复制: a.ysm")).toBe(true);
  });

  it("ha-copy 失败 → toast「复制失败」", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    clipboardWrite.mockRejectedValue(new Error("deny"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".ha-copy") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string }>;
    expect(toasts.some((t) => t.msg.includes("复制失败"))).toBe(true);
  });
});

// ===== click：复选框启停 =====

describe("click 复选框（单文件 ToggleEnable）", () => {
  it("可用且空闲 → ToggleEnable(fullPath) → _load/_renderTree/sync:toggle:status/stats:refresh，busy 复位", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl .ck") as Element);
    await flush();
    expect(ToggleEnableMock).toHaveBeenCalledWith("/repo/a.ysm");
    expect(h.vm._load).toHaveBeenCalledOnce();
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
    expect(emitted("sync:toggle:status").length).toBe(1); // rtype=ysm 才发
    expect(emitted("stats:refresh").length).toBe(1);
    expect((h.vm as unknown as { _toggleBusy: boolean })._toggleBusy).toBe(false);
  });

  it("非 YSM rtype → 不发 sync:toggle:status", async () => {
    const h = makeHarness();
    (h.vm as unknown as { _typeFilter: string })._typeFilter = "mmd";
    h.container.appendChild(fileRow("/repo/a.pmx", "a.pmx"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl .ck") as Element);
    await flush();
    expect(emitted("sync:toggle:status")).toEqual([]);
    expect(emitted("stats:refresh").length).toBe(1);
  });

  it("toggle 进行中 → toast「⏳ 操作进行中」，不重复调用", async () => {
    const h = makeHarness();
    (h.vm as unknown as { _toggleBusy: boolean })._toggleBusy = true;
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(toasts.some((t) => t.msg.includes("操作进行中") && t.type === "info")).toBe(true);
    expect(ToggleEnableMock).not.toHaveBeenCalled();
  });

  it("can(ToggleEnable)=false（网页版）→ warn toast，不触碰 binding", async () => {
    const h = makeHarness();
    canMock.mockReturnValue(false);
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(
      toasts.some((t) => t.msg.includes("网页版不支持启用/禁用模型") && t.type === "warn"),
    ).toBe(true);
    expect(ToggleEnableMock).not.toHaveBeenCalled();
    canMock.mockReturnValue(true);
  });

  it("ToggleEnable 失败 → error toast「切换失败: 文件名」，busy 复位", async () => {
    const h = makeHarness();
    ToggleEnableMock.mockRejectedValue(new Error("io"));
    h.container.appendChild(fileRow("/repo/dirA/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fl .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(
      toasts.some((t) => t.msg.includes("切换失败") && t.msg.includes("a.ysm") && t.type === "error"),
    ).toBe(true);
    expect((h.vm as unknown as { _toggleBusy: boolean })._toggleBusy).toBe(false);
  });
});

describe("click 复选框（文件夹批量 toggleFolderBatch）", () => {
  it("混合状态 → 启用：仅对 banned 项调 ToggleEnable，翻转 banned + renderTree + toast success", async () => {
    const h = makeHarness();
    h.vm._entries = [
      makeEntry("dirA/a.ysm", "/repo/dirA/a.ysm", false),
      makeEntry("dirA/b.ysm", "/repo/dirA/b.ysm", true),
      makeEntry("other/c.ysm", "/repo/other/c.ysm", true), // 前缀外，不参与
    ];
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    expect(ToggleEnableMock).toHaveBeenCalledTimes(1);
    expect(ToggleEnableMock).toHaveBeenCalledWith("/repo/dirA/b.ysm");
    expect(h.vm._entries[1].banned).toBe(false);
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
    expect(emitted("sync:toggle:status").length).toBe(1);
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(
      toasts.some((t) => t.msg === "文件夹启用: 1 成功, 0 失败" && t.type === "success"),
    ).toBe(true);
    expect((h.vm as unknown as { _batchBusy: boolean })._batchBusy).toBe(false);
  });

  it("全部已启用 → 禁用：逐项 ToggleEnable 并置 banned=true，toast「文件夹禁用」", async () => {
    const h = makeHarness();
    h.vm._entries = [
      makeEntry("dirA/a.ysm", "/repo/dirA/a.ysm", false),
      makeEntry("dirA/b.ysm", "/repo/dirA/b.ysm", false),
    ];
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    expect(ToggleEnableMock).toHaveBeenCalledTimes(2);
    expect(h.vm._entries.every((e) => e.banned)).toBe(true);
    const toasts = emitted("toast:show") as Array<{ msg: string }>;
    expect(toasts.some((t) => t.msg === "文件夹禁用: 2 成功, 0 失败")).toBe(true);
  });

  it("部分失败 → toast warn 含失败计数；banned 按现状乐观全量翻转（含失败项，待重载纠正）", async () => {
    const h = makeHarness();
    ToggleEnableMock
      .mockRejectedValueOnce(new Error("lock"))
      .mockResolvedValueOnce(undefined);
    h.vm._entries = [
      makeEntry("dirA/a.ysm", "/repo/dirA/a.ysm", false),
      makeEntry("dirA/b.ysm", "/repo/dirA/b.ysm", false),
    ];
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(toasts.some((t) => t.msg === "文件夹禁用: 1 成功, 1 失败" && t.type === "warn")).toBe(true);
    // 源码现状：ok>0 后对全部 targets 无差别翻转（不看单项成败）→ 失败项也被置 banned，
    // 依赖随后 _load/重载由后端真实状态纠正
    expect(h.vm._entries[0].banned).toBe(true);
    expect(h.vm._entries[1].banned).toBe(true);
  });

  it("批量进行中 → toast「⏳ 操作进行中」，不调 getApp", async () => {
    const h = makeHarness();
    (h.vm as unknown as { _batchBusy: boolean })._batchBusy = true;
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(toasts.some((t) => t.msg.includes("操作进行中"))).toBe(true);
    expect(getAppMock).not.toHaveBeenCalled();
    (h.vm as unknown as { _batchBusy: boolean })._batchBusy = false;
  });

  it("can=false → warn toast，不进批量流程", async () => {
    const h = makeHarness();
    canMock.mockReturnValue(false);
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(toasts.some((t) => t.msg.includes("网页版不支持"))).toBe(true);
    expect(ToggleEnableMock).not.toHaveBeenCalled();
    canMock.mockReturnValue(true);
  });

  it("getApp 失败 → error toast（friendlyError 兜底文案），busy 复位", async () => {
    const h = makeHarness();
    getAppMock.mockRejectedValue(new Error("bridge down"));
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    click(h.container.querySelector(".fh .ck") as Element);
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(
      toasts.some((t) => t.msg.includes("批量启用/禁用失败") && t.type === "error"),
    ).toBe(true);
    expect((h.vm as unknown as { _batchBusy: boolean })._batchBusy).toBe(false);
    getAppMock.mockResolvedValue({
      ToggleEnable: ToggleEnableMock,
      RenameFile: RenameFileMock,
      OpenInBrowser: OpenInBrowserMock,
    });
  });

  it("结构缺项防御：fh 无 .ck / 无 data-dir → 早退不调 ToggleEnable", async () => {
    // 无 .ck
    const h1 = makeHarness();
    h1.container.appendChild(folderRow("dirA", "目录A", false));
    bindTreeEvents(h1.container, h1.vm);
    click(h1.container.querySelector(".fh") as Element);
    // 无 data-dir
    const h2 = makeHarness();
    const badRow = folderRow("", "坏目录");
    delete badRow.dataset.dir;
    h2.container.appendChild(badRow);
    bindTreeEvents(h2.container, h2.vm);
    click(h2.container.querySelector(".fh .ck") as Element);
    await flush();
    expect(ToggleEnableMock).not.toHaveBeenCalled();
  });
});

// ===== dblclick：重命名 =====

describe("dblclick 重命名", () => {
  it("双击行 → .nm 被 input.rename-inp 替换，value 为文件名并聚焦", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    (
      h.container as unknown as { _vsRows: Array<{ key: string; type: string }> }
    )._vsRows = [{ key: "/repo/a.ysm", type: "file" }];
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelector(".nm")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    const inp = h.container.querySelector<HTMLInputElement>(".rename-inp");
    expect(inp).not.toBeNull();
    expect(inp?.value).toBe("a.ysm");
    expect(h.container.querySelector(".nm")).toBeNull();
  });

  it("Enter → preventDefault + blur；focusout 后续走保存链（RenameFile → _load/_renderTree/stats:refresh）", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    (
      h.container as unknown as { _vsRows: Array<{ key: string; type: string }> }
    )._vsRows = [{ key: "/repo/a.ysm", type: "file" }];
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelector(".nm")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const inp = h.container.querySelector<HTMLInputElement>(".rename-inp")!;
    inp.value = "新名字.ysm";
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    inp.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true); // Enter 阻止换行默认行为
    // happy-dom 的 blur() 不派发 focusout（真实浏览器语义会）→ 手动补发模拟 blur 后果
    inp.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(RenameFileMock).toHaveBeenCalledWith("/repo/a.ysm", "新名字.ysm");
    expect(h.vm._load).toHaveBeenCalled();
    expect(h.vm._renderTree).toHaveBeenCalled();
    expect(emitted("stats:refresh").length).toBe(1);
  });

  it("focusout 空值 → 仅 renderTree 放弃重命名", async () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    const inp = document.createElement("input");
    inp.className = "rename-inp";
    inp.value = "   ";
    h.container.querySelector(".fl")!.appendChild(inp);
    inp.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(RenameFileMock).not.toHaveBeenCalled();
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
  });

  it("focusout 找不到所在行 → renderTree 放弃，不调 RenameFile", async () => {
    const h = makeHarness();
    bindTreeEvents(h.container, h.vm);
    const inp = document.createElement("input");
    inp.className = "rename-inp";
    inp.value = "孤儿输入框";
    h.container.appendChild(inp); // 不在 .fl/.fl-list 内
    inp.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(RenameFileMock).not.toHaveBeenCalled();
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
  });

  it("RenameFile 失败 → error toast（friendlyError 兜底）", async () => {
    const h = makeHarness();
    RenameFileMock.mockRejectedValue(new Error("disk io"));
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    const inp = document.createElement("input");
    inp.className = "rename-inp";
    inp.value = "新名字";
    h.container.querySelector(".fl")!.appendChild(inp);
    inp.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    const toasts = emitted("toast:show") as Array<{ msg: string; type: string }>;
    expect(
      toasts.some((t) => t.msg.includes("重命名失败") && t.type === "error"),
    ).toBe(true);
  });

  it("Escape → renderTree 放弃，不进入保存链", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm"));
    bindTreeEvents(h.container, h.vm);
    const inp = document.createElement("input");
    inp.className = "rename-inp";
    inp.value = "改一半";
    h.container.querySelector(".fl")!.appendChild(inp);
    inp.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(h.vm._renderTree).toHaveBeenCalledOnce();
    expect(RenameFileMock).not.toHaveBeenCalled();
  });
});

// ===== contextmenu =====

describe("contextmenu 右键菜单", () => {
  it("文件夹 → ctx:show {type:dir, dir, rtype}", () => {
    const h = makeHarness();
    h.container.appendChild(folderRow("dirA", "目录A"));
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelector(".fh")!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }),
      );
    expect(emitted("ctx:show")).toEqual([
      { x: 10, y: 20, type: "dir", dir: "dirA", rtype: "ysm" },
    ]);
  });

  it("未选中文件（ck 灭）→ ctx:show {type:file, path, banned:true, name}", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm", false));
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelector(".fl")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1, clientY: 2 }));
    expect(emitted("ctx:show")).toEqual([
      {
        x: 1,
        y: 2,
        type: "file",
        path: "/repo/a.ysm",
        banned: true,
        name: "a.ysm",
        rtype: "ysm",
      },
    ]);
  });

  it("启用中文件（ck 亮）→ banned:false", () => {
    const h = makeHarness();
    h.container.appendChild(fileRow("/repo/a.ysm", "a.ysm", true));
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelector(".fl")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const payload = emitted("ctx:show")[0] as { banned: boolean };
    expect(payload.banned).toBe(false);
  });

  it("右键命中多选集合内的行 → ctx:show {type:batch, count, paths}", () => {
    const h = makeHarness();
    for (const p of ["/repo/a.ysm", "/repo/b.ysm"]) {
      h.container.appendChild(fileRow(p, p.split("/").pop() || p));
    }
    (
      h.container as unknown as { _vsRows: Array<{ key: string; type: string }> }
    )._vsRows = [
      { key: "/repo/a.ysm", type: "file" },
      { key: "/repo/b.ysm", type: "file" },
    ];
    selectState.keys.add("/repo/a.ysm");
    selectState.keys.add("/repo/b.ysm");
    bindTreeEvents(h.container, h.vm);
    h.container
      .querySelectorAll(".fl")[0]
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 }));
    expect(emitted("ctx:show")).toEqual([
      {
        x: 5,
        y: 6,
        type: "batch",
        count: 2,
        paths: ["/repo/a.ysm", "/repo/b.ysm"],
        rtype: "ysm",
      },
    ]);
  });
});
