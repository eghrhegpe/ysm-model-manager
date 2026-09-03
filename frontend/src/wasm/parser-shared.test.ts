// ===== parser-shared 纯函数测试（内存 FS mock，无 WASM 依赖）=====
import { describe, expect, it } from "vitest";
import {
  classifyWasmError,
  ensureDir,
  collectOutputFiles,
  patchGlueHeapExport,
  resolveWasmFactory,
  wipeDir,
  writeHeapBytes,
  type FSLike,
  type WasmModuleLike,
} from "./parser-shared.ts";

/** 内存 FS：最小 Emscripten MEMFS 语义 */
function makeFS(initial: Record<string, string> = {}): FSLike & { dump(): string[] } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);
  for (const [p, content] of Object.entries(initial)) {
    files.set(p, new TextEncoder().encode(content));
    let cur = "";
    for (const seg of p.split("/").slice(0, -1).filter(Boolean)) {
      cur += "/" + seg;
      dirs.add(cur);
    }
  }
  const parent = (p: string): string => p.split("/").slice(0, -1).join("/") || "/";
  return {
    readdir(d) {
      if (!dirs.has(d)) throw new Error("ENOENT " + d);
      const prefix = d === "/" ? "/" : d + "/";
      const out = new Set<string>();
      for (const f of files.keys()) if (f.startsWith(prefix)) out.add(f.slice(prefix.length).split("/")[0]);
      for (const dd of dirs) if (dd.startsWith(prefix) && dd !== d) out.add(dd.slice(prefix.length).split("/")[0]);
      return [...out, ".", ".."];
    },
    stat(p) {
      if (files.has(p)) return { mode: 0o100644 };
      if (dirs.has(p)) return { mode: 0o040755 };
      throw new Error("ENOENT " + p);
    },
    isDir(mode) {
      return (mode & 0o170000) === 0o040000;
    },
    readFile(p) {
      const f = files.get(p);
      if (!f) throw new Error("ENOENT " + p);
      return f;
    },
    writeFile(p, data) {
      files.set(p, data);
    },
    mkdir(p) {
      if (dirs.has(p)) throw new Error("EEXIST " + p);
      if (!dirs.has(parent(p))) throw new Error("ENOENT " + parent(p));
      dirs.add(p);
    },
    rmdir(p) {
      if (!dirs.delete(p)) throw new Error("ENOENT " + p);
    },
    unlink(p) {
      if (!files.delete(p)) throw new Error("ENOENT " + p);
    },
    dump() {
      return [...files.keys()].sort();
    },
  };
}

describe("classifyWasmError", () => {
  it("ExitStatus 带 number status → kind=exit 且带 exitCode", () => {
    expect(classifyWasmError({ name: "ExitStatus", status: 2 })).toEqual({
      kind: "exit",
      exitCode: 2,
    });
  });

  it("ExitStatus 无 status → kind=exit 且 exitCode undefined", () => {
    expect(classifyWasmError({ name: "ExitStatus" })).toEqual({ kind: "exit" });
  });

  it("判定材料：裸字符串全文；Error 对象取 name+message（真实崩溃关键词在 message）", () => {
    // Emscripten OOM 走裸字符串 throw → err 本身被 stringify → 命中
    for (const msg of ["abort(OOM)", "out of memory", "Aborted(). Build with -s ASSERTIONS"]) {
      expect(classifyWasmError(msg).kind).toBe("fatal");
    }
    expect(classifyWasmError(new Error("some io error")).kind).toBe("unknown");
    expect(classifyWasmError("plain string")).toEqual({ kind: "unknown" });
  });

  it("真实硬崩溃形态（ysm-glue-data.js 实际 abort/trap 实现）→ fatal 触发重置链", () => {
    // Emscripten abort()：throw new WebAssembly.RuntimeError(`Aborted(${what}). Build with -sASSERTIONS...`)
    // —— OOM/C++ 异常/mmapAlloc 全走此路径：name="RuntimeError"，关键词只在 message
    expect(
      classifyWasmError(
        new WebAssembly.RuntimeError("Aborted(out of memory). Build with -sASSERTIONS for more info."),
      ).kind,
    ).toBe("fatal");
    // 原生 WASM trap（引擎直接抛，无 abort 包装）
    for (const msg of [
      "memory access out of bounds",
      "unreachable executed",
      "null function or function signature mismatch",
    ]) {
      expect(classifyWasmError(new WebAssembly.RuntimeError(msg)).kind).toBe("fatal");
    }
    // 跨 Worker 结构化克隆丢原型（instanceof 失效）→ name+message 关键词兜底
    expect(
      classifyWasmError({ name: "RuntimeError", message: "memory access out of bounds" }).kind,
    ).toBe("fatal");
  });

  it("其他错误 → unknown", () => {
    expect(classifyWasmError(new Error("some io error"))).toEqual({ kind: "unknown" });
    expect(classifyWasmError("plain string")).toEqual({ kind: "unknown" });
  });
});

