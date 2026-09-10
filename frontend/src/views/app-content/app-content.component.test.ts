// ===== app-content 组件编排测试（组件级测试样板 4）=====
// 生命周期：connectedCallback 订阅 nav:changed → disconnectedCallback 清理
// 验证：mount 渲染默认仓库页 / nav:changed 切页渲染 / disconnected 后不再重写 detached DOM
// 依赖：@wailsio/runtime（Events）+ backend/app.ts（getApp）+ bindings 三层 mock
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 阻断 Wails runtime（drag.js 在模块加载时访问 window）
// On 返回 vi.fn() 供断言 unsub 被调用（config-loaded 生命周期 P1 回归）
vi.mock("@wailsio/runtime", () => ({
  Events: { On: vi.fn().mockReturnValue(vi.fn()) },
  Window: { Show: vi.fn(), Hide: vi.fn(), SetTitle: vi.fn(), OpenDevTools: vi.fn(), Reload: vi.fn() },
}));

// getApp 全绑定 mock（组件多处从 getApp() 解构绑定，缺导出会 "not a function"）
vi.mock("@/backend/app.ts", () => ({
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

import { bus } from "@/bus";
import "./index.ts"; // 触发 customElements.define("app-content")
import { sleep, waitFor, mountCustomElement, unmountElement } from "@/test-utils/index.ts";

// 排空调度轮次（G-1 三分法「init 落定」解法）：setTimeout(0)+rAF 各 2 轮确定性 drain，
// 替代固定 sleep 等挂载/切页 init 链落定（本地定义即可，不必进公共层——test-utils 卡）
async function flushAsyncTurns(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((r) => {
      setTimeout(r, 0);
    });
    await new Promise<void>((r) => {
      requestAnimationFrame(() => r());
    });
  }
}

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

  it("nav:changed → 切页渲染（页面内容变化）", async () => {
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".repo-tab") !== null); // init 落定
    const before = el.shadowRoot?.innerHTML || "";
    bus.emit("nav:changed", { page: "settings" });
    await waitFor(() => (el.shadowRoot?.innerHTML || "") !== before); // 正等结果：已切到 settings
    expect(el.shadowRoot?.innerHTML).not.toBe(before);
    unmountElement(el);
  });

  it("disconnected → 订阅清理 + 面板 DOM 释放（ADR-163：nav:changed 不重挂 detached 面板）", async () => {
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".page") !== null); // init 落定
    // 挂载时已渲染 .page 面板（ADR-163 单面板挂载）
    expect(el.shadowRoot?.querySelector(".page")).not.toBeNull();
    // disconnectedCallback 同步做两件事：
    //  ① clearPanels() 清空面板 DOM（防组件销毁后面板残留泄漏，ADR-163）；
    //  ② subs.cleanupAll() 退订 nav:changed → 后续 emit 不再重挂面板。
    unmountElement(el);
    expect(el.shadowRoot?.querySelector(".page")).toBeNull(); // ① 面板已随 disconnect 释放
    bus.emit("nav:changed", { page: "settings" });
    // 负向窗口：disconnected 后 emit 不应重挂面板——waitFor(null) 会立即返回（假绿），须走满窗口确认无延迟重挂
    await sleep(200);
    expect(el.shadowRoot?.querySelector(".page")).toBeNull(); // ② 订阅已清，不会再重挂
  });

  it("启动恢复 → nav_page=settings 时 mount 直接渲染设置页（resolveInitialPage 白名单）", async () => {
    localStorage.setItem("nav_page", "settings");
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".stg-tab") !== null); // 正等结果：settings 页渲染
    // settings 页渲染：.stg-tab 存在、仓库页 .repo-tab 不渲染
    expect(el.shadowRoot?.querySelector(".stg-tab")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".repo-tab")).toBeNull();
    unmountElement(el);
  });

  it("启动恢复 → 未知/损坏 nav_page 值回退仓库页（不死页）", async () => {
    localStorage.setItem("nav_page", "legacy-garbage");
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".repo-tab")); // 正等结果：回退仓库页
    // 未知值应回退 repository（仓库页渲染，且绑定正常）
    expect(el.shadowRoot?.querySelector(".repo-tab")).toBeTruthy();
    unmountElement(el);
  });

  it("运行时 nav:changed 非法 page → 忽略（isValidPage 守卫，与 app-nav 口径一致）", async () => {
    const el = mountCustomElement("app-content");
    await waitFor(() => el.shadowRoot?.querySelector(".repo-tab") !== null); // init 落定
    bus.emit("nav:changed", { page: "settings" });
    await waitFor(() => el.shadowRoot?.querySelector(".stg-tab") !== null); // 正等结果：已切 settings
    await flushAsyncTurns(); // 排空：设置页 init 完全落定（版本字段 加载中…→settled），基线捕获需 settled 态
    expect(el.shadowRoot?.querySelector(".stg-tab")).not.toBeNull();
    const htmlBefore = el.shadowRoot?.innerHTML || "";
    bus.emit("nav:changed", { page: "bogus-page" as unknown as import("@/bus").PageName });
    // 负向窗口：非法 page 被守卫拒绝，渲染应不变——waitFor(===) 会立即返回（假绿），须走满窗口确认无延迟切页
    await sleep(200);
    // 非法 page 被守卫拒绝：渲染不变（不切页、不写脏 state）
    expect(el.shadowRoot?.innerHTML).toBe(htmlBefore);
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
    await waitFor(() => el.shadowRoot?.querySelector(".repo-tab") !== null); // init 落定
    bus.emit("nav:changed", { page: "workshop" });
    await waitFor(() => onMock.mock.calls.some((c) => c[0] === "config-loaded")); // 正等结果：订阅注册
    expect(onMock).toHaveBeenCalledWith("config-loaded", expect.any(Function));
    const unsub = onMock.mock.results[0]?.value as ReturnType<typeof vi.fn>;
    expect(typeof unsub).toBe("function");

    // disconnected → 真实 unsub 被调用（旧订阅退订）
    unmountElement(el);
    expect(unsub).toHaveBeenCalled();

    // 重建 + 再切 workshop → 重新注册（flag 已复位，新实例可注册）
    onMock.mockClear();
    const el2 = mountCustomElement("app-content");
    await waitFor(() => el2.shadowRoot?.querySelector(".repo-tab") !== null); // init 落定
    bus.emit("nav:changed", { page: "workshop" });
    await waitFor(() => onMock.mock.calls.some((c) => c[0] === "config-loaded")); // 正等结果：重新注册
    expect(onMock).toHaveBeenCalledWith("config-loaded", expect.any(Function));
    unmountElement(el2);
  });
});
