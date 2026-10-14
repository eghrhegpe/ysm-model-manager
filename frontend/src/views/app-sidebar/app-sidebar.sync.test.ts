// ===== app-sidebar 交互补充测试（sync/index 低覆盖分支）=====
// 覆盖：全选/恢复勾选、推送（无勾选/成功/skipped/计数汇总）、
//       拉取（成功/无多余/失败）、_reload 失败分支
// ADR-340 去总线化（2026-10-14）：推送段原「bus 往返夹具」（waitFor 循环补 done、
// 错 token 负例）随协议退役，改为 mock downloadMissing 直调断言——调用次数/载荷/
// 返回值汇总直接落在函数边界上，守护面更窄（原「错误 token 不解锁」用例守护的是
// 回执匹配补丁，补丁退役即无用武之地，已删）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", () => ({
  LoadAppConfig: vi.fn().mockResolvedValue({ mcRoot: "/mc" }),
  ListVersionInstances: vi.fn().mockResolvedValue([]),
  GetResourceInstanceStatus: vi.fn().mockResolvedValue([]),
  GetRepoRoot: vi.fn().mockResolvedValue(""),
  SaveAppConfig: vi.fn().mockResolvedValue(undefined),
  GetMinecraftPaths: vi.fn().mockResolvedValue([]),
  PullResourceFromInstance: vi.fn().mockResolvedValue({ ok: 0, failed: 0 }),
  ClearScanCache: vi.fn().mockResolvedValue(undefined),
}));

// registry.ts 已删（架构锐评 P1-2 修正版）：loader 假实现注入改标准 vi.mock
vi.mock("./loader.ts", () => ({ loadInstances: vi.fn() }));

// 直调入口 mock：推送链的唯一出口（sync-flow.runPush → downloadMissing）
vi.mock("@/features/sync/sync.ts", () => ({
  downloadMissing: vi.fn().mockResolvedValue({ ok: 0, fail: 0, skipped: false }),
  registerSync: vi.fn(),
}));

// 批D：拉取超时用例需把 withTimeout 打桩（否则要真等 120s）；其余用例透传真实实现，
// 故其它推送/拉取用例行为不变。TimeoutError 保持真实类（runPull 用 instanceof 分流）。
vi.mock("@/utils/base/primitives/async.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/base/primitives/async.ts")>();
  return { ...actual, withTimeout: vi.fn(actual.withTimeout) };
});

import { bus } from "@/bus";
import { downloadMissing } from "@/features/sync/sync.ts";
import { loadInstances } from "./loader.ts";
import "./index.ts"; // customElements.define("app-sidebar")
import { waitFor, sleep } from "@/test-utils/wait.ts";
import { mountCustomElement, unmountElement } from "@/test-utils/render.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { SidebarInstance } from "./data.ts";

/** loader mock 句柄（各用例 mockImplementation 设假数据，beforeEach mockReset 防泄漏） */
const loadInstancesMock = vi.mocked(loadInstances);
/** downloadMissing mock 句柄（推送用例设返回值，beforeEach mockReset 防泄漏） */
const downloadMissingMock = vi.mocked(downloadMissing);

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
    },
  ];
}

// bus 事件收集
const toasts: Array<{ msg: string; type: string }> = [];
const statsRefreshed: Array<boolean> = [];
const treeReloads: Array<boolean> = [];
const offs: Array<() => void> = [];

beforeEach(async () => {
  loadInstancesMock.mockReset();
  // downloadMissing 是 vi.mock 工厂里的共享 fn：mockReset 清实现，须重设默认成功值，
  // 否则未显式打桩的用例拿到 undefined → runPush 读 outcome.ok 崩
  downloadMissingMock.mockReset();
  downloadMissingMock.mockResolvedValue({ ok: 0, fail: 0, skipped: false });
  document.body.innerHTML = "";
  toasts.length = 0;
  statsRefreshed.length = 0;
  treeReloads.length = 0;
  offs.forEach((fn) => fn());
  offs.length = 0;
  offs.push(bus.on("toast:show", (p) => toasts.push(p as { msg: string; type: string })));
  offs.push(bus.on("stats:refresh", () => statsRefreshed.push(true)));
  offs.push(bus.on("tree:reload", () => treeReloads.push(true)));
  // vi.clearAllMocks 不清 mock 实现：显式重置拉取 mock，防跨测试泄漏
  const { PullResourceFromInstance } = await import(
    "../../../bindings/ysm-model-manager/internal/app/app.js"
  );
  (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: 0, failed: 0 });
});

