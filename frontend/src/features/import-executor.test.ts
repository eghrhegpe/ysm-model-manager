// @vitest-environment node
// ===== 全局导入执行器测试（import-executor.ts）=====
// 覆盖：单文件直导、文件夹整组、执行入口分组、去重、ysm.json 引导
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import { getApp, type AppBindings } from "../backend/app.ts";
import { executeCollected, directImport, importFolder, importWebFilesWithToast } from "./import-executor.ts";

const mocks = vi.hoisted(() => ({
  ImportModelFile: vi.fn().mockResolvedValue(undefined),
  ImportModelFolder: vi.fn().mockResolvedValue(undefined),
  ImportModelFolderTo: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../backend/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: mocks.ImportModelFile,
    ImportModelFolder: mocks.ImportModelFolder,
    ImportModelFolderTo: mocks.ImportModelFolderTo,
  }),
}));

// importWebFilesWithToast 依赖（仅该路径用到）：保留真实 MAX_IMPORT_BYTES，
// 仅替换 importWebFiles 为可控 mock
const importWebFilesMock = vi.hoisted(() => vi.fn());
vi.mock("../backend/browser-adapter.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../backend/browser-adapter.ts")>();
  return { ...actual, importWebFiles: importWebFilesMock };
});
vi.mock("./repo-rtype.ts", () => ({ currentRepoType: vi.fn(() => "ysm") }));

// happy-dom 已原生支持 FileReader（历史 jsdom 缺失，mock 保留以防环境切换）
// failingReads：测试「组内读失败跳过」用的可控失败名单（readAsDataURL 触发 onerror）
const failingReads = new Set<string>();
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(file: File): void {
    if (failingReads.has(file.name)) {
      this.onerror?.();
      return;
    }
    this.result = "data:application/octet-stream;base64,QUJD";
    this.onload?.();
  }
}
vi.stubGlobal("FileReader", MockFileReader);

const mkFile = (name: string): File => new File(["x"], name);

describe("executeCollected — 静默导入入口", () => {
  beforeEach(() => {
    mocks.ImportModelFile.mockClear();
    mocks.ImportModelFolder.mockClear();
    mocks.ImportModelFolderTo.mockClear();
  });

  it("散落 ysm 单文件 → 直导", async () => {
    const r = await executeCollected([{ file: mkFile("模型.ysm"), relPath: "模型.ysm" }]);
    expect(r.singles).toBe(1);
    expect(r.folders).toBe(0);
    expect(mocks.ImportModelFile).toHaveBeenCalledWith("模型.ysm", "QUJD");
  });

  it("普通文件夹装 ysm → 整组导入（保留层级）", async () => {
    const r = await executeCollected([
      { file: mkFile("模型A.ysm"), relPath: "合集/模型A.ysm" },
      { file: mkFile("模型B.ysm"), relPath: "合集/模型B.ysm" },
    ]);
    expect(r.folders).toBe(1);
    expect(r.singles).toBe(0);
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    const [folderName, subpath, items] = mocks.ImportModelFolder.mock.calls[0];
    expect(folderName).toBe("合集");
    expect(subpath).toBe("");
    expect(items).toEqual([
      { RelPath: "模型A.ysm", Base64: "QUJD" },
      { RelPath: "模型B.ysm", Base64: "QUJD" },
    ]);
  });

  it("多层嵌套 → 顶层目录整组，深层 relPath 保留", async () => {
    await executeCollected([
      { file: mkFile("ysm.json"), relPath: "a/b/ysm.json" },
      { file: mkFile("skin.png"), relPath: "a/b/textures/char/skin.png" },
    ]);
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    const [folderName, subpath, items] = mocks.ImportModelFolder.mock.calls[0];
    expect(folderName).toBe("a");
    expect(subpath).toBe("");
    expect(items).toEqual([
      { RelPath: "b/ysm.json", Base64: "QUJD" },
      { RelPath: "b/textures/char/skin.png", Base64: "QUJD" },
    ]);
  });

  it("纯杂物文件夹（无支持文件）→ 不导入", async () => {
    const r = await executeCollected([
      { file: mkFile("readme.txt"), relPath: "杂物/readme.txt" },
      { file: mkFile("pic.png"), relPath: "杂物/pic.png" },
    ]);
    expect(r.folders).toBe(0);
    expect(r.singles).toBe(0);
    expect(mocks.ImportModelFile).not.toHaveBeenCalled();
    expect(mocks.ImportModelFolder).not.toHaveBeenCalled();
  });

  it("带上下文 rtype → 文件夹走 ImportModelFolderTo（上下文路由落盘）", async () => {
    const r = await executeCollected(
      [{ file: mkFile("pack.zip"), relPath: "女仆包/pack.zip" }],
      "maid-model",
    );
    expect(r.folders).toBe(1);
    expect(mocks.ImportModelFolderTo).toHaveBeenCalledTimes(1);
    expect(mocks.ImportModelFolder).not.toHaveBeenCalled();
    const [folderName, subpath, rtype, items] = mocks.ImportModelFolderTo.mock.calls[0];
    expect(folderName).toBe("女仆包");
    expect(subpath).toBe("");
    expect(rtype).toBe("maid-model");
    expect(items).toEqual([{ RelPath: "pack.zip", Base64: "QUJD" }]);
  });

  it("无上下文（默认空串）→ 保持 ImportModelFolder 内容推断旧路径", async () => {
    await executeCollected([{ file: mkFile("a.ysm"), relPath: "包/a.ysm" }]);
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    expect(mocks.ImportModelFolderTo).not.toHaveBeenCalled();
  });

  it("有上下文但 ImportModelFolderTo 缺失（旧桥/Android 时序）→ 降级内容推断 + warn toast", async () => {
    // executeCollected 内部两次 log()（各调一次 getApp）+ importFolder 一次，共三次——
    // 需按调用序 mock：前两次给 log（AddOpLog 消费），第三次模拟缺失 ImportModelFolderTo 的旧桥
    vi.mocked(getApp)
      .mockResolvedValueOnce(mocks as unknown as AppBindings)
      .mockResolvedValueOnce(mocks as unknown as AppBindings)
      .mockResolvedValueOnce({
        ImportModelFile: mocks.ImportModelFile,
        ImportModelFolder: mocks.ImportModelFolder,
        // 无 ImportModelFolderTo：模拟绑定时序缺失
      } as unknown as AppBindings);
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const r = await executeCollected(
      [{ file: mkFile("pack.zip"), relPath: "女仆包/pack.zip" }],
      "maid-model",
    );
    expect(r.folders).toBe(1);
    expect(mocks.ImportModelFolderTo).not.toHaveBeenCalled();
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    expect(toasts.some((x) => x.type === "warn" && String(x.msg).includes("上下文"))).toBe(true);
    off();
  });

  it("同名文件两次拖入 → 两次执行（去重由后端 FILE_EXISTS / 调用方保证，执行器不拦历史重复）", async () => {
    await executeCollected([{ file: mkFile("dup.ysm"), relPath: "dup.ysm" }]);
    await executeCollected([{ file: mkFile("dup.ysm"), relPath: "dup.ysm" }]);
    expect(mocks.ImportModelFile).toHaveBeenCalledTimes(2);
  });

  it("ysm.json 单文件拖入 → 引导提示，不调后端", async () => {
    let warned = "";
    const off = bus.on("toast:show", ({ msg, type }) => {
      if (type === "warn") warned = msg;
    });
    await executeCollected([{ file: mkFile("ysm.json"), relPath: "ysm.json" }]);
    expect(warned).toContain("ysm.json");
    expect(mocks.ImportModelFile).not.toHaveBeenCalled();
    off();
  });
});

