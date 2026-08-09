// ===== <app-sync-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；交互模拟类型标签切换、状态筛选、按钮点击。
// 注意：模块级变量 _lastSelectedType 在类型切换后泄漏，测试间隔离需靠 localStorage + 顺序。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

// getApp 全绑定 mock（P1 修复：mocks 提为 vi.hoisted 可引用，原内联 vi.fn 无法精确断言）
const { mocks } = vi.hoisted(() => {
  const mocks = {
    LoadResourceTypes: vi.fn().mockResolvedValue(
      JSON.stringify({
        resourceTypes: [
          { id: "ysm", name: "YSM 模型", icon: "💎" },
          { id: "mmd-skin", name: "MMD 模型", icon: "🎭" },
          { id: "vrchat-avatar", name: "VRC 模型", icon: "🥽" },
          { id: "resourcepack", name: "资源包", icon: "🎨" },
          { id: "shaderpack", name: "光影包", icon: "☀️" },
          { id: "create-blueprint", name: "蓝图", icon: "⚙️" },
          { id: "litematic", name: "投影", icon: "📐" },
        ],
      }),
    ),
    GetInstanceSyncStatus: vi.fn().mockResolvedValue(
      JSON.stringify([
        { path: "a.ysm", name: "模型A", status: "synced", type: "ysm", size: 1024 },
        { path: "b.ysm", name: "模型B", status: "missing", type: "ysm", size: 2048 },
        { path: "c.ysm", name: "模型C", status: "disabled", type: "ysm", size: 512 },
        { path: "d.ysm", name: "模型D", status: "synced", type: "ysm", size: 0 },
      ]),
    ),
    PushSingleResourceToInstance: vi.fn().mockResolvedValue(undefined),
    PullSingleResourceFromInstance: vi.fn().mockResolvedValue(undefined),
  };
  return { mocks };
});

vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    LoadResourceTypes: mocks.LoadResourceTypes,
    GetInstanceSyncStatus: mocks.GetInstanceSyncStatus,
    PushSingleResourceToInstance: mocks.PushSingleResourceToInstance,
    PullSingleResourceFromInstance: mocks.PullSingleResourceFromInstance,
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

  it("类型标签切换 → 数据过滤（P2 修复：原 if 包裹空洞通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-tab") !== null, 5000);
    const tabs = el.querySelectorAll(".sm-tab");
    expect(tabs.length).toBeGreaterThanOrEqual(3);
    const target = tabs[1] as HTMLElement;
    target.click();
    await sleep(100);
    // 点击后 active 标签与目标 data-type 一致（不再空洞通过）
    const activeTab = el.querySelector(".sm-tab.active") as HTMLElement;
    expect(activeTab).not.toBeNull();
    expect(activeTab.dataset.type).toBe(target.dataset.type);
    unmountElement(el);
  });

  it("状态筛选标签 → 切换后列表变化（P2 修复：原 if 包裹可空洞通过）", async () => {
    const el = document.createElement("app-sync-manager");
    el.setAttribute("instance", "test");
    document.body.appendChild(el);
    await waitFor(() => el.querySelector(".sm-tab") !== null, 5000);
    // 类型切换用例会改变模块级 _lastSelectedType（泄漏到本用例）——先显式切回 ysm，
    // 否则 _applyFilter 先按残留类型过滤，missing 列表为空
    const ysmTab = Array.from(el.querySelectorAll(".sm-tab")).find(
      (t) => (t as HTMLElement).dataset.type === "ysm",
    ) as HTMLElement;
    expect(ysmTab).toBeTruthy();
    ysmTab.click();
    await sleep(50);
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
});