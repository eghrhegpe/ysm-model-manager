// ===== 仓库页 DnD（组件级 — ADR-060）测试 =====
// 覆盖：bindTreeDnD 事件绑定 / handleTreeDrop 处理链路（网页版分支、桌面版收集、oversize、busy 互斥、错误兜底）
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bus, type ToastPayload } from "../bus.ts";
import { handleTreeDrop, bindTreeDnD } from "./import-dnd.ts";
import { fireDrop } from "../test-utils/events.ts";
import { MAX_IMPORT_BYTES } from "../backend/browser-adapter.ts";

vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: vi.fn().mockResolvedValue(undefined),
    ImportModelFolder: vi.fn().mockResolvedValue(undefined),
    DetectZipType: vi.fn().mockResolvedValue("ysm"),
  }),
}));

const { importWebFilesMock } = vi.hoisted(() => ({
  importWebFilesMock: vi.fn().mockResolvedValue({ imported: 1, failed: 0 }),
}));
vi.mock("../backend/browser-adapter.ts", () => ({
  importWebFiles: importWebFilesMock,
  MAX_IMPORT_BYTES: 100 * 1024 * 1024,
}));

import { getApp } from "../backend/app.ts";
import { importWebFiles } from "../backend/browser-adapter.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** 构造带 dataTransfer 的 DragEvent */
function makeDragEvent(type: string, opts: {
  types?: string[];
  items?: unknown[];
  files?: File[];
  relatedTarget?: EventTarget | null;
  clientX?: number;
  clientY?: number;
}): DragEvent {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, ...opts }) as DragEvent;
  Object.defineProperty(ev, "dataTransfer", {
    value: {
      types: opts.types ?? ["Files"],
      items: opts.items ?? [],
      files: opts.files ?? [],
      dropEffect: "none",
    },
    configurable: true,
  });
  if (opts.relatedTarget !== undefined) {
    Object.defineProperty(ev, "relatedTarget", { value: opts.relatedTarget, configurable: true });
  }
  if (opts.clientX !== undefined) Object.defineProperty(ev, "clientX", { value: opts.clientX, configurable: true });
  if (opts.clientY !== undefined) Object.defineProperty(ev, "clientY", { value: opts.clientY, configurable: true });
  return ev;
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  container.id = "tree-drop-zone";
  document.body.appendChild(container);
  (getApp as ReturnType<typeof vi.fn>).mockClear();
  importWebFilesMock.mockClear();
  delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
});

afterEach(() => {
  container.remove();
});

// ===== bindTreeDnD 绑定/清理 =====

