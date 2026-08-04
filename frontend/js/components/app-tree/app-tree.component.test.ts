// ===== app-tree 组件编排测试（组件级测试样板 2）=====
// 生命周期：connectedCallback 订阅 → disconnectedCallback 清理（bus 配对）
// 验证：mount 渲染树容器 / tree:reload 经 registry 触发重载 / disconnected 后 emit 不再触发
// 注：bus-handlers 的 reload 走 registry.get("loadEntries")（index.ts 的 _load 直接 import），
// 测试注册 registry spy 验证 bus 订阅生效
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// mock bindings（静态 import 全导出），阻断 Wails runtime 加载链
vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  ToggleModelEnable: vi.fn().mockResolvedValue(undefined),
  SelectDirectory: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  RenameFile: vi.fn().mockResolvedValue(undefined),
  ScanModelEntries: vi.fn().mockResolvedValue([]),
  IsFileBanned: vi.fn().mockResolvedValue(false),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  SyncCustomToRepo: vi.fn().mockResolvedValue(undefined),
}));

import { bus } from "../../bus.ts";
import { register, clear as clearRegistry } from "../../services/registry.ts";
import { loadEntries } from "./loader.ts";
import "./index.ts"; // 触发 customElements.define("app-tree")

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

function mount(): HTMLElement {
  const el = document.createElement("app-tree");
  document.body.appendChild(el);
  return el;
}

function unmount(el: HTMLElement): void {
  document.body.removeChild(el);
}

describe("app-tree 生命周期配对", () => {
  let loadSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    clearRegistry();
    // bus-handlers 的 reload 走 registry.get("loadEntries")——注入 spy 验证触发
    loadSpy = vi.fn(loadEntries);
    register("loadEntries", loadSpy);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    clearRegistry();
  });

  it("connected → 渲染树容器（#tree 存在，生命周期跑通）", async () => {
    const el = mount();
    await sleep(150);
    expect(el.shadowRoot?.querySelector("#tree")).toBeTruthy();
    unmount(el);
  });

  it("tree:reload → 触发 registry loadEntries（bus 订阅生效）", async () => {
    const el = mount();
    await sleep(150);
    loadSpy.mockClear();
    bus.emit("tree:reload");
    await sleep(150);
    expect(loadSpy).toHaveBeenCalled(); // bus-handlers reload(vm) → get("loadEntries")
    unmount(el);
  });

  it("disconnected → 订阅清理（tree:reload 不再触发 loadEntries）", async () => {
    const el = mount();
    await sleep(150);
    unmount(el);
    loadSpy.mockClear();
    bus.emit("tree:reload");
    await sleep(150);
    expect(loadSpy).not.toHaveBeenCalled(); // 订阅已随 disconnectedCallback 清理
  });
});
