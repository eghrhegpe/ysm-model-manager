// ===== sidebar 卡片事件绑定测试 =====
// 覆盖：list 复用（renderVersionCards 只清 innerHTML 不替换 #sidebar-instance-list）时，
// 旧 handler 闭包仍读到最新 instances（P2 数据陈旧回归）
import { describe, it, expect, vi, beforeEach } from "vitest";

const { emitMock, runMcSearchMock, runLauncherDetectMock, currentRepoTypeMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  runMcSearchMock: vi.fn(),
  runLauncherDetectMock: vi.fn(),
  currentRepoTypeMock: vi.fn(() => "ysm"),
}));

vi.mock("../../bus.ts", () => ({ bus: { emit: emitMock, on: vi.fn() } }));
// 2026-08-29 覆盖率补强：mc-search / launcher-detect 按钮路径 + restore 兜底可注入
vi.mock("./launcher-detect.ts", () => ({
  runMcSearch: runMcSearchMock,
  runLauncherDetect: runLauncherDetectMock,
}));
vi.mock("../../features/repo-rtype.ts", () => ({ currentRepoType: currentRepoTypeMock }));
vi.mock("./tpl.ts", () => ({
  instanceCardHeaderHTML: () => '<div class="instance-card-header"><div class="name"></div></div>',
}));
// bindFooter 的 btn-mc 检测走 getApp → 动态 import bindings：mock 阻断
// Wails runtime（getApp 在 node/jsdom 下 window.go 不存在 → 走动态 import 路径）
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc", filesRoot: "", resourcepackRoot: "", linkMode: "copy" }),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
}));

import { bindCardEvents, bindFooter, resetSelectedEmit } from "./events.ts";
import { renderVersionCards } from "./render.ts";
import { waitFor } from "../../test-utils/index.ts";
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
  root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
  const container = root.getElementById("sidebar-instance-list")!;
  renderVersionCards(container, instances);
  const cleanup = bindCardEvents(root, instances);
  return { root, container, cleanup };
}

beforeEach(() => {
  emitMock.mockClear();
  runMcSearchMock.mockClear();
  runLauncherDetectMock.mockClear();
  currentRepoTypeMock.mockReturnValue("ysm");
  localStorage.clear();
  resetSelectedEmit(); // 隔离模块级 _lastEmittedPkg 状态（P3 补测：去重状态机跨用例不串）
});

