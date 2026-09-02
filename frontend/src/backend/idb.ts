// ===== 浏览器侧 IndexedDB 轻量封装（ADR-049 Phase 2，参考 MikuMikuAR ADR-176）=====
// 网页版模型库/配置持久化。key 规约（对齐 MikuMikuAR ADR-177）：
//   dir:<type>/<modelName>:  目录标记（值 {name, addedAt}）
//   file:<type>/<modelName>/<relPath>  文件内容（值 {data: ArrayBuffer, size, mime}）
//   cfg:<key>  配置（值 JSON 可序列化对象）
// IndexedDB 不可用时（非浏览器/隐私模式/禁 Cookie/open 失败）自动降级内存 Map：
// 数据不持久，但应用不崩（网页版查看器可临时用；配置另走 localStorage 兜底）。
// open() 失败（如 Firefox 隐私模式：indexedDB 存在但 open 抛 QuotaExceeded/ SecurityError）
// 会令 dbPromise 持有 rejected promise 而令所有后续 await 永久失败——此处捕获后置
// forcedMemory，后续调用改走内存分支，避免「一次失败永久毒化」。
// 零依赖：不使用 fake-indexeddb，测试经 vi.mock 注入内存实现。

import { swallowError } from "../utils/core/async.ts";

const DB_NAME = "ysm-model-manager-web";
const DB_VERSION = 1;

const STORES = ["files", "config"] as const;
export type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("[idb] IndexedDB 不可用（非浏览器环境）"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 其他标签页请求更高版本时主动让位：旧连接不关闭会永远阻塞对方 upgrade
      // （onblocked），此处先关后留新连接接管，防多标签页互锁
      db.onversionchange = () => {
        db.close();
        // P2 修复（子代理审计）：关闭后必须置空单例——否则 dbPromise 仍持有已关闭
        // 连接，后续 openDB() 返回同一 cached promise，所有 transaction 抛
        // InvalidStateError 且不触发内存降级（db 对象仍 truthy），模型库永久失效
        // 直到刷新。置空后下一个 getIdb 重新 openDB() 拿到新连接
        if (dbPromise) dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    // P3 修复：其他标签页持有旧版本连接时会触发 onblocked（Promise 永不 settle，
    // 不 reject 不 resolve → 后续所有 idb 操作永久挂起且不触发内存降级）。
    // 明确 reject，让 getIdb 捕获后置 forcedMemory 走内存分支。
    req.onblocked = () => {
      reject(new Error("[idb] open 被阻塞（其他标签页持有旧连接），已降级内存模式"));
    };
  });
  // open() 失败（隐私模式等）时清空单例，让 getIdb 捕获后降级内存，
  // 否则 rejected promise 会令后续全部 await 直接失败（真实风险）
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// --- 内存降级后端（IndexedDB 不可用 / open 失败 / 非浏览器）---
const memoryStore = new Map<string, Map<string, unknown>>();
let forcedMemory = false;
const backendIsIdb = (): boolean => !forcedMemory && typeof indexedDB !== "undefined";

// P2 修复（审核）：内存降级模式无上限——网页版隐私模式下文件内容（模型可达数十 MB~GB）
// 全部驻留内存会 OOM。加条目数与字节估算双上限，超限按 FIFO 驱逐（近似 LRU：先入先出）。
const MEMORY_MAX_KEYS = 200;
const MEMORY_MAX_BYTES = 64 << 20; // 64MB 粗粒度字节估算上限

/** 估算条目内存占用（data 为 ArrayBuffer 时按字节，其余按 JSON 序列化长度） */
function estimateBytes(value: unknown): number {
  if (value && typeof value === "object" && "data" in value) {
    const d = (value as { data: unknown }).data;
    if (d instanceof ArrayBuffer) return d.byteLength;
    if (ArrayBuffer.isView(d)) return (d as ArrayBufferView).byteLength;
  }
  try {
    return JSON.stringify(value)?.length ?? 64;
  } catch {
    return 64;
  }
}

/** 内存降级写入：超限时按插入顺序驱逐最旧条目（Map 迭代序 = 插入序） */
function memorySet(store: Store, key: string, value: unknown): void {
  let m = memoryStore.get(store);
  if (!m) {
    m = new Map();
    memoryStore.set(store, m);
  }
  // 已存在：先删再插，让重新写入的 key 移到队尾（近似 LRU）
  if (m.has(key)) m.delete(key);
  m.set(key, value);

  let totalBytes = 0;
  for (const v of m.values()) totalBytes += estimateBytes(v);
  // 双上限：条目数超限 或 字节估算超限 → 驱逐最旧（map 迭代首个）
  while (m.size > MEMORY_MAX_KEYS || (m.size > 1 && totalBytes > MEMORY_MAX_BYTES)) {
    const oldest = m.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const evicted = m.get(oldest);
    if (evicted !== undefined) totalBytes -= estimateBytes(evicted);
    m.delete(oldest);
  }
}

/** 取 IDB 连接；不可用或 open 失败时返回 null 并标记强制内存模式 */
async function getIdb(): Promise<IDBDatabase | null> {
  if (!backendIsIdb()) {
    if (!_warnedNoIdb) {
      _warnedNoIdb = true;
      console.warn("[idb] IndexedDB 不可用（隐私模式/非浏览器），模型数据仅驻留内存、不持久");
    }
    return null;
  }
  try {
    return await openDB();
  } catch (e) {
    // P3 修复（子代理审计）：降级内存模式全程零日志——用户不知道「导入的模型不持久」；
    // 只 warn 一次避免刷屏
    if (!_warnedNoIdb) {
      _warnedNoIdb = true;
      console.warn("[idb] IndexedDB open 失败，降级内存模式（不持久）:", e);
    }
    forcedMemory = true;
    return null;
  }
}

