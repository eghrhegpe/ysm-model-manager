// ===== 通用异步缓存工具 =====
// 基于 key+namespace+ttl 的内存缓存，支持 STALE / NORMAL / FORCE 策略
// 特性：并发去重（stampede guard）、失败不缓存、命名空间隔离

import { dbg, isDebugEnabled } from "@/utils/debug/debug.ts";

/** 缓存条目 */
interface CacheEntry<T> {
  value: T;
  /** 过期时间戳（毫秒） */
  expiryMs: number;
}

/** 缓存策略 */
export type CachePolicy = "NORMAL" | "STALE" | "FORCE";

/** 进程级缓存表，fullKey → CacheEntry */
const _cache = new Map<string, CacheEntry<unknown>>();

/** 在途请求跟踪：fullKey → Promise，防 stampede */
const _pending = new Map<string, Promise<unknown>>();

/** 默认命名空间，调用方可通过 namespace 参数覆盖 */
const DEFAULT_NS = "ysm";

/** 模块级配置 */
interface CacheConfig {
  /** LRU 容量上限 */
  maxSize: number;
}

let _config: CacheConfig = { maxSize: 128 };

/**
 * 配置缓存模块级参数（应在应用启动时调用一次）。
 * maxSize 提级为模块配置：避免 per-call 参数导致不同调用方互相驱逐。
 */
export function configureCache(partial: Partial<CacheConfig>): void {
  _config = { ..._config, ...partial };
}

/** LRU 淘汰：超出容量时 shift 最久未用条目（Map 插入顺序 = 访问顺序） */
function evictLru(): void {
  while (_cache.size > _config.maxSize) {
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
}

/** 拼接命名空间 + key，生成唯一 fullKey */
function mkKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/** 过期时间戳：ttl=0 = 永不过期（文档契约，哨兵 MAX_SAFE_INTEGER）；>0 = nowMs + ttlMs */
function expiryOf(ttlMs: number, nowMs: number): number {
  return ttlMs === 0 ? Number.MAX_SAFE_INTEGER : nowMs + ttlMs;
}

/** 缓存命中时调试输出（热路径：仅在 debug 开启时求值） */
function logHit(fullKey: string, expiryMs: number, now: number): void {
  if (_debugEnabled && isDebugEnabled()) {
    dbg("cache", `[hit] ${fullKey} (${Math.round((expiryMs - now) / 1000)}s 后过期)`);
  }
}

/** 缓存模块 debug 标记缓存（避免热路径重复读取 location.search） */
const _debugEnabled = false;

/**
 * 带过期时间的异步缓存包装器
 *
 * @param key       缓存键（同一 namespace 内唯一）
 * @param ttlMs     过期时间（毫秒），0 = 永不过期
 * @param fn        异步工厂函数，当缓存失效时调用
 * @param policy    缓存策略（默认 NORMAL）
 * @param namespace 命名空间前缀（默认 "ysm"），防不同模块 key 撞车
 * @returns 缓存结果或 fn 的执行结果
 *
 * 策略行为（优先级从高到低）：
 *   FORCE  — 忽略缓存，强制重新计算（不写入缓存）
 *   STALE  — 命中缓存直接返回；过期则立即返回旧值 + 后台刷新（不阻塞，并发去重）
 *   NORMAL — 命中缓存直接返回；过期则重新计算并更新缓存（并发去重）
 *
 * 注意：失败结果不缓存，下次调用仍会重试 fn()
 */
export async function withCached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  policy: CachePolicy = "NORMAL",
  namespace: string = DEFAULT_NS,
): Promise<T> {
  const fullKey = mkKey(namespace, key);
  const now = Date.now();
  const entry = _cache.get(fullKey) as CacheEntry<T> | undefined;

  // FORCE 最高优先级：完全不依赖缓存
  if (policy === "FORCE") {
    dbg("cache", `[force] ${fullKey} 强制重新计算`);
    return fn();
  }

  if (entry && now < entry.expiryMs) {
    // 缓存命中 → LRU 触摸：delete + re-set 移到末尾（Map 插入顺序 = 访问顺序）
    _cache.delete(fullKey);
    _cache.set(fullKey, entry);
    logHit(fullKey, entry.expiryMs, now);
    return entry.value;
  }

  if (entry && policy === "STALE") {
    // 过期但返回旧值，后台刷新（并发去重）
    _cache.delete(fullKey);
    _cache.set(fullKey, entry);
    dbg("cache", `[stale] ${fullKey} 已过期，返回旧值并后台刷新`);
    if (!_pending.has(fullKey)) {
      const p = refreshInBackground(fullKey, ttlMs, fn);
      _pending.set(fullKey, p);
      p.catch((e) => dbg("cache", `refreshInBackground ${fullKey} 失败:`, e));
      p.finally(() => _pending.delete(fullKey));
    }
    return entry.value;
  }

  // NORMAL 且缓存过期或不存在：重新计算（并发去重）
  if (_pending.has(fullKey)) {
    dbg("cache", `[pending] ${fullKey} 已在途，等待`);
    const pending = _pending.get(fullKey);
    if (!pending) return fn();
    try {
      return (await pending) as T;
    } catch (e) {
      // pending 失败 → 让调用方走自己的 fn() 重试
      throw e;
    }
  }

  dbg("cache", `[miss] ${fullKey} 重新计算，ttl=${ttlMs}ms`);
  const p = (async () => {
    try {
      const value = await fn();
      _cache.set(fullKey, { value, expiryMs: expiryOf(ttlMs, Date.now()) });
      evictLru();
      return value;
    } catch (e) {
      // 失败不写入缓存——下次调用仍会重试 fn()
      dbg("cache", `[miss-fail] ${fullKey}:`, e);
      throw e;
    }
  })();
  _pending.set(fullKey, p);
  // 双路清理：无论 resolve/reject 都从 _pending 移除，消除 unhandled rejection
  return p.then(
    (v) => {
      _pending.delete(fullKey);
      return v;
    },
    (e) => {
      _pending.delete(fullKey);
      throw e;
    },
  );
}

