// ===== 模型预览数据持久缓存（类型化版 — ADR-014 P2）=====
// 模块级 Map，组件卸载/重挂不丢失
// key: 模型文件绝对路径
// value: { texture?:string, geometry?:object, _decodedBy?:string }
//
// 缓存有大小限制（默认 50），超出时淘汰最早插入的条目。
// 淘汰时会自动调用 onEvict 回调释放 blob URL。

/** 缓存条目值 */
export interface CacheValue {
  texture?: string | null;
  geometry?: object | null;
  animations?: unknown[];
  authors?: Array<
    | string
    | { name?: string; role?: string; avatarUrl?: string | null; avatarPath?: string }
  >;
  avatars?: Record<string, string>;
  _decodedBy?: string;
  [key: string]: unknown;
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

/** 收集缓存值中全部 blob URL（evict 释放用） */
export function collectBlobUrls(v: CacheValue | undefined): Set<string> {
  const s = new Set<string>();
  if (!v) return s;
  const geo = v.geometry as { textures?: string[]; texture?: string } | undefined;
  if (geo?.textures) for (const u of geo.textures) if (u?.startsWith("blob:")) s.add(u);
  if (geo?.texture?.startsWith("blob:")) s.add(geo.texture);
  if (v.texture?.startsWith("blob:")) s.add(v.texture);
  for (const au of v.authors || []) {
    // P3 修复：`typeof au === "object"` 对 null 同为 true → authors 含 null 时
    // `au.avatarUrl` 抛 TypeError；补 `&& au !== null` 显式排除
    const url = typeof au === "object" && au !== null ? au.avatarUrl : undefined;
    if (url?.startsWith("blob:")) s.add(url);
  }
  for (const u of Object.values(v.avatars || {})) if (u?.startsWith("blob:")) s.add(u);
  return s;
}

export function cacheSet(path: string, data: CacheValue): void {
  // 已有该 key：仅在「新值不再引用旧值的 blob URL」时 evict 释放旧资源——
  // 本项目存在大量「同 key re-set 相同解码对象」模式（loader.ts:42 读旧值补 _decodedBy
  // 塞回、wasm.ts 解码后 index.ts 对同一 key 二次 set 同一对象），新旧值引用同一批 blob URL。
  // 无条件 evict 会 revoke 新值仍在引用的 URL → .ysm 预览纹理/缩略图/头像损坏（code_review P1）。
  if (_cache.has(path)) {
    const oldVal = _cache.get(path);
    if (oldVal && _onEvict) {
      const oldUrls = collectBlobUrls(oldVal);
      const newUrls = collectBlobUrls(data);
      let needsEvict = false;
      for (const u of oldUrls) {
        if (!newUrls.has(u)) {
          needsEvict = true;
          break;
        }
      }
      if (needsEvict) _onEvict(path, oldVal);
    }
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
