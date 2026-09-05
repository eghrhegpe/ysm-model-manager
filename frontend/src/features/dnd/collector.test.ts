// @vitest-environment node
// ===== dnd-collector 单测 =====
// 覆盖 collectFiles 的三种路径：文件条目、目录递归、getAsFile 兜底
import { describe, it, expect, vi } from "vitest";
import { collectFiles } from "./collector.ts";

// 假条目构造器
const fileEntry = (name: string, file: File): FileSystemFileEntry => ({
  isFile: true,
  isDirectory: false,
  name,
  file: (cb: (f: File) => void) => cb(file),
} as unknown as FileSystemFileEntry);

/**
 * 目录条目 mock：readEntries 首次回调返回 children，之后回调空数组——
 * 模拟真实浏览器分页语义（单批读完后第二批为空 → 目录读完）。
 * 若 mock 每次回调都返回非空，循环分页实现会无限读下去直至超时。
 */
const dirEntry = (
  name: string,
  children: FileSystemEntry[],
): FileSystemDirectoryEntry => {
  let read = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (cb: (e: FileSystemEntry[]) => void) => {
        if (!read) {
          read = true;
          cb(children);
        } else {
          cb([]);
        }
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
};

const dndItem = (entry: FileSystemEntry): DataTransferItem => ({
  kind: "file",
  webkitGetAsEntry: () => entry,
} as unknown as DataTransferItem);

describe("collectFiles — 单文件", () => {
  it("webkitGetAsEntry 路径：收集到 File", async () => {
    const f = new File(["data"], "m.ysm");
    const result = await collectFiles([dndItem(fileEntry("m.ysm", f))], false);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(f);
    expect(result[0].relPath).toBe("m.ysm");
  });

  it("getAsFile 兜底：无 webkitGetAsEntry 时取 getAsFile", async () => {
    const f = new File(["data"], "b.ysm");
    const item = { kind: "file", getAsFile: () => f } as unknown as DataTransferItem;
    const result = await collectFiles([item], false);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe(f);
  });

  it("非 file kind 条目 → 跳过", async () => {
    const item = { kind: "string", data: "hi" } as unknown as DataTransferItem;
    const result = await collectFiles([item], false);
    expect(result).toHaveLength(0);
  });
});

describe("collectFiles — 目录递归", () => {
  it("单层目录：子文件保留 relPath", async () => {
    const child = fileEntry("a.ysm", new File(["x"], "a.ysm"));
    const parent = dirEntry("pkg", [child]);
    const result = await collectFiles([dndItem(parent)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("pkg/a.ysm");
  });

  it("嵌套目录：多级 relPath", async () => {
    const leaf = fileEntry("f.ysm", new File(["x"], "f.ysm"));
    const mid = dirEntry("sub", [leaf]);
    const root = dirEntry("pkg", [mid]);
    const result = await collectFiles([dndItem(root)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("pkg/sub/f.ysm");
  });

  it("深度守卫：超过 MAX_DEPTH 层时停止递归，深层文件不收集", async () => {
    // 每层目录含 1 个文件 + 1 个子目录，构造 12 层嵌套
    const makeDeepDir = (n: number): FileSystemDirectoryEntry => {
      let read = false;
      const self: FileSystemDirectoryEntry = {
        isFile: false,
        isDirectory: true,
        name: `d${n}`,
        createReader: () => ({
          readEntries: (cb: (e: FileSystemEntry[]) => void) => {
            if (read) {
              cb([]);
              return;
            }
            read = true;
            if (n < 12) {
              cb([fileEntry(`f${n}.ysm`, new File(["x"], `f${n}.ysm`)), makeDeepDir(n + 1)]);
            } else {
              cb([]);
            }
          },
        }),
      } as unknown as FileSystemDirectoryEntry;
      return self;
    };
    const root = makeDeepDir(0);
    const result = await collectFiles([dndItem(root)], false);
    // MAX_DEPTH=10：目录深度 0..9 的文件被收集（10 个），depth=10 起截断（f10 不应出现）
    expect(result).toHaveLength(10);
    expect(result.map((c) => c.relPath.split("/").pop()).sort()).toEqual(
      ["f0.ysm", "f1.ysm", "f2.ysm", "f3.ysm", "f4.ysm", "f5.ysm", "f6.ysm", "f7.ysm", "f8.ysm", "f9.ysm"],
    );
    expect(result.some((c) => c.relPath.includes("/f10.ysm"))).toBe(false);
  });

  it(">100 条目目录：readEntries 分页循环读完所有批次（漏文件回归）", async () => {
    // 模拟真实浏览器分页：批次1 = 60 条、批次2 = 60 条、批次3 = 空（目录读完）
    // Web 标准 readEntries 单次最多返回 100 条，须循环读到空数组才完整。
    const batches = [
      Array.from({ length: 60 }, (_, i) =>
        fileEntry(`a${i}.ysm`, new File(["x"], "a")),
      ),
      Array.from({ length: 60 }, (_, i) =>
        fileEntry(`b${i}.ysm`, new File(["x"], "b")),
      ),
    ];
    const pagedDir = {
      isFile: false,
      isDirectory: true,
      name: "big",
      createReader: () => {
        let idx = 0;
        return {
          readEntries: (cb: (e: FileSystemEntry[]) => void) => {
            if (idx < batches.length) cb(batches[idx++]);
            else cb([]); // 空批次 = 读完
          },
        };
      },
    } as unknown as FileSystemDirectoryEntry;
    const result = await collectFiles([dndItem(pagedDir)], false);
    // 120 个文件全部收集（修复前只读第一批：漏掉 b* 60 个）
    expect(result).toHaveLength(120);
    expect(result.some((c) => c.relPath === "big/a59.ysm")).toBe(true);
    expect(result.some((c) => c.relPath === "big/b59.ysm")).toBe(true);
  });

  it("isEntryArray=true：直接传 FileSystemEntry[] 顶层递归，未知条目跳过", async () => {
    const f = new File(["x"], "m.ysm");
    const unknown = { isFile: false, isDirectory: false, name: "unk" } as unknown as FileSystemEntry;
    const result = await collectFiles([fileEntry("m.ysm", f), unknown], true);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("m.ysm");
  });
});

describe("collectFiles — 错误处理", () => {
  it("entry.file 抛错 → 该文件跳过，其他文件正常", async () => {
    const ok = fileEntry("ok.ysm", new File(["x"], "ok.ysm"));
    const bad = {
      isFile: true,
      isDirectory: false,
      name: "bad.ysm",
      file: (_cb: (f: File) => void, ecb: (e: unknown) => void) => ecb(new Error("denied")),
    } as unknown as FileSystemFileEntry;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await collectFiles([dndItem(ok), dndItem(bad)], false);
    expect(result).toHaveLength(1);
    expect(result[0].relPath).toBe("ok.ysm");
    warnSpy.mockRestore();
  });

  it("readEntries error 回调 → 整目录跳过", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const badDir = {
      isFile: false,
      isDirectory: true,
      name: "bad",
      createReader: () => ({
        readEntries: (_cb: (e: FileSystemEntry[]) => void, ecb: () => void) => ecb(),
      }),
    } as unknown as FileSystemDirectoryEntry;
    const result = await collectFiles([dndItem(badDir)], false);
    expect(result).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("readEntries 永不回调 → 3s 超时兜底，不卡死", async () => {
    vi.useFakeTimers();
    try {
      const hungDir = {
        isFile: false,
        isDirectory: true,
        name: "hung",
        createReader: () => ({ readEntries: () => {} }),
      } as unknown as FileSystemDirectoryEntry;
      const p = collectFiles([dndItem(hungDir)], false);
      await vi.advanceTimersByTimeAsync(3000); // READ_ENTRIES_TIMEOUT
      expect(await p).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("entry.file 永不回调 → 5s 超时兜底，该文件跳过", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const silent = {
        isFile: true,
        isDirectory: false,
        name: "silent.ysm",
        file: () => {},
      } as unknown as FileSystemFileEntry;
      const p = collectFiles([dndItem(silent)], false);
      await vi.advanceTimersByTimeAsync(5000); // FILE_ENTRY_TIMEOUT
      expect(await p).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
