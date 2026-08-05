// ===== app-content 组件编排测试（组件级测试样板 4）=====
// 生命周期：connectedCallback 订阅 nav:change → disconnectedCallback 清理
// 验证：mount 渲染默认仓库页 / nav:change 切页渲染 / disconnected 后不再重写 detached DOM
// 依赖：@wailsio/runtime（Events）+ wails/app.ts（getApp）+ bindings 三层 mock——
// 其中 setPendingTreeSearch 会连带加载 app-tree 全链（bindings 静态 import 需 mock）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 阻断 Wails runtime（drag.js 在模块加载时访问 window）
vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn().mockReturnValue(() => {}) },
}));

// getApp 全绑定 mock（组件多处从 getApp() 解构绑定，缺导出会 "not a function"）
vi.mock("../../wails/app.ts", () => ({
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
  LoadWorkshopSites: vi.fn().mockResolvedValue([]),
  LoadWorkshopCreators: vi.fn().mockResolvedValue([]),
  ListModelAuthors: vi.fn().mockResolvedValue([]),
  ScanLocalAuthors: vi.fn().mockResolvedValue([]),
}));

import { bus } from "../../bus.ts";
import "./index.ts"; // 触发 customElements.define("app-content")
import { sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

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
    await sleep(150);
    expect(el.shadowRoot?.querySelector(".repo-tab")).toBeTruthy();
    unmountElement(el);
  });

  it("nav:change → 切页渲染（页面内容变化）", async () => {
    const el = mountCustomElement("app-content");
    await sleep(150);
    const before = el.shadowRoot?.innerHTML || "";
    bus.emit("nav:change", { page: "settings" });
    await sleep(200);
    expect(el.shadowRoot?.innerHTML).not.toBe(before); // 已切换到 settings 页
    unmountElement(el);
  });

  it("disconnected → 订阅清理（nav:change 不再重写 detached DOM）", async () => {
    const el = mountCustomElement("app-content");
    await sleep(150);
    const before = el.shadowRoot?.innerHTML || "";
    unmountElement(el);
    bus.emit("nav:change", { page: "settings" });
    await sleep(200);
    expect(el.shadowRoot?.innerHTML).toBe(before); // 订阅已随 disconnectedCallback 清理
  });

  it("启动恢复 → nav_page=settings 时 mount 直接渲染设置页（resolveInitialPage 白名单）", async () => {
    localStorage.setItem("nav_page", "settings");
    const el = mountCustomElement("app-content");
    await sleep(200);
    // settings 页渲染：.stg-tab 存在、仓库页 .repo-tab 不渲染
    expect(el.shadowRoot?.querySelector(".stg-tab")).toBeTruthy();
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
});
