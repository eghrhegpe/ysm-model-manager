// ===== app-content 组件编排测试（组件级测试样板 4）=====
// 生命周期：connectedCallback 订阅 nav:change → disconnectedCallback 清理
// 验证：mount 渲染默认仓库页 / nav:change 切页渲染 / disconnected 后不再重写 detached DOM
// 依赖：@wailsio/runtime（Events）+ backend/app.ts（getApp）+ bindings 三层 mock
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 阻断 Wails runtime（drag.js 在模块加载时访问 window）
// On 返回 vi.fn() 供断言 unsub 被调用（config-loaded 生命周期 P1 回归）
vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn().mockReturnValue(vi.fn()) },
  Window: { Show: vi.fn(), Hide: vi.fn(), SetTitle: vi.fn(), OpenDevTools: vi.fn(), Reload: vi.fn() },
}));

// getApp 全绑定 mock（组件多处从 getApp() 解构绑定，缺导出会 "not a function"）
vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ClearScanCache: vi.fn().mockResolvedValue(undefined),
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    GetRepoRoot: vi.fn().mockResolvedValue(""),
    ScanModelEntries: vi.fn().mockResolvedValue([]),
    DetectResourceType: vi.fn().mockResolvedValue(""),
    ReadFileBytes: vi.fn().mockResolvedValue(null),
    SaveAppConfig: vi.fn().mockResolvedValue(undefined),
    GetMinecraftPaths: vi.fn().mockResolvedValue([]),
    GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
    ListVersionInstances: vi.fn().mockResolvedValue([]),
  }),
}));

// bindings（app-tree 链静态 import + 动态兜底）
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ScanModelEntries: vi.fn().mockResolvedValue([]),
  IsFileBanned: vi.fn().mockResolvedValue(false),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  ToggleModelEnable: vi.fn().mockResolvedValue(undefined),
  SelectDirectory: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  RenameFile: vi.fn().mockResolvedValue(undefined),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  SyncCustomToRepo: vi.fn().mockResolvedValue(undefined),
  LoadAppConfig: vi.fn().mockResolvedValue({}),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  GetPackInfo: vi.fn().mockResolvedValue(null),
  DefaultWorkshopSites: vi.fn().mockResolvedValue([]),
  LoadWorkshopCreators: vi.fn().mockResolvedValue([]),
  ListModelAuthors: vi.fn().mockResolvedValue([]),
  ScanLocalAuthors: vi.fn().mockResolvedValue([]),
}));

import { bus } from "../../bus.ts";
import "./index.ts"; // 触发 customElements.define("app-content")
import { sleep, waitFor, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

describe("app-content 生命周期配对", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // 清除启动恢复状态，避免测试依赖环境 localStorage（resolveInitialPage 读取）
    localStorage.removeItem("nav_page");
    localStorage.removeItem("ui-default-page");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染默认仓库页（repo tab 存在）", async () => {
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".repo-tab") !== null);
    expect(el.shadowRoot?.querySelector(".repo-tab")).not.toBeNull();
    unmountElement(el);
  });

  it("nav:change → 切页渲染（页面内容变化）", async () => {
    const el = mountCustomElement("app-content");
    await sleep(150);
    const before = el.shadowRoot?.innerHTML || "";
    bus.emit("nav:changed", { page: "settings" });
    await sleep(200);
    expect(el.shadowRoot?.innerHTML).not.toBe(before); // 已切换到 settings 页
    unmountElement(el);
  });

  it("disconnected → 订阅清理 + 面板 DOM 释放（ADR-163：nav:change 不重挂 detached 面板）", async () => {
    const el = mountCustomElement("app-content");
    await sleep(150);
    // 挂载时已渲染 .page 面板（ADR-163 单面板挂载）
    expect(el.shadowRoot?.querySelector(".page")).not.toBeNull();
    // disconnectedCallback 同步做两件事：
    //  ① clearPanels() 清空面板 DOM（防组件销毁后面板残留泄漏，ADR-163）；
    //  ② subs.cleanupAll() 退订 nav:changed → 后续 emit 不再重挂面板。
    unmountElement(el);
    expect(el.shadowRoot?.querySelector(".page")).toBeNull(); // ① 面板已随 disconnect 释放
    bus.emit("nav:changed", { page: "settings" });
    await sleep(200);
    expect(el.shadowRoot?.querySelector(".page")).toBeNull(); // ② 订阅已清，不会再重挂
  });

  it("启动恢复 → nav_page=settings 时 mount 直接渲染设置页（resolveInitialPage 白名单）", async () => {
    localStorage.setItem("nav_page", "settings");
    const el = mountCustomElement("app-content");
    await sleep(200);
    // settings 页渲染：.stg-tab 存在、仓库页 .repo-tab 不渲染
    expect(el.shadowRoot?.querySelector(".stg-tab")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".repo-tab")).toBeNull();
    unmountElement(el);
  });

  it("启动恢复 → 未知/损坏 nav_page 值回退仓库页（不死页）", async () => {
    localStorage.setItem("nav_page", "legacy-garbage");
    const el = mountCustomElement("app-content");
    await sleep(200);
    // 未知值应回退 repository（仓库页渲染，且绑定正常）
    expect(el.shadowRoot?.querySelector(".repo-tab")).toBeTruthy();
    unmountElement(el);
  });

  it("config-loaded 订阅生命周期：disconnected 退订 → 重建后重新注册（P1 回归）", async () => {
    // 子代理审核发现的 P1：index.ts 与 init-workshop.ts 各自持有同名模块级
    // _avatarConfigLoaded*，disconnectedCallback 清理的是自己的死拷贝，真实
    // unsub 永不执行。修复后经 resetAvatarConfigLoaded() 协作，此处锁回归。
    const { Events } = await import("@wailsio/runtime");
    const onMock = vi.mocked(Events.On);

    // 第一次 mount + 切 workshop 页 → 注册 config-loaded 订阅
    onMock.mockClear();
    const el = mountCustomElement("app-content");
    await sleep(150);
    bus.emit("nav:changed", { page: "workshop" });
    await sleep(250);
    expect(onMock).toHaveBeenCalledWith("config-loaded", expect.any(Function));
    const unsub = onMock.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    expect(typeof unsub).toBe("function");

    // disconnected → 真实 unsub 被调用（旧订阅退订）
    unmountElement(el);
    expect(unsub).toHaveBeenCalled();

    // 重建 + 再切 workshop → 重新注册（flag 已复位，新实例可注册）
    onMock.mockClear();
    const el2 = mountCustomElement("app-content");
    await sleep(150);
    bus.emit("nav:changed", { page: "workshop" });
    await sleep(250);
    expect(onMock).toHaveBeenCalledWith("config-loaded", expect.any(Function));
    unmountElement(el2);
  });
});
