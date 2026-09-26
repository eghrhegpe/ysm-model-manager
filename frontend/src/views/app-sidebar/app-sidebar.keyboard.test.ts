// ===== app-sidebar 键盘操作集成测试（ADR-308 D2 首批）=====
// 整合包卡片 roving tabindex + 方向键导航：卡片上 keydown → 原语合成点击 header →
// 复用 events.ts 点击委托路径（高亮/涟漪/去重/持久化全部走既有 handler，零复制）。
// 本文件锁死三件事：
//  ① 渲染后卡片即 roving listbox（容器 role=listbox、卡片 role=option、唯一 tabindex 0、
//     其余 -1、aria-selected 随迁移）——渲染同步路径落点 syncIndex(0)；
//  ② ArrowDown 从卡片 0 → 焦点/aria 迁到卡片 1 且激活（合成点击经委托 emit package:selected，
//     证明激活没有旁路复制点击语义）；
//  ③ 卸载后 roving dispose（keydown 死寂，不再迁移/发射）。
// 依赖：bindings 经 mock 阻断 Wails runtime（同 app-sidebar.component.test.ts 样板）；
// bus 整模块 mock（同 events.test.ts），package:selected 发射可断言。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { emitMock, onMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  // 组件 _unsubs 存 bus.on 的返回（unsubscribe 闭包）——mock 须返回可调用物，
  // 否则 disconnectedCallback 的 fn() 炸「fn is not a function」
  onMock: vi.fn(() => () => {}),
}));

vi.mock("@/bus", () => ({ bus: { emit: emitMock, on: onMock } }));
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc" }),
  ListVersionInstances: vi.fn().mockResolvedValue([
    { Name: "P1", VersionDir: "/mc/P1", Exists: true },
    { Name: "P2", VersionDir: "/mc/P2", Exists: true },
  ]),
  GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
}));
// 标准 vi.mock 注入（同 app-sidebar.component.test.ts）：importOriginal 保真包装真实 loader，
// 防在途去重表（模块级 _inflight）跨用例残留
vi.mock("./loader.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./loader.ts")>();
  return { ...mod, loadInstances: vi.fn(mod.loadInstances) };
});

import "./index.ts"; // 触发 customElements.define("app-sidebar")
import { waitFor } from "@/test-utils/wait.ts";
import { mountCustomElement, unmountElement } from "@/test-utils/render.ts";

function cards(el: HTMLElement): HTMLElement[] {
  return Array.from(el.shadowRoot!.querySelectorAll<HTMLElement>(".instance-card"));
}

function pkgSelects(): unknown[] {
  return emitMock.mock.calls.filter(([evt]) => evt === "package:selected").map((c) => c[1]);
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear(); // 清 sb_selectedName_* / repo_rtype：restore 路径不干扰，rtype 走默认 ysm
  emitMock.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("app-sidebar 键盘导航（ADR-308 D2）", () => {
  it("渲染后卡片即 roving listbox：容器 role=listbox，active 卡 tabindex=0 其余 -1，aria-selected 跟随", async () => {
    const el = mountCustomElement("app-sidebar");
    await waitFor(() => cards(el).length === 2);
    const [c0, c1] = cards(el);
    expect(el.shadowRoot!.getElementById("sidebar-instance-list")!.getAttribute("role")).toBe(
      "listbox",
    );
    expect(c0.getAttribute("role")).toBe("option");
    expect(c0.tabIndex).toBe(0); // 渲染落点 = 第 0 卡（无保存选中，localStorage 已清）
    expect(c1.tabIndex).toBe(-1);
    expect(c0.getAttribute("aria-selected")).toBe("true");
    expect(c1.getAttribute("aria-selected")).toBe("false");
    unmountElement(el);
  });

  it("ArrowDown 从卡片 0 → 焦点/aria 迁到卡片 1，且经点击委托激活（emit P2 的 package:selected）", async () => {
    const el = mountCustomElement("app-sidebar");
    await waitFor(() => cards(el).length === 2);
    const [c0, c1] = cards(el);
    c0.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    // roving 迁移：tabindex/aria-selected 移格，不抢焦点之外的可见变化（active 高亮由点击路径负责）
    expect(c1.tabIndex).toBe(0);
    expect(c0.tabIndex).toBe(-1);
    expect(c1.getAttribute("aria-selected")).toBe("true");
    // 激活走合成点击 → 点击委托路径发射（证明零复制：发射源是 events.ts 的 click handler）
    const selects = pkgSelects();
    expect(selects).toHaveLength(1);
    expect((selects[0] as { name: string }).name).toBe("P2");
    unmountElement(el);
  });

  it("卸载后 keydown 死寂（roving 已 dispose）：不迁移、不发射", async () => {
    const el = mountCustomElement("app-sidebar");
    await waitFor(() => cards(el).length === 2);
    unmountElement(el);
    const [c0, c1] = cards(el); // 卸载后 shadowRoot 仍可查（元素已离树）
    c0.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    expect(c1.tabIndex).toBe(-1);
    expect(c1.getAttribute("aria-selected")).not.toBe("true");
    expect(pkgSelects()).toHaveLength(0);
  });
});