afterEach(() => {
  offs.forEach((fn) => fn());
  offs.length = 0;
  document.body.innerHTML = "";
});

// _checkedSets 是实例属性（74850d4a8 泄漏修复重构），同一组件实例内 reload 保持勾选；
// 各用例独立 mount 自带干净实例，rtype 隔离已非必须——uniqueRtype 保留供跨 rtype 场景
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

/** 点开推送/拉取菜单并选「全部类型」（推送块与拉取块共用；批D 起提到模块级） */
function clickPushAll(el: HTMLElement): void {
  clickMenuAll(el, ".sidebar-push-selected", "#sidebar-push-menu");
}

function clickPullAll(el: HTMLElement): void {
  clickMenuAll(el, ".sidebar-pull-selected", "#sidebar-pull-menu");
}

function clickMenuAll(el: HTMLElement, btnSel: string, menuId: string): void {
  $<HTMLButtonElement>(el, btnSel).click();
  const menu = $<HTMLElement>(el, menuId);
  menu
    .querySelector('.dd-item[data-sync-type="all"]')!
    .dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

  it("全选 → 跨 reload 存活（勾选集合真被写入，非只改 DOM）", async () => {
    const el = await mountSidebar();
    const cb = $<HTMLInputElement>(el, "#sb-select-all");
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    // 触发 reload：renderVersionCards 重建卡片 + restoreCheckboxes 以「勾选集合」为准恢复
    bus.emit("stats:refresh");
    await waitFor(() => {
      const c = el.shadowRoot!.querySelector(".chk") as HTMLInputElement | null;
      // 等 reload 完成（旧 DOM 被替换后新勾选框仍在）
      return c !== null && el.shadowRoot!.querySelectorAll(".chk").length > 0;
    });
    await sleep(400); // reload 防抖（300ms）+ 渲染落定
    const after = el.shadowRoot!.querySelectorAll(".chk") as NodeListOf<HTMLInputElement>;
    expect(after.length).toBeGreaterThan(0);
    // 2026-10 回归锁：原 bindSelectAll 按值捕获绑定时（connectedCallback）的空 instances 数组，
    // _reload 换的是新数组引用 → 全选只改 DOM、从未写入勾选集合，reload 后选择即蒸发。
    after.forEach((c) => expect(c.checked).toBe(true));
  });

  it("同一实例 reload → 恢复已勾选状态", async () => {
    const el = await mountSidebar();
    checkFirst(el);

    // 触发 reload：stats:refresh → 300ms 防抖 → _reload → _renderCards → restoreCheckboxes
    bus.emit("stats:refresh");
    // 等 reload 清旧 DOM、渲染新卡片、restoreCheckboxes 从实例级 _checkedSets 恢复勾选
    await waitFor(() => {
      const c = el.shadowRoot!.querySelector(".chk") as HTMLInputElement | null;
      return c?.checked === true;
    });
    const restored = el.shadowRoot!.querySelector(".chk") as HTMLInputElement;
    expect(restored.checked).toBe(true);
  });

  // P1 修复回归锁（2026-10 锐评）：勾选集合里的幽灵名——实例删除后名字原会永远留在
  // 集合里，同名实例再现时被静默勾选（用户以为没选，实际已被拉进同步）。pruneCheckedSets
  // 在 _renderCards 内**先于** restoreCheckboxes 修剪，故「再现实例不被勾选」是可测的
  // 行为差异：把 prune 顺序颠倒或删掉，下面这个用例必须红。
  it("实例删除后再现 → 不被静默勾选（幽灵名已被修剪，prune 先于 restore）", async () => {
    const insA = makeInstances()[0];
    const el = await mountSidebar([insA]);
    checkFirst(el); // 勾选 insA → _checkedSets 写入 {insA}

    // reload 1：列表只剩 insB（insA 已删）→ prune 应把幽灵名 insA 剪掉
    loadInstancesMock.mockImplementation(async () => [{ ...insA, name: "insB" }]);
    bus.emit("stats:refresh");
    await waitFor(() => el.shadowRoot!.querySelectorAll(".chk").length === 1);
    await sleep(400); // reload 300ms 防抖落定

    // reload 2：insA 同名再现 → 若幽灵名未被剪，restoreCheckboxes 会把它恢复成勾选
    loadInstancesMock.mockImplementation(async () => [insA]);
    bus.emit("stats:refresh");
    await waitFor(() => {
      const c = el.shadowRoot!.querySelector(".chk") as HTMLInputElement | null;
      return c !== null && !c.checked;
    });
  });
});

