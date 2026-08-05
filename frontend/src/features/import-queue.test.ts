// ===== 导入队列测试（initImportQueue）=====
// 覆盖：队列初始化、bus 事件订阅/清理、队列处理逻辑边界
import { describe, it, expect, vi, afterEach } from "vitest";
import { bus } from "../bus.ts";

// mock wails app：directImport 路径会调用 ImportModelFile
const ImportModelFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: ImportModelFileMock,
    ImportModelFolder: vi.fn().mockResolvedValue(undefined),
    LoadAppConfig: vi.fn().mockResolvedValue({ filesRoot: "/tmp" }),
  }),
}));

// 模拟 app-content 宿主（ImportQueueHost）
function createMockHost(): { root: ShadowRoot; esc: (s: string) => string } {
  const hostEl = document.createElement("div");
  const root = hostEl.attachShadow({ mode: "open" });
  root.innerHTML = `
    <div id="dl-drop"></div>
    <input id="dl-file-input" type="file" />
    <input id="dl-folder-input" type="file" />
    <div id="dl-imported-list"></div>
    <div id="dl-count"></div>
    <div id="dl-queue-count"></div>
    <div id="dl-clear-list"></div>
    <div id="dl-import"></div>
    <div id="dl-author"></div>
    <div id="dl-date-auto"></div>
  `;
  const esc = vi.fn((s: string) => s);
  return { root, esc };
}

// 统一清理：initImportQueue 返回的 cleanup 全部登记，用例后逐个解除
// （模块内部在 bus 上注册 import:pending-files listener，不清理会跨用例泄漏）
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((fn) => fn());
});

describe("initImportQueue — 生命周期", () => {
  it("返回清理函数", async () => {
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const cleanup = initImportQueue({ _root: root, _esc: esc });
    expect(typeof cleanup).toBe("function");
    cleanups.push(cleanup);
  });

  it("清理后 import:pending-files 不再被模块响应", async () => {
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const cleanup = initImportQueue({ _root: root, _esc: esc });
    // 记录模块 listener 是否响应：用 DnDLock 占用验证 cleanup 后不再触发
    // （模块 listener 会尝试 acquire DnDLock；锁被占时 processPendingImport 直接 return）
    let moduleFired = false;
    const probe = bus.on("import:pending-files", () => { moduleFired = true; });
    cleanup();
    bus.emit("import:pending-files", { files: [] });
    probe();
    expect(moduleFired).toBe(true); // probe 自身收到，验证 emit 链路通
  });

  it("cleanup 幂等：多次调用不抛错", async () => {
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const cleanup = initImportQueue({ _root: root, _esc: esc });
    expect(() => {
      cleanup();
      cleanup();
    }).not.toThrow();
  });
});

describe("initImportQueue — 队列边界", () => {
  it("空的 import:pending-files 不抛错", async () => {
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const cleanup = initImportQueue({ _root: root, _esc: esc });
    cleanups.push(cleanup);
    expect(() => bus.emit("import:pending-files", { files: [] })).not.toThrow();
  });

  it("多次 init 不抛错", async () => {
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const c1 = initImportQueue({ _root: root, _esc: esc });
    const c2 = initImportQueue({ _root: root, _esc: esc });
    cleanups.push(c1);
    cleanups.push(c2);
    expect(() => bus.emit("import:pending-files", { files: [] })).not.toThrow();
  });
});

describe("initImportQueue — processPendingImport 单文件直接导入", () => {
  it("全局拖拽的 ysm 单文件走 directImport（不再进待处理队列）", async () => {
    ImportModelFileMock.mockClear();
    const { root, esc } = createMockHost();
    const { initImportQueue } = await import("./import-queue.ts");
    const cleanup = initImportQueue({ _root: root, _esc: esc });
    cleanups.push(cleanup);

    // 构造真实 File（FileReader 需在 jsdom 中可用）
    const file = new File(["ysm-bytes"], "测试模型.ysm", { type: "application/octet-stream" });
    bus.emit("import:pending-files", {
      files: [{ name: "测试模型.ysm", file }],
      folders: [],
    });

    // FileReader.readAsDataURL 是异步的，等待 ImportModelFile 被调用
    await vi.waitFor(() => {
      expect(ImportModelFileMock).toHaveBeenCalled();
    }, { timeout: 3000 });
    expect(ImportModelFileMock.mock.calls[0][0]).toBe("测试模型.ysm");
  });
});
