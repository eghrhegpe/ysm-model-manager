// ===== <app-nav> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互验证 nav:change 事件 + nav:changed 高亮更新。
// 注意：nav:change 是请求事件（app-content 处理），nav:changed 是响应事件（app-nav 监听）。
// 单独挂载 app-nav 时 nav:change → nav:changed 链路无消费方，需直接发射 nav:changed 验证。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

const { canMock } = vi.hoisted(() => ({
  canMock: vi.fn().mockReturnValue(true), // 默认桌面：ListVersionInstances 可用
}));

vi.mock("../../utils/dom/capabilities.ts", () => ({
  can: canMock,
}));

// getApp 仅在 version 加载时调用，mock 阻断
vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetAppVersion: vi.fn().mockResolvedValue("v1.0.0"),
  }),
}));

// FAB 3D 一键跳转的动态 import 链（_viewerFabClick 内 await import）——
// 三模块均不在本测试 import 链上静态加载，mock 后只被 _viewerFabClick 消费
vi.mock("../../views/app-content/init-pages.ts", () => ({
  getLastModelPath: vi.fn(),
}));
vi.mock("../../views/app-preview/empty-3d.ts", () => ({
  openEmpty3DFullscreen: vi.fn(),
}));
vi.mock("../../views/app-preview/preview-library.ts", () => ({
  openModel3DFullscreen: vi.fn(),
}));
import { getApp, type AppBindings } from "../../backend/app.ts";
import { t } from "../../core/i18n/t.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getLastModelPath } from "../../views/app-content/init-pages.ts";
import { openEmpty3DFullscreen } from "../../views/app-preview/empty-3d.ts";
import { openModel3DFullscreen } from "../../views/app-preview/preview-library.ts";

import "./index.ts"; // 触发 customElements.define("app-nav")