describe("bindTreeDnD 绑定与清理", () => {
  it("调用后 document 注册 dragover + drop listener，cleanup 后移除", () => {
    // ADR-060 组件化后绑定提升到 document 层（WebView2 ShadowRoot drop 限制，7e3229dd）
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const cleanup = bindTreeDnD(container);
    expect(addSpy).toHaveBeenCalledWith("dragover", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("drop", expect.any(Function));
    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("dragover", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("drop", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("hint 与容器同为 shadow root 子节点 → 拖拽显示 / drop 隐藏（getRootNode 查找）", () => {
    // <app-tree> 中 #tree 与 .tree-drop-hint 都是 shadow root 直接子节点，
    // 旧 parentElement 查找返回 null → hint 永不显示；此用例锁死修复行为。
    // 事件在 document 层监听（7e3229dd），故从 document 派发。
    const host = document.createElement("div");
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML = '<div id="tree"></div><div class="tree-drop-hint"></div>';
    document.body.appendChild(host);
    const tree = sr.getElementById("tree") as HTMLElement;
    const hint = sr.querySelector(".tree-drop-hint") as HTMLElement;
    const cleanup = bindTreeDnD(tree);

    const over = makeDragEvent("dragover", { types: ["Files"] });
    Object.defineProperty(over, "target", { value: tree, configurable: true });
    document.dispatchEvent(over);
    expect(hint.style.display).toBe("flex");

    const drop = makeDragEvent("drop", { types: ["Files"] });
    Object.defineProperty(drop, "target", { value: tree, configurable: true });
    document.dispatchEvent(drop);
    expect(hint.style.display).toBe("none");

    cleanup();
    host.remove();
  });

  it("drop 目标是 shadow DOM 深层后代（真实拖放场景）→ 仍被识别为树内（parentNode 跨 shadow 边界）", () => {
    // 回归锁：isInTree 旧实现用 parentElement 上溯，遇 shadow 边界顶部返回 null，
    // 对 shadow DOM 内任何深层目标都判 false → 真实拖放永不触发（ADR-060 组件化后
    // 树内容全在 shadow root 内）。改用 parentNode 跨 shadow 边界（经 host）上溯。
    const host = document.createElement("app-tree");
    const sr = host.attachShadow({ mode: "open" });
    sr.innerHTML =
      '<div id="tree"><div class="item"><span>deep target</span></div></div>' +
      '<div class="tree-drop-hint"></div>';
    document.body.appendChild(host);
    const tree = sr.getElementById("tree") as HTMLElement;
    const deep = tree.querySelector(".item span") as HTMLElement;
    const hint = sr.querySelector(".tree-drop-hint") as HTMLElement;
    const cleanup = bindTreeDnD(tree);

    const over = makeDragEvent("dragover", { types: ["Files"] });
    Object.defineProperty(over, "target", { value: deep, configurable: true });
    document.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(hint.style.display).toBe("flex");

    const drop = makeDragEvent("drop", { types: ["Files"] });
    Object.defineProperty(drop, "target", { value: deep, configurable: true });
    document.dispatchEvent(drop);
    expect(hint.style.display).toBe("none");

    cleanup();
    host.remove();
  });
});

// ===== dragover 行为 =====

describe("dragover 事件", () => {
  it("拖文件到容器 → preventDefault + dropEffect=copy", () => {
    bindTreeDnD(container);
    const ev = makeDragEvent("dragover", { types: ["Files"] });
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((ev.dataTransfer as { dropEffect: string }).dropEffect).toBe("copy");
  });

  it("拖非文件 → 不拦截", () => {
    bindTreeDnD(container);
    const ev = makeDragEvent("dragover", { types: ["text/plain"] });
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("目标为 input → 不拦截", () => {
    bindTreeDnD(container);
    const input = document.createElement("input");
    container.appendChild(input);
    const ev = makeDragEvent("dragover", { types: ["Files"] });
    Object.defineProperty(ev, "target", { value: input, configurable: true });
    container.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    input.remove();
  });
});

// 为 handleTreeDrop 提供 busy 闭包（与 bindTreeDnD 同结构）
function makeBusyPair(): [() => boolean, (v: boolean) => void] {
  let busy = false;
  return [() => busy, (v) => { busy = v; }];
}

// ===== handleTreeDrop：网页版分支 =====

describe("handleTreeDrop — 网页版（ADR-049）", () => {
  it("isWebPlatform → importWebFiles + tree:reload + stats:refresh", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    const reloadSpy = vi.fn();
    const statsSpy = vi.fn();
    const unsubReload = bus.on("tree:reload", () => reloadSpy());
    const unsubStats = bus.on("stats:refresh", () => statsSpy());
    const file = new File(["ysm"], "m.ysm", { type: "application/octet-stream" });
    const [isBusy, setBusy] = makeBusyPair();
    await handleTreeDrop(makeDragEvent("drop", { files: [file], types: ["Files"] }), isBusy, setBusy);
    expect(importWebFiles).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalled();
    expect(statsSpy).toHaveBeenCalled();
    unsubReload();
    unsubStats();
  });

  it("网页版拖入文件夹（files 为空）→ warn toast，不调 importWebFiles", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    const [isBusy, setBusy] = makeBusyPair();
    await handleTreeDrop(makeDragEvent("drop", { files: [], types: ["Files"] }), isBusy, setBusy);
    expect(importWebFiles).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalled();
    expect(String(toastSpy.mock.calls[0][0])).toContain("暂不支持文件夹");
    unsub();
  });

  it("网页版 importWebFiles reject → onDrop 兜底：console.error + error toast，busy 复位", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    importWebFilesMock.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    const file = new File(["ysm"], "m.ysm");
    bindTreeDnD(container);
    fireDrop(container, { items: [], files: [file], types: ["Files"] });
    await flush();
    await flush();
    expect(importWebFiles).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    expect(toastSpy.mock.calls.some((c) => String(c[0]).includes("出错"))).toBe(true);
    errSpy.mockRestore();
    unsub();
  });
});

// ===== handleTreeDrop：桌面版 busy 互斥 =====

describe("handleTreeDrop — busy 互斥守卫", () => {
  it("连续两次 drop：第二次被 busy 忽略，emit busy toast", async () => {
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    const file = new File(["ysm"], "m.ysm");
    const [isBusy, setBusy] = makeBusyPair();
    // 第一次 drop：同步触发 handleTreeDrop，setBusy(true)，executeCollected 异步执行
    const p1 = handleTreeDrop(makeDragEvent("drop", { files: [file], types: ["Files"] }), isBusy, setBusy);
    // 第二次 drop：isBusy() 仍为 true
    handleTreeDrop(makeDragEvent("drop", { files: [file], types: ["Files"] }), isBusy, setBusy);
    await p1;
    await flush();
    await flush();
    // busy toast 应被 emit
    expect(toastSpy.mock.calls.some((c) => String(c[0]).includes("正在导入"))).toBe(true);
    unsub();
  });
});

// ===== handleTreeDrop：错误兜底 =====

describe("handleTreeDrop — 错误兜底", () => {
  it("drop 处理异常 → console.error + error toast", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    // items 含 null 触发 collectFiles 的 null 守卫（不再崩溃）
    const ev = makeDragEvent("drop", { items: [null as unknown as DataTransferItem], files: [], types: ["Files"] });
    const [isBusy, setBusy] = makeBusyPair();
    await handleTreeDrop(ev, isBusy, setBusy);
    await flush();
    // 无异常即成功（null 守卫让 collectFiles 安全跳过 null 项）
    errSpy.mockRestore();
    unsub();
  });
});

// ===== handleTreeDrop：桌面版空 drop / 可编辑目标 =====

describe("handleTreeDrop — 空 drop / 可编辑目标", () => {
  it("无 items 无 files 的桌面版 drop → 无支持文件 toast，不调 execute", async () => {
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    const [isBusy, setBusy] = makeBusyPair();
    await handleTreeDrop(makeDragEvent("drop", { types: ["Files"] }), isBusy, setBusy);
    expect(toastSpy.mock.calls.some((c) => String(c[0]).includes("未检测到"))).toBe(true);
    unsub();
  });

  it("drop 目标为 input → 直接 return，不导入不 toast", async () => {
    (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"] = "browser";
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    const input = document.createElement("input");
    container.appendChild(input);
    const [isBusy, setBusy] = makeBusyPair();
    const ev = makeDragEvent("drop", { files: [new File(["x"], "m.ysm")], types: ["Files"] });
    Object.defineProperty(ev, "target", { value: input, configurable: true });
    await handleTreeDrop(ev, isBusy, setBusy);
    expect(importWebFiles).not.toHaveBeenCalled();
    expect(toastSpy).not.toHaveBeenCalled();
    input.remove();
    unsub();
  });
});

// ===== oversize 过滤（桌面版 files 路径）=====

describe("handleTreeDrop — oversize 过滤", () => {
  it("超限文件 + 合法文件：仅导入合法项，warn toast 列名", async () => {
    const big = new File(["x"], "big.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1, configurable: true });
    const small = new File(["x"], "small.ysm", { type: "application/octet-stream" });
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    bindTreeDnD(container);
    fireDrop(container, { items: [], files: [big, small], types: ["Files"] });
    await flush();
    await flush();
    await flush();
    const oversizeToast = toastSpy.mock.calls.some((c) =>
      String(c[0]).includes("超过") && String(c[0]).includes("上限已跳过"),
    );
    expect(oversizeToast).toBe(true);
    unsub();
  });

  it("全部文件超限 → 过滤后为空，return，不调 execute", async () => {
    vi.resetModules();
    vi.doMock("../backend/app.ts", () => ({
      getApp: vi.fn().mockResolvedValue({
        ImportModelFile: vi.fn().mockResolvedValue(undefined),
        ImportModelFolder: vi.fn().mockResolvedValue(undefined),
      }),
    }));
    const { getApp: freshGetApp } = await import("../backend/app.ts");
    const big1 = new File(["x"], "big1.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big1, "size", { value: MAX_IMPORT_BYTES + 1, configurable: true });
    const toastSpy = vi.fn();
    const unsub = bus.on("toast:show", (p) => toastSpy(p.msg));
    fireDrop(container, { items: [], files: [big1], types: ["Files"] });
    await flush();
    await flush();
    const { ImportModelFile } = await freshGetApp();
    expect(ImportModelFile).not.toHaveBeenCalled();
    unsub();
  });

  // review 14f3b7e4 回归锁：collect-0 检查前移后（oversize 滤光场景静默返回），
  // 镜像 pack-dnd.test.ts 的双断言——all-oversized 只许 warn、不许误导性 info；
  // 空 drop 必须走 collect-0 的 info 提示。两者互斥，缺一即双 toast 回归。
  it("全部文件超限 → 仅 warn 超限提示，不误导性补弹「未检测到支持文件」info", async () => {
    const big = new File(["x"], "big.ysm", { type: "application/octet-stream" });
    Object.defineProperty(big, "size", { value: MAX_IMPORT_BYTES + 1, configurable: true });
    const toasts: ToastPayload[] = [];
    const unsub = bus.on("toast:show", (p) => toasts.push(p));
    bindTreeDnD(container);
    fireDrop(container, { items: [], files: [big], types: ["Files"] });
    await flush();
    await flush();
    await flush();
    expect(toasts.some((t2) => t2.type === "warn")).toBe(true);
    expect(toasts.some((t2) => t2.type === "info")).toBe(false);
    unsub();
  });

  it("收集 0 文件（空 drop）→ info 提示无支持文件", async () => {
    const toasts: ToastPayload[] = [];
    const unsub = bus.on("toast:show", (p) => toasts.push(p));
    bindTreeDnD(container);
    fireDrop(container, { items: [], files: [], types: ["Files"] });
    await flush();
    await flush();
    await flush();
    expect(toasts.some((t2) => t2.type === "info")).toBe(true);
    unsub();
  });
});
