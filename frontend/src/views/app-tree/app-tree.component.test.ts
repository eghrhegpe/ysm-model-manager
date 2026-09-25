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
  // 属性变更重载链（mountTree 复用主路径）的必经口：vitest mock 对未定义导出的
  // 属性访问直接抛错，缺它会让 _attrChangeReloadAsync 在 _load 前中断（假绿/假红）
  ClearScanCache: vi.fn().mockResolvedValue(undefined),
}));

// registry.ts 已删（架构锐评 P1-2 修正版）：组件测试改标准 vi.mock 注入，
// importOriginal 保真包装真实 loader（替代原 register 运行时替身注入）
vi.mock("./loader.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./loader.ts")>();
  return { ...mod, loadEntries: vi.fn(mod.loadEntries) };
});

import { bus } from "@/bus";
import { loadEntries, type TreeEntry } from "./loader.ts";
import type { AppTree } from "./index.ts";
import { setPendingTreeSearch, takePendingTreeSearch } from "@/utils/dom/search-pending.ts";
import { createTreeRenderCtx, updateStat } from "./render.ts";
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

describe("updateStat 计数动画（2026-09 收债：先读后写 data-total）", () => {
  const mkEntry = (p: string): TreeEntry => ({
    name: p,
    path: p,
    fullPath: `/repo/${p}`,
    size: 0,
    modTime: 0,
    banned: false,
    type: "",
  });

  it("total 变化 → 动画接管（旧实现写后再读恒等，动画永不触发）", async () => {
    const ctx = createTreeRenderCtx();
    const el = document.createElement("span");
    // 首帧：无旧值（oldTotal=0）→ 直接落文本
    updateStat(ctx, el, [mkEntry("a"), mkEntry("b")]);
    expect(el.textContent).toContain("共 2 项");
    expect(el.dataset.total).toBe("2");
    // 二帧 total 变化：动画句柄登记、终值文案延迟落位
    updateStat(ctx, el, [mkEntry("a"), mkEntry("b"), mkEntry("c"), mkEntry("d"), mkEntry("e")]);
    expect(el.dataset.total).toBe("5");
    expect(ctx.statAnim.has(el), "total 变化应走 animateNumber 分支").toBe(true);
    await sleep(800); // 动画(700ms)结束后 updateStat 落终值文案
    expect(el.textContent).toContain("共 5 项");
    expect(ctx.statAnim.has(el)).toBe(false);
  });
});

describe("root/subdir 属性变更（mountTree 复用主路径）", () => {
  it("同任务双属性变更合并为一次重载（microtask 合并）", async () => {
    const el = mountCustomElement("app-tree");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(50); // 首挂 _load 落定
    const calls = vi.mocked(loadEntries).mock.calls.length;
    el.setAttribute("root", "MMD");
    el.setAttribute("subdir", "stage");
    await sleep(60); // microtask 合并 + async 重载链
    expect(vi.mocked(loadEntries).mock.calls.length).toBe(calls + 1);
    expect(el.getAttribute("root")).toBe("MMD");
    unmountElement(el);
  });

  it("同值 setAttribute 不触发重载（oldVal === newVal 拦下）", async () => {
    const el = mountCustomElement("app-tree");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(50);
    el.setAttribute("root", "ysm"); // 首次设置：null → "ysm"，真实变更
    await sleep(60);
    const calls = vi.mocked(loadEntries).mock.calls.length;
    el.setAttribute("root", "ysm"); // 同值重放：repo:rtype-changed 重复 emit 的形态
    await sleep(60);
    expect(vi.mocked(loadEntries).mock.calls.length).toBe(calls);
    unmountElement(el);
  });
});


describe("dirOpen 持久化按 rtype 隔离（2026-09 收债）", () => {
  function mountWithRoot(root: string): AppTree {
    const el = document.createElement("app-tree") as unknown as AppTree;
    el.setAttribute("root", root);
    document.body.appendChild(el);
    return el;
  }

  afterEach(() => {
    localStorage.removeItem("dirOpenState");
    document.body.innerHTML = "";
  });

  it("嵌套形态：只恢复当前 rtype 的展开态", async () => {
    localStorage.setItem(
      "dirOpenState",
      JSON.stringify({ ysm: { folderA: true }, mmd: { folderB: true } }),
    );
    const el = mountWithRoot("ysm");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(30);
    expect(el.dirOpen).toEqual({ folderA: true });
    unmountElement(el);
  });

  it("旧平铺形态（跨类型串的祸源）→ 忽略不恢复", async () => {
    localStorage.setItem("dirOpenState", JSON.stringify({ folderA: true }));
    const el = mountWithRoot("ysm");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(30);
    expect(el.dirOpen).toEqual({});
    unmountElement(el);
  });

  it("toggleDir 写回嵌套形态且保留其他 rtype 子集", async () => {
    localStorage.setItem("dirOpenState", JSON.stringify({ mmd: { folderB: true } }));
    const el = mountWithRoot("ysm");
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(30);
    el.toggleDir("x");
    const stored = JSON.parse(localStorage.getItem("dirOpenState") || "{}");
    expect(stored).toEqual({ mmd: { folderB: true }, ysm: { x: true } });
    unmountElement(el);
  });
});


describe("tree:set-search 冷启动 pending（2026-09 收债：search-pending 通道）", () => {
  afterEach(() => {
    setPendingTreeSearch(null);
    document.body.innerHTML = "";
  });

  it("挂载前落 pending → 挂载段消费：搜索框填词 + input 事件派发（app-tree chunk 未加载时 emit 落空的兜底）", async () => {
    setPendingTreeSearch("miko");
    const el = document.createElement("app-tree") as unknown as AppTree;
    document.body.appendChild(el);
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    const srch = el.shadowRoot?.getElementById("srch") as HTMLInputElement;
    expect(srch.value).toBe("miko");
    // take 即清：不残留到未来挂载
    expect(takePendingTreeSearch()).toBe(null);
    unmountElement(el);
  });

  it("listener 命中路径 take 清残：emit 后 pending 不残留", async () => {
    setPendingTreeSearch("stale");
    const el = document.createElement("app-tree") as unknown as AppTree;
    document.body.appendChild(el);
    await waitFor(() => el.shadowRoot?.querySelector("#tree") !== null);
    await sleep(20);
    bus.emit("tree:set-search", "fresh");
    const srch = el.shadowRoot?.getElementById("srch") as HTMLInputElement;
    expect(srch.value).toBe("fresh");
    expect(takePendingTreeSearch()).toBe(null);
    unmountElement(el);
  });
});
