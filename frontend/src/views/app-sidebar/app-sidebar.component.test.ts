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
// 正向等待一律 waitFor 条件轮询（原固定 sleep 慢机不够即假红，审计 P2）；
// 仅两处防抖/清理的**负向窗口**保留真实 sleep（须等满定时器窗口才能断言「没发生」），
// 已在各处注释标明。waitFor 定义见 src/test-utils/index.ts。
import { sleep, waitFor, mountCustomElement, unmountElement } from "../../test-utils/index.ts";

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
    // 原 sleep(120)：等 connectedCallback 末尾 setTimeout(_reload, 50)——改条件轮询
    await waitFor(() => spy.mock.calls.length > 0);
    expect(spy).toHaveBeenCalled();
  });

  it("stats:refresh → 防抖后重新 _reload（300ms 合并）", async () => {
    const spy = spyLoad();
    mountCustomElement("app-sidebar");
    await waitFor(() => spy.mock.calls.length > 0); // 等初始加载完成（原 sleep(120)）
    spy.mockClear();
    bus.emit("stats:refresh");
    bus.emit("stats:refresh");
    bus.emit("stats:refresh"); // 快速连发 3 次
    await waitFor(() => spy.mock.calls.length > 0); // 防抖触发首次 _reload
    // 防抖语义断言「恰好 1 次」必须等满整个防抖窗口——waitFor 只能确认「发生了」，
    // 确认「不再多调」需真实走过 300ms 定时器，故此处保留语义性等待
    await sleep(320);
    expect(spy).toHaveBeenCalledTimes(1); // 防抖合并为 1 次
  });

  it("disconnected → 订阅清理（emit 不再触发 _reload）", async () => {
    const spy = spyLoad();
    const el = mountCustomElement("app-sidebar");
    await waitFor(() => spy.mock.calls.length > 0); // 等初始 _reload（原 sleep(120)）
    spy.mockClear();
    unmountElement(el);
    bus.emit("stats:refresh");
    // 负向断言必须真等满防抖窗口：若清理失效，_reload 会在 ~300ms 后触发；
    // 等「不会到来」的调用无法用 waitFor（永远轮询不到），故保留语义性等待
    await sleep(380);
    expect(spy).not.toHaveBeenCalled(); // 订阅已随 disconnectedCallback 清理
  });

  it("localStorage 存非默认 rtype → 首屏 _reload 用该 rtype（缺省属性不回落 YSM）", async () => {
    // 回归：tpl.ts 挂载 <app-sidebar> 不传 rtype 属性，构造函数此前恒回落 YSM，
    // 导致整合包视图首屏标题显示 (ysm)，须手动切一次导航标签才被 repo:rtype-changed 纠正。
    // 修复：构造函数读 currentRepoType()（localStorage repo_rtype 权威源），与仓库页
    // initRepositoryPage 的 savedRtype 恢复逻辑对齐。
    localStorage.setItem("repo_rtype", "EntityPlayer");
    try {
      const spy = spyLoad();
      mountCustomElement("app-sidebar");
      // 原 sleep(120)：等首屏 _reload——改条件轮询（慢机上 50ms 定时器未必已完成）
      await waitFor(() => spy.mock.calls.length > 0);
      // 首次 _reload 即携带权威类型，而非 YSM
      expect(spy).toHaveBeenCalledWith("EntityPlayer", undefined);
    } finally {
      localStorage.removeItem("repo_rtype");
    }
  });

  it("localStorage 为空 → 回落默认 YSM（行为不变）", async () => {
    localStorage.removeItem("repo_rtype");
    const spy = spyLoad();
    mountCustomElement("app-sidebar");
    // 原 sleep(120)：等 connectedCallback 末尾 setTimeout(_reload, 50)——改条件轮询
    await waitFor(() => spy.mock.calls.length > 0);
    expect(spy).toHaveBeenCalledWith("ysm", undefined);
  });
});
