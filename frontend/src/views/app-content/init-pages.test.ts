// ===== init-pages|bindTabs 契约测试（ADR-259 运行期半边）=====
//
// 背景（2026-09，设置页新增「操作」tab 的真实事故）：
//   `bindTabs` 曾要求调用方手传 `ids` 白名单，它必须与模板里的 tab 按钮一一对应。
//   新增 tab 时若忘了同步该数组，`activate` 遍历的是**白名单而不是 DOM**——
//   新 tab 的面板永远不会被设为可见，于是「按钮在、点了没反应、内容区空白」，且**不报错**。
//   （`app-content.component.test.ts` 留有自白：「曾因漏注册导致 e2e 看不见新 tab 界面」。）
//
// 治本（ADR-259 运行期契约）：真值源 = 按钮自身的 `data-tab`（由 `renderTabs` 工厂保证
// 与面板 id 同源），`bindTabs` 从 DOM 派生，**不再接受白名单**——新增 tab 只改模板一处。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";
import type { AppContentHost } from "./host.ts";
import { bindTabs, initInstancesPage, initRepositoryPage } from "./init-pages.ts";
import { AppContentState } from "./state.ts";
import { SubscriptionBucket } from "./subscription-bucket.ts";

/** 排空 microtask 队列（懒初始化 / activate 均为 async 链） */
async function flushAsyncTurns(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function makeHost(): { host: AppContentHost; root: ShadowRoot } {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = el.attachShadow({ mode: "open" });
  const host: AppContentHost = {
    state: new AppContentState(root, "repository"),
    subs: new SubscriptionBucket(),
  };
  return { host, root };
}

/** 标准 tab 壳（`renderTabs` 产出形状）：三 tab，首个可见、其余 display:none */
const SHELL = `
  <div class="repo-tabs">
    <button class="repo-tab active" data-tab="alpha">A</button>
    <button class="repo-tab" data-tab="beta">B</button>
    <button class="repo-tab" data-tab="gamma">G</button>
  </div>
  <div class="tab-body" id="x-tab-alpha">AAA</div>
  <div class="tab-body" id="x-tab-beta" style="display:none">BBB</div>
  <div class="tab-body" id="x-tab-gamma" style="display:none">GGG</div>`;

async function clickTab(root: ShadowRoot, tab: string): Promise<void> {
  (root.querySelector(`.repo-tab[data-tab="${tab}"]`) as HTMLElement).click();
  await flushAsyncTurns();
}

describe("bindTabs：按钮 data-tab 即唯一真值（ADR-259 运行期契约）", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.replaceChildren();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("新增 tab 只改模板：第三个 tab 无需任何白名单即能切换", async () => {
    const { host, root } = makeHost();
    root.innerHTML = SHELL;
    bindTabs(host, ".repo-tab", "x");

    await clickTab(root, "gamma");
    const gamma = root.getElementById("x-tab-gamma") as HTMLElement;
    expect(gamma.hasAttribute("hidden"), "新 tab 面板应被激活").toBe(false);
    expect(gamma.style.display).not.toBe("none");

    // 互斥：切走后前一面板收起
    const alpha = root.getElementById("x-tab-alpha") as HTMLElement;
    expect(alpha.hasAttribute("hidden")).toBe(true);
    expect(alpha.style.display).toBe("none");
  });

  it("ARIA 注入覆盖全部 DOM 按钮（tablist / role=tab / aria-controls / roving tabindex）", () => {
    const { host, root } = makeHost();
    root.innerHTML = SHELL;
    bindTabs(host, ".repo-tab", "x");

    const tabs = [...root.querySelectorAll<HTMLElement>(".repo-tab")];
    expect(root.querySelector(".repo-tabs")?.getAttribute("role")).toBe("tablist");
    expect(tabs.map((b) => b.getAttribute("role"))).toEqual(["tab", "tab", "tab"]);
    expect(tabs.map((b) => b.getAttribute("aria-controls"))).toEqual([
      "x-tab-alpha",
      "x-tab-beta",
      "x-tab-gamma",
    ]);
    expect(tabs.map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
    expect(root.getElementById("x-tab-gamma")?.getAttribute("role")).toBe("tabpanel");
  });

  it("按钮缺 data-tab → 响亮告警（不静默留下不可切换的 tab）", () => {
    const { host, root } = makeHost();
    root.innerHTML = `
      <div class="repo-tabs">
        <button class="repo-tab active" data-tab="only">O</button>
        <button class="repo-tab">无 data-tab</button>
      </div>
      <div class="tab-body" id="x-tab-only">OOO</div>`;
    bindTabs(host, ".repo-tab", "x");
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("data-tab"))).toBe(true);
  });

  it("面板缺失 → 响亮告警（按钮在但内容区必然空白）", () => {
    const { host, root } = makeHost();
    root.innerHTML = `
      <div class="repo-tabs">
        <button class="repo-tab active" data-tab="alpha">A</button>
        <button class="repo-tab" data-tab="ghost">幽灵</button>
      </div>
      <div class="tab-body" id="x-tab-alpha">AAA</div>`;
    bindTabs(host, ".repo-tab", "x");
    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes("x-tab-ghost"))).toBe(true);
  });

  it("键盘 ArrowRight 自动激活新 tab（roving 覆盖 DOM 全集，非白名单）", async () => {
    const { host, root } = makeHost();
    root.innerHTML = SHELL;
    bindTabs(host, ".repo-tab", "x");

    const beta = root.querySelector('.repo-tab[data-tab="beta"]') as HTMLElement;
    beta.focus();
    beta.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flushAsyncTurns();

    const gamma = root.getElementById("x-tab-gamma") as HTMLElement;
    expect(gamma.hasAttribute("hidden")).toBe(false);
    // 焦点在 shadow 内：查 root.activeElement（document.activeElement 只会是宿主元素）
    expect(root.activeElement).toBe(root.querySelector('.repo-tab[data-tab="gamma"]'));
  });
});

