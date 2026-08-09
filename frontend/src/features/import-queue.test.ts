// ===== 导入队列 + 拖拽 + 重命名流程测试 =====
// 覆盖：
//  - normalizeRepoName：.ban 先剥后剥扩展名的归一化契约（P2 修复）
//  - initImportQueue：
//    * drop 回退 files 路径（支持/不支持过滤 + warn toast）
//    * fileInput/folderInput change 路由（直导 / 文件夹整组）
//    * 导入按钮全链路：configureStorage / cancelled / 成功 / FILE_EXISTS 覆盖 / 并发守卫
//    * 取消按钮、队列项点击/移除、历史列表 ✂️ 重命名、clear list、history-changed 重渲染
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "../../src/test-utils/index.ts";

const {
  busEmit,
  busOn,
  friendlyError,
  modalConfirm,
  getApp,
  showRenameDialog,
  directImport,
  importFolder,
  __resetBus,
} = vi.hoisted(() => {
  // 同步派发 emitter：emit 调已注册 handler（ImportHistory 等真实模块依赖 bus 派发）
  const busHandlers: Record<string, Array<(p: unknown) => void>> = {};
  return {
    busEmit: vi.fn(
      (name: string, payload?: { msg?: string; type?: string }) => {
        for (const h of busHandlers[name] || []) h(payload);
      },
    ),
    busOn: vi.fn((name: string, handler: (p: unknown) => void) => {
      (busHandlers[name] ||= []).push(handler);
      return () => {
        busHandlers[name] = (busHandlers[name] || []).filter((h) => h !== handler);
      };
    }),
    friendlyError: vi.fn((e: unknown) => `友好:${String((e as Error)?.message ?? e)}`),
    modalConfirm: vi.fn(),
    getApp: vi.fn(),
    showRenameDialog: vi.fn(),
    directImport: vi.fn(),
    importFolder: vi.fn(),
    __resetBus: vi.fn(() => {
      for (const k of Object.keys(busHandlers)) delete busHandlers[k];
    }),
  };
});

vi.mock("../bus.ts", () => ({
  bus: { emit: busEmit, on: busOn },
}));
// t 返回 key 原文，便于断言（真实语言包返回中文文案）
vi.mock("../core/i18n/t.ts", () => ({
  t: (key: string) => key,
}));
vi.mock("../utils/dom/errors.ts", () => ({ friendlyError }));
vi.mock("../utils/dom/dialogs/modal.ts", () => ({ modalConfirm }));
vi.mock("../wails/app.ts", () => ({ getApp }));
vi.mock("../utils/dom/dialogs/rename.ts", () => ({ showRenameDialog }));
vi.mock("./import-executor.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./import-executor.ts")>();
  return { ...mod, directImport, importFolder };
});

import { normalizeRepoName, initImportQueue } from "./import-queue.ts";
import { ImportHistory } from "./import-executor.ts";
import type { ImportQueueHost } from "./import-queue.ts";

describe("normalizeRepoName — .ban 先剥契约", () => {
  it("普通扩展名 → 剥扩展名", () => {
    expect(normalizeRepoName("foo.ysm")).toBe("foo");
    expect(normalizeRepoName("foo.zip")).toBe("foo");
    expect(normalizeRepoName("a.b.c.ysm")).toBe("a.b.c");
  });

  it("banned 条目 → 先剥 .ban 再剥扩展名（顺序不可反）", () => {
    expect(normalizeRepoName("foo.ysm.ban")).toBe("foo");
    expect(normalizeRepoName("foo.ban")).toBe("foo");
  });

  it("大小写不敏感", () => {
    expect(normalizeRepoName("FOO.YSM.BAN")).toBe("FOO");
    expect(normalizeRepoName("foo.YSM")).toBe("foo");
  });

  it("无扩展名 → 原样返回", () => {
    expect(normalizeRepoName("foo")).toBe("foo");
  });
});

