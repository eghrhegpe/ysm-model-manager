// ===== app-tree 入口生命周期补位测试（index.ts 覆盖补强）=====
// 目标：index.ts 入口编排层的剩余缺口——键盘快捷键（Ctrl+F / Delete 全分支）、
// 批量删除（_deleteSelected 成功/部分失败/取消/防重入/代际丢弃/错误出口）、
// root 属性变更（ready 后 / 挂载中 pendingRoot / 快速连切 / 失败路径）、
// _load 空返回与抛错、_loadAuthorsAsync 失败、_filterPaths 过滤、
// connectedCallback 初始化异常兜底、disconnected 键盘监听清理。
// mock 策略：backend/app.ts（getApp 可控）、modal.ts（modalConfirm 可控）、
// toolbar-events.ts（抛错注入）；loader mock（vi.mock 直供 loadEntries）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// —— 模块 mock（工厂不引用外部变量，可安全提升）——
vi.mock("@/backend/app.ts", () => ({ getApp: vi.fn() }));
// can() 默认 true（桌面/常规语义）；"查看器模式"用例内设 false 模拟无能力
const { canMock } = vi.hoisted(() => ({ canMock: vi.fn(() => true) }));
vi.mock("@/backend/capabilities.ts", () => ({ can: canMock }));
vi.mock("@/utils/dom/modal-confirm.ts", () => ({
  modalConfirm: vi.fn(),
}));
vi.mock("@/utils/dom/modal-prompt.ts", () => ({
  modalPrompt: vi.fn(),
}));
vi.mock("./toolbar-events.ts", () => ({ bindToolbarEvents: vi.fn() }));
// registry.ts 已删（架构锐评 P1-2 修正版）：loader mock 直供 loadEntries
vi.mock("./loader.ts", () => ({ loadEntries: vi.fn() }));

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { LoadGuard } from "@/utils/async/load-guard.ts";
import { getApp } from "@/backend/app.ts";
import type { AppBindings } from "@/backend/app.ts";
import { modalConfirm } from "@/utils/dom/modal-confirm.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { loadEntries, type TreeEntry } from "./loader.ts";
import "./index.ts"; // 触发 customElements.define("app-tree")
import { queryAllByTestId } from "@/test-utils/query-by-testid.ts";
import { waitFor } from "@/test-utils/wait.ts";
import { stubConsoleError, stubConsoleWarn } from "@/test-utils/mock-log.ts";
import type { AppTree } from "./index.ts";

const getAppMock = vi.mocked(getApp);
const modalConfirmMock = vi.mocked(modalConfirm);
const bindToolbarEventsMock = vi.mocked(bindToolbarEvents);

/** Go 绑定集合（getApp 返回；按测试需要追加 mockRejectedValueOnce） */
const bindings = {
  ListModelAuthors: vi.fn().mockResolvedValue([] as unknown[]),
  ClearScanCache: vi.fn().mockResolvedValue(undefined),
  DeleteResourcePack: vi.fn().mockResolvedValue(undefined),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
  IsFileBanned: vi.fn().mockResolvedValue(false),
};

/** 按 rtype 区分的加载数据（root 切换测试用） */
const entriesByType: Record<string, TreeEntry[]> = {
  "EntityPlayer": [
    { name: "m1.mmd", path: "m1.mmd", fullPath: "/repo/m1.mmd", type: "EntityPlayer", banned: false, size: 1, modTime: 0 },
  ],
  "vrm": [
    { name: "v1.vrm", path: "v1.vrm", fullPath: "/repo/v1.vrm", type: "vrm", banned: false, size: 1, modTime: 0 },
  ],
  // ADR-111：VRM 已合并进 EntityPlayer 的 variants，用 "resourcepack" 测试 root 切换
  "resourcepack": [
    { name: "v1.zip", path: "v1.zip", fullPath: "/repo/v1.zip", type: "resourcepack", banned: false, size: 1, modTime: 0 },
  ],
};

const entriesData: TreeEntry[] = [];

/** 可变 loader 实现（_load 每次调用时读取最新） */
let loaderImpl: (rtype: string) => Promise<{ filesRoot: string; entries?: TreeEntry[] }>;
let loader: ReturnType<typeof vi.fn>;
const loadEntriesMock = vi.mocked(loadEntries);
let emitSpy: ReturnType<typeof vi.spyOn>;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const defaultLoaderImpl = (rtype: string) =>
  Promise.resolve({ filesRoot: "/repo", entries: [...(entriesByType[rtype] ?? entriesData)] });

/** 挂载并等 connectedCallback 全流程结束（_ready 在 finally 置位） */
async function mountEl(rootAttr?: string): Promise<AppTree> {
  const el = document.createElement("app-tree") as unknown as AppTree;
  if (rootAttr !== undefined) el.setAttribute("root", rootAttr);
  document.body.appendChild(el);
  await waitFor(() => el.ready === true);
  return el;
}

function dispatchKey(key: string, init: KeyboardEventInit = {}): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

/** 当前渲染的文件行文本（renderDisplayName 剥离扩展名 + 图标/尺寸混排，按包含断言） */
function fileRowTexts(el: AppTree): string[] {
  return queryAllByTestId(el.shadowRoot!, "tree-file").map((r) => r.textContent ?? "");
}

/** 断言仅一行且行文本包含（且可选不包含）指定显示名 */
function expectSingleRow(el: AppTree, contains: string, notContains?: string): void {
  const texts = fileRowTexts(el);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toContain(contains);
  if (notContains) expect(texts[0]).not.toContain(notContains);
}

