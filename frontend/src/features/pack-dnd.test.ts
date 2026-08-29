// ===== 整合包卡片拖拽导入（先入仓库再推送）测试 =====
// 覆盖：handleInstanceDrop 编排链路（单文件 / 文件夹整组 / 光杆 ysm.json 拦截 /
// oversize 过滤 / busy 互斥 / 失败反馈）与 bindPackCardDnD 绑定/高亮/清理。
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  importFilePush: vi.fn<(...args: unknown[]) => Promise<void>>(),
  importFolderPush: vi.fn<(...args: unknown[]) => Promise<void>>(),
  addOpLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportFileAndPushToInstance: mocks.importFilePush,
    ImportFolderAndPushToInstance: mocks.importFolderPush,
    AddOpLog: mocks.addOpLog,
  }),
}));

// oversize 阈值压到 10 字节便于测试过滤分支
vi.mock("../backend/browser-adapter.ts", () => ({
  MAX_IMPORT_BYTES: 10,
}));

import { bus } from "../bus.ts";
import { getApp } from "../backend/app.ts";
import { handleInstanceDrop, bindPackCardDnD } from "./pack-dnd.ts";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** binder 测试用：FileReader（happy-dom）跨多个宏任务 resolve，多轮冲刷收敛 */
const flushAll = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** 构造带 dataTransfer 的 DragEvent（happy-dom 需 defineProperty 注入） */
function makeDragEvent(type: string, opts: {
  types?: string[];
  files?: File[];
  target?: EventTarget | null;
}): DragEvent {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(ev, "dataTransfer", {
    value: { types: opts.types ?? ["Files"], items: [], files: opts.files ?? [], dropEffect: "none" },
    configurable: true,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(ev, "target", { value: opts.target, configurable: true });
  }
  return ev;
}

function makeFile(name: string, content: string, relPath?: string): File {
  const f = new File([content], name);
  if (relPath !== undefined) {
    Object.defineProperty(f, "webkitRelativePath", { value: relPath, configurable: true });
  }
  return f;
}

/** 收集 bus 事件 */
const toasts: Array<{ msg: string; type: string }> = [];
const events: string[] = [];
let unsubToast: (() => void) | null = null;
let unsubStats: (() => void) | null = null;
let unsubTree: (() => void) | null = null;

beforeEach(() => {
  toasts.length = 0;
  events.length = 0;
  mocks.importFilePush.mockReset().mockResolvedValue(undefined);
  mocks.importFolderPush.mockReset().mockResolvedValue(undefined);
  mocks.addOpLog.mockReset().mockResolvedValue(undefined);
  (getApp as ReturnType<typeof vi.fn>).mockClear();
  unsubToast?.(); unsubStats?.(); unsubTree?.();
  unsubToast = bus.on("toast:show", (p) => toasts.push({ msg: (p as { msg: string }).msg, type: (p as { type?: string }).type || "" }));
  unsubStats = bus.on("stats:refresh", () => events.push("stats:refresh"));
  unsubTree = bus.on("tree:reload", () => events.push("tree:reload"));
});

const busyIdle = { isBusy: () => false, setBusy: () => {} };

// ===== handleInstanceDrop 编排 =====

describe("handleInstanceDrop 编排", () => {
  it("散落单文件：先入仓库再推送（ImportFileAndPushToInstance），成功后刷新", async () => {
    const ev = makeDragEvent("drop", { files: [makeFile("a.ysm", "content")] });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFilePush).toHaveBeenCalledTimes(1);
    expect(mocks.importFilePush).toHaveBeenCalledWith("a.ysm", expect.any(String), "TestInst");
    expect(events).toContain("stats:refresh");
    expect(events).toContain("tree:reload");
    expect(toasts.some((t2) => t2.type === "success")).toBe(true);
  });

  it("文件夹整组：folderName/subpath 拆分 + 组内相对路径", async () => {
    const ev = makeDragEvent("drop", {
      files: [
        makeFile("ysm.json", "{}", "狐狸/ysm.json"),
        makeFile("face.png", "png", "狐狸/tex/face.png"),
      ],
    });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFolderPush).toHaveBeenCalledTimes(1);
    const [folderName, subpath, items, inst] = mocks.importFolderPush.mock.calls[0];
    expect(folderName).toBe("狐狸");
    expect(subpath).toBe("");
    expect(items).toEqual([
      { RelPath: "ysm.json", Base64: expect.any(String) },
      { RelPath: "tex/face.png", Base64: expect.any(String) },
    ]);
    expect(inst).toBe("TestInst");
    expect(mocks.importFilePush).not.toHaveBeenCalled();
  });

  it("拖入含子目录的文件夹：组名=首段目录，组内嵌套 relPath 保留", async () => {
    const ev = makeDragEvent("drop", {
      files: [makeFile("ysm.json", "{}", "分类1/狐狸/ysm.json")],
    });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFolderPush).toHaveBeenCalledWith(
      "分类1",
      "",
      [{ RelPath: "狐狸/ysm.json", Base64: expect.any(String) }],
      "TestInst",
    );
  });

  it("光杆 ysm.json 散文件被拦截（防推送侧整仓落地），不给 binding", async () => {
    const ev = makeDragEvent("drop", { files: [makeFile("ysm.json", "{}")] });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFilePush).not.toHaveBeenCalled();
    expect(mocks.importFolderPush).not.toHaveBeenCalled();
    expect(toasts.some((t2) => t2.type === "warn")).toBe(true);
    expect(events).not.toContain("stats:refresh");
  });

  it("oversize 文件被过滤并提示，不给 binding（且不误导性补弹「收集 0 文件」）", async () => {
    const ev = makeDragEvent("drop", { files: [makeFile("big.ysm", "x".repeat(50))] });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFilePush).not.toHaveBeenCalled();
    expect(toasts.some((t2) => t2.type === "warn")).toBe(true);
    expect(toasts.some((t2) => t2.type === "info")).toBe(false);
  });

  it("推送失败：错误 toast 带友好信息，且仍刷新（导入可能已落仓库）", async () => {
    mocks.importFilePush.mockRejectedValue(new Error("LINK_FAILED"));
    const ev = makeDragEvent("drop", { files: [makeFile("a.ysm", "content")] });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(toasts.some((t2) => t2.type === "error")).toBe(true);
    expect(events).toContain("stats:refresh");
    expect(events).toContain("tree:reload");
  });

  it("busy 在途：第二次 drop 仅提示不执行", async () => {
    let busy = false;
    const b = { isBusy: () => busy, setBusy: (v: boolean) => { busy = v; } };
    const ev1 = makeDragEvent("drop", { files: [makeFile("a.ysm", "content")] });
    const p1 = handleInstanceDrop(ev1, "TestInst", b);
    const ev2 = makeDragEvent("drop", { files: [makeFile("b.ysm", "content")] });
    await handleInstanceDrop(ev2, "TestInst", b);
    await p1;
    await flush();

    // 第一个 drop 正常执行，第二个被 busy 拦截
    expect(mocks.importFilePush).toHaveBeenCalledTimes(1);
    expect(toasts.some((t2) => t2.msg.includes("导入") || t2.type === "info")).toBe(true);
  });

  it("收集 0 文件：提示无支持文件，不给 binding", async () => {
    const ev = makeDragEvent("drop", { files: [] });
    await handleInstanceDrop(ev, "TestInst", busyIdle);
    await flush();

    expect(mocks.importFilePush).not.toHaveBeenCalled();
    expect(mocks.importFolderPush).not.toHaveBeenCalled();
    expect(toasts.some((t2) => t2.type === "info")).toBe(true);
  });
});