describe("bindCardEvents — list 复用数据陈旧回归（P2）", () => {
  it("reload 后 #sidebar-instance-list 未替换时点击仍用最新 instances", () => {
    const A = [instance("A1"), instance("A2")];
    const { container } = mount(A);

    // 首次点击 → 用 A 数据
    (container.querySelector(".instance-card-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", A[0]);

    // 模拟 _reload：同一容器重渲染（#sidebar-instance-list 元素不变）+ 重新绑定（走 list 复用早退分支）
    const B = [instance("B1"), instance("B2")];
    renderVersionCards(container, B);
    bindCardEvents(container.getRootNode() as ShadowRoot, B);

    // 修复前：旧闭包捕获首次的 A 数组 → 点击 emit A[0]（陈旧）；
    // 修复后：currentInstances 已更新为 B → emit B[0]
    (container.querySelector(".instance-card-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", B[0]);
  });

  // P1 修复回归护栏（b4e00a6d）：点击空 rtype 实例 → 拦截并 toast，不 emit package:selected。
  // 此前静默兜底成 YSM，MMD 实例 rtype 漏传时右侧同步面板 default-type 错成 YSM。
  it("点击无 rtype 实例 → 不 emit package:selected，emit toast 报错", () => {
    const noRtype = { ...instance("X1"), rtype: "" };
    const { container } = mount([noRtype]);

    (container.querySelector(".instance-card-header") as HTMLElement).click();

    const pkgCalls = emitMock.mock.calls.filter(([evt]) => evt === "package:selected");
    expect(pkgCalls).toHaveLength(0); // 空 rtype 被拦截，不派发
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error" }),
    );
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

  // P2-1 补测：点击路径的去重状态机同步——点击卡片后若触发 reload，
  // restoreSelectedCard 不得再次 emit（修复前点击不更新 _lastEmittedPkg，
  // reload 读到 localStorage 恢复选中 → 去重恒真失效 → 重发 package:selected）
  it("点击卡片后 reload 不重复 emit（P2-1 点击路径同步去重状态）", async () => {
    const { container } = mount([instance("B1"), instance("B2")]);
    // 点击卡片 → emit 一次 + localStorage 记录
    (container.querySelectorAll(".instance-card-header")[0] as HTMLElement).click();
    expect(emitMock).toHaveBeenCalledTimes(1);
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", instance("B1"));

    // 模拟点击触发的 reload：新绑定走 restoreSelectedCard 恢复选中（localStorage 有 B1）
    mount([instance("B1"), instance("B2")]);
    await flushRaf();
    // 修复前：reload 后 restoreSelectedCard 再次 emit（共 2 次）；修复后：点击已同步去重状态 → 仍 1 次
    expect(emitMock).toHaveBeenCalledTimes(1);
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
    root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
    const container = root.getElementById("sidebar-instance-list")!;
    renderVersionCards(container, [rp]);
    bindCardEvents(root, [rp]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledTimes(2);
    void container;
  });
});

// P3 补测（审核）：原绑定状态为模块级共享变量（_lastList/_clickHandler/currentInstances），
// 多实例并存时 A 重绑会移除 B 的监听、点击数据被 B 覆盖（幽灵状态）。修复后状态收敛到
// 每 ShadowRoot 的 WeakMap，实例间互不干扰。
describe("bindCardEvents — 多实例并存互不干扰（模块级状态收敛回归）", () => {
  it("A 重绑不移除 B 的监听，B 点击仍 emit 自己的数据", () => {
    const A = mount([instance("A1")]);
    const B = mount([instance("B1")]);
    // 模拟 A 的 _reload：同一容器重渲染 + 重新绑定
    renderVersionCards(A.container, [instance("A2")]);
    bindCardEvents(A.container.getRootNode() as ShadowRoot, [instance("A2")]);
    // B 的监听必须仍然有效，且点击读到的是 B 的实例数据
    (B.container.querySelector(".instance-card-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", instance("B1"));
  });
});

// P4 补测（审核）：bindFooter（底部统计 + MC 根目录检测）此前零测试覆盖
describe("bindFooter", () => {
  function mountFooter() {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="footer-stats"><span class="stat-item" id="stat-sync">完全同步 -/-</span></div>' +
      '<button class="btn-mc-dir" id="btn-mc">🎮 未设置</button>';
    return { root };
  }

  it("部分同步 → stat-sync 显示 synced/total", () => {
    const { root } = mountFooter();
    const partial = instance("A");
    partial.missing = 1;
    const full = instance("B");
    bindFooter(root, [partial, full]);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 1/2");
  });

  it("全部同步 → stat-sync 显示 total/total", () => {
    const { root } = mountFooter();
    bindFooter(root, [instance("A"), instance("B")]);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 2/2");
  });

  it("空实例 → stat-sync 保持占位不动（不写 -/-）", () => {
    const { root } = mountFooter();
    bindFooter(root, []);
    expect(root.getElementById("stat-sync")!.textContent).toBe("完全同步 -/-");
  });

  it("mcRoot 已配置 → 按钮显示路径", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      mcRoot: "/mc/root",
      filesRoot: "/f",
      resourcepackRoot: "/r",
      linkMode: "copy",
    });
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() =>
      expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 /mc/root"),
    );
  });

  it("未配置且无检测路径 → 按钮保持未设置", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ mcRoot: "" });
    (app.GetMinecraftPaths as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() => expect(app.GetMinecraftPaths).toHaveBeenCalled());
    expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 未设置");
  });

  it("未配置但有检测路径 → 自动使用第一个路径并保存配置", async () => {
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      mcRoot: "",
      filesRoot: "/f",
      resourcepackRoot: "/r",
      linkMode: "copy",
    });
    (app.GetMinecraftPaths as ReturnType<typeof vi.fn>).mockResolvedValue(["/detected"]);
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(() =>
      expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 /detected"),
    );
    expect(app.SaveAppConfig).toHaveBeenCalled();
  });

  it("btn-mc 点击 → nav:changed 跳设置页", () => {
    const { root } = mountFooter();
    bindFooter(root, []);
    (root.getElementById("btn-mc") as HTMLElement).click();
    expect(emitMock).toHaveBeenCalledWith("nav:changed", { page: "settings" });
  });

  it("MC 检测链路拒绝（LoadAppConfig reject）→ 按钮「未设置」+ console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = await import("../../../bindings/ysm-model-manager/internal/app/app.js");
    (app.LoadAppConfig as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("cfg down"));
    const { root } = mountFooter();
    bindFooter(root, []);
    await waitFor(
      () => expect((root.getElementById("btn-mc") as HTMLElement).textContent).toBe("🎮 未设置"),
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ===== 覆盖率补强：点击早退 / 右键菜单 / 绑定生命周期 / restore 兜底 =====
describe("bindCardEvents — 点击早退分支（P1/P2 闭包内的守卫）", () => {
  it("点击 [data-sidebar-mc-search] → runMcSearch 且不选中", () => {
    const { container } = mount([instance("A1")]);
    const btn = document.createElement("button");
    btn.setAttribute("data-sidebar-mc-search", "");
    container.appendChild(btn);
    btn.click();
    expect(runMcSearchMock).toHaveBeenCalledTimes(1);
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
  });

  it("点击 [data-sidebar-launcher-detect] → runLauncherDetect", () => {
    const { container } = mount([instance("A1")]);
    const btn = document.createElement("button");
    btn.setAttribute("data-sidebar-launcher-detect", "");
    container.appendChild(btn);
    btn.click();
    expect(runLauncherDetectMock).toHaveBeenCalledTimes(1);
  });

  it("点击卡片内普通 button / chk → 早退不选中", () => {
    const { container } = mount([instance("A1")]);
    const card = container.querySelector(".instance-card") as HTMLElement;
    const plain = document.createElement("button");
    card.appendChild(plain);
    plain.click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());

    const chk = document.createElement("div");
    chk.className = "chk";
    card.appendChild(chk);
    chk.click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
  });

  it("点击列表空白（无卡片）/ 卡片无 header → 早退", () => {
    const { container, root } = mount([instance("A1")]);
    (container as HTMLElement).click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());

    // 无 header 卡片：手工构造 DOM
    const host2 = document.createElement("div");
    const root2 = host2.attachShadow({ mode: "open" });
    root2.innerHTML =
      '<div class="list" id="sidebar-instance-list">' +
      '<div class="instance-card" data-idx="0"></div></div>';
    bindCardEvents(root2, [instance("A1")]);
    (root2.querySelector(".instance-card") as HTMLElement).click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
    void root;
  });

  it("涟漪：点击 header 加 active+ripple，500ms 后 ripple 移除", async () => {
    const { container } = mount([instance("A1")]);
    const hdr = container.querySelector(".instance-card-header") as HTMLElement;
    hdr.click();
    expect(hdr.classList.contains("active")).toBe(true);
    expect(hdr.classList.contains("ripple")).toBe(true);
    await new Promise((r) => setTimeout(r, 560));
    expect(hdr.classList.contains("ripple")).toBe(false);
    expect(hdr.classList.contains("active")).toBe(true); // active 不随涟漪消失
  });
});