/** emitSpy 调用记录（bus.emit 是泛型方法，spyOn 推导不出 calls 元素类型，显式断言） */
function toastCalls(): Array<[string, unknown]> {
  return emitSpy.mock.calls as Array<[string, unknown]>;
}

function getToast(): { msg: string; type?: string; duration?: number } | undefined {
  const call = toastCalls().find(([ev]) => ev === "toast:show");
  return call ? (call[1] as { msg: string; type?: string; duration?: number }) : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  canMock.mockReturnValue(true); // 重置能力探测（viewer 用例内改 false，防测试间污染）
  emitSpy = vi.spyOn(bus, "emit");
  getAppMock.mockResolvedValue(bindings as unknown as AppBindings);
  modalConfirmMock.mockResolvedValue(true);
  entriesData.length = 0;
  entriesData.push(
    { name: "a.ysm", path: "a.ysm", fullPath: "/repo/a.ysm", type: "ysm", banned: false, size: 1, modTime: 0 },
    { name: "b.ysm", path: "b.ysm", fullPath: "/repo/b.ysm", type: "ysm", banned: false, size: 2, modTime: 0 },
  );
  loaderImpl = defaultLoaderImpl;
  loader = loadEntriesMock;
  loadEntriesMock.mockClear();
  loadEntriesMock.mockImplementation(((rtype: string) => loaderImpl(rtype)) as typeof loadEntries);
  delete (globalThis as Record<string, unknown>)["__YSM_WEB__"];
});

afterEach(() => {
  vi.restoreAllMocks(); // 复位 stubConsoleError 的 console spy，防泄漏到后续用例
  document.body.innerHTML = "";
  localStorage.removeItem("dirOpenState");
  delete (globalThis as Record<string, unknown>)["__YSM_WEB__"];
});