describe("app-sidebar — 推送所选（ADR-340 直调）", () => {
  it("未勾选 → info toast 提示先勾选", async () => {
    const el = await mountSidebar();
    clickPushAll(el);

    await waitFor(() => toasts.length > 0);
    expect(toasts.some((t) => t.msg.includes("请先勾选要推送的整合包"))).toBe(true);
    expect(downloadMissingMock).not.toHaveBeenCalled();
  });

  it("推送成功 → downloadMissing 直调完成 → 成功 toast + 按钮恢复", async () => {
    const el = await mountSidebar();
    checkFirst(el);
    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.msg.includes("推送完成")));

    expect(
      toasts.some((t) => (!t.type || t.type === "success") && t.msg.includes("推送完成：1 个整合包")),
    ).toBe(true);
    expect(pushBtn.disabled).toBe(false);
    // ▾ 指示符已移交 dropdownBaseCSS 的 .dd-wrap > button::after 单源生成（ADR-238），
    // 不再进入按钮文本（jsdom 不渲染伪元素，故此处断言无箭头）
    expect(pushBtn.textContent).toBe(" 推送所选");
  });

  // ADR-310 性能不变量（ADR-340 后落点从「事件载荷」迁到「直调入参」）：批量推送必须
  // 收敛为「每类型一次直调、带 instanceNames 多包名单」，而非「逐包×逐类型」N×T 次。
  // 3 包 + 全部类型 → 恰 ALL_RESOURCE_TYPES.length 次调用，每次带全部 3 包名单；
  // 否则退化会发 3×N 次全量状态扫描。
  it("批量推送 → 每类型一次直调、带 instanceNames 全包名单（O(类型) 而非 O(包×类型)）", async () => {
    const packs = ["insA", "insB", "insC"] as const;
    const el = await mountSidebar(
      packs.map((n) => ({
        name: n,
        dir: `/mc/${n}`,
        exists: true,
        hasMod: true,
        status: "complete" as const,
        synced: 1,
        missing: 0,
        extra: 0,
        disabled: 0,
        rtype: uniqueRtype(),
      })),
    );
    // 全选 3 个包
    const cb = $<HTMLInputElement>(el, "#sb-select-all");
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));

    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");
    clickPushAll(el);
    await waitFor(() => pushBtn.disabled === false);

    // 不变量：调用数 = 类型数（每类型一次批量直调），且每次携带全部 3 包名单
    expect(downloadMissingMock).toHaveBeenCalledTimes(ALL_RESOURCE_TYPES.length);
    for (const call of downloadMissingMock.mock.calls) {
      const p = call[0] as { instanceName?: string; instanceNames?: string[] };
      expect([...(p.instanceNames ?? [])].sort()).toEqual([...packs].sort());
      expect(p.instanceName).toBeUndefined();
    }
  });

  it("推送被跳过（他页同步占用）→ warn toast（不误报成功）", async () => {
    downloadMissingMock.mockResolvedValue({
      ok: 0,
      fail: 0,
      skipped: true,
      skipReason: "busy",
    });
    const el = await mountSidebar();
    checkFirst(el);
    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("推送完成")));

    // P3 修复（审核发现）：skipped 与超时分别计数——文案为「被跳过」而非「超时」
    expect(toasts.some((t) => t.msg.includes("被跳过"))).toBe(true);
    expect(pushBtn.disabled).toBe(false);
    expect(pushBtn.textContent).toBe(" 推送所选");
  });

  it("推送目录未配置 → warn toast「未完成」归因（不误并入被跳过文案）", async () => {
    downloadMissingMock.mockResolvedValue({
      ok: 0,
      fail: 0,
      skipped: true,
      skipReason: "config",
    });
    const el = await mountSidebar();
    checkFirst(el);

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("推送完成")));

    expect(toasts.some((t) => t.msg.includes("未完成"))).toBe(true);
    expect(toasts.some((t) => t.msg.includes("被跳过"))).toBe(false);
  });

  // 锐评 P1-1 回归锁（91e18f5ed 止血 → ADR-340 直调化）：文件级失败计数（fail>0）时
  // runPush 汇总必须进 warn toast「N 个文件安装失败」，不再报纯成功「推送完成：n 个整合包」。
  it("downloadMissing 返回 fail 计数 → 汇总 warn toast 点明安装失败（非纯成功文案）", async () => {
    downloadMissingMock.mockResolvedValue({ ok: 40, fail: 3, skipped: false });
    const el = await mountSidebar();
    checkFirst(el);

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("安装失败")));

    // 断言不带具体数字：每类型均带 fail=3，ALL_RESOURCE_TYPES 轮循环后累加值
    // = 3×类型数（随注册表演化），「warn + 出现安装失败字样」才是恒定判据
    // 负向：不得再出现纯成功文案「推送完成：n 个整合包」
    expect(toasts.some((t) => t.msg.includes("个整合包"))).toBe(false);
    expect($<HTMLButtonElement>(el, ".sidebar-push-selected").disabled).toBe(false);
    unmountElement(el);
  });

  // ADR-340-d2 回归锁：批量推送覆盖实例侧手改 → 汇总必须如实计数与点名，且**不得**落进
  // 纯成功文案「推送完成：n 个整合包」——那正是锐评 P1-6 的病：用户被告知一切顺利，
  // 而实例侧的手改已经没了。名字取路径末段，超 3 个截断为「等」。
  it("覆盖实例侧已修改副本 → warn toast 如实计数与点名（非纯成功文案）", async () => {
    downloadMissingMock.mockResolvedValue({
      ok: 5,
      fail: 0,
      skipped: false,
      overwrites: ["/repo/ysm/狐妖.pmx", "/repo/ysm/雷电.pmx", "/repo/ysm/c.pmx", "/repo/ysm/d.pmx"],
    });
    const el = await mountSidebar();
    checkFirst(el);
    const pushBtn = $<HTMLButtonElement>(el, ".sidebar-push-selected");

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.msg.includes("覆盖了")));

    const msg = toasts.find((t) => t.msg.includes("覆盖了"))?.msg ?? "";
    // 覆盖是磁盘事实不是批次事实：4 个目标 × 类型数（每类型一次批量直调）按 Set 去重后仍是 4
    expect(msg).toContain("覆盖了 4 处实例侧已修改内容");
    expect(msg).toContain("狐妖.pmx、雷电.pmx、c.pmx");
    expect(msg).toContain("等");
    // 负向：绝不能落进纯成功文案（「推送完成：」只出现在 pushDoneAll）
    expect(toasts.some((t) => t.msg.includes("推送完成："))).toBe(false);
    expect(pushBtn.disabled).toBe(false);
    unmountElement(el);
  });

  // 锐评 P1-3 回归锁：包级归因——「失败 N 个文件」之外必须点名是哪个整合包。
  // 多类型批次下同一包会被累加多次，断言「包名 + 括号内失败数」出现且计数正确。
  it("P1-3 包级归因 → 汇总 toast 点名失败整合包与失败数", async () => {
    downloadMissingMock.mockResolvedValue({
      ok: 10,
      fail: 2,
      skipped: false,
      packs: [{ name: "狐妖整合包", ok: 10, fail: 2, errors: [] }],
    });
    const el = await mountSidebar();
    checkFirst(el);

    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("失败集中在")));

    const msg = toasts.find((t) => t.msg.includes("失败集中在"))?.msg ?? "";
    expect(msg).toContain("狐妖整合包"); // 包名可见（用户能指名道姓）
    // 多类型循环累加：失败数 = 2×类型数（断言「包名(数字)」形态而非具体数字）
    expect(/狐妖整合包\(\d+\)/.test(msg)).toBe(true);
    unmountElement(el);
  });
});

