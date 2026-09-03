// ===== parser-shared 纯函数测试（内存 FS mock，无 WASM 依赖）=====
import { describe, expect, it } from "vitest";
import {
  classifyWasmError,
  collectOutputFiles,
  createLazyModule,
  ensureDir,
  installYsmModule,
  patchGlueHeapExport,
  resolveWasmFactory,
  wipeDir,
  writeHeapBytes,
  type FSLike,
  type WasmModuleLike,
  type YsmModuleConfig,
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

  it("无调用点 → 抛错（patch 未命中不得静默空转，fail-fast 前移到 install 时刻）", () => {
    expect(() => patchGlueHeapExport("var x=1;")).toThrow(/未命中 updateMemoryViews/);
  });

  it("调用点写法随胶水版本变更（如调用处无前导分号 / 调用改名）→ 抛错而非空转", () => {
    // Emscripten 可能把调用写成缩进调用 `  updateMemoryViews();`（前导空白非分号）
    expect(() => patchGlueHeapExport("function u(){}\n  updateMemoryViews();\n")).toThrow(
      /未命中 updateMemoryViews/,
    );
    expect(() => patchGlueHeapExport("function u(){}\n;refreshMemoryViews();\n")).toThrow(
      /未命中 updateMemoryViews/,
    );
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

describe("createLazyModule（懒加载单例状态机：主线程 / Worker 共用）", () => {
  const defer = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    return { promise, resolve };
  };

  it("首次 ensureInit 调 init 缓存实例；成功后 get/isInited 反映", async () => {
    const mod = createLazyModule<string>();
    const initCalls = [] as string[];
    const ok = await mod.ensureInit(async () => {
      initCalls.push("x");
      return "inst";
    });
    expect(ok).toBe(true);
    expect(mod.get()).toBe("inst");
    expect(mod.isInited()).toBe(true);
    expect(initCalls).toHaveLength(1);
  });

  it("已装载后再 ensureInit → 立即 true，不再调 init", async () => {
    const mod = createLazyModule<string>();
    const init = () => Promise.resolve("inst");
    await mod.ensureInit(init);
    const calls = { n: 0 };
    await expect(
      mod.ensureInit(async () => (calls.n++, "other")),
    ).resolves.toBe(true);
    expect(calls.n).toBe(0); // 未触发新 init
    expect(mod.get()).toBe("inst"); // 仍为首次实例
  });

  it("并发 ensureInit 共享一次 init（await 中的第二个 caller 并入等待队列）", async () => {
    const mod = createLazyModule<string>();
    const d = defer();
    let initCount = 0;
    const init = () => {
      initCount++;
      return d.promise.then(() => "inst");
    };
    const p1 = mod.ensureInit(init);
    const p2 = mod.ensureInit(init); // loading 中 → 并入 waiters
    d.resolve();
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true); // waiters 成功分路
    expect(initCount).toBe(1); // 全程仅一次 init（并发去重）
    expect(mod.get()).toBe("inst");
  });

  it("init 失败 → 触发者抛错、并发等待者 resolve(false)、未装载可重试", async () => {
    const mod = createLazyModule<string>();
    const d = defer();
    const failInit = () => d.promise.then(() => {
      throw new Error("boom");
    });
    // 首个调用者触发 init，第二个调用者在 loading 中并入 waiters
    const pTrigger = mod.ensureInit(failInit);
    const pWaiter = mod.ensureInit(failInit);
    d.resolve();
    await expect(pTrigger).rejects.toThrow("boom"); // 触发者收到异常
    await expect(pWaiter).resolves.toBe(false); // 等待者分路为 false 而非抛错/挂起
    expect(mod.isInited()).toBe(false);
    // 失败后 loading 已复位 → 直接重试成功
    await expect(mod.ensureInit(async () => "inst")).resolves.toBe(true);
    expect(mod.get()).toBe("inst");
  });

  it("reset 清空实例与装载态，next ensureInit 重新 init", async () => {
    const mod = createLazyModule<string>();
    let n = 0;
    await mod.ensureInit(async () => (n++, "first"));
    expect(mod.get()).toBe("first");
    mod.reset();
    expect(mod.isInited()).toBe(false);
    await expect(mod.ensureInit(async () => (n++, "second"))).resolves.toBe(true);
    expect(mod.get()).toBe("second");
    expect(n).toBe(2);
  });
});

describe("installYsmModule（注入点 + 间接 eval + MODULARIZE 工厂组装）", () => {
  const moduleCfg: YsmModuleConfig = {
    wasmBinary: new ArrayBuffer(1),
    print: () => {},
    printErr: () => {},
    noInitialRun: true,
  };

  it("patch 胶水 → host.Module 注入 → eval → 读 factory → resolveWasmFactory", async () => {
    const host: Record<string, unknown> = {};
    const fakeFactory = (m: unknown) => {
      // 胶水会把 moduleArg 存起来，工厂返回合法模块
      const module: WasmModuleLike = {
        _malloc: (n) => n,
        _free: () => {},
        ccall: () => 1,
        FS: {} as unknown as FSLike,
      };
      void m;
      return module;
    };
    // 模仿 auto-generated 胶水：indirect eval 后把工厂挂到 host
    //（真实胶水在 eval 时 `var YSMParserModule = ...` → 全局作用域）
    // 含真实调用点形态（base64 解码实证 `...;updateMemoryViews();Module["HEAPU8"]=...`），
    // Module 为胶水内部 var（真实 glue：`var Module=moduleArg`），patch 注入点因此可解析
    const glue = "var Module = {}; var HEAPU8 = new Uint8Array(0);\nfunction updateMemoryViews(){}\n;updateMemoryViews();";
    // 手动模拟 installYsmModule 依赖的全局工厂（patchGlueHeapExport 不改变这一行为）
    host.YSMParserModule = fakeFactory;
    const result = await installYsmModule(host, glue, moduleCfg);
    expect(result.ccall).toBeTypeOf("function");
    expect(host.Module).toBe(moduleCfg); // 注入点落位
  });

  it("factory 缺失（eval 后 host.YSMParserModule 未定义）→ 抛错", async () => {
    await expect(
      installYsmModule(
        {} as Record<string, unknown>,
        "var Module = {}; var HEAPU8 = new Uint8Array(0);\nfunction updateMemoryViews(){}\n;updateMemoryViews();",
        moduleCfg,
      ),
    ).rejects.toThrow("YSMParserModule 未定义");
  });
});