describe("app-nav（testid 钩子 + 导航交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("nav_page");
    localStorage.removeItem("nav_collapsed");
    canMock.mockReturnValue(true); // 默认桌面：ListVersionInstances 可用
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染 6 个导航项（初始 active 同源 resolveInitialPage）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const items = getAllByTestId(root, "nav-item");
    expect(items.length).toBe(6);
    // 构造器与 PageStore 同源：nav_page 未保存时默认 repository，首个导航项 active
    // （旧行为硬编码幽灵值 "dashboard"，无任何项 active——启动高亮缺失的根因）
    const active = items.filter((i) => i.classList.contains("active"));
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("repository");
    unmountElement(el);
  });

  it("底部渲染 3D 一键跳转按钮（替代被移除的 viewer 页内嵌文件树）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const fab = getByTestId(root, "nav-viewer-fab");
    expect(fab).not.toBeNull();
    unmountElement(el);
  });

  it("查看器模式隐藏整合包导航项；GitHub 已由桥接增强 Batch 2 启用（ADR-049）", async () => {
    canMock.mockReturnValue(false); // Android/网页版：ListVersionInstances 不可用
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 5);
    const items = getAllByTestId(root, "nav-item");
    // repository/workshop/github/diagnostics/settings = 5
    expect(items.length).toBe(5);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "instances")).toBe(false);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "github")).toBe(true);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "repository")).toBe(true);
    expect(items.some((i) => (i as HTMLElement).dataset.page === "settings")).toBe(true);
    unmountElement(el);
  });

  it("mmd 组渲染 MMD 独立顶级类型选项（ADR-094 回归：flat 架构平铺）", async () => {
    // 钉住：mmd 大类下拉应显示所有 MMD 独立类型
    // （EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/mmd-shader/
    //  DefaultAnim/DefaultMorph/vrm 共 9 项）
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const groupSel = root.querySelector<HTMLSelectElement>("#nav-group-select");
    const subtypeSel = root.querySelector<HTMLSelectElement>("#nav-subtype-select");
    expect(groupSel).not.toBeNull();
    expect(subtypeSel).not.toBeNull();
    // 切到 mmd 大类 → 子类型下拉应填充 9 个独立类型
    groupSel!.value = "mmd";
    groupSel!.dispatchEvent(new Event("change"));
    const opts = subtypeSel!.querySelectorAll("option");
    expect(opts.length).toBe(9);
    // 所有选项 subdir 为空（flat 架构，各类型独立顶级）
    for (const o of Array.from(opts)) {
      expect((o as HTMLOptionElement).dataset.subdir).toBe("");
    }
    // 其余大类不受影响：minecraft 组 = 资源包/光影包 2 项
    groupSel!.value = "minecraft";
    groupSel!.dispatchEvent(new Event("change"));
    expect(subtypeSel!.querySelectorAll("option").length).toBe(2);
    unmountElement(el);
  });

  it("点击 nav-item → 发射 nav:change", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const spy = vi.fn();
    const offNav = bus.on("nav:changed", spy);
    const items = getAllByTestId(root, "nav-item");
    (items[1] as HTMLElement).click(); // 点击第二个（整合包管理）
    expect(spy).toHaveBeenCalledWith({ page: "instances" });
    offNav();
    unmountElement(el);
  });

  it("nav:changed → 激活项高亮更新", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    bus.emit("nav:changed", { page: "settings" });
    await sleep(50);
    const items = getAllByTestId(root, "nav-item");
    const active = items.filter((i) => i.classList.contains("active"));
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("settings");
    unmountElement(el);
  });

  it("disconnected → 清理 nav:changed 订阅（P3 修复：原 expect(true) 恒真）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    // 卸载前初始 active 为 repository
    unmountElement(el);
    // 断开后发射：若订阅已清理，已卸载元素的高亮不应被更新（仍为 repository）
    bus.emit("nav:changed", { page: "settings" });
    await sleep(50);
    const active = getAllByTestId(root, "nav-item").filter((i) =>
      i.classList.contains("active"),
    );
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.page).toBe("repository");
  });

  it("版本号最终渲染", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => {
      const v = root.getElementById("nav-version");
      return v !== null && v.textContent !== "加载中…";
    });
    const version = root.getElementById("nav-version")!;
    expect(version.textContent).toContain("v1.0.0");
    unmountElement(el);
  });

  it("折叠按钮：点击折叠为窄条（data-collapsed + 持久化），再点展开恢复", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    // 初始展开
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    // 点击折叠
    (getByTestId(root, "nav-toggle") as HTMLElement).click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    expect(localStorage.getItem("nav_collapsed")).toBe("1");
    // 折叠态窄条上按钮仍常驻（防意外找不回导航）
    expect(root.querySelector(".nav-toggle")).not.toBeNull();
    // 再点展开
    (root.querySelector(".nav-toggle") as HTMLElement)!.click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    expect(localStorage.getItem("nav_collapsed")).toBe("0");
    unmountElement(el);
  });

  it("setCollapsed(persist=false) 折叠但不污染用户手动记忆", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    (el as unknown as { setCollapsed(c: boolean, o?: { persist?: boolean }): void }).setCollapsed(true, { persist: false });
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    // 不落盘：localStorage 仍为空
    expect(localStorage.getItem("nav_collapsed")).toBeNull();
    unmountElement(el);
  });

  it("点击「🧭 导航栏」整行也能折叠（扩大触发区，label 可点）", async () => {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    // 点击 label 而非箭头按钮——事件挂在整行 menu-head 上
    (root.querySelector(".menu-label") as HTMLElement).click();
    await sleep(50);
    expect(el.hasAttribute("data-collapsed")).toBe(true);
    unmountElement(el);
  });
});
// ===== 增量覆盖：键盘导航 / FAB 跳转 / 版本兜底 / 仓库焦点重试 / logo 动态文案 =====
describe("app-nav 增量（键盘 / FAB / 版本失败 / 焦点重试 / logo）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem("nav_page");
    localStorage.removeItem("nav_collapsed");
    canMock.mockReturnValue(true);
    // 先清共享 mock 的调用历史（vitest 3+ restoreAllMocks 不再重置 vi.fn 工厂 mock）
    vi.clearAllMocks();
    // 重整共享 mock 实现
    vi.mocked(getApp).mockResolvedValue({
      GetAppVersion: vi.fn().mockResolvedValue("v1.0.0"),
    } as unknown as AppBindings);
    vi.mocked(getLastModelPath).mockReturnValue(null);
    vi.mocked(openEmpty3DFullscreen).mockResolvedValue(undefined);
    vi.mocked(openModel3DFullscreen).mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function mountNav(): { el: HTMLElement; root: ShadowRoot } {
    const el = mountCustomElement("app-nav");
    const root = el.shadowRoot!;
    return { el, root };
  }

  it("nav-item 键盘导航：ArrowDown/ArrowUp 循环移焦，Home/End 跳首尾，Enter/Space 激活", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const items = getAllByTestId(root, "nav-item") as HTMLElement[];
    const focusSpies = items.map((i) => vi.spyOn(i, "focus"));
    const spy = vi.fn();
    const offNav = bus.on("nav:changed", spy);

    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(focusSpies[1]).toHaveBeenCalledTimes(1);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(focusSpies[0]).toHaveBeenCalledTimes(1);
    items[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(focusSpies[items.length - 1]).toHaveBeenCalledTimes(1);
    items[items.length - 1].dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(focusSpies[0]).toHaveBeenCalledTimes(2);

    // Enter / Space 都触发激活（与 click 同链路：safeSet + nav:changed）。
    // 用 settings 项而非 repository——repository 激活会触发 focusRepoSearch 的
    // 500ms 后台重试链，泄漏到后续用例干扰 document.querySelector 断言。
    items[items.length - 1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(spy).toHaveBeenCalledWith({ page: "settings" });
    items[items.length - 1].dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(spy).toHaveBeenCalledTimes(2);
    offNav();
    unmountElement(el);
  });

  it("FAB 点击：无最近模型 → 空场景 3D（openEmpty3DFullscreen，不弹 toast）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const toastSpy = vi.fn();
    const offToast = bus.on("toast:show", toastSpy);
    (getByTestId(root, "nav-viewer-fab") as HTMLElement).click();
    await waitFor(() => expect(openEmpty3DFullscreen).toHaveBeenCalledTimes(1));
    expect(getLastModelPath).toHaveBeenCalledTimes(1);
    expect(openModel3DFullscreen).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
    offToast();
    unmountElement(el);
  });

  it("FAB 点击：有最近模型 → openModel3DFullscreen(path)；打开失败 → console.error + 错误 toast", async () => {
    vi.mocked(getLastModelPath).mockReturnValue("/m/a.pmx");
    vi.mocked(openModel3DFullscreen).mockRejectedValue(new Error("open fail"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const toastSpy = vi.fn();
    const offToast = bus.on("toast:show", toastSpy);
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    (getByTestId(root, "nav-viewer-fab") as HTMLElement).click();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(openModel3DFullscreen).toHaveBeenCalledWith("/m/a.pmx");
    expect(openEmpty3DFullscreen).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    expect(toastSpy.mock.calls[0][0]).toMatchObject({ type: "error", msg: "❌ 打开 3D 失败" });
    offToast();
    errSpy.mockRestore();
    unmountElement(el);
  });

  it("FAB 键盘 Enter/Space 走同一打开链路（无障碍对齐 click）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const fab = getByTestId(root, "nav-viewer-fab") as HTMLElement;
    fab.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    await waitFor(() => expect(openEmpty3DFullscreen).toHaveBeenCalledTimes(1));
    fab.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    await waitFor(() => expect(openEmpty3DFullscreen).toHaveBeenCalledTimes(2));
    unmountElement(el);
  });

  it("GetAppVersion 失败 → 版本位兜底显示 t('nav.preview')（不硬编码版本号）", async () => {
    vi.mocked(getApp).mockRejectedValueOnce(new Error("bridge down"));
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    await waitFor(() => {
      const v = root.getElementById("nav-version");
      return v !== null && v.textContent === t("nav.preview");
    });
    expect(root.getElementById("nav-version")!.textContent).not.toContain("v1.0.0");
    unmountElement(el);
  });

  it("版本加载完成前已断开 → isConnected 守卫提前返回（不写已卸载 DOM）", async () => {
    let resolveVersion!: (v: string) => void;
    vi.mocked(getApp).mockResolvedValue({
      GetAppVersion: () =>
        new Promise<string>((res) => {
          resolveVersion = res;
        }),
    } as unknown as AppBindings);
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    unmountElement(el);
    resolveVersion("v9.9.9");
    await sleep(50);
    // 守卫生效：已卸载组件的版本位停留在「加载中…」，未被 v9.9.9 改写
    expect(root.getElementById("nav-version")!.textContent).toBe(t("common.loading"));
  });

  it("lang:changed → 重新渲染导航（订阅回调 → this.render）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const renderSpy = vi.spyOn(el as unknown as { render: () => void }, "render");
    bus.emit("lang:changed", { lang: "en" });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    // 重渲染后导航项仍在（innerHTML 整体重写不丢结构）
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    renderSpy.mockRestore();
    unmountElement(el);
  });

  it("repo:rtype-changed → logo 文案切到新类型短标签（💎 EntityPlayer → MMD）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    bus.emit("repo:rtype-changed", RESOURCE_TYPES.MMD);
    const logo = root.querySelector(".logo-text")!;
    expect(logo.textContent).toContain("MMD");
    expect(logo.textContent).toContain(t("app.managerSuffix"));
    unmountElement(el);
  });

  it("切到仓库页 → 渐进重试聚焦搜索框（首试 miss，25ms 后命中 #srch）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const srch = { focus: vi.fn(), select: vi.fn() };
    const fakeAppContent = {
      shadowRoot: {
        querySelector: () => ({ shadowRoot: { getElementById: () => srch } }),
      },
    };
    const qSpy = vi
      .spyOn(document, "querySelector")
      .mockReturnValueOnce(null)
      .mockReturnValue(fakeAppContent as unknown as Element);
    (getAllByTestId(root, "nav-item")[0] as HTMLElement).click(); // repository → queueMicrotask(focusRepoSearch)
    await sleep(60);
    expect(qSpy.mock.calls.some((c) => c[0] === "app-content")).toBe(true);
    expect(srch.focus).toHaveBeenCalledTimes(1);
    expect(srch.select).toHaveBeenCalledTimes(1);
    qSpy.mockRestore();
    unmountElement(el);
  });

  it("setCollapsed 同值调用为 no-op（不重复渲染）", async () => {
    const { el, root } = mountNav();
    await waitFor(() => getAllByTestId(root, "nav-item").length >= 6);
    const renderSpy = vi.spyOn(el as unknown as { render: () => void }, "render");
    (el as unknown as { setCollapsed(c: boolean): void }).setCollapsed(false); // 已是展开态
    expect(renderSpy).not.toHaveBeenCalled();
    expect(el.hasAttribute("data-collapsed")).toBe(false);
    renderSpy.mockRestore();
    unmountElement(el);
  });
});