describe("directImport — 在途去重 / 失败释放（陷阱 #3）", () => {
  beforeEach(() => {
    failingReads.clear();
    mocks.ImportModelFile.mockClear();
    mocks.ImportModelFolder.mockClear();
  });

  it("同一文件并发在途 → 第二次命中 busy toast，不重复调后端，结束后在途释放", async () => {
    let release: () => void = () => {};
    mocks.ImportModelFile.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const file = mkFile("busy.ysm");
    const p1 = directImport(file);
    const p2 = directImport(file); // 在途 → busy 拦截
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ImportModelFile).toHaveBeenCalledTimes(1);
    expect(toasts.some((x) => x.type === "warn")).toBe(true); // busyImporting warn
    release();
    await p1;
    await p2;
    off();
  });

  it("后端失败 → 错误 toast + 在途释放（同文件可再次导入成功）", async () => {
    mocks.ImportModelFile.mockRejectedValueOnce(new Error("IO_ERROR"));
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const file = mkFile("fail.ysm");
    await directImport(file);
    expect(
      toasts.some((x) => x.type === "error" && String(x.msg).includes("IO_ERROR")),
    ).toBe(true);
    await directImport(file); // 若在途未释放则此处被 busy 拦截，ImportModelFile 仍 1 次
    expect(mocks.ImportModelFile).toHaveBeenCalledTimes(2);
    off();
  });
});

