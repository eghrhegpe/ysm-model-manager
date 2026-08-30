// ===== 集成测试：虚拟滚动 + Shadow DOM 下仓库页拖拽导入全链路 =====
// 守护 ADR-060 document 层绑定在真实 <app-tree>（虚拟滚动 .vs-wrap 结构 + shadow 隔离）下
// 仍能识别 dragover/drop：容器只换 innerHTML 不换节点，target 链经 parentNode 跨 shadow 边界可达。
// 另锁定上下文路由核心链路：文件夹拖入 → ImportModelFolderTo 的 rtype 透传（审核 P3-2），
// 以及 root 动态切换后闭包惰性解析不残留旧类型（审核 P2）。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../backend/app.ts", () => ({ getApp: vi.fn() }));
vi.mock("./toolbar-events.ts", () => ({ bindToolbarEvents: vi.fn() }));

import { register, clear as clearRegistry } from "../../services/registry.ts";
import { getApp } from "../../backend/app.ts";
import "./index.ts"; // 触发 customElements.define("app-tree")
import { waitFor } from "../../test-utils/index.ts";
import type { AppTree } from "./index.ts";

const getAppMock = vi.mocked(getApp);

const bindings = {
  ImportModelFile: vi.fn().mockResolvedValue(undefined),
  ImportModelFolder: vi.fn().mockResolvedValue(undefined),
  ImportModelFolderTo: vi.fn().mockResolvedValue(undefined),
  AddOpLog: vi.fn().mockResolvedValue(undefined),
  ListModelAuthors: vi.fn().mockResolvedValue([]),
  ClearScanCache: vi.fn().mockResolvedValue(undefined),
  GetRepoRoot: vi.fn().mockResolvedValue("/repo"),
  ScanModelEntriesWithLabel: vi.fn().mockResolvedValue([]),
  IsFileBanned: vi.fn().mockResolvedValue(false),
};

const entries = [
  { name: "a.ysm", path: "a.ysm", fullPath: "/repo/a.ysm", type: "EntityPlayer", banned: false, size: 1, modTime: 0 },
  { name: "b.ysm", path: "b.ysm", fullPath: "/repo/b.ysm", type: "EntityPlayer", banned: false, size: 2, modTime: 0 },
];

function makeDragEvent(type: string, opts: { types?: string[]; files?: File[] }): DragEvent {
  const ev = new DragEvent(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(ev, "dataTransfer", {
    value: { types: opts.types ?? ["Files"], items: [], files: opts.files ?? [], dropEffect: "none" },
    configurable: true,
  });
  return ev;
}

async function mountEl(): Promise<AppTree> {
  const el = document.createElement("app-tree") as unknown as AppTree;
  el.setAttribute("root", "EntityPlayer");
  document.body.appendChild(el);
  await waitFor(() => (el as unknown as { _ready: boolean })._ready === true);
  return el;
}

let el: AppTree;

beforeEach(async () => {
  vi.clearAllMocks();
  clearRegistry();
  register(
    "loadEntries",
    (() => Promise.resolve({ filesRoot: "/repo", entries: [...entries] })) as unknown as Parameters<typeof register>[1],
  );
  getAppMock.mockResolvedValue(bindings as unknown as Awaited<ReturnType<typeof getAppMock>>);
  delete (globalThis as unknown as Record<string, unknown>)["__YSM_BACKEND__"];
  el = await mountEl();
});

afterEach(() => {
  el?.remove();
});

describe("虚拟滚动 + Shadow DOM 下仓库页 DnD 全链路", () => {
  it("树渲染出虚拟滚动结构（.vs-wrap 行）→ document 级 dragover 命中深层行 → 提示条显示", () => {
    const tree = el.shadowRoot!.getElementById("tree")!;
    const vsWrap = tree.querySelector(".vs-wrap");
    expect(vsWrap, "虚拟滚动容器应存在").toBeTruthy();
    const row = vsWrap!.querySelector("*");
    expect(row, "虚拟滚动行应存在").toBeTruthy();

    const hint = el.shadowRoot!.querySelector(".tree-drop-hint") as HTMLElement;

    const over = makeDragEvent("dragover", { types: ["Files"] });
    Object.defineProperty(over, "target", { value: row, configurable: true });
    document.dispatchEvent(over);

    expect(hint.style.display).toBe("flex");
  });

  it("document 级 drop 命中虚拟滚动深层行 → ImportModelFile 被调用（导入生效）", async () => {
    const tree = el.shadowRoot!.getElementById("tree")!;
    const row = tree.querySelector(".vs-wrap > *")!;
    const hint = el.shadowRoot!.querySelector(".tree-drop-hint") as HTMLElement;

    const drop = makeDragEvent("drop", { files: [new File(["x"], "m.ysm")] });
    Object.defineProperty(drop, "target", { value: row, configurable: true });
    document.dispatchEvent(drop);

    await waitFor(() => bindings.ImportModelFile.mock.calls.length > 0);
    expect(bindings.ImportModelFile).toHaveBeenCalledTimes(1);
    expect(hint.style.display).toBe("none");
  });

  it("文件夹拖入 → rtype 透传链路锁定：ImportModelFolderTo 收到当前树根类型（审核 P3-2）", async () => {
    const tree = el.shadowRoot!.getElementById("tree")!;
    const row = tree.querySelector(".vs-wrap > *")!;
    const f = new File(["x"], "pack.zip");
    Object.defineProperty(f, "webkitRelativePath", { value: "女仆包/pack.zip" });

    const drop = makeDragEvent("drop", { files: [f] });
    Object.defineProperty(drop, "target", { value: row, configurable: true });
    document.dispatchEvent(drop);

    await waitFor(() => bindings.ImportModelFolderTo.mock.calls.length > 0);
    expect(bindings.ImportModelFolderTo).toHaveBeenCalledTimes(1);
    const [folderName, subpath, rtype] = bindings.ImportModelFolderTo.mock.calls[0];
    expect(folderName).toBe("女仆包");
    expect(subpath).toBe("");
    expect(rtype).toBe("EntityPlayer");
  });

  it("root 动态切换后拖入 → drop 时惰性解析新类型，闭包不残留旧值（审核 P2 回归）", async () => {
    el.setAttribute("root", "Blueprint");
    const tree = el.shadowRoot!.getElementById("tree")!;
    const row = tree.querySelector(".vs-wrap > *")!;
    const f = new File(["x"], "pack.zip");
    Object.defineProperty(f, "webkitRelativePath", { value: "图纸包/pack.zip" });

    const drop = makeDragEvent("drop", { files: [f] });
    Object.defineProperty(drop, "target", { value: row, configurable: true });
    document.dispatchEvent(drop);

    await waitFor(() => bindings.ImportModelFolderTo.mock.calls.length > 0);
    const [, , rtype] = bindings.ImportModelFolderTo.mock.calls[0];
    expect(rtype).toBe("Blueprint");
  });
});