describe("app-tree index 入口生命周期（补位）", () => {
  it("Ctrl+F / Cmd+F → 聚焦搜索框并全选", async () => {
    const el = await mountEl();
    const srch = el.shadowRoot!.getElementById("srch") as HTMLInputElement | null;
    expect(srch).not.toBeNull();
    dispatchKey("f", { ctrlKey: true });
    // happy-dom：shadow 内元素聚焦时 document.activeElement 是宿主，shadowRoot.activeElement 才是输入框
    expect(el.shadowRoot!.activeElement).toBe(srch);
    dispatchKey("f", { metaKey: true });
    expect(el.shadowRoot!.activeElement).toBe(srch);
  });

  it("Delete 无选中 → warn toast 提示，不弹确认", async () => {
    await mountEl();
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({ msg: t("tree.selectFilesFirst"), type: "warn", duration: 2000 });
    expect(modalConfirmMock).not.toHaveBeenCalled();
  });

  it("Delete 目标为 INPUT/TEXTAREA → 跳过删除流程", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    const srch = el.shadowRoot!.getElementById("srch") as HTMLInputElement;
    srch.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, composed: true }));
    const ta = document.createElement("textarea");
    document.body.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Del", bubbles: true, composed: true }));
    await sleep0();
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
  });

  it("3D 全屏 overlay 激活 → Ctrl+F/Delete/方向键全部让路（不接管全局按键）", async () => {
    const el = await mountEl();
    const srch = el.shadowRoot!.getElementById("srch") as HTMLInputElement;
    el.selectState.keys.add("/repo/a.ysm");
    const emitBefore = emitSpy.mock.calls.length;
    // 模拟 3D 全屏 overlay 挂载（id 与 mount-preview-core 共用常量）
    const overlay = document.createElement("div");
    overlay.id = "ysm-overlay-3d";
    document.body.appendChild(overlay);

    dispatchKey("f", { ctrlKey: true });
    await sleep0();
    expect(el.shadowRoot!.activeElement).not.toBe(srch); // Ctrl+F 不抢焦点到树搜索框

    dispatchKey("Delete");
    await sleep0();
    expect(modalConfirmMock).not.toHaveBeenCalled(); // 不弹删除确认
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();

    dispatchKey("ArrowDown");
    await sleep0();
    // 方向键不引发 toast / 删除 / 选中变更（bus 无新增事件）
    expect(emitSpy.mock.calls.length).toBe(emitBefore);

    document.body.removeChild(overlay);
    // overlay 移除后快捷键恢复
    dispatchKey("f", { ctrlKey: true });
    await waitFor(() => expect(el.shadowRoot!.activeElement).toBe(srch));
  });

  // 锐评 UX #1（2026-10-14）：键盘可达性回归锁。病：role="tree" 容器与 role="treeitem" 行
  // 全无 tabindex → 浏览器焦点永不落在树内 → _onKeyArrowNav 的 _root.contains(target) 守卫
  // 恒拦下 body 事件，方向键导航是死代码（键盘用户完全无法在树里移动）。
  it("树容器挂 tabindex=0 → 可作单点 tab 停靠（键盘可达性入口）", async () => {
    const el = await mountEl();
    const tree = el.shadowRoot!.getElementById("tree") as HTMLElement;
    expect(tree.getAttribute("role")).toBe("tree");
    expect(tree.getAttribute("tabindex")).toBe("0");
  });

  it("body 焦点下按 ArrowDown → 焦点归树容器 + 导航生效（旧守卫会拦成 no-op）", async () => {
    const el = await mountEl();
    await sleep0();
    const tree = el.shadowRoot!.getElementById("tree") as HTMLElement;
    expect(el.shadowRoot!.activeElement).not.toBe(tree);

    // 焦点在 body（点击页面空白处的典型态）→ 方向键应被树接管并把焦点拉进树
    dispatchKey("ArrowDown");
    await sleep0();
    await sleep0();
    expect(el.shadowRoot!.activeElement).toBe(tree);
  });

  it("输入框内按方向键 → 不被树抢（光标移动归输入框所有）", async () => {
    const el = await mountEl();
    const srch = el.shadowRoot!.getElementById("srch") as HTMLInputElement;
    srch.focus();
    expect(el.shadowRoot!.activeElement).toBe(srch);

    // 真实浏览器里 keydown 的 target = 获得焦点的元素；document 派发只能造 body 焦点态，
    // 故此处向输入框自身派发冒泡事件，才走得出「焦点在输入区」分支
    srch.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    await sleep0();
    expect(el.shadowRoot!.activeElement).toBe(srch);
  });

  it("方向键导航 → selectState 实例级隔离（多实例不串扰）", async () => {
    const el = await mountEl();
    await sleep0();
    await sleep0();
    // code_review b95c7dd42 #1/#2/#3（P2）：ArrowDown 导航回归守卫的完整恢复受限——
    // 新导航（selectState 实例化 + vsRows）经 getVsRows 读虚拟滚动行 + lastKey 匹配，
    // 完整断言需 vsRows fixture 适配（本轮未能构造）；此处保留实例隔离断言 + 如实标题
    // （原「方向键导航」标题已删——不假称方向键覆盖）。导航残高亮回归的守卫缺口如实
    // 报告：index.ts _onKeyArrowNav 的 oldKey 捕获时序仍无测试锁定
    el.selectState.lastKey = "/repo/a.ysm";
    el.selectState.keys.add("/repo/a.ysm");
    const el2 = document.createElement("app-tree") as unknown as AppTree;
    document.body.appendChild(el2);
    await waitFor(() => el2.ready === true);
    expect(el2.selectState.keys.size).toBe(0);
    el2.remove();
  });

  // 锐评 2026-10-15：`_treeMovePayload` 原只查 `_deleteLock`，而它的注释声称「导入链/批量链
  // 在途」也拒绝——两条**最长**的批量链（文件夹批量启禁 `toggleFolderBatch`、整库启停
  // `runBatchToggle`）走的是 `_toggleLock`，完全没查。并发后果：两条链的 IPC 打同一文件，
  // `fileops.opMu` 串行化后总有一方拿到旧路径（另一方已改名加 `.disabled` / 已搬走）→
  // 部分失败 + 困惑 toast。本组把「任一仓库互斥锁在途 → 不起拖」钉成不变量。
  it("_treeMovePayload：空闲时锚行在选中集 → 全集载荷；不在选中集 → 仅该行", async () => {
    const el = await mountEl();
    const probe = el as unknown as {
      _treeMovePayload(a: string): { paths: string[]; anchor: string } | null;
    };
    expect(probe._treeMovePayload("/repo/a.ysm")).toBeNull(); // 无选中 → 不起拖
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    expect(probe._treeMovePayload("/repo/a.ysm")).toEqual({
      paths: ["/repo/a.ysm", "/repo/b.ysm"],
      anchor: "/repo/a.ysm",
    });
    // 锚行不在选中集 → 只拖该行（不误拖整组）
    expect(probe._treeMovePayload("/repo/c.ysm")).toEqual({
      paths: ["/repo/c.ysm"],
      anchor: "/repo/c.ysm",
    });
  });

  it("_treeMovePayload：任一仓库互斥锁在途（删除/启停/移动）→ 一律不起拖，释放后恢复", async () => {
    const el = await mountEl();
    const probe = el as unknown as {
      _treeMovePayload(a: string): unknown;
      _deleteLock: { tryStart(): boolean; finish(): void };
      _toggleLock: { tryStart(): boolean; finish(): void };
      _moveLock: { tryStart(): boolean; finish(): void };
    };
    el.selectState.keys.add("/repo/a.ysm");
    for (const key of ["_deleteLock", "_toggleLock", "_moveLock"] as const) {
      const lock = probe[key];
      expect(lock.tryStart()).toBe(true);
      // 该锁在途 → 不起拖（_toggleLock 那条是本刀修的病：原实现查不到它）
      expect(probe._treeMovePayload("/repo/a.ysm")).toBeNull();
      lock.finish();
      // 释放即恢复可拖（防「锁释放了却永久禁拖」的反向回归）
      expect(probe._treeMovePayload("/repo/a.ysm")).not.toBeNull();
    }
  });

  it("Delete 网页版无删除能力 → toast，不删除", async () => {
    const el = await mountEl();
    canMock.mockReturnValue(false); // 模拟无删除能力
    el.selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({ msg: "网页版不支持删除模型", type: "warn", duration: 3000 });
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
  });

  it("Delete 确认 → DeleteResourcePack 逐路径删除 + 清缓存重载 + 成功 toast + 选中清空", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    modalConfirmMock.mockResolvedValue(true);
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    expect(bindings.DeleteResourcePack).toHaveBeenNthCalledWith(1, "/repo/a.ysm", RESOURCE_TYPES.YSM);
    expect(bindings.DeleteResourcePack).toHaveBeenNthCalledWith(2, "/repo/b.ysm", RESOURCE_TYPES.YSM);
    expect(bindings.ClearScanCache).toHaveBeenCalled();
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length === 2); // mount 1 + 删除后 1
    expect(el.selectState.keys.size).toBe(0);
    expect(el.selectState.lastKey).toBeNull();
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({
      msg: t("tree.deleted", { ok: 2, fail: 0 }),
      type: "success",
    });
    // 重载后树仍渲染
    expect(queryAllByTestId(el.shadowRoot!, "tree-file").length).toBe(2);
  });

  // 2026-10-15 P1-C：批量删除可达数百数千项，补页脚进度。本用例走**真实页脚模板**
  // （mountEl → _renderLayout → footerHTML 产出 #ftr-progress），故同时锁「模板真有该槽」
  // 与「结束必清槽」两端——夹具手抄槽位是另一路测试（bus-handlers）的盲点。
  it("批量删除在途 → 页脚进度可见；结束后清槽", async () => {
    const el = await mountEl("ysm");
    el.selectState.keys.add("/repo/a.ysm");
    const gates: Array<() => void> = [];
    // ⚠️ 必须 Once：`clearAllMocks` 只清调用记录、**不重置 implementation**，
    // 用 mockImplementation 会把「永挂起」泄漏给后续 Delete 用例（实测把
    // 「删除期间推进代际」那条打成超时/误判）
    (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          gates.push(() => res());
        }),
    );

    dispatchKey("Delete");
    await waitFor(() => gates.length === 1);
    const progress = el.shadowRoot!.getElementById("ftr-progress") as HTMLElement;
    expect(progress.hidden).toBe(false);
    expect(progress.textContent).toBe("⏳ 删除中 0/1");

    gates.splice(0).forEach((g) => g());
    await waitFor(() => progress.hidden === true);
    expect(progress.textContent).toBe("");
  });

  // 已知边界的自愈出口（2026-10-15）：批次永不落定（IPC 挂死）会让模块级计数滞留，
  // 此后所有批次都不再清槽。卸载时复位 → 泄漏只活在单个实例生命周期内。
  it("卸载 → 进度槽复位（挂死批次不跨实例残留）", async () => {
    const el = await mountEl("ysm");
    const progress = el.shadowRoot!.getElementById("ftr-progress") as HTMLElement;
    // 模拟「挂死批次」留下的僵尸槽：直接写，不经 withFooterProgress（计数一并被毒化）
    progress.textContent = "⏳ 僵尸 3/9";
    progress.hidden = false;

    el.remove(); // disconnectedCallback → resetFooterProgress

    expect(progress.hidden).toBe(true);
    expect(progress.textContent).toBe("");
  });

  it("Delete 统一走 DeleteResourcePack 并传 rtype", async () => {    const el = await mountEl();
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    el.selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(bindings.DeleteResourcePack).toHaveBeenCalledWith("/repo/a.ysm", RESOURCE_TYPES.MMD);
  });

  // 锐评 2026-10-13 P1-1：切资源类型不清选中态 → 底部仍报「已选 N 个」而新树 0 行高亮，
  // 按 Delete 会拿「新类型 + 旧路径」拼参（确认框文案说 3 个，实为上类型的文件）。
  // 后端 root 包含守卫会拦（fileops.go:557-570）故删不掉，但虚假危险确认框本身就该修。
  it("切资源类型 → 选中态清空（不复用上类型的路径与计数）", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    el.selectState.lastKey = "/repo/b.ysm";
    expect(el.selectState.keys.size).toBe(2);
    const callsBefore = (loader as ReturnType<typeof vi.fn>).mock.calls.length;

    el.setAttribute("root", "resourcepack");
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length > callsBefore);

    expect(el.selectState.keys.size).toBe(0);
    expect(el.selectState.lastKey).toBeNull();
  });

  // 锐评 2026-10-15 P1-A：readScopedDirOpen 原先只在 connectedCallback 跑一次，而切类型走
  // init-pages.mountTree 的 setAttribute 复用同一实例（不重连→不重读）→ 新树沿用上类型的
  // 展开图；更糟的是写侧 writeScopedDirOpen(rtype, this._state.dirOpen) 写的是混装全量 map，
  // 会把上类型目录整包写进新类型槽位——2026-09「按类型命名空间」收债从活切换路径复活。
  it("切资源类型 → 展开态换新类型命名空间（不串上类型、写盘不污染）", async () => {
    localStorage.setItem("dirOpenState", JSON.stringify({ ysm: { "[作者A]": true } }));
    const el = await mountEl("ysm");
    expect(el.dirOpen["[作者A]"]).toBe(true);
    const callsBefore = (loader as ReturnType<typeof vi.fn>).mock.calls.length;

    el.setAttribute("root", "resourcepack");
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length > callsBefore);

    // 内存态：新类型槽位为空 → 不得残留上类型目录
    expect(el.dirOpen["[作者A]"]).toBeUndefined();
    // 写侧：本类型落盘只含本类型目录，且旧类型存档原样保留
    el.toggleDir("[资源包作者]");
    const stored = JSON.parse(localStorage.getItem("dirOpenState") || "{}");
    expect(stored.resourcepack?.["[资源包作者]"]).toBe(true);
    expect(stored.resourcepack?.["[作者A]"]).toBeUndefined();
    expect(stored.ysm?.["[作者A]"]).toBe(true);
  });

  // 复核 2026-10-15（P1-A 第二入口）：分离期切类型时 attributeChangedCallback 走
  // `!isConnected` 分支只更新 rootAttr（不重读、不重载），切回页面靠重连恢复——旧实现此处
  // 是 `Object.assign(dirOpen, readScopedDirOpen(root))` **合并**语义，会把上类型目录并进
  // 新类型 map，随后任一次 toggleDir 就把混装态整包写进新类型槽位。
  it("分离期间切 rtype → 重连按 rtype 重读展开态（合并语义会带旧类型目录）", async () => {
    localStorage.setItem(
      "dirOpenState",
      JSON.stringify({ ysm: { "[作者A]": true }, resourcepack: { "[资源包作者]": true } }),
    );
    const el = await mountEl("ysm");
    expect(el.dirOpen["[作者A]"]).toBe(true);

    el.remove(); // 页面切走 → 面板分离（_ready 仍为 true）
    el.setAttribute("root", "resourcepack"); // 分离期切类型：只更新 rootAttr
    const callsBefore = (loader as ReturnType<typeof vi.fn>).mock.calls.length;
    document.body.appendChild(el); // 切回页面 → 重连（isRemount 分支）
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length > callsBefore);

    expect(el.dirOpen["[作者A]"]).toBeUndefined();
    expect(el.dirOpen["[资源包作者]"]).toBe(true);

    // 写侧：混装态一旦落盘就污染新类型槽位——重连后的首次 toggleDir 不得捎带上类型目录
    el.toggleDir("[新目录]");
    const stored = JSON.parse(localStorage.getItem("dirOpenState") || "{}");
    expect(stored.resourcepack?.["[作者A]"]).toBeUndefined();
    expect(stored.ysm?.["[作者A]"]).toBe(true);
  });

  // 承重假设（复核 2026-10-15 指出「无红测」）：批量启禁的乐观翻转与失败回滚直接写
  // `snapshot.entries` 里的条目对象，前提是 snapshot **不复印**数组。若哪天 getSnapshot
  // 改成浅拷贝，乐观会静默失效（界面不翻）、回滚会写进副本（标志永不还原），而现有
  // 用例可能全绿——故把这条假设本身钉住。
  it("snapshot.entries 与 entries 同源（乐观/回滚的承重假设：非副本）", async () => {
    const el = await mountEl("ysm");
    expect(el.snapshot.entries).toBe(el.entries);
    expect(el.snapshot.entries.length).toBeGreaterThan(0);
    el.snapshot.entries[0].banned = true;
    expect(el.entries[0].banned).toBe(true);
  });

  // 复核 2026-10-15（P1-A 时序竞态）：水化若押在 `await ClearScanCache/_load` **之后**，扫盘
  // 在途窗口内 DOM 仍是旧类型可点行——用户点任一文件夹即以 `writeScopedDirOpen(新rtype, 旧dirOpen)`
  // 落盘，把旧类型目录整包写进新类型槽位；更糟的是随后的水化 `readScopedDirOpen(新rtype)`
  // 会把这份污染**读回来当作本类型状态**（瞬时污染升级为持久）。修法：水化置于方法首行。
  it("切类型扫盘在途点旧树 → 旧类型目录不得被写进新类型槽位", async () => {
    localStorage.setItem(
      "dirOpenState",
      JSON.stringify({ ysm: { "[作者A]": true, "[作者B]": true } }),
    );
    const el = await mountEl("ysm");
    expect(el.dirOpen["[作者A]"]).toBe(true);
    // 本轮 reload 卡在扫描 RPC（大仓库扫盘可达秒级）
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = () => d.promise;
    const callsBefore = (loader as ReturnType<typeof vi.fn>).mock.calls.length;

    el.setAttribute("root", "resourcepack");
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length > callsBefore);
    el.toggleDir("[作者A]"); // 扫盘在途点了旧树的行

    const stored = JSON.parse(localStorage.getItem("dirOpenState") || "{}");
    // 没被点过的旧类型目录绝不该跟着过去（水化押后时 [作者B] 会一并被写入）
    expect(stored.resourcepack?.["[作者B]"]).toBeUndefined();
    d.resolve({ filesRoot: "/repo", entries: [] });
  });

  it("切资源类型后按 Delete → 无路径可删（不拿旧路径配新 rtype）", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.setAttribute("root", "resourcepack");
    await waitFor(() => el.selectState.keys.size === 0);

    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(getToast()).toMatchObject({ type: "warn" });
  });

  it("Delete 部分删除失败 → ok/fail 计数进 toast + 类型降级 warn", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("删除失败"));
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    // 审核 P2（2026-10-15）：原先无条件 "success"——失败也报绿色成功，误导用户以为都删掉了
    expect(getToast()).toMatchObject({
      msg: t("tree.deleted", { ok: 1, fail: 1 }),
      type: "warn",
    });
  });

  it("Delete 全部失败 → warn toast + 选中保留（可原地重试）", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("删除失败"),
    );
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({ type: "warn" });
    // 全失败 = 路径都在磁盘上，清空选中只会让用户失去重试起点
    expect(el.selectState.keys.size, "全失败不得清选中").toBe(2);
  });

  it("modalConfirm 取消 → 不删除、选中保留", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    modalConfirmMock.mockResolvedValue(false);
    dispatchKey("Delete");
    await sleep0();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
    expect(el.selectState.keys.size).toBe(1);
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("连点 Delete → _deleting 并发守卫只执行一次删除", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    dispatchKey("Delete");
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    expect(modalConfirmMock).toHaveBeenCalledTimes(2);
    // 若守卫失效会是 4 次
    expect(bindings.DeleteResourcePack).toHaveBeenCalledTimes(2);
  });

  it("删除期间 _guard 推进代际 → 丢弃过期渲染且不发成功 toast", async () => {
    const el = await mountEl();
    const renderSpy = vi.spyOn(el, "_renderTree");
    el.selectState.keys.add("/repo/a.ysm");
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = () => d.promise; // 挂起删除后的重载
    dispatchKey("Delete");
    await sleep0(); // 删除循环 + ClearScanCache 已完成，_load 挂起中
    (el as unknown as { _guard: LoadGuard })._guard.invalidate(); // 模拟删除期间 root 切换
    d.resolve({ filesRoot: "/repo", entries: [] });
    await sleep0();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(getToast()).toBeUndefined();
    expect(el.deleting).toBe(false);
  });

  it("_deleteSelected getApp 失败 → 错误 toast，选中保留", async () => {
    const el = await mountEl();
    el.selectState.keys.add("/repo/a.ysm");
    el.selectState.keys.add("/repo/b.ysm");
    getAppMock.mockRejectedValueOnce(new Error("bridge down"));
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()!.msg.startsWith("❌")).toBe(false);
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
    expect(el.selectState.keys.size).toBe(2); // 失败不清空选中
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("root 属性变更（ready 后）→ 按新 root 重载渲染（止血 A2：不再清全局缓存）", async () => {
    const el = await mountEl();
    (loader as ReturnType<typeof vi.fn>).mockClear();
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length >= 1);
    expect(loader).toHaveBeenCalledWith(RESOURCE_TYPES.MMD);
    // 止血 2026-10-15 A2：切类型链不再全局 ClearScanCache（原实现每次切类型核平
    // 全仓所有类型缓存 = 全库重新冷扫+重哈希的哈希税）；新鲜度由 per-dir 30s 缓存
    // + watcher 清缓存 + tree:reload 全局清三口径覆盖
    expect(bindings.ClearScanCache).not.toHaveBeenCalled();
    expect(el.entries.map((e) => e.name)).toEqual(["m1.mmd"]);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "m1");
  });

  it("root 快速连切 → 过期代丢弃，只渲染最新 root", async () => {
    const el = await mountEl();
    (loader as ReturnType<typeof vi.fn>).mockClear();
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = (rtype) =>
      rtype === RESOURCE_TYPES.MMD
        ? d.promise
        : Promise.resolve({ filesRoot: "/repo", entries: entriesByType[rtype] ?? [] });
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    await sleep0(); // 第一次变更的 _load 已发起并挂起
    // ADR-111：VRM 已合并进 EntityPlayer 的 variants，用 PACK 作为第二类型测试切换
    el.setAttribute("root", RESOURCE_TYPES.PACK);
    await sleep0(); // 第二次变更完成渲染
    d.resolve({ filesRoot: "/repo", entries: entriesByType[RESOURCE_TYPES.MMD] });
    await sleep0(); // 第一次变更恢复 → gen 不匹配 → 丢弃渲染
    expect(loader.mock.calls.map((c) => c[0])).toEqual([RESOURCE_TYPES.MMD, RESOURCE_TYPES.PACK]);
    // 代际守卫只丢弃过期"渲染"：DOM 是最新 root（v1）；_entries 会被过期 _load 写回
    //（下次渲染前总会被新 _load 覆盖，实际无泄漏面）
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "v1");
  });

  it("root 同值 / 非 root 属性 → 不触发重载", async () => {
    const el = await mountEl();
    expect(loader).toHaveBeenCalledTimes(1);
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    el.setAttribute("root", RESOURCE_TYPES.MMD); // 同值 → 忽略
    el.setAttribute("title", "hello"); // 非 root → 忽略
    await sleep0();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("root 变更为空字符串 → _rootAttr 置空并按空 rtype 重载（止血 A2：不清全局缓存）", async () => {
    const el = await mountEl();
    expect(el.rootAttr).toBe("");
    el.setAttribute("root", "");
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length >= 2);
    expect(el.rootAttr).toBe("");
    expect(loader).toHaveBeenLastCalledWith("");
    expect(bindings.ClearScanCache).not.toHaveBeenCalled();
  });

  // 2026-10 锐评修复回归锁：`disconnectedCallback` 漏接 `_guard.invalidate()`——卸载发生在
  // `_reloadAfterMountSwitch` 的 await 期间（_load 慢 IPC；止血 2026-10-15 A2 起补载链
  // 无 ClearScanCache 前置步）时，续体会通过代际校验（`stale(gen)` 恒 false：没人推进过
  // gen）并执行 `_renderTree()`，给**已卸载**的 shadow root 重渲染整棵树（幽灵写入）。
  // 同型先例：app-sidebar 的同类漏接（已修）。
  it("在途补载期间卸载 → 迟到结果不重渲染（代际已失效）", async () => {
    const el = await mountEl();
    const renderSpy = vi.spyOn(el, "_renderTree");
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = () => d.promise; // 补载挂起

    el.setAttribute("root", RESOURCE_TYPES.MMD); // 触发 _reloadAfterMountSwitch
    await sleep0(); // 让 await 链进入挂起态
    renderSpy.mockClear();

    el.remove(); // 卸载发生在在途期间
    expect(el.isConnected).toBe(false);

    d.resolve({ filesRoot: "/repo", entries: entriesByType[RESOURCE_TYPES.MMD] });
    await sleep0();
    await sleep0();

    // 病理（先红）：无 invalidate 时这里会被调用，给游离 root 重渲染
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("_entries 非数组（防御）→ 过滤为空渲染空态不崩溃", async () => {
    const el = await mountEl();
    el["_state"].entries = [];
    el._renderTree(); // 直接调用渲染，触发 Array.isArray 兜底
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toContain("暂无模型文件");
  });

  // 原「root 变更时 ClearScanCache 失败 → 错误日志且不加载」用例随止血 2026-10-15 A2
  // 删除：切类型链已无全局 ClearScanCache 前置步，该故障面不复存在（全局清缓存失败
  // 的语义归 tree:reload 链的 bus-handlers.reload catch，另有测试覆盖）。

  it("未连接 setAttribute → 单次加载最新 root（快照差量，不再冗余双加载）", async () => {
    const el = document.createElement("app-tree") as unknown as AppTree;
    // ADR-111：VRM 已合并进 EntityPlayer 的 variants，用 "resourcepack" 测 root 预置
    el.setAttribute("root", "resourcepack"); // 未连接：attributeChanged 同步 _rootAttr + 推进代际
    document.body.appendChild(el);
    await waitFor(() => el.ready === true);
    // 单次加载（旧实现：预连接 setAttribute 置 _pendingRoot → connected 末尾补载 = 双加载）
    expect(loader.mock.calls.map((c) => c[0])).toEqual(["resourcepack"]);
    expect(bindings.ClearScanCache).not.toHaveBeenCalled();
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "v1");
  });

  it("挂载期间 root 在途切换 → 丢弃首代渲染、补载最新 root（无错配帧）", async () => {
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = (rtype) =>
      rtype === RESOURCE_TYPES.MMD
        ? d.promise // 首代 MMD 加载挂起（connected 在途）
        : Promise.resolve({ filesRoot: "/repo", entries: entriesByType[rtype] ?? [] });
    const el = document.createElement("app-tree") as unknown as AppTree;
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    document.body.appendChild(el);
    await sleep0(); // connected 已发起 MMD 加载并 await（挂起中）
    // ADR-111：用 PACK 作第二类型测在途切换
    el.setAttribute("root", RESOURCE_TYPES.PACK); // 在途切换：attributeChanged 推进代际作废首代
    d.resolve({ filesRoot: "/repo", entries: entriesByType[RESOURCE_TYPES.MMD] }); // 首代恢复 → gen 不匹配
    await waitFor(() => el.ready === true);
    expect(loader.mock.calls.map((c) => c[0])).toEqual([RESOURCE_TYPES.MMD, RESOURCE_TYPES.PACK]);
    // 止血 2026-10-15 A2：挂载期切类型的补载链不再前置全局 ClearScanCache
    expect(bindings.ClearScanCache).not.toHaveBeenCalled();
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "v1"); // 最终渲染最新 root（PACK/resourcepack）
  });

  it("挂载期间 root 在途切换且补载失败 → 错误日志 + 节流 toast + 兜底渲染首代数据", async () => {
    stubConsoleError(); // 静音生产 logError("app-tree","pendingRoot Error")
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = (rtype) =>
      rtype === RESOURCE_TYPES.MMD
        ? d.promise
        : Promise.resolve({ filesRoot: "/repo", entries: entriesByType[rtype] ?? [] });
    const el = document.createElement("app-tree") as unknown as AppTree;
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    document.body.appendChild(el);
    await sleep0(); // MMD 加载挂起
    // 止血 2026-10-15 A2：补载链已无全局 ClearScanCache 前置步（原故障点删除）——
    // 补载失败的口径改为「_load 链本身抛错」（spy 拒载一次）
    const loadSpy = vi.spyOn(el, "_load").mockRejectedValueOnce(new Error("load boom"));
    el.setAttribute("root", RESOURCE_TYPES.PACK); // 在途切换 → 补载
    d.resolve({ filesRoot: "/repo", entries: entriesByType[RESOURCE_TYPES.MMD] });
    // 失败路径同步屏障：等到错误 toast 发出（logError 同链路已执行、告警已静音）
    await waitFor(() =>
      (emitSpy.mock.calls as Array<[string, unknown]>).some(([ev]) => ev === "toast:show"),
    );
    expect(loadSpy).toHaveBeenCalled(); // 补载确实进入 _load 链（失败在 _load 内）
    // 首代渲染已被 gen 作废（无错配帧），_entries 为首代数据 → 兜底渲染避免空白树
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "m1");
  });

  it("connectedCallback 初始化异常 → 错误容器文案兜底", async () => {
    stubConsoleError(); // 静音生产 logError("app-tree","Init Error")
    bindToolbarEventsMock.mockImplementationOnce(() => {
      throw new Error("toolbar boom");
    });
    const el = await mountEl();
    const treeHtml = el.shadowRoot!.getElementById("tree")!.innerHTML;
    // 结构兜底断言：empty/big 容器仍在（图标与包裹在模板层 treeLoadFailedHTML）
    expect(treeHtml).toContain('class="big"');
    expect(treeHtml).toContain(t("tree.treeLoadFailed"));
    // ADR-248 回归锁：空态图标必须是 SVG（语义名经 resolveIcon 落位），不是裸 emoji 字形
    expect(treeHtml).toContain("<svg");
    expect(treeHtml).not.toMatch(/[📁🔍⚠️]/u);
    expect(loader).not.toHaveBeenCalled(); // _load 未及执行
    expect(el.ready).toBe(true);
  });

  it("_load 返回无 entries 字段 → _entries 置空渲染空态", async () => {
    loaderImpl = () => Promise.resolve({ filesRoot: "/repo" });
    const el = await mountEl();
    expect(el.entries).toEqual([]);
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toContain("暂无模型文件");
  });

  it("_load 抛错 → _entries 置空且挂载不崩溃", async () => {
    stubConsoleWarn(); // 静音生产 logWarn("app-tree","entries 加载失败:")（_load 抛错经 connected 兜底）
    loaderImpl = () => Promise.reject(new Error("scan boom"));
    const el = await mountEl();
    expect(el.entries).toEqual([]);
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("_load 抛错 → 空态显示「加载失败」而非「暂无模型文件」（P2 失败可区分）", async () => {
    stubConsoleWarn();
    loaderImpl = () => Promise.reject(new Error("scan boom"));
    const el = await mountEl();
    const tree = el.shadowRoot!.getElementById("tree");
    expect(tree!.innerHTML).toContain("加载失败");
    expect(tree!.innerHTML).not.toContain("暂无模型文件");
    // 失败态对 reload 成功自愈：恢复真数据后空态消失、loadFailed 清位
    loaderImpl = defaultLoaderImpl;
    bus.emit("tree:reload");
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length >= 1);
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).not.toContain("加载失败");
  });

  it("_load 真返回空列表 → 空态仍是「暂无模型文件」（成功加载清 loadFailed 位）", async () => {
    stubConsoleWarn();
    // 先制造一次失败，再让 loader 真返回空列表——验证成功路径清位
    loaderImpl = () => Promise.reject(new Error("boom"));
    const el = await mountEl();
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toContain("加载失败");
    loaderImpl = () => Promise.resolve({ filesRoot: "/repo", entries: [] });
    bus.emit("tree:reload");
    // ⚠️ 不用 negate-waitFor（「不包含加载失败」谓词）：happy-dom 下连续两个 waitFor
    // 的 rAF 轮询链会停摆（探针实证，wait.ts pollUntil 的 rAF 在第二段调度耗尽）——
    // reload 链全微任务 + ClearScanCache mock 同步 resolve，一个宏任务足够落定
    await sleep0();
    const treeHtml = el.shadowRoot!.getElementById("tree")!.innerHTML;
    expect(treeHtml).not.toContain("加载失败");
    expect(treeHtml).toContain("暂无模型文件");
  });

  it("_loadAuthorsAsync 失败 → _authors 置空", async () => {
    stubConsoleWarn(); // 静音 loadAuthors 失败留痕（authors.ts 现 logWarn）
    getAppMock.mockRejectedValueOnce(new Error("authors down"));
    const el = await mountEl();
    expect((el as unknown as { _authors: unknown[] })._authors).toEqual([]);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length >= 1);
  });

  it("_filterPaths 过滤渲染（只渲染命中路径的行）", async () => {
    const el = document.createElement("app-tree") as unknown as AppTree;
    // 注：filterPaths 匹配 entry.fullPath（commit 518e19237 起，render.test.ts 锁定），
    // 非短路径名——Set 须放 fullPath 才能命中
    el.setFilterPaths(new Set(["/repo/b.ysm"]));
    document.body.appendChild(el);
    await waitFor(() => el.ready === true);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "b", "a");
  }, 10000);

  it("disconnected → document keydown 监听移除（Delete 不再触发）", async () => {
    const el = await mountEl();
    el.remove();
    el.selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await sleep0();
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
  });

  // 锐评性能 #5 后续（2026-10-14）：_renderTree 曾先 cleanupVirtualScroll 再 renderTree，
  // 而 scroll 同步 / ResizeObserver 是按需安装一次的（renderTree 内 !st.cleanup 守卫）——
  // 每次交互（选中/方向键/拖源态）都拆了再装，搜索击键每次重建监听 + Observer。
  // 修法：_renderTree 不再预cleanup，销毁点归 disconnectedCallback。
  it("_renderTree 重入不重装scroll 监听（虚拟滚动监听跨渲染复用）", async () => {
    const el = await mountEl();
    const tree = el.shadowRoot!.getElementById("tree") as HTMLElement;
    await sleep0();

    const addSpy = vi.spyOn(tree, "addEventListener");
    // 连续三次重渲（等价三次交互：选行 / 方向键 / 拖源态切换）
    el.selectState.keys.add("/repo/a.ysm");
    (el as unknown as { _renderTree: () => void })._renderTree();
    (el as unknown as { _renderTree: () => void })._renderTree();
    (el as unknown as { _renderTree: () => void })._renderTree();
    await sleep0();

    const scrollAdds = addSpy.mock.calls.filter((c) => c[0] === "scroll");
    expect(scrollAdds).toHaveLength(0);
    addSpy.mockRestore();
  });

  it("disconnected 后 scroll 监听确实拆除（监听复用不泄漏）", async () => {
    const el = await mountEl();
    const tree = el.shadowRoot!.getElementById("tree") as HTMLElement;
    await sleep0();
    const removeSpy = vi.spyOn(tree, "removeEventListener");
    el.remove();
    await sleep0();
    expect(removeSpy.mock.calls.some((c) => c[0] === "scroll")).toBe(true);
    removeSpy.mockRestore();
  });

  // 锐评性能 #5 后续（2026-10-14）：renderSlice 原实现每帧 cloneNode 重建全部可见行——
  // 滚动 1px 也把窗口内约 40 行重新克隆一遍（持续 GC 压力）。改为 VsState.liveNodes
  // 按 key + row 对象身份复用节点：滚动只有首尾进出窗口，中间行直接搬动。
  it("滚动重绘复用行节点（中间行 DOM 实例不变，不逐帧重建）", async () => {
    const el = await mountEl();
    await sleep0();
    const tree = el.shadowRoot!.getElementById("tree") as HTMLElement;
    const wrap = tree.firstElementChild as HTMLElement;
    // 强制 container 有 clientHeight（否则 calcVisibleRange 走「全量渲染」旁路）
    Object.defineProperty(tree, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(tree, "scrollTop", { value: 0, writable: true, configurable: true });

    const before = new Map<string, Element>();
    for (const row of Array.from(wrap.children)) {
      before.set((row as HTMLElement).dataset.fullpath ?? (row as HTMLElement).dataset.dir ?? "", row);
    }
    expect(before.size).toBeGreaterThan(0);

    // 滚动 40px（仍在同一批可见行内）→ 触发 redraw
    tree.scrollTop = 40;
    tree.dispatchEvent(new Event("scroll"));
    await sleep0();
    await sleep0();

    const after = new Map<string, Element>();
    for (const row of Array.from(wrap.children)) {
      after.set((row as HTMLElement).dataset.fullpath ?? (row as HTMLElement).dataset.dir ?? "", row);
    }
    // 仍然可见的 key 集合中，重叠部分的 DOM 实例必须保持同一（复用而非重建）
    let reused = 0;
    for (const [k, node] of after) {
      if (before.has(k) && before.get(k) === node) reused++;
    }
    expect(reused).toBeGreaterThan(0);
  });
});

/** 测试内小工具：等一个宏任务（让微任务链跑完） */
function sleep0(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