describe("importFolder — 组内读失败跳过 / 空组 / busy / FILE_EXISTS", () => {
  beforeEach(() => {
    failingReads.clear();
    mocks.ImportModelFolder.mockClear();
  });

  it("组内某文件读取失败 → 跳过该文件，不拖垮整组", async () => {
    failingReads.add("坏.ysm");
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    await importFolder("包", [
      { file: mkFile("坏.ysm"), relPath: "包/坏.ysm" },
      { file: mkFile("好.ysm"), relPath: "包/好.ysm" },
    ]);
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    expect(mocks.ImportModelFolder.mock.calls[0][2]).toEqual([
      { RelPath: "好.ysm", Base64: "QUJD" },
    ]);
    expect(toasts.some((x) => x.type === "success")).toBe(true);
    off();
  });

  it("组内全部读取失败 → emptyFolder toast，不调后端", async () => {
    failingReads.add("a.ysm");
    failingReads.add("b.ysm");
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    await importFolder("包", [
      { file: mkFile("a.ysm"), relPath: "包/a.ysm" },
      { file: mkFile("b.ysm"), relPath: "包/b.ysm" },
    ]);
    expect(mocks.ImportModelFolder).not.toHaveBeenCalled();
    expect(toasts.some((x) => x.type === "error")).toBe(true);
    off();
  });

  it("文件夹在途重复提交 → busy toast 拦截，不重复调后端", async () => {
    let release: () => void = () => {};
    mocks.ImportModelFolder.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const files = [{ file: mkFile("m.ysm"), relPath: "包/m.ysm" }];
    const p1 = importFolder("包", files);
    const p2 = importFolder("包", files); // 在途 → busy 拦截
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    expect(toasts.some((x) => x.type === "warn")).toBe(true);
    release();
    await p1;
    await p2;
    off();
  });

  it("后端 FILE_EXISTS → alreadyExists toast（非通用失败 toast）", async () => {
    mocks.ImportModelFolder.mockRejectedValueOnce(new Error("FILE_EXISTS"));
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    await importFolder("包", [{ file: mkFile("m.ysm"), relPath: "包/m.ysm" }]);
    // alreadyExists 分支的 toast 丢弃原始错误文案（不含 FILE_EXISTS）；
    // 若落入通用失败分支则 msg 会包含 "FILE_EXISTS"
    expect(
      toasts.some(
        (x) => x.type === "error" && !String(x.msg).includes("FILE_EXISTS"),
      ),
    ).toBe(true);
    off();
  });

  it("rtype 非空但旧桥缺 ImportModelFolderTo（typeof 守卫）→ 回退 ImportModelFolder 内容推断旧路", async () => {
    mocks.ImportModelFolderTo.mockClear();
    vi.mocked(getApp).mockResolvedValueOnce({
      ImportModelFile: mocks.ImportModelFile,
      ImportModelFolder: mocks.ImportModelFolder,
    } as unknown as AppBindings);
    await importFolder("包", [{ file: mkFile("m.ysm"), relPath: "包/m.ysm" }], "maid-model");
    expect(mocks.ImportModelFolder).toHaveBeenCalledTimes(1);
    expect(mocks.ImportModelFolderTo).not.toHaveBeenCalled();
  });
});

describe("importWebFilesWithToast — 网页版导入反馈（补零测试盲区）", () => {
  beforeEach(() => {
    importWebFilesMock.mockReset();
  });

  it("部分成功（imported=2, failed=1）→ 反馈双计数 + 刷新 tree/stats", async () => {
    importWebFilesMock.mockResolvedValue({ imported: 2, failed: 1 });
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    let reloaded = false;
    let refreshed = false;
    const offToast = bus.on("toast:show", (p) => toasts.push(p));
    const offTree = bus.on("tree:reload", () => (reloaded = true));
    const offStats = bus.on("stats:refresh", () => (refreshed = true));
    const r = await importWebFilesWithToast([mkFile("a.ysm"), mkFile("b.ysm"), mkFile("c.ysm")]);
    offToast();
    offTree();
    offStats();
    expect(r).toEqual({ imported: 2, failed: 1 });
    expect(toasts.some((x) => x.type === "warn" && String(x.msg).includes("2 个导入成功") && String(x.msg).includes("1 个失败"))).toBe(true);
    expect(reloaded).toBe(true);
    expect(refreshed).toBe(true);
  });

  it("全成功（failed=0）→ 成功 toast 不含失败字样", async () => {
    importWebFilesMock.mockResolvedValue({ imported: 3, failed: 0 });
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const r = await importWebFilesWithToast([mkFile("a.ysm"), mkFile("b.ysm"), mkFile("c.ysm")]);
    off();
    expect(r).toEqual({ imported: 3, failed: 0 });
    expect(toasts.some((x) => x.type === "success" && !String(x.msg).includes("失败"))).toBe(true);
  });

  it("importWebFiles 灾难性抛错 → 错误 toast + 返回 failed=files.length（上限兜底，非堆内部分计数）", async () => {
    importWebFilesMock.mockRejectedValue(new Error("QUOTA"));
    const toasts: Array<{ msg: unknown; type?: unknown }> = [];
    const off = bus.on("toast:show", (p) => toasts.push(p));
    const files = [mkFile("a.ysm"), mkFile("b.ysm"), mkFile("c.ysm")];
    const r = await importWebFilesWithToast(files);
    off();
    expect(r).toEqual({ imported: 0, failed: files.length });
    expect(toasts.some((x) => x.type === "error" && String(x.msg).includes("QUOTA"))).toBe(true);
  });
});
