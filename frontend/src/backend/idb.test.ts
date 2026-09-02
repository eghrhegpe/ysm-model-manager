// @vitest-environment node
// ===== idb.ts 故障路径测试（子代理审计 P2：idb 零测试，被 browser-adapter 整体 mock 掉）=====
// 覆盖：open 失败降级 / onblocked / 内存驱逐双上限 / versionchange 重开 / __resetDBForTest
// 实现：vi.stubGlobal 注入受控 fake indexedDB（open 可触发 onsuccess/onerror/onblocked），
// 不依赖 fake-indexeddb 库（零依赖原则）。
// 2026-08-17：本文件测「真实 idb.ts 实现」——test-setup 全局 mock 了 idb.ts（isolate:false
// 穿透修复，供 browser-adapter 系共享），此处显式 unmock 恢复真实实现（否则 22 用例全被 mock 吞）。
vi.unmock("./idb.ts");
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDBForTest, idbDel, idbGet, idbGetAll, idbKeys, idbSet, idbTx, openDB } from "./idb.ts";

// MEMORY_MAX_KEYS=200 / MEMORY_MAX_BYTES=64MB（与 idb.ts 常量保持一致——此处验证驱逐行为）
const MEMORY_MAX_KEYS = 200;

/** 给 fakeDB 注入 onversionchange / open 请求，并 stub 全局 indexedDB */
function installIndexedDBStub(
  fakeDB: {
    close: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
    objectStoreNames: { contains: () => boolean };
    createObjectStore: ReturnType<typeof vi.fn>;
  },
  opts: { failOpen?: boolean; blocked?: boolean } = {},
): {
  openCount: number;
  triggerVersionChange: () => void;
} {
  let openCount = 0;
  let vcHandler: (() => void) | null = null;

  // onversionchange 用 defineProperty 注入——idb.ts 赋值 handler，triggerVersionChange 调用
  Object.defineProperty(fakeDB, "onversionchange", {
    configurable: true,
    get: () => vcHandler,
    set: (fn: (() => void) | null) => {
      vcHandler = fn;
    },
  });
  const open = vi.fn(() => {
    openCount++;
    const req = {
      result: fakeDB,
      error: new Error("indexedDB open failed"),
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onblocked: null as (() => void) | null,
      onupgradeneeded: null as (() => void) | null,
    };
    if (opts.failOpen) {
      setTimeout(() => req.onerror?.(), 0);
    } else if (opts.blocked) {
      setTimeout(() => req.onblocked?.(), 0);
    } else {
      setTimeout(() => req.onsuccess?.(), 0);
    }
    return req;
  });
  vi.stubGlobal("indexedDB", { open });
  return {
    get openCount() {
      return openCount;
    },
    triggerVersionChange: () => vcHandler?.(),
  };
}

/** 构造可控 fake indexedDB：open 可触发 onsuccess / onerror / onblocked */
function makeFakeIDB(opts: { failOpen?: boolean; blocked?: boolean } = {}): {
  openCount: number;
  triggerVersionChange: () => void;
} {
  const fakeDB = {
    close: vi.fn(),
    transaction: vi.fn(),
    objectStoreNames: { contains: () => false },
    createObjectStore: vi.fn(),
  };
  return installIndexedDBStub(fakeDB, opts);
}

describe("idb 故障路径", () => {
  beforeEach(() => {
    __resetDBForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetDBForTest();
  });

  it("open 失败（隐私模式）→ 降级内存模式，读写仍可用", async () => {
    makeFakeIDB({ failOpen: true });
    await idbSet("files", "dir:ysm/a", { name: "a", addedAt: 1 });
    const v = await idbGet<{ name: string }>("files", "dir:ysm/a");
    expect(v?.name).toBe("a");
  });

  it("onblocked（多标签页持旧连接）→ reject → 降级内存模式", async () => {
    makeFakeIDB({ blocked: true });
    await idbSet("files", "file:ysm/a/b", { data: new ArrayBuffer(4), size: 4, mime: "" });
    const keys = await idbKeys("files", "file:ysm/");
    expect(keys).toContain("file:ysm/a/b");
  });

  it("内存模式驱逐：超 200 条 FIFO 淘汰最旧", async () => {
    // 无 indexedDB（未 stub）→ backendIsIdb false → 纯内存模式
    for (let i = 0; i < MEMORY_MAX_KEYS + 10; i++) {
      await idbSet("files", `k${i}`, { n: i });
    }
    const keys = await idbKeys("files", "");
    expect(keys.length).toBe(MEMORY_MAX_KEYS);
    // 最旧 10 条被驱逐（k0..k9），最新 10 条保留（k200..k209）
    expect(keys).not.toContain("k0");
    expect(keys).toContain("k209");
  });

  it("versionchange 关闭后重开（P2 修复）：dbPromise 置空后 openDB 重新连接", async () => {
    const fake = makeFakeIDB();
    const db1 = await openDB();
    expect(db1).toBeTruthy();
    const firstCount = fake.openCount;
    // 模拟其他标签页请求升级 → versionchange → 关闭连接
    fake.triggerVersionChange();
    // 再次 openDB 应重新调 indexedDB.open（openCount 增加），而非复用已关闭连接
    const db2 = await openDB();
    expect(db2).toBeTruthy();
    expect(fake.openCount).toBeGreaterThan(firstCount);
    // 重开后返回的是新连接对象（同一 fakeDB 实例，此处验证不再走已关闭路径）
    expect(db2).toBe(db1);
  });
});