describe("wipeDir / ensureDir / collectOutputFiles", () => {
  it("ensureDir 多级创建且幂等", () => {
    const fs = makeFS();
    ensureDir(fs, "/output/a/b");
    expect(fs.stat("/output/a/b").mode).toBeTruthy();
    expect(() => ensureDir(fs, "/output/a/b")).not.toThrow();
  });

  it("wipeDir 清空目录树但保留目录本身；对不存在目录静默", () => {
    const fs = makeFS({ "/output/keep.json": "{}" });
    ensureDir(fs, "/output/sub");
    fs.writeFile("/output/sub/deep.bin", new Uint8Array([1]));
    wipeDir(fs, "/output");
    expect(fs.dump()).toEqual([]);
    // 目录本身仍在
    expect(fs.stat("/output").mode).toBeTruthy();
    // 不存在目录不抛
    expect(() => wipeDir(fs, "/nope")).not.toThrow();
  });

  it("collectOutputFiles 递归收集并返回相对路径", () => {
    const fs = makeFS({
      "/output/model.ysm": "A",
      "/output/assets/tex.png": "B",
    });
    const files = collectOutputFiles(fs, "/output");
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["assets/tex.png", "model.ysm"]);
    expect(new TextDecoder().decode(files.find((f) => f.path === "model.ysm")!.data)).toBe("A");
  });
});

describe("writeHeapBytes", () => {
  it("malloc 成功 → 写入最新 heap 并返回指针", () => {
    const heap = new Uint8Array(16);
    const ptr = writeHeapBytes(
      new Uint8Array([1, 2, 3]),
      () => 4,
      () => heap,
    );
    expect(ptr).toBe(4);
    expect([...heap.slice(4, 7)]).toEqual([1, 2, 3]);
  });

  it("malloc 返回 0 → 抛错且带长度", () => {
    expect(() =>
      writeHeapBytes(
        new Uint8Array(5),
        () => 0,
        () => new Uint8Array(8),
      ),
    ).toThrow(/malloc 失败 \(5 bytes\)/);
  });

  it("_malloc 触发扩容后 getHeap 必须返回新 buffer（detached 防护）", () => {
    // 模拟：malloc 触发 growMemory 后旧 heap 分离，getHeap 返回扩容后的新 heap
    const oldHeap = new Uint8Array(8);
    const newHeap = new Uint8Array(32);
    let grew = false;
    const ptr = writeHeapBytes(
      new Uint8Array([9, 9]),
      () => {
        grew = true;
        return 16;
      },
      () => (grew ? newHeap : oldHeap),
    );
    expect(ptr).toBe(16);
    // 写入发生在新 heap（若实现缓存了旧 heap 会写到 detached buffer 上）
    expect([...newHeap.slice(16, 18)]).toEqual([9, 9]);
  });
});

describe("patchGlueHeapExport（主线程 / Worker 共用胶水 patch）", () => {
  it("在 updateMemoryViews 调用后注入 HEAPU8 导出，且只命中调用点", () => {
    const glue = `function updateMemoryViews(){...}\nfoo();updateMemoryViews();bar();updateMemoryViews();`;
    const out = patchGlueHeapExport(glue);
    expect(out).toContain(
      ';updateMemoryViews();Module["HEAPU8"]=HEAPU8',
    );
    expect(out.match(/Module\["HEAPU8"\]/g)).toHaveLength(2);
    // 函数定义（;updateMemoryViews(){...}）不被误改
    expect(out).toContain("function updateMemoryViews(){...}");
  });

  it("无调用点 → 原样返回", () => {
    expect(patchGlueHeapExport("var x=1;")).toBe("var x=1;");
  });
});

describe("resolveWasmFactory（工厂解析 + ccall 校验）", () => {
  const fakeModule: WasmModuleLike = {
    _malloc: (n) => n,
    _free: () => {},
    ccall: () => 1,
    FS: {} as unknown as FSLike,
  };

  it("同步工厂返回合法模块 → 直接解析", async () => {
    await expect(resolveWasmFactory(() => fakeModule, {})).resolves.toBe(fakeModule);
  });

  it("Promise 工厂 → await 后解析", async () => {
    await expect(resolveWasmFactory(async () => fakeModule, {})).resolves.toBe(fakeModule);
  });

  it("工厂返回异常值（缺 ccall）→ 抛错", async () => {
    await expect(resolveWasmFactory(() => ({} as unknown as WasmModuleLike), {})).rejects.toThrow(
      "YSMParserModule 工厂返回异常值",
    );
  });
});
