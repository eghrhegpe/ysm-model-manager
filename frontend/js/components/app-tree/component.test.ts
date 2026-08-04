// ===== app-tree 组件级测试（G-1 首个 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子 + 交互路径（多选 / 连点防重入），
// 不绑定 CSS 类/文案；状态经 data.ts 的 selectState 查询。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor } from "../../test-utils/index.ts";
import { selectState } from "./data.ts";
import { ToggleModelEnable } from "../../../bindings/ysm-model-manager/internal/app/app.js";
import "./index.ts"; // 注册 app-tree 自定义元素（constructor 里 attachShadow）

// jsdom 缺 ResizeObserver（render 虚拟滚动依赖）——空实现防 _renderTree 抛错
class MockResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;

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
      return async () => ({
        repoRoot: "/repo",
        entries: [
          { name: "a.ysm", path: "a.ysm", fullPath: "/repo/a.ysm", type: "ysm", banned: false, size: 1 },
          { name: "b.ysm", path: "b.ysm", fullPath: "/repo/b.ysm", type: "ysm", banned: false, size: 2 },
        ],
      });
    }
    return undefined;
  },
}));

async function mountTree(): Promise<HTMLElement> {
  const el = document.createElement("app-tree");
  document.body.appendChild(el);
  // 等 connectedCallback 的 _load + _renderTree 完成（树行渲染出）
  await waitFor(() => getAllByTestId(el.shadowRoot!, "tree-file").length > 0);
  return el;
}

function clickRow(el: HTMLElement, idx: number, opts: { ctrl?: boolean } = {}): void {
  const rows = getAllByTestId(el.shadowRoot!, "tree-file");
  const row = rows[idx];
  row.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: !!opts.ctrl, metaKey: !!opts.ctrl }));
}

describe("app-tree 组件（testid 钩子）", () => {
  beforeEach(() => {
    selectState.keys.clear();
    selectState.lastKey = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.querySelectorAll("app-tree").forEach((el) => el.remove());
  });

  it("渲染后文件行带 tree-file testid 且多选路径生效（Ctrl 连选）", async () => {
    const el = await mountTree();
    const rows = getAllByTestId(el.shadowRoot!, "tree-file");
    expect(rows.length).toBe(2);

    // 单击第一行 → 选中 1 个
    clickRow(el, 0);
    expect(selectState.keys.size).toBe(1);

    // Ctrl+单击第二行 → 多选 2 个
    clickRow(el, 1, { ctrl: true });
    expect(selectState.keys.size).toBe(2);
  });

  it("连点文件开关防重入：_toggleBusy 守卫下 ToggleModelEnable 只调一次", async () => {
    const el = await mountTree();
    const toggle = getByTestId(el.shadowRoot!, "tree-toggle");
    expect(toggle).not.toBeNull();

    toggle!.click();
    toggle!.click(); // 第二次被 _toggleBusy 拦截
    expect(ToggleModelEnable).toHaveBeenCalledTimes(1);
    // 等待异步完成复位（finally 置 _toggleBusy=false）
    await waitFor(() => (ToggleModelEnable as ReturnType<typeof vi.fn>).mock.calls.length > 0);
  });
});
