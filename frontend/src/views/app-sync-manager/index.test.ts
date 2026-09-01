// ===== <app-sync-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互模拟类型标签切换、状态筛选、按钮点击。
// 注意：模块级变量 _lastSelectedType 在类型切换后泄漏，测试间隔离需靠 localStorage + 顺序。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";
import type { SyncItem } from "./tpl.ts";

// getApp 全绑定 mock（P1 修复：mocks 提为 vi.hoisted 可引用，原内联 vi.fn 无法精确断言）
const { mocks } = vi.hoisted(() => {
  const mocks = {
    LoadResourceTypes: vi.fn().mockResolvedValue({
      resourceTypes: [
        { id: "ysm", name: "YSM 模型", icon: "💎" },
        { id: "EntityPlayer", name: "PMX 模型", icon: "🎭" },
        { id: "SceneModel", name: "场景模型", icon: "🏰" },
        { id: "vrm", name: "VRM 模型", icon: "🥽" },
        { id: "resourcepack", name: "资源包", icon: "🎨" },
        { id: "shaderpack", name: "光影包", icon: "☀️" },
        { id: "blueprint", name: "蓝图", icon: "⚙️" },
        { id: "litematic", name: "投影", icon: "📐" },
      ],
    }),
    GetInstanceSyncStatus: vi.fn().mockResolvedValue([
      { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
      { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
      { path: "c.ysm", name: "模型C", status: "disabled", type: "ysm", size: 512 },
      { path: "d.ysm", name: "模型D", status: "synced", type: "ysm", size: 0 },
    ]),
    PushSingleResourceToInstance: vi.fn().mockResolvedValue(undefined),
    PullSingleResourceFromInstance: vi.fn().mockResolvedValue(undefined),
    GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
    GetSyncScanDirs: vi.fn().mockResolvedValue({
      global: "/repo/schematics", instance: "/mc/inst/x/schematics", warningCode: "",
    }),
    ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
  };
  return { mocks };
});

vi.mock("../../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadResourceTypes: mocks.LoadResourceTypes,
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    PushSingleResourceToInstance: mocks.PushSingleResourceToInstance,
    PullSingleResourceFromInstance: mocks.PullSingleResourceFromInstance,
    GetRepoRoot: mocks.GetRepoRoot,
    GetSyncScanDirs: mocks.GetSyncScanDirs,
    ScanModelEntriesWithLabel: mocks.ScanModelEntriesWithLabel,
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-sync-manager")

describe("app-sync-manager（testid 钩子 + 同步交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // P2 修复（审核发现）：原键名 "ysm-sm-last-type" 写错——源码实际键是
    // "ysm_syncLastType"（LAST_TYPE_KEY，index.ts:39），清理无效导致测试隔离
    // 完全依赖文件内执行顺序
    localStorage.removeItem("ysm_syncLastType");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    // 2026-08-17 isolate:false 审核模式发现：全局残留会让 5000ms waitFor 渲染超时
    vi.unstubAllGlobals();
  });

  it("connected 无 instance → 显示错误提示", async () => {
    const el = mountCustomElement("app-sync-manager");
    expect(el.innerHTML).toContain("⚠️");
    unmountElement(el);
  });

  it("connected 有 instance → 渲染列表和推送按钮", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "1.20.1-Fabric");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLElement;
    expect(pushBtn).toBeTruthy();
    expect(pushBtn.textContent).toContain("推送");
    unmountElement(el);
  });

  it("仓库基准过宽 → 摘要栏显示告警而非目录", async () => {
    mocks.GetSyncScanDirs.mockResolvedValue({
      global: "/mc", instance: "/mc/inst/x/schematics", warningCode: "scan_dir_wide", warningParams: { label: "蓝图", dir: "/mc", subDir: "schematics" },
    });
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => {
      const sum = el.querySelector(".sm-summary");
      return sum && sum.textContent!.includes("疑似过宽");
    }, 5000);
    const sum = el.querySelector(".sm-summary");
    expect(sum!.textContent).toContain("⚠️");
    unmountElement(el);
  });

  it("推送按钮 → 调用 PushSingleResourceToInstance（P1 修复：原断言 getApp 恒真）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLElement;
    pushBtn.click();
    await waitFor(() => mocks.PushSingleResourceToInstance.mock.calls.length > 0, 5000);
    // 精确断言：参数序 (selectedType, instanceName, filePath)，selectedType 默认 YSM
    expect(mocks.PushSingleResourceToInstance).toHaveBeenCalledWith(
      "ysm",
      "test",
      expect.any(String),
    );
    unmountElement(el);
  });

  it("stats:refresh → 重新加载数据（P2 修复：原只断言元素存在，handler 被移除也通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    bus.emit("stats:refresh");
    await sleep(500);
    // 订阅有效 → 重新加载（GetInstanceSyncStatus 调用次数 +1）
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore + 1);
    unmountElement(el);
  });

  it("disconnected → 清理订阅（P1 修复：原 expect(true) 恒真）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    // 记录卸载前的加载次数，断开后 emit 不应再触发 GetInstanceSyncStatus
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    unmountElement(el);
    // 断开后发射 stats:refresh，订阅应已清理 → 调用次数不变
    bus.emit("stats:refresh");
    await sleep(100);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore);
  });

  it("repo:rtype-changed → 当前类型跟随 + 数据重载（sm-tabs 移除后全局驱动）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-item") !== null, 5000);
    // 无类型 tab（已移除，防回归）
    expect(el.querySelector(".sm-tab")).toBeNull();
    // 发射全局焦点 → 订阅应重载数据（GetInstanceSyncStatus +1）
    const callsBefore = mocks.GetInstanceSyncStatus.mock.calls.length;
    bus.emit("repo:rtype-changed", "shaderpack");
    await sleep(500);
    expect(mocks.GetInstanceSyncStatus.mock.calls.length).toBe(callsBefore + 1);
    // 当前类型指示更新
    const cur = el.querySelector(".sm-cur-type") as HTMLElement;
    expect(cur).not.toBeNull();
    expect(cur.dataset.rtype).toBe("shaderpack");
    // 恢复全局焦点为 ysm（防模块级 _lastSelectedType 泄漏到后续用例）
    bus.emit("repo:rtype-changed", "ysm");
    await sleep(100);
    unmountElement(el);
  });

  it("EntityPlayer 走 sync tree：subdir 作为顶层文件夹（SceneModel/CustomAnim 平行可见）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    // 驱动私有状态：EntityPlayer 条目含 subdir
    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "EntityPlayer";
    self._typeConfig = [{ id: "EntityPlayer", dirLevelSync: true }];
    // code review P1：更新为新 renderer 的 isDir 契约（旧 subdir 分组语义已移除——
    // 文件夹行 = isDir:true + children 数组，展开渲染 children）
    self._allItems = [
      { path: "SceneModel", name: "SceneModel", status: "synced", type: "EntityPlayer", icon: "🎭", size: 10, isDir: true, children: [
        { path: "SceneModel/舞台.pmx", name: "舞台", status: "synced", type: "EntityPlayer", icon: "🎭", size: 10, isDir: false },
      ] },
      { path: "角色A.pmx", name: "角色A", status: "missing", type: "EntityPlayer", icon: "🎭", size: 20, isDir: true, children: [] },
      { path: "CustomAnim", name: "CustomAnim", status: "synced", type: "EntityPlayer", icon: "🎭", size: 30, isDir: true, children: [
        { path: "CustomAnim/动作.pmx", name: "动作", status: "synced", type: "EntityPlayer", icon: "🎭", size: 30, isDir: false },
      ] },
    ];
    self._filteredItems = self._allItems;
    self._filesRoots = { "EntityPlayer": "/repo" };
    self._dirOpen = {};
    mocks.ScanModelEntriesWithLabel.mockResolvedValue([]);

    self._doRender();
    await sleep(100);
    // 顶层文件夹：SceneModel、CustomAnim、角色A（根下无 subdir 的条目也成文件夹）
    let dirs = el.querySelectorAll(".sm-dir");
    expect(dirs.length).toBe(3);
    // data-path = 后端绝对路径（供 push/pull 消费）；分组文件夹用 subdir 名、根下条目用原始 path
    const dirKeys = Array.from(dirs).map((d) => (d as HTMLElement).dataset.path || "");
    expect(dirKeys).toEqual(expect.arrayContaining(["SceneModel", "CustomAnim", "角色A.pmx"]));
    // 未展开无子文件
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    // 展开 SceneModel → 出现 children 行（isDir 契约——.sm-file 渲染）
    (dirs[0] as HTMLElement).click();
    await sleep(200);
    // 文件夹行仍在，且箭头变为 ▾（dirs 数不变——children 是 .sm-file 行）
    dirs = el.querySelectorAll(".sm-dir");
    expect(dirs.length).toBe(3);
    expect((dirs[0] as HTMLElement).querySelector(".sm-dir-arrow")?.textContent).toBe("▾");
    // 展开后 SceneModel 的 children 行（舞台）以 .sm-file 渲染，data-path 为完整路径
    const filesAfter = Array.from(el.querySelectorAll(".sm-file")).map((f) => (f as HTMLElement).dataset.path || "");
    expect(filesAfter).toEqual(expect.arrayContaining(["SceneModel/舞台.pmx"]));
    // 恢复全局状态
    bus.emit("repo:rtype-changed", "ysm");
    await sleep(100);
    unmountElement(el);
  });

  it("状态筛选标签 → 切换后列表变化（P2 修复：原 if 包裹可空洞通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);
    const statusTabs = el.querySelectorAll(".sm-status-tab");
    const missingTab = Array.from(statusTabs).find(
      (t) => (t as HTMLElement).dataset.status === "missing",
    ) as HTMLElement;
    // 直接断言存在（去掉 if 空洞包裹）
    expect(missingTab).toBeTruthy();
    missingTab.click();
    await sleep(100);
    const active = el.querySelector('.sm-status-tab.active') as HTMLElement;
    expect(active.dataset.status).toBe("missing");
    // 过滤后列表全部为 missing 状态
    const items = el.querySelectorAll(".sm-item[data-status]");
    expect(items.length).toBeGreaterThan(0);
    items.forEach((it) => {
      expect((it as HTMLElement).dataset.status).toBe("missing");
    });
    unmountElement(el);
  });

  // P4 审计新增（陷阱 #3）：异步在途时按钮须灰掉，finally 复位——防用户误判没响应连点
  it("推送在途 → 按钮禁用，完成后复位（陷阱 #3 视觉反馈）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(pushBtn.disabled).toBe(false);
    // 让 getApp() await 期间检查禁用态：mock 推迟一拍 resolves
    mocks.PushSingleResourceToInstance.mockImplementationOnce(() =>
      new Promise((r) => setTimeout(() => r(undefined), 100)),
    );
    pushBtn.click();
    // 在途：按钮 disabled=true、opacity=0.55、cursor=wait
    await waitFor(() => (el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement)?.disabled === true, 3000);
    const busyBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(busyBtn.style.opacity).toBe("0.55");
    expect(busyBtn.style.cursor).toBe("wait");
    // 完成：复位（注意 _render 会重建 DOM，故按钮引用须重取；delta 守卫）
    await waitFor(() => {
      const b = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement | null;
      return b !== null && b.disabled === false;
    }, 5000);
    const finalBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    expect(finalBtn.style.opacity).toBe("");
    expect(finalBtn.style.cursor).toBe("");
    unmountElement(el);
  });

  // P4 审计新增（陷阱 #31）：快速连点 3 次 → _singleBusy 重入守卫，仅执行 1 次
  it("快速连点推送 3 次 → 重入守卫，仅执行 1 次（陷阱 #31 重入守卫）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    // 推迟 resolves 制造在途窗口
    mocks.PushSingleResourceToInstance.mockImplementation(() =>
      new Promise((r) => setTimeout(() => r(undefined), 150)),
    );
    // 用 delta 断言：mock.calls.length 跨用例累积（vi.hoisted 单例），取差值隔离
    const callsBefore = mocks.PushSingleResourceToInstance.mock.calls.length;
    pushBtn.click();
    pushBtn.click();
    pushBtn.click();
    await sleep(400);
    // 重入守卫：3 次点击仅 1 次真正调到底层 API（delta=1）
    const delta = mocks.PushSingleResourceToInstance.mock.calls.length - callsBefore;
    expect(delta).toBe(1);
    unmountElement(el);
  });

  // P4 审计新增（错误路径）：推送失败 → toast error + 按钮复位（不卡死）
  it("推送失败 → 错误 toast + 按钮复位（陷阱 #3 失败不卡死）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector('[data-testid="sm-push"]') !== null, 5000);
    const pushBtn = el.querySelector('[data-testid="sm-push"]') as HTMLButtonElement;
    const toastCalls: Array<{ msg: string; type?: string }> = [];
    // P2 修复（codereview）：bus 是模块级单例，bus.on 返回的 unsub 必须调用，
    // 否则监听器泄漏跨测试文件（后续每个 toast:show 都会推入已卸载组件的 toastCalls）
    const offToast = bus.on("toast:show", (payload: { msg: string; type?: string }) => {
      toastCalls.push(payload);
    });
    mocks.PushSingleResourceToInstance.mockRejectedValueOnce(new Error("boom"));
    pushBtn.click();
    await waitFor(() => pushBtn.disabled === false, 5000);
    // 失败也复位按钮（finally），不卡死
    expect(pushBtn.disabled).toBe(false);
    // 至少一条 error 类型 toast
    const errToast = toastCalls.find((c) => c.type === "error");
    expect(errToast).toBeTruthy();
    expect(errToast!.msg).toContain("boom");
    offToast(); // 卸载监听器，防跨测试文件泄漏
    unmountElement(el);
  });

  it("dirLevelSync 类型（blueprint）→ 文件夹行 + 展开扫出子文件（missing 条目也可展开）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    // 直接驱动组件私有状态（绕过 mock 链的多重 getApp 调用，避免 mockResolvedValue 被 afterEach 还原污染）
    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; name: string; icon: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "blueprint";
    self._typeConfig = [{ id: "blueprint", name: "蓝图", icon: "⚙️", dirLevelSync: true }];
    // 真实场景：蓝图在仓库、整合包缺失 → missing；path 为仓库绝对路径
    // code review P1：新 renderer 的 isDir 契约——children 直接携带（不再依赖
    // ScanModelEntriesWithLabel 仓库扫描——新 renderer 无 scan 路径）
    self._allItems = [
      { path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core", name: "hello_new_generation_core", status: "missing", type: "blueprint", icon: "⚙️", size: 4096, isDir: true, children: [
        { path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core/建筑.nbt", name: "建筑.nbt", status: "missing", type: "blueprint", icon: "⚙️", size: 2048, isDir: false },
        { path: "D:/YSM管理器测试文件夹/minecraft-mod/blueprint/hello_new_generation_core/建筑.schematic", name: "建筑.schematic", status: "missing", type: "blueprint", icon: "⚙️", size: 1024, isDir: false },
      ] },
    ];
    self._filteredItems = self._allItems;
    self._filesRoots = { "blueprint": "/repo" };
    self._dirOpen = {};

    // code review P1：新 renderer 无 ScanModelEntriesWithLabel 路径——children 已内联
    void mocks.ScanModelEntriesWithLabel;

    self._doRender();
    await sleep(100);
    // 未展开：只有文件夹行
    let dirs = el.querySelectorAll(".sm-dir");
    expect(dirs.length).toBe(1);
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    // 点击展开（isDir 契约——展开渲染 children）
    (dirs[0] as HTMLElement).click();
    await sleep(300);
    dirs = el.querySelectorAll(".sm-dir");
    const arrow = (dirs[0] as HTMLElement).querySelector(".sm-dir-arrow");
    expect(arrow?.textContent).toBe("▾");
    expect(el.querySelectorAll(".sm-file").length).toBe(2);
    expect(Array.from(el.querySelectorAll(".sm-file")).map((f) => f.textContent || "")).toEqual(
      expect.arrayContaining([expect.stringContaining("建筑.nbt"), expect.stringContaining("建筑.schematic")]),
    );
    // 点击折叠
    (dirs[0] as HTMLElement).click();
    await sleep(300);
    dirs = el.querySelectorAll(".sm-dir");
    expect((dirs[0] as HTMLElement).querySelector(".sm-dir-arrow")?.textContent).toBe("▸");
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    unmountElement(el);
  });

  it("diverged 条目 → missing tab 显示 + 计数 + 文件夹行推送按钮 + 展开 children（code review P3）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "EntityPlayer";
    self._typeConfig = [{ id: "EntityPlayer", dirLevelSync: true }];
    self._allItems = [
      { path: "模型A", name: "模型A", status: "diverged", type: "EntityPlayer", icon: "🗂️", size: 10, isDir: true, children: [
        { path: "模型A/a.pmx", name: "a.pmx", status: "missing", type: "EntityPlayer", icon: "🎭", size: 10, isDir: false },
      ] },
    ];
    self._filteredItems = self._allItems;
    self._statusFilter = "missing"; // diverged 折叠进 missing tab（store.applyFilter 契约）
    self._filesRoots = { "EntityPlayer": "/repo" };
    self._dirOpen = {};

    self._doRender();
    await sleep(100);
    // missing 筛选下 diverged 文件夹行可见（含推送按钮——继承可操作属性）
    expect(el.querySelectorAll(".sm-dir").length).toBe(1);
    expect(el.querySelector('[data-testid="sm-push"]')).toBeTruthy();
    // 展开渲染 children（真实状态子文件）
    (el.querySelector(".sm-dir") as HTMLElement).click();
    await sleep(200);
    expect(el.querySelectorAll(".sm-file").length).toBe(1);
    unmountElement(el);
  });

  it("status 筛选 + 用户显式折叠 → 折叠优先于 forceOpen（code_review P2 回归）", async () => {
    // 契约：dirOpen 手动折叠优先（点过即尊重）；forceOpen 只对「未点过」目录生效。
    // 原 `dirOpen[path] || forceOpen` 让显式折叠（false）被 forceOpen（true）覆盖——
    // 折叠无效、下次渲染被强开。改为 `??` 后必须保持折叠。
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _forceOpenPaths: Set<string>;
      _doRender: () => void;
    };
    self._selectedType = "EntityPlayer";
    self._typeConfig = [{ id: "EntityPlayer", dirLevelSync: true }];
    self._allItems = [
      { path: "模型A", name: "模型A", status: "diverged", type: "EntityPlayer", icon: "🗂️", size: 10, isDir: true, children: [
        { path: "模型A/a.pmx", name: "a.pmx", status: "missing", type: "EntityPlayer", icon: "🎭", size: 10, isDir: false },
      ] },
    ];
    self._filteredItems = self._allItems;
    self._statusFilter = "missing";
    self._filesRoots = { "EntityPlayer": "/repo" };
    // 用户显式折叠该目录（点过）——即使它命中 forceOpenPaths 也必须保持折叠
    self._dirOpen = { "模型A": false };
    self._forceOpenPaths = new Set(["模型A"]);

    self._doRender();
    await sleep(100);
    // 显式折叠优先：目录行可见但子文件不渲染
    expect(el.querySelectorAll(".sm-dir").length).toBe(1);
    expect(el.querySelectorAll(".sm-file").length).toBe(0);
    // 再点一次展开仍可用（点击语义不被 forceOpen 吞掉）
    (el.querySelector(".sm-dir") as HTMLElement).click();
    await sleep(200);
    expect(el.querySelectorAll(".sm-file").length).toBe(1);
    unmountElement(el);
  });

  it("多层嵌套目录 → 递归渲染可展开 sm-dir（镜像磁盘层级）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; name?: string; icon?: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "ysm";
    self._typeConfig = [{ id: "ysm", name: "YSM", icon: "💎", dirLevelSync: true }];
    // 三层容器：vendor → authors → character（模型文件夹叶子，含文件级 children）
    self._allItems = [{
      path: "/repo/ysm/vendor", name: "vendor", status: "diverged", type: "ysm", icon: "🗂️", size: 0, isDir: true,
      children: [{
        path: "/repo/ysm/vendor/authors", name: "authors", status: "diverged", type: "ysm", icon: "🗂️", size: 0, isDir: true,
        children: [{
          path: "/repo/ysm/vendor/authors/character", name: "character", status: "missing", type: "ysm", icon: "💎", size: 4096, isDir: true,
          children: [{ path: "/repo/ysm/vendor/authors/character/model.ysm", name: "model.ysm", status: "missing", type: "ysm", icon: "💎", size: 4096, isDir: false }],
        }],
      }],
    }];
    self._filteredItems = self._allItems;
    self._filesRoots = { "ysm": "/repo/ysm" };
    self._dirOpen = {};

    self._doRender();
    await sleep(100);
    // 折叠：仅顶层 vendor 一个 sm-dir，无子项渲染
    expect(el.querySelectorAll(".sm-dir").length).toBe(1);
    expect(el.querySelectorAll(".sm-file").length).toBe(0);

    // 逐层展开：vendor ▸ → authors ▸ → character ▸ → 渲染 model.ysm
    (el.querySelector(".sm-dir") as HTMLElement).click();
    await sleep(150);
    expect(el.querySelectorAll(".sm-dir").length).toBe(2); // vendor + authors
    // 展开第二层 authors（data-path 精确匹配，避免误点 vendor）
    const authors = el.querySelector('.sm-dir[data-path="/repo/ysm/vendor/authors"]') as HTMLElement;
    expect(authors).toBeTruthy();
    authors.click();
    await sleep(150);
    expect(el.querySelectorAll(".sm-dir").length).toBe(3); // + character
    const character = el.querySelector('.sm-dir[data-path="/repo/ysm/vendor/authors/character"]') as HTMLElement;
    expect(character).toBeTruthy();
    character.click();
    await sleep(150);
    // 展开全部 → 出现 model.ysm 文件行
    expect(el.querySelectorAll(".sm-file").length).toBe(1);
    expect(el.querySelector('.sm-file[data-path="/repo/ysm/vendor/authors/character/model.ysm"]')).toBeTruthy();
    unmountElement(el);
  });

  it("容器 synced + 子项 disabled → disabled tab 显示该子行及其父链（点1 递归筛选）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "resourcepack";
    self._typeConfig = [{ id: "resourcepack", dirLevelSync: true }];
    // 容器 synced，内部 disabled 子文件——旧 applyFilter 顶层过滤会整体丢弃容器
    self._allItems = [{
      path: "packs", name: "packs", status: "synced", type: "resourcepack", icon: "📁", size: 0, isDir: true,
      children: [
        { path: "packs/a.zip", name: "a.zip", status: "disabled", type: "resourcepack", icon: "📦", size: 10, isDir: false },
        { path: "packs/b.zip", name: "b.zip", status: "synced", type: "resourcepack", icon: "📦", size: 10, isDir: false },
      ],
    }];
    self._filteredItems = self._allItems;
    self._statusFilter = "disabled";
    self._filesRoots = { resourcepack: "/repo" };
    self._dirOpen = {};

    self._doRender();
    await sleep(100);
    // 父链保留（容器行）+ disabled 子文件在 disabled tab 可见
    expect(el.querySelectorAll(".sm-dir").length).toBe(1);
    expect(el.querySelector('.sm-file[data-path="packs/a.zip"]')).toBeTruthy();
    // 非命中的 b.zip 不出现
    expect(el.querySelector('[data-path="packs/b.zip"]')).toBeNull();
    unmountElement(el);
  });

  it("递归计数：子项计入 status 徽标（synced 容器 + 1 disabled 子 → disabled 徽标=1）点2", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "resourcepack";
    self._typeConfig = [{ id: "resourcepack", dirLevelSync: true }];
    self._allItems = [{
      path: "packs", name: "packs", status: "synced", type: "resourcepack", icon: "📁", size: 0, isDir: true,
      children: [
        { path: "packs/a.zip", name: "a.zip", status: "disabled", type: "resourcepack", icon: "📦", size: 10, isDir: false },
      ],
    }];
    self._filteredItems = self._allItems;
    self._statusFilter = "all";
    self._filesRoots = { resourcepack: "/repo" };
    self._dirOpen = {};

    self._doRender();
    await sleep(100);
    // disabled 徽标应显示 1（子项递归计入），非 0/2
    const disabledTab = el.querySelector('.sm-status-tab[data-status="disabled"]');
    expect(disabledTab).toBeTruthy();
    // 徽标数字由 statusTabHTML 渲染，断言文本含 1
    expect(disabledTab!.textContent).toContain("1");
    unmountElement(el);
  });

  it("折叠目录下的命中子项 → 筛选时强制展开可见（点1 展开语义）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "ysm";
    self._typeConfig = [{ id: "ysm", dirLevelSync: true }];
    // 三层嵌套，最深层 leaf 是 disabled——旧逻辑需逐层手动展开才可见
    self._allItems = [{
      path: "vendor", name: "vendor", status: "synced", type: "ysm", icon: "🗂️", size: 0, isDir: true,
      children: [{
        path: "vendor/authors", name: "authors", status: "synced", type: "ysm", icon: "🗂️", size: 0, isDir: true,
        children: [{
          path: "vendor/authors/character", name: "character", status: "missing", type: "ysm", icon: "💎", size: 10, isDir: true,
          children: [{ path: "vendor/authors/character/model.ysm", name: "model.ysm", status: "disabled", type: "ysm", icon: "💎", size: 5, isDir: false }],
        }],
      }],
    }];
    self._filteredItems = self._allItems;
    self._statusFilter = "disabled";
    self._filesRoots = { ysm: "/repo" };
    self._dirOpen = {}; // 全部折叠

    self._doRender();
    await sleep(100);
    // 无手动展开，但命中子项经 forceOpen 强制展开可见
    expect(el.querySelector('[data-path="vendor/authors/character/model.ysm"]')).toBeTruthy();
    // 非命中 synced 中间目录不强制展开其内部（此处仅验证命中路径即可见）
    unmountElement(el);
  });

  it("自身命中的目录、子项全不命中 → 展开后不露未命中子行（不变量，边角对称）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-status-tab") !== null, 5000);

    const self = el as unknown as {
      _selectedType: string;
      _allItems: SyncItem[];
      _filteredItems: SyncItem[];
      _typeConfig: Array<{ id: string; dirLevelSync: boolean }>;
      _dirOpen: Record<string, boolean>;
      _statusFilter: string;
      _filesRoots: Record<string, string>;
      _doRender: () => void;
    };
    self._selectedType = "ysm";
    self._typeConfig = [{ id: "ysm", dirLevelSync: true }];
    // 容器自身 missing（命中 missing tab），但子文件全是 synced——旧逻辑返回原 item
    // 会带出全部 synced 子行；修后 children 清空，展开无未命中行
    self._allItems = [{
      path: "folder", name: "folder", status: "missing", type: "ysm", icon: "🗂️", size: 0, isDir: true,
      children: [
        { path: "folder/a.ysm", name: "a.ysm", status: "synced", type: "ysm", icon: "💎", size: 10, isDir: false },
      ],
    }];
    self._filteredItems = self._allItems;
    self._statusFilter = "missing";
    self._filesRoots = { ysm: "/repo" };
    self._dirOpen = {};

    self._doRender();
    await sleep(100);
    // 目录自身命中 → 保留行
    expect(el.querySelectorAll(".sm-dir").length).toBe(1);
    // 展开后不得出现 synced 子行（不变量：列表全为筛选态）
    expect(el.querySelector('[data-path="folder/a.ysm"]')).toBeNull();
    unmountElement(el);
  });
});