describe("bindCardEvents — 右键菜单（ctx:show）", () => {
  function ctxEvent(): MouseEvent {
    return new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 11,
      clientY: 22,
    });
  }

  it("右键卡片 → preventDefault + ctx:show payload（name 剥 📦 / subdir 读 storage）", () => {
    localStorage.setItem("repo_subdir", " subdirA ");
    const pkg = instance("A1");
    const { container } = mount([pkg]);
    const hdr = container.querySelector(".instance-card-header") as HTMLElement;
    (hdr.querySelector(".name") as HTMLElement).textContent = "📦 A1";
    const ev = ctxEvent();
    (container.querySelector(".instance-card") as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(emitMock).toHaveBeenCalledWith(
      "ctx:show",
      expect.objectContaining({
        x: 11,
        y: 22,
        type: "instance",
        instanceName: "A1",
        path: "/mc/instances/A1",
        rtype: "ysm",
      }),
    );
  });

  it("右键无 rtype 实例 → toastEmptyRtype 拦截，不 emit ctx:show", () => {
    const noRtype = { ...instance("X1"), rtype: "" };
    const { container } = mount([noRtype]);
    const ev = ctxEvent();
    (container.querySelector(".instance-card") as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error" }),
    );
    expect(emitMock).not.toHaveBeenCalledWith("ctx:show", expect.anything());
  });

  it("右键无 dir 实例 → missingPath toast，不 emit ctx:show", () => {
    const noDir = { ...instance("Y1"), dir: "" };
    const { container } = mount([noDir]);
    const ev = ctxEvent();
    (container.querySelector(".instance-card") as HTMLElement).dispatchEvent(ev);
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error" }),
    );
    expect(emitMock).not.toHaveBeenCalledWith("ctx:show", expect.anything());
  });

  it("右键非卡片区域 / idx 越界 → 无 emit 不拦截", () => {
    const { container } = mount([instance("A1")]);
    const evList = ctxEvent();
    (container as HTMLElement).dispatchEvent(evList);
    expect(evList.defaultPrevented).toBe(false);
    expect(emitMock).not.toHaveBeenCalledWith("ctx:show", expect.anything());
  });
});

