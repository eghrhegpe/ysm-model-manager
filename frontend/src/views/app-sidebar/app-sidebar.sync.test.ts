// ===== app-sidebar 交互补充测试（sync/index 低覆盖分支）=====
// 覆盖：全选/恢复勾选、推送（无勾选/成功/skipped）、
//       拉取（成功/无多余/失败）、_reload 失败分支
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc" }),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  PullResourceFromInstance: vi.fn().mockResolvedValue(0),
}));

// registry.ts 已删（架构锐评 P1-2 修正版）：loader 假实现注入改标准 vi.mock
vi.mock("./loader.ts", () => ({ loadInstances: vi.fn() }));

import { bus } from "../../bus.ts";
import { loadInstances } from "./loader.ts";
import "./index.ts"; // customElements.define("app-sidebar")
import { mountCustomElement, unmountElement, waitFor } from "../../test-utils/index.ts";
import type { SidebarInstance } from "./data.ts";

/** loader mock 句柄（各用例 mockImplementation 设假数据，beforeEach mockReset 防泄漏） */
const loadInstancesMock = vi.mocked(loadInstances);

function makeInstances(): SidebarInstance[] {
  return [
    {
      name: "insA",
      dir: "/inst/insA",
      exists: true,
      hasMod: true,
      status: "complete",
      synced: 3,
      missing: 0,
      extra: 1,
      disabled: 0,
      rtype: "ysm",
      variantGroups: null,
      _missingPaths: [],
      _extraPaths: [],
      // 类型要求 { synced: unknown[]; missing?; extra?; disabled? } 对象（宽松兼容
      // loader 的 {synced,disabled} 与 fallback 的 {synced,missing,extra}）——
      // 传 [] 会触发 TS2741，破坏 typecheck 门槛
      items: { synced: [] },
    },
  ];
}

// bus 事件收集
const toasts: Array<{ msg: string; type: string }> = [];
const statsRefreshed: Array<boolean> = [];
const treeReloads: Array<boolean> = [];
const missingPayloads: Array<{ token?: string }> = [];
const offs: Array<() => void> = [];

beforeEach(async () => {
  loadInstancesMock.mockReset();
  document.body.innerHTML = "";
  toasts.length = 0;
  statsRefreshed.length = 0;
  treeReloads.length = 0;
  missingPayloads.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as { msg: string; type: string })));
  offs.push(bus.on("stats:refresh", () => statsRefreshed.push(true)));
  offs.push(bus.on("tree:reload", () => treeReloads.push(true)));
  offs.push(
    bus.on("sync:download:missing", (p) => {
      missingPayloads.push(p as { token?: string });
    }),
  );
  // vi.clearAllMocks 不清 mock 实现：显式重置拉取 mock，防跨测试泄漏
  const { PullResourceFromInstance } = await import(
    "../../../bindings/ysm-model-manager/internal/app/app.js"
  );
  (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue(0);
});

afterEach(() => {
  offs.forEach((fn) => fn());
  offs.length = 0;
  document.body.innerHTML = "";
});

// _checkedSets 是模块级持久 Map（跨重新渲染保持勾选）：每个测试用唯一 rtype 隔离，
// 避免上一个测试的勾选被 _restoreCheckboxes 自动恢复污染下一个测试
let rtypeSeq = 0;
const uniqueRtype = (): string => `ysm-test-${++rtypeSeq}`;

async function mountSidebar(
  instances: SidebarInstance[] = makeInstances(),
  rtype: string = uniqueRtype(),
): Promise<HTMLElement> {
  loadInstancesMock.mockImplementation(async () => instances);
  const el = mountCustomElement("app-sidebar");
  // 用测试专用 rtype 隔离 _checkedSets；attributeChangedCallback 会带新 rtype 重新加载
  if (rtype !== "ysm") el.setAttribute("rtype", rtype);
  // 等卡片渲染完成（含 connectedCallback 50ms 防抖 + async _reload）
  await waitFor(() => el.shadowRoot!.querySelector(".chk"));
  return el as HTMLElement;
}

