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
vi.mock("../../backend/app.ts", () => ({ getApp: vi.fn() }));
// can() 默认 true（桌面/常规语义）；"查看器模式"用例内设 false 模拟无能力
const { canMock } = vi.hoisted(() => ({ canMock: vi.fn(() => true) }));
vi.mock("../../utils/dom/capabilities.ts", () => ({ can: canMock }));
vi.mock("../../features/dialogs/modal.ts", () => ({
  modalConfirm: vi.fn(),
  modalPrompt: vi.fn(),
}));
vi.mock("./toolbar-events.ts", () => ({ bindToolbarEvents: vi.fn() }));
// registry.ts 已删（架构锐评 P1-2 修正版）：loader mock 直供 loadEntries
vi.mock("./loader.ts", () => ({ loadEntries: vi.fn() }));

import { bus } from "../../bus.ts";
import { t } from "../../core/i18n/t.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { getApp } from "../../backend/app.ts";
import type { AppBindings } from "../../backend/app.ts";
import { modalConfirm } from "../../features/dialogs/modal.ts";
import { bindToolbarEvents } from "./toolbar-events.ts";
import { selectState } from "./data.ts";
import { loadEntries, type TreeEntry } from "./loader.ts";
import "./index.ts"; // 触发 customElements.define("app-tree")
import { waitFor, queryAllByTestId } from "../../test-utils/index.ts";
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
  await waitFor(() => (el as unknown as { _ready: boolean })._ready === true);
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
  selectState.keys.clear();
  selectState.lastKey = null;
  delete (globalThis as Record<string, unknown>)["__YSM_WEB__"];
});

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem("at_dirs");
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
    selectState.keys.add("/repo/a.ysm");
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
    selectState.keys.add("/repo/a.ysm");
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

  it("Delete 网页版无删除能力 → toast，不删除", async () => {
    await mountEl();
    canMock.mockReturnValue(false); // 模拟无删除能力
    selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({ msg: "网页版不支持删除模型", type: "warn", duration: 3000 });
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
  });

  it("Delete 确认 → DeleteResourcePack 逐路径删除 + 清缓存重载 + 成功 toast + 选中清空", async () => {
    const el = await mountEl();
    selectState.keys.add("/repo/a.ysm");
    selectState.keys.add("/repo/b.ysm");
    modalConfirmMock.mockResolvedValue(true);
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    expect(bindings.DeleteResourcePack).toHaveBeenNthCalledWith(1, "/repo/a.ysm", RESOURCE_TYPES.YSM);
    expect(bindings.DeleteResourcePack).toHaveBeenNthCalledWith(2, "/repo/b.ysm", RESOURCE_TYPES.YSM);
    expect(bindings.ClearScanCache).toHaveBeenCalled();
    await waitFor(() => (loader as ReturnType<typeof vi.fn>).mock.calls.length === 2); // mount 1 + 删除后 1
    expect(selectState.keys.size).toBe(0);
    expect(selectState.lastKey).toBeNull();
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({
      msg: "✅ " + t("tree.deleted", { ok: 2, fail: 0 }),
      type: "success",
    });
    // 重载后树仍渲染
    expect(queryAllByTestId(el.shadowRoot!, "tree-file").length).toBe(2);
  });

  it("Delete 统一走 DeleteResourcePack 并传 rtype", async () => {
    const el = await mountEl();
    (el as unknown as { _rootAttr: string })._rootAttr = RESOURCE_TYPES.MMD;
    selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(bindings.DeleteResourcePack).toHaveBeenCalledWith("/repo/a.ysm", RESOURCE_TYPES.MMD);
  });

  it("Delete 部分删除失败 → ok/fail 计数进 toast", async () => {
    await mountEl();
    selectState.keys.add("/repo/a.ysm");
    selectState.keys.add("/repo/b.ysm");
    (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("删除失败"));
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()).toMatchObject({
      msg: "✅ " + t("tree.deleted", { ok: 1, fail: 1 }),
      type: "success",
    });
  });

  it("modalConfirm 取消 → 不删除、选中保留", async () => {
    const el = await mountEl();
    selectState.keys.add("/repo/a.ysm");
    modalConfirmMock.mockResolvedValue(false);
    dispatchKey("Delete");
    await sleep0();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
    expect(selectState.keys.size).toBe(1);
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("连点 Delete → _deleting 并发守卫只执行一次删除", async () => {
    await mountEl();
    selectState.keys.add("/repo/a.ysm");
    selectState.keys.add("/repo/b.ysm");
    dispatchKey("Delete");
    dispatchKey("Delete");
    await waitFor(() => (bindings.DeleteResourcePack as ReturnType<typeof vi.fn>).mock.calls.length === 2);
    expect(modalConfirmMock).toHaveBeenCalledTimes(2);
    // 若守卫失效会是 4 次
    expect(bindings.DeleteResourcePack).toHaveBeenCalledTimes(2);
  });

  it("删除期间 _gen 变化 → 丢弃过期渲染且不发成功 toast", async () => {
    const el = await mountEl();
    const renderSpy = vi.spyOn(el, "_renderTree");
    selectState.keys.add("/repo/a.ysm");
    const d = deferred<{ filesRoot: string; entries?: TreeEntry[] }>();
    loaderImpl = () => d.promise; // 挂起删除后的重载
    dispatchKey("Delete");
    await sleep0(); // 删除循环 + ClearScanCache 已完成，_load 挂起中
    (el as unknown as { _gen: number })._gen += 1; // 模拟删除期间 root 切换
    d.resolve({ filesRoot: "/repo", entries: [] });
    await sleep0();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(getToast()).toBeUndefined();
    expect((el as unknown as { _deleting: boolean })._deleting).toBe(false);
  });

  it("_deleteSelected getApp 失败 → 错误 toast，选中保留", async () => {
    const el = await mountEl();
    selectState.keys.add("/repo/a.ysm");
    selectState.keys.add("/repo/b.ysm");
    getAppMock.mockRejectedValueOnce(new Error("bridge down"));
    dispatchKey("Delete");
    await waitFor(() => toastCalls().some(([ev]) => ev === "toast:show"));
    expect(getToast()!.msg.startsWith("❌")).toBe(true);
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
    expect(selectState.keys.size).toBe(2); // 失败不清空选中
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("root 属性变更（ready 后）→ 清扫描缓存 + 按新 root 重载渲染", async () => {
    const el = await mountEl();
    (loader as ReturnType<typeof vi.fn>).mockClear();
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    await waitFor(() => (bindings.ClearScanCache as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect(loader).toHaveBeenCalledWith(RESOURCE_TYPES.MMD);
    expect((el as unknown as { _entries: TreeEntry[] })._entries.map((e) => e.name)).toEqual(["m1.mmd"]);
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

  it("root 变更为空字符串 → _rootAttr 置空并按空 rtype 重载", async () => {
    const el = await mountEl();
    expect((el as unknown as { _rootAttr: string })._rootAttr).toBe("");
    el.setAttribute("root", "");
    await waitFor(() => (bindings.ClearScanCache as ReturnType<typeof vi.fn>).mock.calls.length === 1);
    expect((el as unknown as { _rootAttr: string })._rootAttr).toBe("");
    expect(loader).toHaveBeenLastCalledWith("");
  });

  it("_entries 非数组（防御）→ 过滤为空渲染空态不崩溃", async () => {
    const el = await mountEl();
    (el as unknown as { _entries: unknown })._entries = null;
    el._renderTree(); // 直接调用渲染，触发 Array.isArray 兜底
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toContain("暂无模型文件");
  });

  it("root 变更时 ClearScanCache 失败 → 错误日志且不加载", async () => {
    const el = await mountEl();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (bindings.ClearScanCache as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("cache boom"));
    el.setAttribute("root", RESOURCE_TYPES.MMD);
    await sleep0();
    expect(consoleSpy).toHaveBeenCalledWith("[Tree root change Error]", expect.anything());
    expect(loader).toHaveBeenCalledTimes(1); // 未走到 _load
    consoleSpy.mockRestore();
  });

  it("挂载期间 root 已在途切换（pendingRoot）→ 补加载最新 root", async () => {
    const el = document.createElement("app-tree") as unknown as AppTree;
    // ADR-111：VRM 已合并进 EntityPlayer 的 variants，用 "resourcepack" 测试 pendingRoot
    el.setAttribute("root", "resourcepack"); // 未连接 → attributeChangedCallback 只置 pending
    document.body.appendChild(el);
    await waitFor(() => (el as unknown as { _ready: boolean })._ready === true);
    expect(loader.mock.calls.map((c) => c[0])).toEqual(["resourcepack", "resourcepack"]);
    expect(bindings.ClearScanCache).toHaveBeenCalledTimes(1);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "v1");
  });

  it("pendingRoot 补加载失败 → 错误日志但首代渲染保留", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (bindings.ClearScanCache as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("cache boom"));
    const el = document.createElement("app-tree") as unknown as AppTree;
    // ADR-111：VRM 已合并进 EntityPlayer 的 variants，用 "resourcepack" 测试 pendingRoot
    el.setAttribute("root", "resourcepack");
    document.body.appendChild(el);
    await waitFor(() => (el as unknown as { _ready: boolean })._ready === true);
    expect(consoleSpy).toHaveBeenCalledWith("[Tree pendingRoot Error]", expect.anything());
    expect(loader).toHaveBeenCalledTimes(1); // 补加载被失败中断
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "v1");
    consoleSpy.mockRestore();
  });

  it("connectedCallback 初始化异常 → 错误容器文案兜底", async () => {
    bindToolbarEventsMock.mockImplementationOnce(() => {
      throw new Error("toolbar boom");
    });
    const el = await mountEl();
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toBe(t("tree.treeLoadFailed"));
    expect(loader).not.toHaveBeenCalled(); // _load 未及执行
    expect((el as unknown as { _ready: boolean })._ready).toBe(true);
  });

  it("_load 返回无 entries 字段 → _entries 置空渲染空态", async () => {
    loaderImpl = () => Promise.resolve({ filesRoot: "/repo" });
    const el = await mountEl();
    expect((el as unknown as { _entries: TreeEntry[] })._entries).toEqual([]);
    expect(el.shadowRoot!.getElementById("tree")!.innerHTML).toContain("暂无模型文件");
  });

  it("_load 抛错 → _entries 置空且挂载不崩溃", async () => {
    loaderImpl = () => Promise.reject(new Error("scan boom"));
    const el = await mountEl();
    expect((el as unknown as { _entries: TreeEntry[] })._entries).toEqual([]);
    expect(el.shadowRoot!.getElementById("tree")).not.toBeNull();
  });

  it("_loadAuthorsAsync 失败 → _authors 置空", async () => {
    getAppMock.mockRejectedValueOnce(new Error("authors down"));
    const el = await mountEl();
    expect((el as unknown as { _authors: unknown[] })._authors).toEqual([]);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length >= 1);
  });

  it("_filterPaths 过滤渲染（只渲染命中路径的行）", async () => {
    const el = document.createElement("app-tree") as unknown as AppTree & {
      _filterPaths: Set<string> | null;
    };
    el._filterPaths = new Set(["/repo/b.ysm"]);
    document.body.appendChild(el);
    await waitFor(() => (el as unknown as { _ready: boolean })._ready === true);
    await waitFor(() => queryAllByTestId(el.shadowRoot!, "tree-file").length === 1);
    expectSingleRow(el, "b", "a");
  });

  it("disconnected → document keydown 监听移除（Delete 不再触发）", async () => {
    const el = await mountEl();
    el.remove();
    selectState.keys.add("/repo/a.ysm");
    dispatchKey("Delete");
    await sleep0();
    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(bindings.DeleteResourcePack).not.toHaveBeenCalled();
  });
});

/** 测试内小工具：等一个宏任务（让微任务链跑完） */
function sleep0(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