// ===== IDB 事务路径测试（此前 open 生命周期有测，transaction 读写路径零覆盖）=====
// fake DB 实现最小 IDB 事务语义：get/put/delete 基于内存 Map，openCursor 升序遍历；
// 可注入 writeError 模拟 put 失败 → 事务 abort → idbSet reject（对齐真实 QuotaExceeded）
function makeFakeIDBWithTx(opts: { writeError?: Error } = {}): {
  store: Map<string, unknown>;
  openCount: number;
  triggerVersionChange: () => void;
} {
  const store = new Map<string, unknown>();
  let writeFailed = false;

  /** 构造一个可异步触发 onsuccess/onerror 的 IDBRequest */
  const reqOf = (result: unknown, error?: Error) => {
    const req = {
      result,
      error,
      onsuccess: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    if (error) setTimeout(() => req.onerror?.(), 0);
    else setTimeout(() => req.onsuccess?.(), 0);
    return req;
  };

  const fakeDB = {
    close: vi.fn(),
    objectStoreNames: { contains: () => false },
    createObjectStore: vi.fn(),
    transaction: vi.fn((_storeName: string, _mode: string) => {
      let txError: Error | null = null;
      const os = {
        get: (key: string) => reqOf(store.has(key) ? store.get(key) : undefined),
        put: (value: unknown, key: string) => {
          if (opts.writeError && !writeFailed) {
            writeFailed = true;
            txError = opts.writeError;
            return reqOf(undefined, opts.writeError);
          }
          store.set(key, value);
          return reqOf(undefined);
        },
        delete: (key: string) => {
          store.delete(key);
          return reqOf(undefined);
        },
        openCursor: () => {
          const keys = [...store.keys()].sort();
          let i = 0;
          const req = {
            result: null as unknown,
            onsuccess: null as (() => void) | null,
            onerror: null as (() => void) | null,
          };
          const next = () => {
            if (i < keys.length) {
              req.result = { key: keys[i], value: store.get(keys[i]), continue: () => setTimeout(next, 0) };
              i++;
            } else {
              req.result = null;
            }
            req.onsuccess?.();
          };
          setTimeout(next, 0);
          return req;
        },
      };
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        objectStore: () => os,
        // codereview P2：真实 IDB 事务契约暴露 tx.error（DOMException/Error），
        // idb.ts 的 idbSet/idbDel 拒拒路径读 tx.error（reject(tx.error)）。
        // fake 缺此字段 → QuotaExceeded 测试 reject(undefined) 无法匹配文案。
        error: null as Error | null,
      };
      // 真实 IDB：请求失败 → 事务 abort；全部成功 → complete
      setTimeout(() => {
        if (txError) {
          tx.error = txError; // 同步暴露拒绝原因，供 idbSet/idbDel 的 reject(tx.error) 穿透
          tx.onerror?.();
          tx.onabort?.();
        } else {
          tx.oncomplete?.();
        }
      }, 0);
      return tx;
    }),
  };
  const fake = installIndexedDBStub(fakeDB);
  return {
    store,
    get openCount() {
      return fake.openCount;
    },
    triggerVersionChange: fake.triggerVersionChange,
  };
}