function $<T extends Element>(el: HTMLElement, sel: string): T {
  return el.shadowRoot!.querySelector(sel) as T;
}

/** 勾选第一个实例 */
function checkFirst(el: HTMLElement): void {
  const chk0 = el.shadowRoot!.querySelector(".chk") as HTMLInputElement;
  chk0.checked = true;
  chk0.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("app-sidebar — 全选/恢复勾选", () => {
  it("勾选全选 → 所有 .chk 被选中并写入持久化集合", async () => {
    const el = await mountSidebar();
    const cb = $<HTMLInputElement>(el, "#sb-select-all");

    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    const chks = el.shadowRoot!.querySelectorAll(".chk") as NodeListOf<HTMLInputElement>;
    expect(chks.length).toBeGreaterThan(0);
    chks.forEach((c) => expect(c.checked).toBe(true));
  });

  it("重新挂载 → 恢复已勾选状态", async () => {
    const rtype = "restore-test";
    const el = await mountSidebar(makeInstances(), rtype);
    checkFirst(el);

    unmountElement(el);
    const el2 = await mountSidebar(makeInstances(), rtype);
    const restored = el2.shadowRoot!.querySelector(".chk") as HTMLInputElement;
    expect(restored.checked).toBe(true);
  });
});

describe("app-sidebar — 推送所选", () => {
  it("未勾选 → info toast 提示先勾选", async () => {
    const el = await mountSidebar();
    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");
    pushBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-push-menu");
    menu.querySelector(".dd-item")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitFor(() => toasts.length > 0);
    expect(toasts.some((t) => t.msg.includes("请先勾选要推送的整合包"))).toBe(true);
  });

  it("推送成功 → emit missing + done 配对 → 成功 toast + 按钮恢复", async () => {
    const el = await mountSidebar();
    checkFirst(el);

    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");
    pushBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-push-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    // P1 修复（审核）：组件改为逐类型串行 emit+await（原并发 emit 全部类型只推第 1 类），
    // 测试相应改为 waitFor 循环响应式补 done——每轮把已收集的 token 全部应答，
    // 组件串行推进到全部类型完成，直至成功 toast 出现
    await waitFor(() => {
      for (const p of missingPayloads) {
        bus.emit("sync:download:done", {
          ...(p.token !== undefined ? { token: p.token } : {}),
          instanceName: "insA",
          // 不再带 rtype：BusEvents["sync:download:done"] 无该字段（TS2353），
          // 真实生产者 sync.ts 也从不发，组件 handler 只匹配 token——删掉恢复类型门槛
        });
      }
      return toasts.some((t) => t.msg.includes("推送完成"));
    });
    // 成功 toast 不带 type（默认 success），用 `!t.type || success` 精确锁定
    expect(toasts.some((t) => (!t.type || t.type === "success") && t.msg.includes("推送完成：1 个整合包"))).toBe(true);
    expect(pushBtn.disabled).toBe(false);
    expect(pushBtn.textContent).toBe("⬆️ 推送所选 ▾");
  });

  it("推送 skipped → warn toast（被吞请求不误报成功）", async () => {
    const el = await mountSidebar();
    checkFirst(el);

    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");
    pushBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-push-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    // 同上：串行 emit 下 waitFor 循环响应式补 skipped done
    await waitFor(() => {
      for (const p of missingPayloads) {
        bus.emit("sync:download:done", { ...(p.token !== undefined ? { token: p.token } : {}), skipped: true });
      }
      return toasts.some((t) => t.type === "warn" && t.msg.includes("推送完成"));
    });
    // P3 修复（审核发现）：skipped 与超时分别计数——文案为「被跳过」而非「超时」
    expect(toasts.some((t) => t.msg.includes("被跳过"))).toBe(true);
    expect(pushBtn.disabled).toBe(false);
    expect(pushBtn.textContent).toBe("⬆️ 推送所选 ▾");
  });

  it("错误 token 的 done 不解锁（P2 修复防线负向验证）", async () => {
    const el = await mountSidebar();
    checkFirst(el);

    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");
    pushBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-push-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await waitFor(() => missingPayloads.length > 0);

    // 发错误 token + 匹配 instanceName——旧实现 `|| payload?.instanceName === insName`
    // 会误判成功（P1 bug 回退防线）；负向验证：按钮保持锁定、无完成 toast
    bus.emit("sync:download:done", { token: "WRONG-TOKEN", instanceName: "insA" });
    await new Promise((r) => setTimeout(r, 50));
    expect(pushBtn.disabled).toBe(true);
    expect(toasts.some((t) => t.msg.includes("推送完成"))).toBe(false);

    // 清理：waitFor 循环补发正确 token 让串行 promise 全部 settle，避免挂起 30s timer
    await waitFor(() => {
      for (const p of missingPayloads) {
        bus.emit("sync:download:done", p.token !== undefined ? { token: p.token } : {});
      }
      return pushBtn.disabled === false;
    });
  });
});

describe("app-sidebar — 拉取所选", () => {
  it("拉取成功（有文件）→ toast + stats:refresh + tree:reload", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // ALL_RESOURCE_TYPES × 每类型 1 个文件 = 全部拉取
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const el = await mountSidebar();
    checkFirst(el);

    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitFor(() => toasts.some((t) => t.msg.includes("拉取完成，共")));
    await waitFor(() => statsRefreshed.length > 0);
    expect(treeReloads.length).toBeGreaterThan(0);
  });

  it("拉取无多余文件 → info toast", async () => {
    const el = await mountSidebar();
    checkFirst(el);

    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitFor(() => toasts.some((t) => t.msg.includes("没有可拉取的文件")));
  });

  it("拉取失败 → warn toast（部分失败计数）+ 按钮恢复", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // reject 被 Promise.allSettled 捕获 → failed 计数 → warn toast（非 error）
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("boom"),
    );
    const el = await mountSidebar();
    checkFirst(el);

    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitFor(() =>
      toasts.some((t) => t.type === "warn" && t.msg.includes("拉取完成") && t.msg.includes("失败")),
    );
    expect(pullBtn.disabled).toBe(false);
    expect(pullBtn.textContent).toBe("⬇️ 拉取所选 ▾");
  });
});