describe("bindCardEvents — 绑定生命周期", () => {
  it("绑定前先清残留 .instance-card-context-menu", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="list" id="sidebar-instance-list"></div>' +
      '<div class="instance-card-context-menu">stale</div>';
    bindCardEvents(root, []);
    expect(root.querySelector(".instance-card-context-menu")).toBeNull();
  });

  it("root 无 #sidebar-instance-list → 返回 noop cleanup", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<div></div>";
    const cleanup = bindCardEvents(root, []);
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });

  it("cleanup 后点击失效；重复 cleanup 安全", () => {
    const { container, cleanup } = mount([instance("A1")]);
    cleanup();
    (container.querySelector(".instance-card-header") as HTMLElement).click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
    expect(() => cleanup()).not.toThrow();
  });

  it("list 元素被替换后重绑 → 旧 list 监听移除、新 list 生效", () => {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
    const oldList = root.getElementById("sidebar-instance-list")!;
    bindCardEvents(root, [instance("A1")]);

    // 模拟 list 整体替换（innerHTML 重建）
    root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
    const newList = root.getElementById("sidebar-instance-list")!;
    bindCardEvents(root, [instance("B1")]);

    // 旧 list（已脱离 DOM）点击 → 无 emit（监听已移除）
    const hdrOld = document.createElement("div");
    hdrOld.className = "instance-card-header";
    const cardOld = document.createElement("div");
    cardOld.className = "instance-card";
    cardOld.dataset.idx = "0";
    cardOld.appendChild(hdrOld);
    oldList.appendChild(cardOld);
    hdrOld.click();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());

    // 新 list 正常选中
    renderVersionCards(newList, [instance("B1")]);
    (newList.querySelector(".instance-card-header") as HTMLElement).click();
    expect(emitMock).toHaveBeenLastCalledWith("package:selected", instance("B1"));
  });
});

describe("restoreSelectedCard 兜底分支", () => {
  const flushRaf = (): Promise<void> =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  it("保存名有实例但渲染卡片缺失（idx 越界于 DOM）→ 不高亮不 emit", async () => {
    localStorage.setItem("sb_selectedName_ysm", "B1");
    // 渲染只放 A1 的卡片，instances 却含 B1 → idx=1 找不到 card
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
    const container = root.getElementById("sidebar-instance-list")!;
    renderVersionCards(container, [instance("A1")]);
    bindCardEvents(root, [instance("A1"), instance("B1")]);
    await flushRaf();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
  });

  it("恢复卡片无 header → rAF 内兜底 return", async () => {
    localStorage.setItem("sb_selectedName_ysm", "A1");
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<div class="list" id="sidebar-instance-list">' +
      '<div class="instance-card" data-idx="0"></div></div>';
    bindCardEvents(root, [instance("A1")]);
    await flushRaf();
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
  });

  it("保存实例无 rtype → toastEmptyRtype + 去重位记录（后续 reload 不再 toast）", async () => {
    localStorage.setItem("sb_selectedName_ysm", "X1");
    const noRtype = { ...instance("X1"), rtype: "" };
    mount([noRtype]);
    await flushRaf();
    expect(emitMock).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error" }),
    );
    expect(emitMock).not.toHaveBeenCalledWith("package:selected", expect.anything());
    // reload：emitKey 已记录 → 不再 toast
    emitMock.mockClear();
    mount([{ ...instance("X1"), rtype: "" }]);
    await flushRaf();
    expect(emitMock).not.toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "error" }),
    );
  });

  it("instances 空且 currentRepoType 抛错 → console.warn 兜底不炸", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    currentRepoTypeMock.mockImplementationOnce(() => {
      throw new Error("repo state broken");
    });
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<div class="list" id="sidebar-instance-list"></div>';
    expect(() => bindCardEvents(root, [])).not.toThrow();
    await flushRaf();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
