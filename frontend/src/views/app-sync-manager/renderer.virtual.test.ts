// ===== app-sync-manager 行级虚拟滚动契约测试（2026-10）=====
// 背景：整合包页 MMD 模型上百时，原实现把全部 SyncItem 递归拼串后一次 `innerHTML`
// 注入——DOM 行数 = 条目数 × 展开层级，滚动卡顿/内存膨胀。仓库树 app-tree 早已窗口化，
// 故同一数据量下只有本页出事（用户反馈「一到上百个模型就显示诡异」）。
//
// 本文件锁死窗口化契约：
//   ① DOM 行数由视口决定，与总条目数解耦（百行与千行同量级）；
//   ② padding 撑出滚动总高——末行可达，滚动条长度不失真；
//   ③ 行高按首帧实测校正（尊重用户可调的 --fs-scale，常量会漂）；
//   ④ 骨架幂等 → 二次渲染复用同一 .sm-list，滚动位置不弹回顶部；
//   ⑤ 零高度（jsdom / 首帧未布局）→ 全量渲染降级，不因窗口化而空白。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCustomElement, unmountElement } from "@/test-utils/render.ts";
import { waitFor } from "@/test-utils/wait.ts";
import type { SyncItem } from "./tpl.ts";

const { mocks } = vi.hoisted(() => {
  const mocks = {
    GetInstanceSyncStatus: vi.fn().mockResolvedValue([]),
    PushSingleResourceToInstance: vi.fn().mockResolvedValue(undefined),
    PullSingleResourceFromInstance: vi.fn().mockResolvedValue(undefined),
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
    GetSyncScanDirs: vi.fn().mockResolvedValue({
      global: "/repo",
      instance: "/inst",
      warningCode: "",
    }),
  };
  return { mocks };
});

vi.mock("@/backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    PushSingleResourceToInstance: mocks.PushSingleResourceToInstance,
    PullSingleResourceFromInstance: mocks.PullSingleResourceFromInstance,
    GetRepoRoot: mocks.GetRepoRoot,
    GetSyncScanDirs: mocks.GetSyncScanDirs,
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-sync-manager")

/** 测试用组件私有面（驱动渲染状态；与既有 index.test.ts 同款断言姿势） */
interface SyncSelfProbe extends HTMLElement {
  _selectedType: string;
  _statusFilter: string;
  _typeConfig: Array<{ id: string }>;
  _allItems: SyncItem[];
  _dirOpen: Record<string, boolean>;
  _doRender: () => void;
}

/** 造 n 个顶层扁平文件条目——每条恰好一行，便于精确数行 */
function makeItems(n: number): SyncItem[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `/repo/model-${i}.pmx`,
    name: `model-${i}.pmx`,
    status: "missing",
    type: "ysm",
    icon: "💎",
    size: 1024,
    isDir: false,
  }));
}

/** 等待 n 个 rAF 轮次（installScrollSync 的滚动回调经 rAF 合并） */
async function nextFrames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
}

/** 挂载组件并注入 n 条数据，返回可直接驱动的实例 */
async function mountWith(n: number): Promise<SyncSelfProbe> {
  const el = mountCustomElement<SyncSelfProbe>("app-sync-manager");
  el.setAttribute("instance", "test");
  // 等 _init（loadData → render）落定：状态页签由 render 注入，出现即 _init 完成
  // （否则在途 loadData 会在下方注入私有状态后把 _allItems 覆盖回 mock 空数组）
  await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);
  el._selectedType = "ysm";
  el._statusFilter = "all";
  el._typeConfig = [{ id: "ysm" }];
  el._dirOpen = {};
  el._allItems = makeItems(n);
  el._doRender();
  await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
  return el;
}

function listOf(el: HTMLElement): HTMLElement {
  const listEl = el.querySelector(".sm-list");
  if (!listEl) throw new Error("缺 .sm-list");
  return listEl as HTMLElement;
}

