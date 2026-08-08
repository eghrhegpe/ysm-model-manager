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

// P3 修复（code_review）：⚠️ 预警键契约——repoFiles 键须与预警查询
// fq.name.replace(/\.\w+$/,"") 对齐（去扩展名），normal 与 banned 条目都归一化为纯名。
// 直接锁 normalizeRepoName 纯函数（避免 mock 完整 getApp 148 个绑定属性的类型负担）
describe("normalizeRepoName ⚠️ 预警键契约（P3）", () => {
  it("normal 条目 foo.ysm → foo", async () => {
    const { normalizeRepoName } = await import("./import-queue.ts");
    expect(normalizeRepoName("foo.ysm")).toBe("foo");
  });

  it("banned 条目 foo.ysm.ban → foo（先剥 .ban 再剥扩展名，顺序不可反）", async () => {
    const { normalizeRepoName } = await import("./import-queue.ts");
    expect(normalizeRepoName("foo.ysm.ban")).toBe("foo");
    // 顺序反了会得到 foo.ysm（死代码）——断言非此形态
    expect(normalizeRepoName("foo.ysm.ban")).not.toBe("foo.ysm");
  });

  it("无扩展名条目原样返回", async () => {
    const { normalizeRepoName } = await import("./import-queue.ts");
    expect(normalizeRepoName("README")).toBe("README");
  });
});


