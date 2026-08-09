// ===== <app-resource-manager> 组件级测试（G-1 — ADR-035 / Design.md §19.1）=====
// 断言基于 data-testid 稳定钩子；验证生命周期、list 渲染、detail 面板。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getByTestId, getAllByTestId, waitFor, sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";
import { bus } from "../../bus.ts";

// getApp 全绑定 mock（AppResourceManager 依赖大量 bindings）
const mockScanResult = vi.hoisted(() => [
    { Name: "pack1.zip", Path: "/repo/resourcepack/pack1.zip", enabled: true },
    { Name: "pack2.zip", Path: "/repo/resourcepack/pack2.zip", enabled: false },
  ]);
// P2 修复：mock 提为 vi.hoisted 可引用，供恒真断言改为精确断言（rtype 切换验证 ReadShaderpackLang）
const { readShaderpackLangMock, scanEntriesWithLabelMock } = vi.hoisted(() => ({
  readShaderpackLangMock: vi.fn().mockResolvedValue(
    JSON.stringify({ name: "光影包测试", entries: {} }),
  ),
  // 默认返回列表数据（与 ScanModelEntries 同源），config:updated 用例内可临时改值
  scanEntriesWithLabelMock: vi.fn().mockResolvedValue(mockScanResult),
}));
vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    GetRepoRoot: vi.fn().mockResolvedValue("/repo/resourcepack"),
    ReadPackMeta: vi.fn().mockResolvedValue(JSON.stringify({
      name: "测试资源包",
      description: "一个测试用的资源包",
      pack_format: 15,
    })),
    ScanModelEntries: vi.fn().mockResolvedValue(mockScanResult),
    ScanModelEntriesWithLabel: scanEntriesWithLabelMock,
    ToggleResourcePack: vi.fn().mockResolvedValue(undefined),
    IsResourcePackEnabled: vi.fn().mockResolvedValue(true),
    SelectImportZip: vi.fn().mockResolvedValue(""),
    SelectImportFile: vi.fn().mockResolvedValue(""),
    ImportByType: vi.fn().mockResolvedValue(undefined),
    DeleteResourcePack: vi.fn().mockResolvedValue(undefined),
    OpenFolder: vi.fn().mockResolvedValue(undefined),
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    ListVersionInstances: vi.fn().mockResolvedValue([]),
    ReadShaderpackLang: readShaderpackLangMock,
    LoadResourceTypes: vi.fn().mockResolvedValue(JSON.stringify({
      resourceTypes: [
        { id: "resourcepack", name: "资源包", icon: "🎨", actions: ["import", "toggle", "delete", "openFolder"] },
        { id: "shaderpack", name: "光影包", icon: "☀️", actions: ["import", "openFolder"] },
      ],
    })),
  }),
}));

import "./index.ts"; // 触发 customElements.define("app-resource-manager")
import { registerResourceManagerGlobal } from "./index.ts";

// P3 修复：删除 mock 不存在的 ../../resource-types.ts（死 mock，误导注释）——
// 真实配置源已在 LoadResourceTypes mock（_loadConfig 走 getApp()）
describe("app-resource-manager（testid 钩子 + 资源管理交互）", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染侧栏与列表", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const items = getAllByTestId(el, "rm-item");
    expect(items.length).toBeGreaterThanOrEqual(1);
    unmountElement(el);
  });

  it("connected → 导入按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-import"]') !== null, 5000);
    const importBtn = getByTestId(el, "rm-import")!;
    expect(importBtn).toBeTruthy();
    expect(importBtn.textContent).toContain("导入");
    unmountElement(el);
  });

  it("连接 → 打开文件夹按钮存在", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-open"]') !== null, 5000);
    const openBtn = getByTestId(el, "rm-open");
    expect(openBtn).toBeTruthy();
    unmountElement(el);
  });

  it("点击列表项 → 显示详情面板（P2 修复：原无断言，_showDetail 可完全坏掉仍绿）", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const firstItem = el.querySelector('[data-testid="rm-item"]') as HTMLElement;
    firstItem.click();
    // 详情渲染后：占位符消失，出现详情内容（删除按钮或包名文本）
    await waitFor(
      () => el.querySelector(".dp-placeholder") === null &&
        el.querySelector(".rm-del-btn") !== null,
      5000,
    );
    expect(el.querySelector(".rm-del-btn")).not.toBeNull();
    unmountElement(el);
  });

  it("rtype 属性变化 → 重新初始化并渲染新类型（P2 修复：原 expect(true) 恒真）", async () => {
    readShaderpackLangMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    // 切换到光影包类型（SHADER="shaderpack"）→ attributeChangedCallback 触发 _init 异步重建
    el.setAttribute("rtype", "shaderpack");
    // waitFor 首次检查会命中旧 rtype 残留的 rm-item（_init 尚未清空 DOM），
    // 故先 sleep 等 _init + _loadList 重建完成，再点击新列表项
    await sleep(400);
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    // 点击列表项 → _showDetail 走 ReadShaderpackLang 分支（验证 shaderpack 渲染路径真实生效）
    (el.querySelector('[data-testid="rm-item"]') as HTMLElement).click();
    await waitFor(() => readShaderpackLangMock.mock.calls.length > 0, 5000);
    expect(readShaderpackLangMock).toHaveBeenCalled();
    unmountElement(el);
  });

  it("disconnected → 移除 DOM 无残留（P2 修复：原 expect(true) 恒真）", async () => {
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    unmountElement(el);
    expect(document.querySelector("app-resource-manager")).toBeNull();
  });

  it("config:updated → 全局刷新触发实例重载（P2 修复：registerResourceManagerGlobal 零测试）", async () => {
    // 挂载实例 → 注册全局 handler → 发 config:updated → 断言实例 _init 被再次触发
    //（ScanModelEntriesWithLabel 调用次数增加，STORE._config 重置后重载）
    scanEntriesWithLabelMock.mockResolvedValue(mockScanResult);
    scanEntriesWithLabelMock.mockClear();
    const el = mountCustomElement("app-resource-manager");
    await waitFor(() => el.querySelector('[data-testid="rm-item"]') !== null, 5000);
    const callsBefore = scanEntriesWithLabelMock.mock.calls.length;

    const unsubs: Array<() => void> = [];
    registerResourceManagerGlobal(unsubs);
    bus.emit("config:updated");
    await waitFor(
      () => scanEntriesWithLabelMock.mock.calls.length > callsBefore,
      5000,
    );
    // 配置刷新后实例仍渲染列表（重载成功，未落错误态）
    expect(el.querySelector('[data-testid="rm-item"]')).not.toBeNull();
    unsubs.forEach((fn) => fn());
    unmountElement(el);
  });
});