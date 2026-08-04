// ===== app-sidebar 组件编排测试（组件级测试样板）=====
// 生命周期：connectedCallback 订阅 → disconnectedCallback 清理（bus 配对）
// 守卫：stats:refresh 300ms 防抖合并（多次 emit 只 reload 一次）
// 依赖：loader.ts 经 bindings 加载 Wails runtime——mock bindings 阻断（同 loader.test.ts）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc" }),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
}));

import { bus } from "../../bus.ts";
import { register, clear as clearRegistry } from "../../services/registry.ts";
import { loadInstances } from "./loader.ts";
import "./index.ts"; // 触发 customElements.define("app-sidebar")
import { sleep, mountCustomElement, unmountElement } from "../../test-utils.ts";

/** loadInstances 调用计数（registry 注入 spy，验证 _reload 触发与清理） */
function spyLoad(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(loadInstances);
  register("loadInstances", spy);
  return spy;
}

describe("app-sidebar 生命周期配对", () => {
  beforeEach(() => {
    clearRegistry();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    clearRegistry();
    document.body.innerHTML = "";
  });

  it("connected → 初始 _reload（spy 被调）", async () => {
    const spy = spyLoad();
    mountCustomElement("app-sidebar");
    // connectedCallback 末尾 setTimeout(_reload, 50)
    await sleep(120);
    expect(spy).toHaveBeenCalled();
  });

  it("stats:refresh → 防抖后重新 _reload（300ms 合并）", async () => {
    const spy = spyLoad();
    mountCustomElement("app-sidebar");
    await sleep(120); // 初始加载完成
    spy.mockClear();
    bus.emit("stats:refresh");
    bus.emit("stats:refresh");
    bus.emit("stats:refresh"); // 快速连发 3 次
    await sleep(380); // 超过 300ms 防抖
    expect(spy).toHaveBeenCalledTimes(1); // 防抖合并为 1 次
  });

  it("disconnected → 订阅清理（emit 不再触发 _reload）", async () => {
    const spy = spyLoad();
    const el = mountCustomElement("app-sidebar");
    await sleep(120);
    spy.mockClear();
    unmountElement(el);
    bus.emit("stats:refresh");
    await sleep(380);
    expect(spy).not.toHaveBeenCalled(); // 订阅已随 disconnectedCallback 清理
  });
});