// P3 修复：降级警告只发一次（避免每次操作刷屏）
let _warnedNoIdb = false;

/** 仅测试用：重置单例连接 + 降级标志（避免用例间共享状态） */
export function __resetDBForTest(): void {
  // P3 修复（子代理审计）：原仅重置 dbPromise/forcedMemory——已打开的 IDB 连接未
  // close（测试环境泄漏）、memoryStore 不清理（真实后端测试间状态串扰）
  if (dbPromise) {
    swallowError(
      dbPromise.then((db) => {
        if (db) db.close();
      }),
    );
  }
  dbPromise = null;
  forcedMemory = false;
  _warnedNoIdb = false;
  memoryStore.clear();
}

/** 读取单 key */
export async function idbGet<T>(store: Store, key: string): Promise<T | undefined> {
  const db = await getIdb();
  if (!db) return memoryStore.get(store)?.get(key) as T | undefined;
  return new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

/** 写入单 key（QuotaExceededError 走 onabort，必须监听否则 Promise 永不 settle） */
export async function idbSet(store: Store, key: string, value: unknown): Promise<void> {
  const db = await getIdb();
  if (!db) {
    // P2 修复（审核）：走带上限驱逐的 memorySet（原 m.set 无界增长，隐私模式 OOM）
    memorySet(store, key, value);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 删除单 key */
export async function idbDel(store: Store, key: string): Promise<void> {
  const db = await getIdb();
  if (!db) {
    memoryStore.get(store)?.delete(key);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 前缀扫描（MikuMikuAR 模式：dir:<stem>: / file:<stem>: 遍历模型库）
 *  性能优化（R1 万级 key 门槛）：真实浏览器用 IDBKeyRange 区间定位 cursor，
 *  只访问前缀命中键（O(命中)）而非全库 openCursor 逐键 startsWith（O(全库)）。
 *  仅当全局 IDBKeyRange 存在时启用（node 测试环境无此全局 → 降级全量 cursor），
 *  且保留下方 startsWith 兜底过滤——区间上界 prefix+\uffff 覆盖所有命中键，
 *  双保险防边界误含/误漏；内存降级分支逻辑不变。 */
export async function idbKeys(store: Store, prefix: string): Promise<string[]> {
  const db = await getIdb();
  if (!db) {
    const m = memoryStore.get(store);
    if (!m) return [];
    // 排序以对齐 IDB cursor 的 key 升序，扫描结果稳定
    return [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
  return new Promise<string[]>((resolve, reject) => {
    const os = db.transaction(store, "readonly").objectStore(store);
    // 空 prefix（=全库）不走区间，避免空上下界退化；无 IDBKeyRange（node 测试）降级全量
    const useRange = prefix !== "" && typeof IDBKeyRange !== "undefined";
    const req = useRange
      ? os.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff", false, false))
      : os.openCursor();
    const keys: string[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const key = String(cursor.key);
        if (key.startsWith(prefix)) keys.push(key);
        cursor.continue();
      } else {
        resolve(keys);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** 前缀批量取值（P0-1：scanWebModels 单次事务收敛，替代 N 次单 key get）。
 *  返回 [key, value][]，key 为 store 内完整 key（含前缀），按 key 升序（对齐
 *  idbKeys 语义）。真实浏览器用 openCursor + IDBKeyRange 区间定位（O(命中)，
 *  cursor 自带 key，无 getAll/getAllKeys 对齐问题）；node 测试 / 内存降级走
 *  Map 过滤。 */
export async function idbGetAll(store: Store, prefix: string): Promise<Array<[string, unknown]>> {
  const db = await getIdb();
  if (!db) {
    const m = memoryStore.get(store);
    if (!m) return [];
    return [...m.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  return new Promise<Array<[string, unknown]>>((resolve, reject) => {
    const os = db.transaction(store, "readonly").objectStore(store);
    const useRange = prefix !== "" && typeof IDBKeyRange !== "undefined";
    const req = useRange
      ? os.openCursor(IDBKeyRange.bound(prefix, prefix + "\uffff", false, false))
      : os.openCursor();
    const out: Array<[string, unknown]> = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const key = String(cursor.key);
        if (key.startsWith(prefix)) out.push([key, cursor.value]);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** 单事务内的一个操作（put 写入 / del 删除） */
export type IdbOp = { kind: "put"; key: string; value: unknown } | { kind: "del"; key: string };

/**
 * 多 key 单事务原语（ADR-040 治理：rekey/delete 原子性）。
 * 一批 put/del 在同一 IDB readwrite 事务内执行——任一操作失败 → 事务 abort →
 * 整批全部回滚（全有或全无），杜绝 rekeyWebModelGroup / deleteWebModel 的
 * dir/file 分裂或标记残留。内存降级分支同步顺序执行（单微任务内完成，观察者
 * 不可见中间态），天然原子。事务内不抛异常（IDB request 异常走 onerror/onabort）。
 */
export async function idbTx(store: Store, ops: IdbOp[]): Promise<void> {
  const db = await getIdb();
  if (!db) {
    // 内存降级：同步执行，天然原子（无 await 让出控制权，外部观察不到中间态）。
    // put 走 memorySet 保持驱逐语义（与 idbSet 单 key 路径同口径）
    for (const op of ops) {
      if (op.kind === "put") memorySet(store, op.key, op.value);
      else memoryStore.get(store)?.delete(op.key);
    }
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const op of ops) {
      if (op.kind === "put") os.put(op.value, op.key);
      else os.delete(op.key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