// ===== bindPackCardDnD 绑定 =====

describe("bindPackCardDnD 绑定", () => {
  function makeSidebar(): { root: ShadowRoot; card: HTMLElement; host: HTMLElement } {
    const host = document.createElement("app-sidebar");
    const root = host.attachShadow({ mode: "open" });
    const card = document.createElement("div");
    card.className = "instance-card";
    card.dataset.idx = "0";
    root.appendChild(card);
    document.body.appendChild(host);
    return { root, card, host };
  }

  it("dragover 命中卡片：高亮 + preventDefault；dragleave/drop 清除高亮", async () => {
    const { root, card, host } = makeSidebar();
    const cleanup = bindPackCardDnD(root, () => [{ name: "TestInst" }]);

    const over = makeDragEvent("dragover", { types: ["Files"], target: card });
    document.dispatchEvent(over);
    expect(card.classList.contains("dnd-over")).toBe(true);

    const leave = makeDragEvent("dragleave", { types: ["Files"], target: card });
    document.dispatchEvent(leave);
    expect(card.classList.contains("dnd-over")).toBe(false);

    const over2 = makeDragEvent("dragover", { types: ["Files"], target: card });
    document.dispatchEvent(over2);
    const drop = makeDragEvent("drop", { types: ["Files"], target: card, files: [makeFile("a.ysm", "content")] });
    document.dispatchEvent(drop);
    expect(card.classList.contains("dnd-over")).toBe(false);
    await flushAll(); // drop 异步处理（FileReader）在测试内收敛，防续体漏到下一用例

    cleanup();
    host.remove();
  });

  it("drop 落到卡片：按 data-idx 解析实例名并执行推送", async () => {
    const { root, card, host } = makeSidebar();
    const cleanup = bindPackCardDnD(root, () => [{ name: "TestInst" }]);

    const drop = makeDragEvent("drop", { types: ["Files"], target: card, files: [makeFile("a.ysm", "content")] });
    document.dispatchEvent(drop);
    await flushAll();

    expect(mocks.importFilePush).toHaveBeenCalledWith("a.ysm", expect.any(String), "TestInst");

    cleanup();
    host.remove();
  });

  it("cleanup 后 document 监听移除，drop 不再触发", async () => {
    const { root, card, host } = makeSidebar();
    const cleanup = bindPackCardDnD(root, () => [{ name: "TestInst" }]);
    cleanup();

    const drop = makeDragEvent("drop", { types: ["Files"], target: card, files: [makeFile("a.ysm", "content")] });
    document.dispatchEvent(drop);
    await flushAll();

    expect(mocks.importFilePush).not.toHaveBeenCalled();
    host.remove();
  });

  it("非 Files 拖拽（如文本）不高亮不拦截", () => {
    const { root, card, host } = makeSidebar();
    const cleanup = bindPackCardDnD(root, () => [{ name: "TestInst" }]);

    const over = makeDragEvent("dragover", { types: ["text/plain"], target: card });
    document.dispatchEvent(over);
    expect(card.classList.contains("dnd-over")).toBe(false);

    cleanup();
    host.remove();
  });
});
