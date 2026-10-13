// ===== init-pages 契约测试 =====
//
// 注：bindTabs（运行期 tab 引擎 + ADR-259 唯一真值契约）已于 2026-10 下沉到 tabs-runtime.ts，
// 其契约测试随之迁至 tabs-runtime.test.ts。本文件现仅覆盖 init-pages.ts 自身的页面编排契约：
//   - AppContentState 字段归属（ADR-263 借宿字段下沉）
//   - 整合包面板复用而非重建（2026-09 修复）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus } from "@/bus";
import type { AppContentHost } from "./host.ts";
import { initInstancesPage, initRepositoryPage } from "./init-pages.ts";
import { AppContentState } from "./state.ts";
import { SubscriptionBucket } from "./subscription-bucket.ts";

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