describe("AppContentState 字段归属（ADR-263）", () => {
  function makeState(): AppContentState {
    const el = document.createElement("div");
    document.body.appendChild(el);
    return new AppContentState(el.attachShadow({ mode: "open" }), "repository");
  }

  // teeth：currentSite 曾借宿此容器，而它只服务工坊页——消费者手持整个 AppContentState 时
  // 无法从类型上拒绝越界写入（tabs 就顺手写下了 workshopTimer）。沉降后容器不得再持该字段，
  // 否则「页作用域」名不副实，下一轮又会有人经 host.state 直达。
  it("currentSite 不再住在共享 state（已下沉 site/workshop-page-state.ts）", () => {
    const state = makeState();
    expect("currentSite" in state).toBe(false);
  });

  it("尾随借宿字段仍在：workshopTimer；avatarCache 已于 ADR-264 上收", () => {
    const state = makeState();
    // workshopTimer 的清理点在 app 壳层 _render 开头（早于 page.init）——未随 ADR-263/264 下沉。
    // avatarCache 已于 ADR-264 上收 community 层 store，其断言转为「已不在容器内」。
    expect("workshopTimer" in state).toBe(true);
    expect("avatarCache" in state).toBe(false);
  });
});

// ===== 整合包面板复用契约（2026-09 修复）=====
// 背景：原每次 `package:selected` 都 `innerHTML` 全量重建 `<app-sync-manager>`，组件实例
// 连同视图状态（目录展开态 / 状态筛选 / 子类型 / 在途集合）一起被丢弃——切整合包闪烁，
// 且「跨包复用」在架构上不可能。组件本就实现了 `attributeChangedCallback` 支持 instance
// 变更，故改为复用 + 改属性。此处锁定「同一元素引用」契约：改回 innerHTML 重建即红。
describe("initInstancesPage：同步面板复用而非重建", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.replaceChildren();
    // initInstancesPage 会跑 bindTabs，测试壳无 tab 面板 → 屏蔽其告警噪音
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("连续 package:selected → 复用同一实例（改属性，不重建）", () => {
    const { host, root } = makeHost();
    root.innerHTML = '<div id="ins-content"></div>';
    initInstancesPage(host);

    bus.emit("package:selected", { name: "packA", rtype: "ysm" });
    const content = root.getElementById("ins-content") as HTMLElement;
    const first = content.querySelector("app-sync-manager");
    expect(first).not.toBeNull();
    expect(first?.getAttribute("instance")).toBe("packA");
    expect(first?.getAttribute("default-type")).toBe("ysm");

    // 切包：必须是同一元素引用（不是新建），仅属性变更
    bus.emit("package:selected", { name: "packB", rtype: "ysm" });
    const second = content.querySelector("app-sync-manager");
    expect(second).toBe(first);
    expect(second?.getAttribute("instance")).toBe("packB");
    expect(content.querySelectorAll("app-sync-manager").length).toBe(1);
  });

  it("空 rtype 早退：不挂载面板（发射点已拦，此处为防御分支）", () => {
    const { host, root } = makeHost();
    root.innerHTML = '<div id="ins-content"></div>';
    initInstancesPage(host);

    bus.emit("package:selected", { name: "packA", rtype: "" });
    const content = root.getElementById("ins-content") as HTMLElement;
    expect(content.querySelector("app-sync-manager")).toBeNull();
  });
});

describe("initRepositoryPage：mountTree 复用实例改属性（2026-09 收债）", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.removeItem("repo_rtype");
    localStorage.removeItem("repo_subdir");
  });

  afterEach(() => {
    localStorage.removeItem("repo_rtype");
    localStorage.removeItem("repo_subdir");
  });

  function setup(): { host: AppContentHost; root: ShadowRoot } {
    const { host, root } = makeHost();
    root.innerHTML = '<div class="tab-body" id="repo-tab-tree"></div>';
    return { host, root };
  }

  it("rtype 变更 → 同一 app-tree 实例更新 root 属性，不重建", () => {
    const { host, root } = setup();
    initRepositoryPage(host);
    const first = root.querySelector("app-tree");
    expect(first).not.toBeNull();
    bus.emit("repo:rtype-changed", "MMD");
    const second = root.querySelector("app-tree");
    expect(second).toBe(first);
    expect(first!.getAttribute("root")).toBe("MMD");
    host.subs.cleanupAll();
  });

  it("同值 rtype 重放 → 零成本短路（元素与属性均不变）", () => {
    const { host, root } = setup();
    initRepositoryPage(host);
    const first = root.querySelector("app-tree");
    bus.emit("repo:rtype-changed", "MMD");
    bus.emit("repo:rtype-changed", "MMD");
    expect(root.querySelector("app-tree")).toBe(first);
    expect(first!.getAttribute("root")).toBe("MMD");
    host.subs.cleanupAll();
  });

  it("subdir：localStorage 恢复进属性，切回根清 subdir 属性", () => {
    localStorage.setItem("repo_subdir", "stage");
    const { host, root } = setup();
    initRepositoryPage(host);
    const tree = root.querySelector("app-tree");
    expect(tree!.getAttribute("subdir")).toBe("stage");
    // app-nav apply() 的真实时序：先落盘 repo_subdir 再 emit
    localStorage.setItem("repo_subdir", "");
    bus.emit("repo:rtype-changed", "YSM");
    expect(tree!.hasAttribute("subdir")).toBe(false);
    host.subs.cleanupAll();
  });
});