describe("app-sync-manager — 行级虚拟滚动", () => {
  let clientHeightSpy: ReturnType<typeof vi.spyOn>;
  let offsetHeightSpy: ReturnType<typeof vi.spyOn>;
  let scrollTopSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    // happy-dom 无布局引擎：clientHeight / offsetHeight 恒 0 → 会走「零高度全量回退」。
    // 本组用例显式给出视口高度与行高，才能真正验证窗口化本身；
    // 零高度回退另有专门用例（把 clientHeight 改回 0）。
    // 落点：两者是 HTMLElement.prototype 上的访问器（Element.prototype 上没有）。
    clientHeightSpy = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    offsetHeightSpy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(26);
    scrollTopSpy = vi.spyOn(Element.prototype, "scrollTop", "get").mockReturnValue(0);
  });

  afterEach(() => {
    clientHeightSpy.mockRestore();
    offsetHeightSpy.mockRestore();
    scrollTopSpy.mockRestore();
    document.body.innerHTML = "";
  });

  it("① DOM 行数由视口决定，与总条目数解耦（200 行与 2000 行同量级）", async () => {
    const el = await mountWith(200);
    const count200 = el.querySelectorAll(".sm-item").length;
    expect(count200).toBeGreaterThan(0);
    // 视口 300px / 行高 26px + 上下各 15 行缓冲 → 常驻 ≈ 27 行，远小于 200
    expect(count200).toBeLessThan(60);

    // 条目数 ×10：DOM 常驻行数不变（这正是「上百个模型就诡异」的根治点）
    el._allItems = makeItems(2000);
    el._doRender();
    await waitFor(() => el.querySelectorAll(".sm-item").length > 0);
    const count2000 = el.querySelectorAll(".sm-item").length;
    expect(count2000).toBe(count200);

    unmountElement(el);
  });

  it("② padding 撑出滚动总高——末行可达，不因窗口化而截断", async () => {
    const el = await mountWith(200);
    const listEl = listOf(el);
    const rendered = el.querySelectorAll(".sm-item").length;
    // 顶部未滚动 → 无上占位；下方未渲染行全部折算为 paddingBottom
    expect(listEl.style.paddingTop).toBe("0px");
    expect(parseInt(listEl.style.paddingBottom, 10)).toBe((200 - rendered) * 26);
    // 撑高量级正确：总高 ≈ 条目数 × 行高
    expect(parseInt(listEl.style.paddingBottom, 10)).toBeGreaterThan(200 * 26 * 0.8);
    unmountElement(el);
  });

  it("③ 行高按首帧实测校正（常量会与用户 --fs-scale 漂移）", async () => {
    // 模拟用户把字号调大 → 真实行高 40px（CSS calc 随 --fs-scale 缩放）
    offsetHeightSpy.mockReturnValue(40);
    const el = await mountWith(200);
    const listEl = listOf(el);
    const rendered = el.querySelectorAll(".sm-item").length;
    // padding 必须按实测 40px 折算，而非回退常量 26px——否则滚动高度与实际行高漂移
    expect(parseInt(listEl.style.paddingBottom, 10)).toBe((200 - rendered) * 40);
    unmountElement(el);
  });

  it("④ 骨架幂等：二次渲染复用同一 .sm-list（重建即丢滚动位置）", async () => {
    const el = await mountWith(200);
    const listEl = listOf(el);

    // 目录行点击 / 状态筛选切换都走 _doRender → render 同一路径
    el._doRender();

    // 同一元素（原实现每次 render 都 self.innerHTML = containerHTML()，元素被替换 →
    // 新元素 scrollTop 归零，用户停在中段时列表「弹回顶部」）
    expect(listOf(el)).toBe(listEl);
    // 内容确实写进了这个被复用的元素（而非悄悄换了宿主）
    expect(listEl.querySelectorAll(".sm-item").length).toBeGreaterThan(0);
    unmountElement(el);
  });

  it("⑤ 滚动 → 窗口位移（paddingTop 生长，行集合随之切换）", async () => {
    const el = await mountWith(200);
    const listEl = listOf(el);
    const firstBefore = el.querySelector(".sm-item")?.getAttribute("data-path");
    // 滚到第 100 行附近：startIdx = floor(2600/26) - 15 = 85
    scrollTopSpy.mockReturnValue(26 * 100);
    listEl.dispatchEvent(new Event("scroll"));
    await nextFrames(3);

    expect(parseInt(listEl.style.paddingTop, 10)).toBeGreaterThan(0);
    expect(el.querySelector(".sm-item")?.getAttribute("data-path")).not.toBe(firstBefore);
    // 窗口位移后常驻行数仍受视口约束
    expect(el.querySelectorAll(".sm-item").length).toBeLessThan(60);
    unmountElement(el);
  });

  it("⑥ 零高度（jsdom / 首帧未布局）→ 全量渲染降级，不空白", async () => {
    clientHeightSpy.mockReturnValue(0);
    const el = await mountWith(200);
    // 视口未知时无可窗口化：全部行入 DOM（既有测试面与首帧可见性都依赖此降级）
    expect(el.querySelectorAll(".sm-item").length).toBe(200);
    expect(listOf(el).style.paddingTop).toBe("0px");
    unmountElement(el);
  });

  it("⑦ teardown 契约：unmount 后 ResizeObserver disconnect，重挂载不残留旧观察者", async () => {
    const roDisconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    const el = await mountWith(200);
    expect(listOf(el)).toBeTruthy();

    // 卸载：旧 .sm-list 的观察者必须被断开（ResizeObserver 强引用被观察元素，
    // 不断开 = 被丢弃的组件跨 re-init/卸载存活——本次虚拟滚动改造要防的核心回归）
    unmountElement(el);
    expect(roDisconnect).toHaveBeenCalled();

    // 重挂载（instance 属性变化触发 re-init 路径的同款卸载→重建）：新元素新状态，不串
    roDisconnect.mockClear();
    const el2 = await mountWith(50);
    unmountElement(el2);
    expect(roDisconnect).toHaveBeenCalled();
  });

  it("⑧ 零高 rAF 去重：隐藏容器内反复重渲染只排一个待执行 rAF", async () => {
    clientHeightSpy.mockReturnValue(0);
    const rafSpy = vi.spyOn(window, "requestAnimationFrame");
    const el = await mountWith(200);
    const baseline = rafSpy.mock.calls.length;

    // 隐藏容器内（clientHeight 恒 0）连续多次重渲染——若不去重，每次 render 都排一个
    // 新 rAF 全量渲染；去重后新增调度数与渲染次数解耦
    el._doRender();
    await nextFrames(2);
    el._doRender();
    await nextFrames(2);
    const afterTwoRenders = rafSpy.mock.calls.length;
    expect(afterTwoRenders).toBeGreaterThan(baseline);

    // 同一时刻最多一个待执行句柄：渲染后又立刻渲染（rAF 未执行间隙），不叠加
    el._doRender();
    el._doRender();
    el._doRender();
    const pendingBurst = rafSpy.mock.calls.length - afterTwoRenders;
    expect(pendingBurst).toBeLessThanOrEqual(1);
    unmountElement(el);
  });
});
