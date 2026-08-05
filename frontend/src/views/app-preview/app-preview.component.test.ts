// ===== app-preview 组件编排测试（组件级测试样板 3）=====
// 生命周期：connectedCallback 订阅 model:select → disconnectedCallback 清理
// 验证：mount 渲染默认面板 / model:select 触发类型分流 / disconnected 后不再触发
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 阻断 Wails runtime 加载链：全链静态 import getApp（wails/app.ts）。
// 注意 preview-wasm 从 getApp() 解构 ReadFileBytes（非 bindings import）——mock 需提供完整绑定
vi.mock("../../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ReadFileBytes: vi.fn().mockResolvedValue(null),
    DetectResourceType: vi.fn().mockResolvedValue("shaderpack"),
    ScanModelEntries: vi.fn().mockResolvedValue([]),
    GetRepoRoot: vi.fn().mockResolvedValue(""),
    LoadAppConfig: vi.fn().mockResolvedValue({}),
    ExtractYsmSummary: vi.fn().mockResolvedValue(null),
    ExtractYSMHeader: vi.fn().mockResolvedValue(null),
    FindPreviewImage: vi.fn().mockResolvedValue(""),
    ExtractPreviewTexture: vi.fn().mockResolvedValue(""),
    LoadResourceTypes: vi.fn().mockResolvedValue("{}"),
  }),
}));

// mock bindings（app-preview 全部动态 import）：DetectResourceType 用于分流断言。
// 返回 "shaderpack"（RESOURCE_TYPES.SHADER）→ _showModelDetail 走 showShaderPack
// （仅渲染图标+名称，无 bindings 深链），避免 showModelDetail 链的 ReadFileBytes 等
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  DetectResourceType: vi.fn().mockResolvedValue("shaderpack"),
  ReadFileBytes: vi.fn().mockResolvedValue(new Uint8Array()),
  FindPreviewImage: vi.fn().mockResolvedValue(""),
  ExtractPreviewTexture: vi.fn().mockResolvedValue(""),
  ExtractYsmSummary: vi.fn().mockResolvedValue(null),
  ExtractYSMHeader: vi.fn().mockResolvedValue(null),
  LoadResourceTypes: vi.fn().mockResolvedValue("{}"),
  GetPackInfo: vi.fn().mockResolvedValue(null),
  LoadAppConfig: vi.fn().mockResolvedValue({}),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
}));

import { bus } from "../../bus.ts";
import { DetectResourceType } from "../../../bindings/ysm-model-manager/internal/app/app.js";
import "./index.ts"; // 触发 customElements.define("app-preview")
import { sleep, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

describe("app-preview 生命周期配对", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.mocked(DetectResourceType).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("connected → 渲染默认面板（#preview-content 存在）", async () => {
    const el = mountCustomElement("app-preview");
    await sleep(50);
    expect(el.shadowRoot?.querySelector("#preview-content")).toBeTruthy();
    unmountElement(el);
  });

  it("model:select → 分流渲染（shaderpack 标签出现）", async () => {
    const el = mountCustomElement("app-preview");
    await sleep(50);
    bus.emit("model:select", { path: "/repo/a.ysm", isDir: false });
    await sleep(100);
    // DetectResourceType mock 返回 "shaderpack" → showShaderPack 渲染 `📦 shaderpack`
    const content = el.shadowRoot?.querySelector("#preview-content")?.textContent || "";
    expect(content).toContain("shaderpack");
    unmountElement(el);
  });

  it("disconnected → 订阅清理（model:select 不再重写 detached DOM）", async () => {
    const el = mountCustomElement("app-preview");
    await sleep(50);
    const before = el.shadowRoot?.innerHTML || "";
    unmountElement(el);
    bus.emit("model:select", { path: "/repo/a.ysm", isDir: false });
    await sleep(100);
    // handler 已随 disconnectedCallback 清理：emit 不再触发 _showModelDetail 重写 innerHTML
    expect(el.shadowRoot?.innerHTML).toBe(before);
  });
});
