// ===== app-tree 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子 + 交互路径；状态经 selectState/实例字段查询，
// 不绑定 CSS 类/文案。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor } from "../../test-utils/index.ts";
import { selectState } from "./data.ts";
import { bus } from "../../bus.ts";
import { ToggleModelEnable } from "../../../bindings/ysm-model-manager/internal/app/app.js";
import "./index.ts"; // 注册 app-tree 自定义元素（constructor 里 attachShadow）
import type { TreeEntry } from "./loader.ts";

// jsdom 缺 ResizeObserver（render 虚拟滚动依赖）——空实现防 _renderTree 抛错
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

// 可配置的 mock 种子数据（vi.hoisted 避免工厂提升问题）
const mockData = vi.hoisted(() => ({
  entries: [] as TreeEntry[],
}));
const flatEntries = (): TreeEntry[] => [
  { name: "a.ysm", path: "a.ysm", fullPath: "/repo/a.ysm", type: "ysm", banned: false, size: 1, modTime: 0 },
  { name: "b.ysm", path: "b.ysm", fullPath: "/repo/b.ysm", type: "ysm", banned: false, size: 2, modTime: 0 },
];

// mock bindings（bus-handlers 静态 import，必须 mock）
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ToggleModelEnable: vi.fn().mockResolvedValue(true),
  SelectDirectory: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  RenameFile: vi.fn().mockResolvedValue(undefined),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
}));

// mock registry（loadEntries 提供假数据，种子数据程序化 — 隔壁实证）
vi.mock("../../services/registry.ts", () => ({
  get: (name: string) => {
    if (name === "loadEntries") {
      return async () => ({ repoRoot: "/repo", entries: mockData.entries });
    }
    return undefined;
  },
}));

interface TreeLike extends HTMLElement {
  _dirOpen: Record<string, boolean>;
  _filterPaths: Set<string> | null;
}

async function mountTree(): Promise<TreeLike> {
  const el = document.createElement("app-tree") as TreeLike;
  document.body.appendChild(el);
  // 等 connectedCallback 的 _load + _renderTree 完成（文件行或文件夹行任一出现——
  // 子路径文件默认在折叠的文件夹内，tree-file 可能不渲染）
  await waitFor(() => {
    const root = el.shadowRoot!;
    return (
      getAllByTestId(root, "tree-file").length + getAllByTestId(root, "tree-dir").length > 0
    );
  });
  return el;
}

function clickRow(el: HTMLElement, idx: number, opts: { ctrl?: boolean; shift?: boolean } = {}): void {
  const rows = getAllByTestId(el.shadowRoot!, "tree-file");
  rows[idx].dispatchEvent(
    new MouseEvent("click", { bubbles: true, ctrlKey: !!opts.ctrl, metaKey: !!opts.ctrl, shiftKey: !!opts.shift }),
  );
}

describe("app-tree 组件（testid 钩子 + 交互路径）", () => {
  beforeEach(() => {
    selectState.keys.clear();
    selectState.lastKey = null;
    mockData.entries = flatEntries();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.querySelectorAll("app-tree").forEach((el) => el.remove());
  });

  it("1. 渲染后文件行带 tree-file testid", async () => {
    const el = await mountTree();
    expect(getAllByTestId(el.shadowRoot!, "tree-file").length).toBe(2);
  });

  it("2. 单击选中单行（selectState + lastKey）", async () => {
    const el = await mountTree();
    clickRow(el, 0);
    expect(selectState.keys.size).toBe(1);
    expect(selectState.lastKey).toBe("/repo/a.ysm");
  });

  it("3. Ctrl 多选两行", async () => {
    const el = await mountTree();
    clickRow(el, 0);
    clickRow(el, 1, { ctrl: true });
    expect(selectState.keys.size).toBe(2);
  });

  it("4. Shift 范围选择（行0 → Shift+行1）", async () => {
    const el = await mountTree();
    clickRow(el, 0);
    clickRow(el, 1, { shift: true });
    expect(selectState.keys.size).toBe(2);
  });

  it("5. 连点文件开关防重入：ToggleModelEnable 只调一次", async () => {
    const el = await mountTree();
    const toggle = getByTestId(el.shadowRoot!, "tree-toggle");
    toggle!.click();
    // 第一次点击同步置位 _toggleBusy（events.ts:136），第二次点击在同步阶段被拦截
    toggle!.click(); // 第二次被 _toggleBusy 拦截（events.ts:135）
    // ToggleModelEnable 经 getApp().then 异步链触发（events.ts:141-142），需等待断言
    await waitFor(() => (ToggleModelEnable as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1);
  });

  it("6. 子路径文件渲染出文件夹行（tree-dir）", async () => {
    mockData.entries = [
      { name: "a.ysm", path: "folder/a.ysm", fullPath: "/repo/folder/a.ysm", type: "ysm", banned: false, size: 1, modTime: 0 },
    ];
    const el = await mountTree();
    expect(getAllByTestId(el.shadowRoot!, "tree-dir").length).toBeGreaterThan(0);
  });

  it("7. 点击文件夹行展开/折叠（_dirOpen 翻转 + 持久化）", async () => {
    mockData.entries = [
      { name: "a.ysm", path: "folder/a.ysm", fullPath: "/repo/folder/a.ysm", type: "ysm", banned: false, size: 1, modTime: 0 },
    ];
    const el = await mountTree();
    const dirRow = getAllByTestId(el.shadowRoot!, "tree-dir")[0];
    dirRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const keys = Object.keys(el._dirOpen);
    expect(keys.length).toBeGreaterThan(0);
    expect(el._dirOpen[keys[0]]).toBe(true);
    // _renderTree 已重建 DOM（旧引用失效），重新获取行再点第二次
    const dirRow2 = getAllByTestId(el.shadowRoot!, "tree-dir")[0];
    dirRow2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el._dirOpen[keys[0]]).toBe(false);
  });

  it("8. 文件夹开关不触发文件选中（selectState 不变）", async () => {
    mockData.entries = [
      { name: "a.ysm", path: "folder/a.ysm", fullPath: "/repo/folder/a.ysm", type: "ysm", banned: false, size: 1, modTime: 0 },
    ];
    const el = await mountTree();
    const dirToggle = getByTestId(el.shadowRoot!, "tree-dir-toggle");
    dirToggle!.click();
    expect(selectState.keys.size).toBe(0);
  });

  it("9. bus filter:results 驱动过滤（_filterPaths 设置）", async () => {
    const el = await mountTree();
    bus.emit("filter:results", [{ path: "/repo/a.ysm" }]);
    await waitFor(() => el._filterPaths !== null);
    expect(el._filterPaths!.has("/repo/a.ysm")).toBe(true);
  });

  it("10. bus tree:set-search 驱动搜索框", async () => {
    const el = await mountTree();
    bus.emit("tree:set-search", "hello");
    await waitFor(() => {
      const srch = el.shadowRoot!.getElementById("srch") as HTMLInputElement | null;
      return srch !== null && srch.value === "hello";
    });
  });
});
