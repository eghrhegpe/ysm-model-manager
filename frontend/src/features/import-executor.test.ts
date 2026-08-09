// ===== 全局导入执行器测试（import-executor.ts）=====
// 覆盖：单文件直导、文件夹整组、执行入口分组、历史广播、去重、ysm.json 引导
import { describe, it, expect, vi, beforeEach } from "vitest";
import { bus } from "../bus.ts";
import { executeCollected, ImportHistory } from "./import-executor.ts";

const mocks = vi.hoisted(() => ({
  ImportModelFile: vi.fn().mockResolvedValue(undefined),
  ImportModelFolder: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../wails/app.ts", () => ({
  getApp: vi.fn().mockResolvedValue({
    ImportModelFile: mocks.ImportModelFile,
    ImportModelFolder: mocks.ImportModelFolder,
  }),
}));

// happy-dom 已原生支持 FileReader（历史 jsdom 缺失，mock 保留以防环境切换）
class MockFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(_file: File): void {
    this.result = "data:application/octet-stream;base64,QUJD";
    this.onload?.();
  }
}
vi.stubGlobal("FileReader", MockFileReader);

const mkFile = (name: string): File => new File(["x"], name);

describe("ImportHistory — 全局历史", () => {
  beforeEach(() => {
    ImportHistory.clear();
    mocks.ImportModelFile.mockClear();
    mocks.ImportModelFolder.mockClear();
  });

  it("push 后 records 首条为最新", () => {
    ImportHistory.push({ name: "a.ysm", time: "t1" });
    ImportHistory.push({ name: "b.ysm", time: "t2" });
    expect(ImportHistory.records[0].name).toBe("b.ysm");
    expect(ImportHistory.records.length).toBe(2);
  });

  it("clear 清空并广播", () => {
    let got = -1;
    const off = bus.on("import:history-changed", ({ records }) => {
      got = records.length;
    });
    ImportHistory.push({ name: "a.ysm", time: "t" });
    ImportHistory.clear();
    expect(got).toBe(0);
    off();
  });

  it("rename 更新条目并广播", () => {
    ImportHistory.push({ name: "old.ysm", time: "t", isYsm: true });
    let renamed = "";
    const off = bus.on("import:history-changed", ({ records }) => {
      renamed = records[0]?.name || "";
    });
    ImportHistory.rename("old.ysm", "new.ysm");
    expect(renamed).toBe("new.ysm");
    off();
  });
});

describe("executeCollected — 静默导入入口", () => {
  beforeEach(() => {
    ImportHistory.clear();
    mocks.ImportModelFile.mockClear();
    mocks.ImportModelFolder.mockClear();
  });

  it("散落 ysm 单文件 → 直导", async () => {
    const r = await executeCollected([{ file: mkFile("模型.ysm"), relPath: "模型.ysm" }]);
    expect(r.singles).toBe(1);
    expect(r.folders).toBe(0);
    expect(mocks.ImportModelFile).toHaveBeenCalledWith("模型.ysm", "QUJD");
    expect(ImportHistory.records.length).toBe(1);
    // P2 修复（审核发现）：isYsm 不得硬编码 false——.ysm 单文件须为 true，
    // 否则已导入列表缺「✂️ 重命名」按钮（与表单路径行为不一致）
    expect(ImportHistory.records[0].isYsm).toBe(true);
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
    // 文件夹条目 isYsm 保持 false（重命名按钮按单文件展示）
    expect(ImportHistory.records[0].isYsm).toBe(false);
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