describe("app-sidebar — 拉取所选", () => {
  it("拉取成功（有文件）→ toast + stats:refresh + tree:reload", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // ALL_RESOURCE_TYPES × 每类型 1 个文件 = 全部拉取
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: 1, failed: 0 });
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

  it("拉取部分失败 → warn toast 如实分开「成功数/失败数」+ 首个失败原因（批D P1-5）", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // 结构化结果：同一类型批次里 3 个成功 + 2 个失败。旧 (int, error) 体裁下这 2 个失败会让
    // 整批以 reject 交付 → 成功计数（3）在途中丢失，用户看到「拉取 0 个文件，1 个失败」
    // 而文件其实已经进仓库了。
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: 3,
      failed: 2,
      firstError: "目标被目录占据",
    });

    const el = await mountSidebar();
    checkFirst(el);
    clickPullAll(el);

    await waitFor(() => toasts.some((t) => t.type === "warn" && t.msg.includes("拉取完成")));
    const msg = toasts.find((t) => t.msg.includes("拉取完成"))?.msg ?? "";
    // 计数是跨全部资源类型的累加（每个类型批次各 3 成功 / 2 失败），故按类型数算期望，
    // 不硬编码数字——断言要点是「成功计数没有被吞掉」。
    const types = ALL_RESOURCE_TYPES.length;
    expect(msg).toContain(`${types * 3} 个文件`); // 旧体裁下这里会是 0（成功计数在 reject 中丢失）
    expect(msg).toContain(`${types * 2} 个失败`);
    expect(msg).toContain("首个失败原因");
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
    // 同上：▾ 单源在 CSS 伪元素
    expect(pullBtn.textContent).toBe(" 拉取所选");
  });

  it("拉取 binding 挂起 → 超时早停 + 锁释放 + 如实计入（批D：原实现无超时，锁被永久占住）", async () => {
    // 超时成因即 binding 永久挂起：把 withTimeout 打桩成抛 TimeoutError，既避开 120s
    // 真实等待，又直接钉住「拉取链必须经 withTimeout 收口」这一契约（原实现完全没有它）。
    const asyncMod = await import("@/utils/base/primitives/async.ts");
    const withTimeoutMock = vi.mocked(asyncMod.withTimeout);
    withTimeoutMock.mockRejectedValueOnce(new asyncMod.TimeoutError("拉取 insA", 120_000));

    const el = await mountSidebar();
    checkFirst(el);
    clickPullAll(el);

    await waitFor(() => toasts.some((t) => t.msg.includes("拉取超时")));
    expect(withTimeoutMock).toHaveBeenCalled();
    expect(toasts.find((t) => t.msg.includes("拉取超时"))?.msg).toContain("拉取完成: 0 个文件, 0 个失败");

    // 锁必须已释放：紧接着再拉一次要能真正跑起来（成功 toast），而不是被 busy 拒收
    toasts.length = 0;
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: 2, failed: 0 });
    clickPullAll(el);
    await waitFor(() => toasts.some((t) => t.msg.includes("拉取完成，共")));
    expect(toasts.some((t) => t.msg.includes("上一次同步尚未结束"))).toBe(false);
  });

  it("busy 拒收必须可见（批D：原实现静默 return，点另一个按钮零反馈）", async () => {
    const { PullResourceFromInstance } = await import(
      "../../../bindings/ysm-model-manager/internal/app/app.js"
    );
    // 拉取挂起 → 共用的 _syncLock 被占住（本用例只需它保持占用，故永不移交）
    (PullResourceFromInstance as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise(() => {}),
    );
    const el = await mountSidebar();
    checkFirst(el);
    clickPullAll(el);
    await sleep(0); // 让入闸与首个 await 落地（锁在 beginSync 内同步抢到）

    // 共用锁被占 → 点推送应给出「上一次同步尚未结束」提示，而非静默无反应
    clickPushAll(el);
    await waitFor(() => toasts.some((t) => t.msg.includes("上一次同步尚未结束")));
  });
});