/** 带 getElementById 的假 root（对应 ImportQueueHost._root） */
function makeHost(): { host: ImportQueueHost; root: HTMLDivElement } {
  const root = document.createElement("div");
  root.innerHTML = `
    <div id="dl-drop"></div>
    <input id="dl-file-input" type="file">
    <input id="dl-folder-input" type="file">
    <div id="dl-imported-list"></div>
    <div id="dl-count"></div>
    <div id="dl-queue-count"></div>
    <div id="dl-form"></div>
    <input id="dl-author"><input id="dl-work"><input id="dl-chara">
    <input id="dl-variant"><input id="dl-date">
    <input id="dl-date-auto" type="checkbox">
    <div id="dl-preview"></div><div id="dl-conflict"></div><div id="dl-tips"></div>
    <input id="dl-from-header" type="checkbox">
    <button id="dl-import"></button><button id="dl-cancel"></button><button id="dl-clear-list"></button>
  `;
  (root as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById =
    (id: string) => root.querySelector(`#${id}`);
  const host: ImportQueueHost = {
    _root: root as unknown as ShadowRoot,
    _esc: (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
  };
  return { host, root };
}

function makeFile(name: string, extra: Record<string, unknown> = {}) {
  const f = new File(["content"], name);
  for (const [k, v] of Object.entries(extra)) {
    Object.defineProperty(f, k, { value: v });
  }
  return f;
}

/** 派发带 dataTransfer 的事件（happy-dom DragEvent 不支持 dataTransfer 构造） */
function dispatchDrop(el: HTMLElement, dt: Record<string, unknown>): void {
  const e = new Event("drop", { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(e, "dataTransfer", { value: dt });
  el.dispatchEvent(e);
}

/** 当前 getApp mock 返回对象（mockApp 每次调用更新；避免依赖 mock.results 调用时机） */
let appObj: Record<string, ReturnType<typeof vi.fn>>;

function mockApp(methods: Record<string, unknown> = {}) {
  appObj = {
    SavePreviewTempFile: vi.fn(() => "tmp.png"),
    GetRepoRoot: vi.fn(() => "/repo"),
    CheckFileExists: vi.fn(() => false),
    ExtractYSMHeaderFromBase64: vi.fn(() => ({ authorName: "", tips: "" })),
    LoadAppConfig: vi.fn(() => ({ filesRoot: "/repo" })),
    ImportModelFileTo: vi.fn(),
    ImportModelFileOverwriteTo: vi.fn(),
    RenameFile: vi.fn(),
    ScanModelEntriesWithLabel: vi.fn(() => []),
    ...methods,
  };
  getApp.mockResolvedValue(appObj);
}

/** 可控 FileReader：readAsDataURL 同步触发 onload（happy-dom FileReader 不触发） */
class FakeFileReader {
  result = "data:application/octet-stream;base64,YWJj";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.onload?.();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetBus();
  ImportHistory.clear();
  document.body.innerHTML = "";
  modalConfirm.mockResolvedValue(true);
  showRenameDialog.mockResolvedValue("新名.ysm");
  directImport.mockResolvedValue(undefined);
  importFolder.mockResolvedValue(undefined);
  mockApp();
  vi.stubGlobal("FileReader", FakeFileReader as never);
});

describe("initImportQueue — drop 回退 files 路径", () => {
  it("drop 无 items → 支持文件直导 + 不支持跳过 + 队列计数", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, {
      items: undefined,
      files: [makeFile("a.ysm"), makeFile("b.txt"), makeFile("c.zip")],
    });
    await waitFor(() => directImport.mock.calls.length === 2);
    expect(directImport).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: "a.ysm" }));
    expect(directImport).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: "c.zip" }));
    expect(busEmit).not.toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "warn" }),
    );
    expect(root.querySelector("#dl-queue-count")?.textContent).toBe("0");
  });

  it("drop 全部不支持 → warn toast 提示支持格式", () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, {
      items: undefined,
      files: [makeFile("a.txt"), makeFile("b.md")],
    });
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ type: "warn" }),
    );
    expect(directImport).not.toHaveBeenCalled();
  });

  it("drop items 无 entry → getAsFile 回退直导", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    const file = makeFile("a.ysm");
    dispatchDrop(drop, {
      items: [{ webkitGetAsEntry: undefined, getAsFile: () => file }],
      files: [],
    });
    await waitFor(() => directImport.mock.calls.length === 1);
    expect(busEmit).toHaveBeenCalledWith(
      "toast:show",
      expect.objectContaining({ msg: expect.stringContaining("addedToQueue") }),
    );
  });
});