describe("idb IDB 事务路径", () => {
  beforeEach(() => {
    __resetDBForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetDBForTest();
  });

  it("idbSet → idbGet 经真实 transaction 读写（非内存降级）", async () => {
    const fake = makeFakeIDBWithTx();
    await idbSet("files", "dir:a", { name: "a", addedAt: 1 });
    // 写入走了 IDB 分支（数据在 fake 的 store 而非内存 memoryStore）
    expect(fake.store.has("dir:a")).toBe(true);
    expect((await idbGet<{ name: string }>("files", "dir:a"))?.name).toBe("a");
  });

  it("idbGet 缺 key → undefined（不抛错）", async () => {
    makeFakeIDBWithTx();
    expect(await idbGet("files", "missing")).toBeUndefined();
  });

  it("idbDel 经 transaction 删除后读回 undefined", async () => {
    const fake = makeFakeIDBWithTx();
    await idbSet("files", "file:x", { data: new ArrayBuffer(4) });
    await idbDel("files", "file:x");
    expect(fake.store.has("file:x")).toBe(false);
    expect(await idbGet("files", "file:x")).toBeUndefined();
  });

  it("idbKeys 经 openCursor 升序前缀扫描", async () => {
    makeFakeIDBWithTx();
    await idbSet("files", "dir:b:", { name: "b" });
    await idbSet("files", "dir:a:", { name: "a" });
    await idbSet("files", "cfg:x", {});
    const keys = await idbKeys("files", "dir:");
    expect(keys).toEqual(["dir:a:", "dir:b:"]); // cursor 升序 + 前缀过滤
  });

  it("IDBKeyRange 存在时走区间 cursor（O(命中) 性能分支）且过滤结果仍正确", async () => {
    // 真实浏览器有全局 IDBKeyRange；node 默认无 → 此用例 stub 后触发区间分支，
    // 证明 openCursor 确实收到 [prefix, prefix+\uffff] 区间，且 startsWith 兜底不破坏结果
    const store = new Map<string, unknown>();
    let capturedRange: unknown = "NOT-CALLED";
    const reqOf = (result: unknown) => {
      const req = { result, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    };
    const os = {
      put: (v: unknown, k: string) => {
        store.set(k, v);
        return reqOf(undefined);
      },
      openCursor: (range?: unknown) => {
        capturedRange = range ?? null;
        const keys = [...store.keys()].sort();
        let i = 0;
        const req = { result: null as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
        const next = () => {
          req.result = i < keys.length ? { key: keys[i], value: store.get(keys[i]), continue: () => setTimeout(next, 0) } : null;
          i++;
          req.onsuccess?.();
        };
        setTimeout(next, 0);
        return req;
      },
    };
    const t = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null, error: null as Error | null, objectStore: () => os };
    const fakeDB = {
      close: vi.fn(),
      objectStoreNames: { contains: () => false },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => {
        setTimeout(() => t.oncomplete?.(), 0);
        return t;
      }),
    };
    installIndexedDBStub(fakeDB);
    vi.stubGlobal("IDBKeyRange", { bound: (lo: string, hi: string) => ({ lo, hi }) });
    try {
      await idbSet("files", "dir:b:", { name: "b" });
      await idbSet("files", "dir:a:", { name: "a" });
      await idbSet("files", "cfg:x", {});
      const keys = await idbKeys("files", "dir:");
      expect(keys).toEqual(["dir:a:", "dir:b:"]); // 区间分支 + startsWith 兜底
      expect(capturedRange).not.toBe("NOT-CALLED");
      expect(capturedRange).not.toBeNull(); // openCursor 确实收到区间
      expect(capturedRange).toMatchObject({ lo: "dir:", hi: "dir:\uffff" }); // 区间上界为 prefix+\uffff
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("put 失败（QuotaExceeded）→ 事务 abort → idbSet reject（不静默吞错）", async () => {
    makeFakeIDBWithTx({ writeError: new Error("QuotaExceededError") });
    await expect(idbSet("files", "dir:big", { data: new ArrayBuffer(8) })).rejects.toThrow("QuotaExceededError");
  });

  it("idbGetAll：前缀批量取值（key+value 成对、key 升序）", async () => {
    makeFakeIDBWithTx();
    await idbSet("files", "file:ysm/a/main.ysm", { size: 1 });
    await idbSet("files", "file:ysm/a/tex/p.png", { size: 2 });
    await idbSet("files", "file:ysm/b/other.ysm", { size: 3 });
    await idbSet("files", "cfg:x", { n: 9 });
    const rows = await idbGetAll("files", "file:ysm/");
    // key 升序：a/main.ysm < a/tex/p.png < b/other.ysm
    expect(rows.map(([k]) => k)).toEqual([
      "file:ysm/a/main.ysm",
      "file:ysm/a/tex/p.png",
      "file:ysm/b/other.ysm",
    ]);
    expect(rows.map(([, v]) => (v as { size: number }).size)).toEqual([1, 2, 3]);
  });

  it("idbGetAll：前缀不命中 → 空数组（不抛错）", async () => {
    makeFakeIDBWithTx();
    await idbSet("files", "file:ysm/a/main.ysm", { size: 1 });
    expect(await idbGetAll("files", "file:vrm/")).toEqual([]);
  });

  it("idbGetAll：内存降级路径（无 indexedDB）同语义", async () => {
    // 未 stub indexedDB → 纯内存模式
    await idbSet("files", "file:ysm/a/main.ysm", { size: 5 });
    await idbSet("files", "file:ysm/b/x.ysm", { size: 6 });
    await idbSet("files", "cfg:y", { n: 1 });
    const rows = await idbGetAll("files", "file:ysm/");
    expect(rows.map(([k]) => k)).toEqual(["file:ysm/a/main.ysm", "file:ysm/b/x.ysm"]);
    expect(rows.map(([, v]) => (v as { size: number }).size)).toEqual([5, 6]);
  });

  it("idbTx：批量 put+del 单事务提交，全部落库（全有）", async () => {
    const fake = makeFakeIDBWithTx();
    await idbSet("files", "dir:old:", { name: "old" });
    await idbTx("files", [
      { kind: "put", key: "dir:new:", value: { name: "new" } },
      { kind: "put", key: "file:new/a.ysm", value: { size: 1 } },
      { kind: "del", key: "dir:old:" },
    ]);
    expect(fake.store.has("dir:new:")).toBe(true);
    expect(fake.store.has("file:new/a.ysm")).toBe(true);
    expect(fake.store.has("dir:old:")).toBe(false);
  });

  it("idbTx：任一 put 失败 → 事务 abort → 整批 reject（不静默吞错）", async () => {
    // 第二个 put 触发 writeError → tx.onerror/onabort → idbTx reject。
    // 真实 IDB 事务 abort 会回滚整个事务（全有或全无由 IDB 语义保证）；
    // fake 仅锁「reject 不吞错」行为（fake 不模拟 abort 回滚，故不断言 store 残留）。
    const fake = makeFakeIDBWithTx({ writeError: new Error("QuotaExceededError") });
    await expect(
      idbTx("files", [
        { kind: "put", key: "dir:new:", value: { name: "new" } },
        { kind: "put", key: "file:new/a.ysm", value: { size: 1 } },
      ]),
    ).rejects.toThrow("QuotaExceededError");
  });

  it("idbTx：内存降级路径（无 indexedDB）批量写删同语义", async () => {
    // 未 stub indexedDB → 纯内存模式（同步执行天然原子）
    await idbSet("files", "dir:old:", { name: "old" });
    await idbTx("files", [
      { kind: "put", key: "dir:new:", value: { name: "new" } },
      { kind: "del", key: "dir:old:" },
    ]);
    const keys = await idbKeys("files", "dir:");
    expect(keys).toEqual(["dir:new:"]);
    expect(await idbGet("files", "dir:old:")).toBeUndefined();
  });
});

// ===== 内存降级模式补充（字节上限驱逐 / idbDel）=====
describe("idb 内存降级补充", () => {
  beforeEach(() => {
    __resetDBForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetDBForTest();
  });

  it("字节上限驱逐：totalBytes 超 64MB 时按 FIFO 淘汰最旧（保留单条超大值不驱逐）", async () => {
    // 无 indexedDB（未 stub）→ 纯内存模式
    await idbSet("files", "big1", { data: new ArrayBuffer(50 * 1024 * 1024) });
    // 第二条 20MB 使总估算 70MB > 64MB → 驱逐最旧 big1，保留 big2（m.size 回到 1）
    await idbSet("files", "big2", { data: new ArrayBuffer(20 * 1024 * 1024) });
    const keys = await idbKeys("files", "");
    expect(keys).toEqual(["big2"]);
    expect(keys).not.toContain("big1");
  });

  it("idbDel 内存模式：删除后 key 消失、其余保留", async () => {
    await idbSet("files", "k1", { n: 1 });
    await idbSet("files", "k2", { n: 2 });
    await idbDel("files", "k1");
    const keys = await idbKeys("files", "");
    expect(keys).toEqual(["k2"]);
    expect(await idbGet("files", "k1")).toBeUndefined();
  });
});


