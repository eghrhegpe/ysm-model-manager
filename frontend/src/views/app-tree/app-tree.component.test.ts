// ===== app-tree 组件编排测试（组件级测试样板 2）=====
// 生命周期：connectedCallback 订阅 → disconnectedCallback 清理（bus 配对）
// 验证：mount 渲染树容器 / tree:reload 经 registry 触发重载 / disconnected 后 emit 不再触发
// 注：bus-handlers 的 reload 走 registry.get("loadEntries")（index.ts 的 _load 直接 import），
// 测试注册 registry spy 验证 bus 订阅生效
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock bindings（静态 import 全导出），阻断 Wails runtime 加载链
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ToggleEnable: vi.fn().mockResolvedValue(undefined),
  SelectDirectory: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  RenameFile: vi.fn().mockResolvedValue(undefined),
  ScanModelEntries: vi.fn().mockResolvedValue([]),
  ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
  IsFileBanned: vi.fn().mockResolvedValue(false),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  SyncCustomToRepo: vi.fn().mockResolvedValue(undefined),
}));

// registry.ts 已删（架构锐评 P1-2 修正版）：组件测试改标准 vi.mock 注入，
// importOriginal 保真包装真实 loader（替代原 register 运行时替身注入）
vi.mock("./loader.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./loader.ts")>();
  return { ...mod, loadEntries: vi.fn(mod.loadEntries) };
});

import { bus } from "@/bus";
import { loadEntries } from "./loader.ts";
import "./index.ts"; // 触发 customElements.define("app-tree")
import { sleep, waitFor } from "@/test-utils/wait.ts";
import { mountCustomElement, unmountElement } from "@/test-utils/render.ts";

describe("app-tree 生命周期配对", () => {
  let loadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
    // bus-handlers 的 reload 走 loader.loadEntries——vi.mock 注入 spy 验证触发
    loadSpy = vi.mocked(loadEntries);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染树容器（#tree 存在，生命周期跑通）", async () => {
    const el = mountCustomElement("app-tree");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    expect(el.shadowRoot?.querySelector("#tree")).not.toBeNull();
    unmountElement(el);
  });

  it("tree:reload → 触发 registry loadEntries（bus 订阅生效）", async () => {
    const el = mountCustomElement("app-tree");
    await sleep(150);
    loadSpy.mockClear();
    bus.emit("tree:reload");
    await sleep(150);
    expect(loadSpy).toHaveBeenCalled(); // bus-handlers reload(vm) → get("loadEntries")
    unmountElement(el);
  });

  it("disconnected → 订阅清理（tree:reload 不再触发 loadEntries）", async () => {
    const el = mountCustomElement("app-tree");
    await sleep(150);
    unmountElement(el);
    loadSpy.mockClear();
    bus.emit("tree:reload");
    await sleep(150);
    expect(loadSpy).not.toHaveBeenCalled(); // 订阅已随 disconnectedCallback 清理
  });

  it("重连 → 滚动位置与搜索词恢复（ADR-163「滚动位置跨页保留」承诺补齐）", async () => {
    // 条目带 abc 前缀：搜索过滤后仍有内容，滚动位置恢复不被空态清零
    loadSpy.mockResolvedValue({
      filesRoot: "/repo",
      entries: Array.from({ length: 5 }, (_, i) => ({
        name: `abc_model_${i}.ysm`,
        path: `abc_model_${i}.ysm`,
        fullPath: `/repo/abc_model_${i}.ysm`,
        size: 1024,
        modTime: 0,
        banned: false,
        type: "ysm",
      })),
    });
    const el = mountCustomElement("app-tree");
    await waitFor(() => el.shadowRoot?.getElementById("tree") !== null);
    await sleep(100); // 等 _load + _renderTree 落定
    // 制造视觉状态：搜索词经 input 事件同步入 state（setSearch 同步，防抖只管重渲染）
    const srch = el.shadowRoot?.getElementById("srch") as HTMLInputElement;
    srch.value = "abc";
    srch.dispatchEvent(new Event("input", { bubbles: true }));
    // 滚动快照：程序化 set scrollTop 不派发 scroll 事件（真实浏览器/测试同口径需真实滚动流），
    // 手动 dispatch 模拟；快照监听在 connectedCallback 注册、随断连退订
    const tree = el.shadowRoot?.getElementById("tree") as HTMLElement;
    tree.scrollTop = 120;
    tree.dispatchEvent(new Event("scroll"));
    // 断开重连（模拟切页往返的面板 detach/attach）
    el.remove();
    document.body.appendChild(el);
    await waitFor(() => el.shadowRoot?.getElementById("tree") !== null); // 重挂完成
    await sleep(150); // 等 _load + _renderTree + 恢复
    expect((el.shadowRoot?.getElementById("srch") as HTMLInputElement).value).toBe("abc");
    expect(el.shadowRoot?.getElementById("tree")?.scrollTop).toBe(120);
    unmountElement(el);
  });
});