describe("initImportQueue — 输入框路由", () => {
  it("fileInput change → 支持文件直导", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const input = root.querySelector("#dl-file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("m.ysm"), makeFile("x.exe")],
    });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => directImport.mock.calls.length === 1);
    expect(directImport).toHaveBeenCalledWith(expect.objectContaining({ name: "m.ysm" }));
  });

  it("folderInput change → 有目录前缀走整组导入 + 队列 toast", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const input = root.querySelector("#dl-folder-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [
        makeFile("a.ysm", { webkitRelativePath: "pack/a.ysm" }),
        makeFile("b.ysm", { webkitRelativePath: "pack/sub/b.ysm" }),
      ],
    });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => importFolder.mock.calls.length === 1);
    expect(importFolder).toHaveBeenCalledWith(
      "pack",
      expect.arrayContaining([
        expect.objectContaining({ relPath: "pack/a.ysm" }),
        expect.objectContaining({ relPath: "pack/sub/b.ysm" }),
      ]),
    );
  });

  it("folderInput change → 顶层散落文件直导（singles）", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const input = root.querySelector("#dl-folder-input") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [makeFile("solo.ysm", { webkitRelativePath: "solo.ysm" })],
    });
    input.dispatchEvent(new Event("change"));
    await waitFor(() => directImport.mock.calls.length === 1);
    expect(directImport).toHaveBeenCalledWith(expect.objectContaining({ name: "solo.ysm" }));
  });
});

describe("initImportQueue — 导入按钮全链路", () => {
  async function enterFormWithFile(host: ReturnType<typeof makeHost>["host"]) {
    initImportQueue(host);
    // 触发 ysm.json 进入表单：drop files 路径 → shouldEnterForm true → FileReader → enqueueFile → showForm
    const drop = host._root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, {
      items: undefined,
      files: [makeFile("ysm.json")],
    });
    await waitFor(
      () =>
        (host._root.querySelector("#dl-form") as HTMLElement).style.display ===
        "flex",
    );
  }

  it("无 filesRoot → warn toast 提示先配置存储", async () => {
    mockApp({ LoadAppConfig: vi.fn(() => ({ filesRoot: "" })) });
    const { host, root } = makeHost();
    initImportQueue(host);
    // 手动进入表单（用 drop 触发 ysm.json 表单），点导入
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, { items: undefined, files: [makeFile("ysm.json")] });
    await waitFor(() => busEmit.mock.calls.length > 0 || true);
    (root.querySelector("#dl-import") as HTMLButtonElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("configureStorage"),
      ),
    );
  });

  it("showRenameDialog 取消 → cancelled info toast，不导入", async () => {
    showRenameDialog.mockResolvedValue(null);
    const { host, root } = makeHost();
    await enterFormWithFile(host);
    (root.querySelector("#dl-import") as HTMLButtonElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("cancelled"),
      ),
    );
    expect(root.querySelector("#dl-count")?.textContent).toContain("个待处理");
  });

  it("导入成功 → ImportModelFileTo + stats/tree 刷新 + 历史入队 + 队列推进", async () => {
    const { host, root } = makeHost();
    await enterFormWithFile(host);
    (root.querySelector("#dl-import") as HTMLButtonElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("imported"),
      ),
    );
    expect(appObj.ImportModelFileTo).toHaveBeenCalledWith(
      "新名.ysm",
      "",
      expect.stringContaining(""),
    );
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
    expect(busEmit).toHaveBeenCalledWith("tree:reload");
    expect(ImportHistory.records.length).toBeGreaterThan(0);
  });

  it("FILE_EXISTS → modalConfirm 确认 → ImportModelFileOverwriteTo 覆盖", async () => {
    const { host, root } = makeHost();
    await enterFormWithFile(host);
    appObj.ImportModelFileTo.mockRejectedValue(new Error("FILE_EXISTS"));
    modalConfirm.mockResolvedValue(true);
    (root.querySelector("#dl-import") as HTMLButtonElement).click();
    await waitFor(() =>
      busEmit.mock.calls.some(
        (c) => c[0] === "toast:show" && String(c[1]?.msg ?? "").includes("overwritten"),
      ),
    );
    expect(modalConfirm).toHaveBeenCalledWith(expect.objectContaining({ okText: "覆盖" }));
    expect(appObj.ImportModelFileOverwriteTo).toHaveBeenCalled();
  });

  it("并发守卫：导入在途时第二次点击被拦截", async () => {
    let release: () => void = () => {};
    const { host, root } = makeHost();
    await enterFormWithFile(host);
    appObj.ImportModelFileTo.mockImplementation(
      () => new Promise<void>((r) => (release = r)),
    );
    const btn = root.querySelector("#dl-import") as HTMLButtonElement;
    btn.click();
    btn.click(); // 在途连点
    await new Promise((r) => setTimeout(r, 0));
    expect(appObj.ImportModelFileTo).toHaveBeenCalledTimes(1);
    release();
  });
});