/** 后台刷新缓存（不阻塞调用方），返回刷新后的值供 _pending awaiter 复用 */
async function refreshInBackground<T>(
  fullKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const value = await fn();
    _cache.set(fullKey, { value, expiryMs: expiryOf(ttlMs, Date.now()) });
    evictLru();
    dbg("cache", `[refresh] ${fullKey} 刷新成功`);
    return value;
  } catch (e) {
    dbg("cache", `[refresh-fail] ${fullKey}:`, e);
    // 刷新失败不删除旧缓存，维持 STALE 值；rethrow 让 _pending awaiter 知晓
    throw e;
  }
}

/** 清除指定缓存条目 */
export function invalidateCache(key: string, namespace?: string): void {
  const fullKey = mkKey(namespace ?? DEFAULT_NS, key);
  _cache.delete(fullKey);
  _pending.delete(fullKey);
  dbg("cache", `[invalidate] ${fullKey}`);
}

/** 清除所有缓存 */
export function clearAllCache(namespace?: string): void {
  if (namespace) {
    const prefix = `${namespace}:`;
    for (const k of [..._cache.keys()]) {
      if (k.startsWith(prefix)) _cache.delete(k);
    }
    for (const k of [..._pending.keys()]) {
      if (k.startsWith(prefix)) _pending.delete(k);
    }
    dbg("cache", `[clearAll] namespace=${namespace}`);
  } else {
    _cache.clear();
    _pending.clear();
    dbg("cache", `[clearAll]`);
  }
}

/** 获取缓存条目的剩余 TTL（毫秒），未命中或已过期返回 -1 */
export function getCacheTtlMs(key: string, namespace?: string): number {
  const fullKey = mkKey(namespace ?? DEFAULT_NS, key);
  const entry = _cache.get(fullKey) as CacheEntry<unknown> | undefined;
  if (!entry || Date.now() >= entry.expiryMs) return -1;
  return entry.expiryMs - Date.now();
}
