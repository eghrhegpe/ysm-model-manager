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

import { bus } from "../../bus.ts";
import { register, clear as clearRegistry } from "../../services/registry.ts";
import "./index.ts"; // customElements.define("app-sidebar")
import { mountCustomElement, unmountElement, waitFor } from "../../test-utils/index.ts";
import type { SidebarInstance } from "./data.ts";

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
      items: [],
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
  clearRegistry();
  document.body.innerHTML = "";
  toasts.length = 0;
  statsRefreshed.length = 0;
  treeReloads.length = 0;
  missingPayloads.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as never)));
  offs.push(bus.on("stats:refresh", () => statsRefreshed.push(true)));
  offs.push(bus.on("tree:reload", () => treeReloads.push(true)));
  offs.push(
    bus.on("sync:download:missing", (p) => {
      missingPayloads.push(p as never);
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
  clearRegistry();
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
  register("loadInstances", vi.fn(async () => instances));
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
    // handler 同步 emit sync:download:missing（ALL_RESOURCE_TYPES 每类型一个 token）
    await waitFor(() => missingPayloads.length > 0);
    // 全部 token 响应 done → failed=0 → 成功 toast
    for (const p of missingPayloads) {
      bus.emit("sync:download:done", {
        token: p.token,
        instanceName: "insA",
        rtype: (p as { rtype?: string }).rtype,
      });
    }

    await waitFor(() => toasts.some((t) => t.msg.includes("推送完成")));
    expect(toasts.some((t) => t.type !== "warn" && t.msg.includes("推送完成：1 个整合包"))).toBe(true);
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
    await waitFor(() => missingPayloads.length > 0);
    // 全部 skipped → 全部按拒绝处理 → warn toast（不误报成功）
    for (const p of missingPayloads) {
      bus.emit("sync:download:done", { token: p.token, skipped: true });
    }

    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("推送完成")));
    expect(toasts.some((t) => t.msg.includes("操作超时"))).toBe(true);
    expect(pushBtn.disabled).toBe(false);
  });
});

describe("app-sidebar — 拉取所选", () => {
  it("拉取成功（有文件）→ toast + stats:refresh + tree:reload", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // ALL_RESOURCE_TYPES 共 7 类型 × 每类型 1 个文件 = 7
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    const el = await mountSidebar();
    checkFirst(el);

    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    menu.querySelector('.dd-item[data-sync-type="all"]')!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitFor(() => toasts.some((t) => t.msg.includes("拉取完成，共 7 个文件")));
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
    register("loadInstances", vi.fn(async () => {
      throw new Error("boom");
    }));
    const el = mountCustomElement("app-sidebar");
    // 不抛异常即通过；等渲染兜底完成
    await waitFor(() => el.shadowRoot!.querySelector(".ws-empty"));
    unmountElement(el);
  });
});