describe("initImportQueue — 表单/队列 UI", () => {
  it("取消按钮 → 回到拖拽区（dropZone display flex）", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, { items: undefined, files: [makeFile("ysm.json")] });
    await waitFor(
      () => (root.querySelector("#dl-form") as HTMLElement).style.display === "flex",
    );
    expect((root.querySelector("#dl-drop") as HTMLElement).style.display).toBe("none");
    (root.querySelector("#dl-cancel") as HTMLButtonElement).click();
    expect((root.querySelector("#dl-drop") as HTMLElement).style.display).toBe("flex");
  });

  it("队列项渲染：编辑中 ✏️ + 同名去重 + repoFiles 加载", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    // 两个同名 ysm.json（同 relPath）→ 去重后仅入队 1 个
    dispatchDrop(drop, {
      items: undefined,
      files: [makeFile("ysm.json"), makeFile("ysm.json")],
    });
    await waitFor(() => root.querySelectorAll(".dl-q-item").length === 1);
    const qItems = root.querySelectorAll(".dl-q-item");
    expect(qItems.length).toBe(1);
    expect(qItems[0]!.textContent).toContain("✏️"); // 编辑中（currentFile 即队列首项）
    // 首次入队触发仓库文件列表加载
    await waitFor(() => appObj.ScanModelEntriesWithLabel.mock.calls.length > 0);
  });

  it("队列移除 → 队列空回拖拽区", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, { items: undefined, files: [makeFile("ysm.json")] });
    await waitFor(() => root.querySelectorAll(".dl-remove-q").length === 1);
    (root.querySelector(".dl-remove-q") as HTMLButtonElement).click();
    await waitFor(
      () => (root.querySelector("#dl-drop") as HTMLElement).style.display === "flex",
    );
    expect(root.querySelectorAll(".dl-q-item").length).toBe(0);
  });

  it("clear list → ImportHistory.clear + 列表渲染为空", () => {
    const { host, root } = makeHost();
    ImportHistory.push({ name: "old.ysm", time: "12:00", isYsm: true });
    const init = initImportQueue(host);
    expect(root.querySelector("#dl-imported-list")?.textContent).toContain("old.ysm");
    (root.querySelector("#dl-clear-list") as HTMLButtonElement).click();
    expect(ImportHistory.records).toHaveLength(0);
    expect(root.querySelector("#dl-imported-list")?.textContent).toContain("暂无文件");
    init();
  });

  it("import:history-changed 事件 → 重渲染列表", () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    expect(root.querySelector("#dl-imported-list")?.textContent).toContain("暂无文件");
    ImportHistory.push({ name: "new.ysm", time: "13:00", isYsm: false });
    expect(root.querySelector("#dl-imported-list")?.textContent).toContain("new.ysm");
  });

  it("历史条目 ✂️ 重命名 → RenameFile + ImportHistory.rename", async () => {
    const { host, root } = makeHost();
    initImportQueue(host);
    ImportHistory.push({ name: "a.ysm", time: "14:00", isYsm: true });
    showRenameDialog.mockResolvedValue("b.ysm");
    await waitFor(() => root.querySelector(".dl-reimport"));
    (root.querySelector(".dl-reimport") as HTMLButtonElement).click();
    await waitFor(() => ImportHistory.records[0]?.name === "b.ysm");
    expect(busEmit).toHaveBeenCalledWith("stats:refresh");
  });

  it("cleanup → 解绑监听器（drop 后 cleanup 不再触发直导）", async () => {
    const { host, root } = makeHost();
    const init = initImportQueue(host);
    const drop = root.querySelector("#dl-drop") as HTMLElement;
    dispatchDrop(drop, { items: undefined, files: [makeFile("x.ysm")] });
    await waitFor(() => directImport.mock.calls.length === 1);
    init();
    directImport.mockClear();
    dispatchDrop(drop, { items: undefined, files: [makeFile("y.ysm")] });
    expect(directImport).not.toHaveBeenCalled();
  });
});
