// ===== sidebar 卡片事件绑定测试 =====
// 覆盖：list 复用（renderVersionCards 只清 innerHTML 不替换 #vg）时，
// 旧 handler 闭包仍读到最新 instances（P2 数据陈旧回归）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
}));

vi.mock("../../bus.ts", () => ({ bus: { emit: emitMock, on: vi.fn() } }));
vi.mock("./tpl.ts", () => ({
  vcHeaderHTML: () => '<div class="vc-header"><div class="name"></div></div>',
}));

import { bindCardEvents, resetSelectedEmit } from "./events.ts";
import { renderVersionCards } from "./render.ts";
import type { SidebarInstance } from "./data.ts";

function instance(name: string): SidebarInstance {
  return {
    name,
    dir: "/mc/instances/" + name,
    exists: true,
    hasMod: true,
    status: "complete",
    synced: 1,
    missing: 0,
    extra: 0,
    disabled: 0,
    rtype: "ysm",
    variantGroups: null,
    _missingPaths: [],
    _extraPaths: [],
    items: { synced: [] },
  };
}

function mount(instances: SidebarInstance[]) {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<div class="list" id="vg"></div>';
  const container = root.getElementById("vg")!;
  renderVersionCards(container, instances);
  const cleanup = bindCardEvents(root, instances);
  return { root, container, cleanup };
}

beforeEach(() => {
  emitMock.mockClear();
  localStorage.clear();
  resetSelectedEmit(); // 隔离模块级 _lastEmittedPkg 状态（P3 补测：去重状态机跨用例不串）
});

describe("bindCardEvents — list 复用数据陈旧回归（P2）", () => {
  it("reload 后 #vg 未替换时点击仍用最新 instances", () => {
    const A = [instance("A1"), instance("A2")];
    const { container } = mount(A);

    // 首次点击 → 用 A 数据
    (container.querySelector(".vc-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", A[0]);

    // 模拟 _reload：同一容器重渲染（#vg 元素不变）+ 重新绑定（走 list 复用早退分支）
    const B = [instance("B1"), instance("B2")];
    renderVersionCards(container, B);
    bindCardEvents(container.getRootNode() as ShadowRoot, B);

    // 修复前：旧闭包捕获首次的 A 数组 → 点击 emit A[0]（陈旧）；
    // 修复后：currentInstances 已更新为 B → emit B[0]
    (container.querySelector(".vc-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", B[0]);
  });
});

// P3 补测（code_review）：_lastEmittedPkg 去重状态机——该逻辑已两次回归
// （每次 reload 重发 / 每次 reload 复位致去重恒真失效），此前零测试覆盖。
// 现契约：同实例 reload 不重发、resetSelectedEmit（disconnectedCallback）后新挂载重发、
// rtype 切换（emitKey 含 rtype）重发。
describe("restoreSelectedCard 去重状态机（P2 复核修复回归护栏）", () => {
  // restoreSelectedCard 的 emit 在 requestAnimationFrame 回调中延迟执行——
  // 断言前必须先 flush rAF，否则 emit 尚未发生
  const flushRaf = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function mountWithSavedSelection(name: string) {
    localStorage.setItem("sb_selectedName_ysm", name);
    return mount([instance(name), instance("Other")]);
  }

  it("同实例 reload（list 替换重绑）不重复 emit package:selected", async () => {
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    // 模拟 _reload：同一组件重绑（cleanup 已置空 _lastList → 走 list 替换分支）
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1); // 去重跨 reload 生效：不得再次 emit
  });

  it("resetSelectedEmit（disconnectedCallback 语义）后新挂载重新 emit", async () => {
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    resetSelectedEmit(); // 模拟组件卸载
    mountWithSavedSelection("A1");
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(2); // 新挂载会话重新 emit
  });

  it("rtype 切换（不同 emitKey）重新 emit", async () => {
    localStorage.setItem("sb_selectedName_ysm", "A1");
    mount([instance("A1")]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(1);

    // 切到另一 rtype：savedName key 不同 → emitKey 不同 → 重发
    localStorage.setItem("sb_selectedName_resourcepack", "RP1");
    const rp = instance("RP1");
    rp.rtype = "resourcepack";
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="list" id="vg"></div>';
    const container = root.getElementById("vg")!;
    renderVersionCards(container, [rp]);
    bindCardEvents(root, [rp]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(2);
    void container;
  });
});