describe("app-sidebar — _reload 失败分支", () => {
  it("loadInstances 抛错 → 实例清空且不抛", async () => {
    loadInstancesMock.mockImplementation(async () => {
      throw new Error("boom");
    });
    const el = mountCustomElement("app-sidebar");
    // 不抛异常即通过；等渲染兜底完成
    await waitFor(() => el.shadowRoot!.querySelector(".ws-empty"));
    unmountElement(el);
  });
});

describe("app-sidebar — _reload 并发（pending 补跑防 rtype 错配）", () => {
  it("reload 进行中 rtype 切换 → 不直接执行，完成后用最新 rtype 补跑", async () => {
    const calls: string[] = [];
    let resolvers: Array<(v: SidebarInstance[]) => void> = [];
    loadInstancesMock.mockImplementation((rtype: string) => {
      calls.push(rtype);
      return new Promise<SidebarInstance[]>((res) => resolvers.push(res));
    });
    const el = mountCustomElement("app-sidebar");
    // 初始 reload 挂起（connectedCallback 50ms 防抖）
    await waitFor(() => calls.length === 1);
    expect(calls).toEqual(["ysm"]);
    // rtype 切换 → attributeChangedCallback → _reload，但 _loading 中 → 仅标记 pending，
    // 不产生第二次 loadInstances 调用（防止旧 rtype 数据覆盖新 rtype）
    el.setAttribute("rtype", "ysm-test-pending");
    await waitFor(() => resolvers.length === 1);
    expect(calls).toEqual(["ysm"]);
    // 放行首次 → 完成后检测到 pending → 用最新 rtype 补跑
    resolvers.shift()!([makeInstances()[0]]);
    await waitFor(() => calls.length === 2);
    expect(calls[1]).toBe("ysm-test-pending");
    // 放行补跑 → 最终渲染新 rtype 的卡片
    resolvers.shift()!([makeInstances()[0]]);
    await waitFor(() => el.shadowRoot!.querySelector(".chk"));
  });
});