describe("app-sidebar — 下拉无障碍（ADR-298 D3 控制器接管）", () => {
  it("push 触发器带 aria-haspopup/aria-expanded，点击展开翻转并落 role=menu", async () => {
    const el = await mountSidebar();
    const root = el.shadowRoot!;
    const btn = root.querySelector(".sidebar-push-selected") as HTMLButtonElement;
    const menu = root.getElementById("sidebar-push-menu") as HTMLElement;
    expect(btn.getAttribute("aria-haspopup")).toBe("menu");
    expect(btn.getAttribute("aria-expanded")).toBe("false");

    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(menu.style.display).toBe("block");
    expect(menu.getAttribute("role")).toBe("menu");

    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(menu.style.display).toBe("none");
  });

  it("Esc 关闭并回焦触发器（键盘可达性，此前完全缺失）", async () => {
    const el = await mountSidebar();
    const root = el.shadowRoot!;
    const btn = root.querySelector(".sidebar-push-selected") as HTMLButtonElement;
    const menu = root.getElementById("sidebar-push-menu") as HTMLElement;

    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    const first = menu.querySelector<HTMLElement>('[role="menuitem"]');
    expect(first).not.toBeNull();
    first!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(root.activeElement).toBe(btn);
  });
});

describe("app-sidebar — _reload 失败分支", () => {
  // P0 修复回归锁（2026-10 锐评）：加载失败必须与空列表分流——原失败走
  // _instances=[] + 空态渲染（「未找到匹配的整合包 + 配目录按钮」），用户误以为
  // 没装包（真正原因可能只是一次 IPC 失败）。现失败走 renderLoadError：错误文案
  // + role=alert + 重试按钮；重试触发 force reload（绕过在途去重拿最新数据）。
  it("loadInstances 抛错 → 渲染失败态（非空态）+ 不抛 + 重试可再次加载", async () => {
    loadInstancesMock.mockImplementation(async () => {
      throw new Error("boom");
    });
    const el = mountCustomElement("app-sidebar");
    // 等失败态渲染完成（connectedCallback 50ms 防抖 + async _reload）
    await waitFor(() => el.shadowRoot!.querySelector("[data-sidebar-retry]"));

    // 失败态 ≠ 空态：不得出现空态文案与配目录按钮
    expect(el.shadowRoot!.innerHTML).not.toContain("未找到匹配的整合包");
    expect(el.shadowRoot!.querySelector("[role='alert']")).not.toBeNull();

    // 重试按钮 → 再次发起加载（mock 仍抛错，但调用计数证明链路通了）
    $<HTMLButtonElement>(el, "[data-sidebar-retry]").click();
    await waitFor(() => loadInstancesMock.mock.calls.length >= 2);
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

describe("app-sidebar — 同步菜单图标/标签渲染", () => {
  it("「全部类型」项渲染真实 SVG 图标而非转义文本", async () => {
    const el = await mountSidebar();
    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    const all = menu.querySelector('.dd-item[data-sync-type="all"]')!;
    expect(all.innerHTML).toContain("<svg");
    expect(all.innerHTML).not.toContain("&lt;svg");
    expect(all.textContent).toContain("全部类型");
    unmountElement(el);
  });

  it("兜底注册表项（SYNC_TYPE_MENU 未覆盖）携带图标与可读短标签，不裸显 id", async () => {
    const el = await mountSidebar();
    const pullBtn = $<HTMLButtonElement>(el, ".sidebar-pull-selected");
    pullBtn.click();
    const menu = $<HTMLElement>(el, "#sidebar-pull-menu");
    // maid-model 不在 SYNC_TYPE_MENU 展示配置里，应走兜底分支
    const maid = menu.querySelector('.dd-item[data-sync-type="maid-model"]')!;
    expect(maid).toBeTruthy();
    // 兜底项携带图标（typeIconOf：资源类型 emoji 字形）与可读短标签，不再裸显 id
    expect(maid.textContent).toContain("🧸"); // typeIconOf(maid-model) 派生图标
    expect(maid.textContent).toContain("女仆"); // shortLabelOf(maid-model) 返回中文短标签
    expect(maid.textContent!.trim()).not.toBe("maid-model"); // 不再裸显 id
    unmountElement(el);
  });
});
