// ===== 模型预览数据持久缓存（类型化版 — ADR-014 P2）=====
// 模块级 Map，组件卸载/重挂不丢失
// key: 模型文件绝对路径
// value: { texture?:string, geometry?:object, _decodedBy?:string }
//
// 缓存有大小限制（默认 50），超出时淘汰最早插入的条目。
// 淘汰时会自动调用 onEvict 回调释放 blob URL。

/** 缓存条目值 */
export interface CacheValue {
  texture?: string;
  geometry?: object;
  _decodedBy?: string;
}

type EvictHandler = (key: string, value: CacheValue | undefined) => void;

const MAX_CACHE = 50;

const _cache = new Map<string, CacheValue>();

/** 插入顺序队列（FIFO 淘汰用） */
const _order: string[] = [];

/** 外部 evict 回调，用于释放 blob URL 等资源 */
let _onEvict: EvictHandler | null = null;

/**
 * 注册 evict 回调，淘汰条目时调用
 * @param fn 淘汰回调
 */
export function cacheSetEvictHandler(fn: EvictHandler): void {
  _onEvict = fn;
}

export function cacheGet(path: string): CacheValue | null {
  return _cache.get(path) || null;
}

export function cacheSet(path: string, data: CacheValue): void {
  // 已达上限 → 淘汰最旧的
  if (_cache.has(path)) {
    // 已有该 key，只更新值，不改变淘汰顺序
    _cache.set(path, data);
    return;
  }
  if (_cache.size >= MAX_CACHE) {
    const oldest = _order.shift();
    if (oldest != null) {
      const oldVal = _cache.get(oldest);
      if (_onEvict) _onEvict(oldest, oldVal);
      _cache.delete(oldest);
    }
  }
  _cache.set(path, data);
  _order.push(path);
}

export function cacheHas(path: string): boolean {
  return _cache.has(path);
}

export function cacheDelete(path: string): void {
  const val = _cache.get(path);
  if (_onEvict) _onEvict(path, val);
  _cache.delete(path);
  const idx = _order.indexOf(path);
  if (idx >= 0) _order.splice(idx, 1);
}

export function cacheClear(): void {
  // 淘汰全部时逐个回调
  if (_onEvict) {
    for (const [k, v] of _cache) {
      _onEvict(k, v);
    }
  }
  _cache.clear();
  _order.length = 0;
}

export function cacheKeys(): IterableIterator<string> {
  return _cache.keys();
}

export function cacheValues(): IterableIterator<CacheValue> {
  return _cache.values();
}

export function cacheEntries(): IterableIterator<[string, CacheValue]> {
  return _cache.entries();
}

/** 缓存大小 */
export function cacheSize(): number {
  return _cache.size;
}
