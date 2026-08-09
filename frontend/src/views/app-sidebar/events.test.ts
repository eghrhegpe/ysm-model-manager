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

import { bindCardEvents } from "./events.ts";
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
