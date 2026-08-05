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


