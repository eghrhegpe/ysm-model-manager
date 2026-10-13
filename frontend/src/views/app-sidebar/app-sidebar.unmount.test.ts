// ===== app-sidebar 卸载期在途请求回归锁 =====
//
// 病理（2026-10 锐评）：`_reload()` 在 `await loadInstances(...)` 挂起期间组件被卸载，
// await 返回后仍继续走 `_renderCards()` + `bindFooter()`——给**已卸载**的 shadow root
// 重渲染卡片并重绑事件委托（含列表 click/contextmenu 监听与去重状态机）。
//
// 根因：本组件的 `_guard`（代际守卫，ADR-230 全仓唯一出口）**从未接上 `invalidate()`**。
// `disconnectedCallback` 复位了单飞锁 `_reloadInFlight`，但没作废代数，于是 `stale(gen)`
// 恒 false，守卫形同虚设。同仓消费者 `app-tree`（cleanup 调 `_guard.invalidate()`）、
// `app-sync-manager`（同）都接上了——唯独本组件漏接。
//
// 本文件锁：卸载后在途结果必须被丢弃（不重渲染、不重绑、不 emit）。
// 依赖：bindings 经 mock 阻断 Wails runtime（同 app-sidebar.component.test.ts 样板）；
// loader 用可控 deferred 精确构造「在途时卸载」时序。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { emitMock, onMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  onMock: vi.fn(() => () => {}),
}));

vi.mock("@/bus", () => ({ bus: { emit: emitMock, on: onMock } }));
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc" }),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
}));

const { loadInstancesMock } = vi.hoisted(() => ({
  loadInstancesMock: vi.fn(),
}));
vi.mock("./loader.ts", () => ({ loadInstances: loadInstancesMock }));

import { mountCustomElement, unmountElement } from "@/test-utils/render.ts";
// 触发 customElements.define("app-sidebar")——必须在 mock 之后 import
import "./index.ts";
import type { SidebarInstance } from "./data.ts";

/** 自建 deferred：精确控制 loadInstances 何时落地（构造「在途时卸载」时序） */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 造一个全字段实例（避免半成品 cast——字段缺失会让 render 分支走偏，锁失焦） */
function instance(name: string): SidebarInstance {
  return {
    name,
    dir: `/mc/${name}`,
    exists: true,
    hasMod: false,
    status: "complete",
    synced: 0,
    missing: 0,
    extra: 0,
    disabled: 0,
    rtype: "ysm",
  };
}

describe("app-sidebar 卸载期在途请求", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    emitMock.mockClear();
    loadInstancesMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("在途时卸载 → 迟到结果被丢弃（不重渲染卡片）", async () => {
    const d = deferred<SidebarInstance[]>();
    loadInstancesMock.mockReturnValueOnce(d.promise);

    const el = mountCustomElement("app-sidebar") as HTMLElement;
    // connectedCallback 末尾 setTimeout(_reload, 50)——等它真正进入在途
    await vi.waitFor(() => expect(loadInstancesMock).toHaveBeenCalled());

    const root = el.shadowRoot!;
    // 卸载发生在 await 挂起期间（此刻 _reload 尚未落地）
    unmountElement(el);
    expect(el.isConnected).toBe(false);

    // 迟到结果落地：投喂两个实例
    d.resolve([instance("A"), instance("B")]);
    // 给微任务队列留出排空时间（含 rAF）
    await new Promise((r) => setTimeout(r, 30));

    // 病理（先红）：无守卫时这里会渲染出 2 张卡片
    expect(root.querySelectorAll(".instance-card").length).toBe(0);
  });

  it("在途时卸载 → 迟到结果不写底部统计", async () => {
    const d = deferred<SidebarInstance[]>();
    loadInstancesMock.mockReturnValueOnce(d.promise);

    const el = mountCustomElement("app-sidebar") as HTMLElement;
    await vi.waitFor(() => expect(loadInstancesMock).toHaveBeenCalled());
    const root = el.shadowRoot!;
    const statBefore = root.getElementById("stat-sync")?.textContent ?? "";
    unmountElement(el);

    d.resolve([instance("A")]);
    await new Promise((r) => setTimeout(r, 30));

    // 病理（先红）：bindFooter 会在已卸载的 root 上改文案
    expect(root.getElementById("stat-sync")?.textContent ?? "").toBe(statBefore);
  });
});
