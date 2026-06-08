// ===== 模型预览数据持久缓存 =====
// 模块级 Map，组件卸载/重挂不丢失
// key: 模型文件绝对路径
// value: { texture?:string, geometry?:object, _decodedBy?:string }

/** @type {Map<string,{texture?:string,geometry?:object,_decodedBy?:string}>} */
const _cache = new Map();

export function cacheGet(path) {
  return _cache.get(path) || null;
}

export function cacheSet(path, data) {
  _cache.set(path, data);
}

export function cacheHas(path) {
  return _cache.has(path);
}

export function cacheDelete(path) {
  _cache.delete(path);
}

export function cacheClear() {
  _cache.clear();
}

export function cacheKeys() {
  return _cache.keys();
}

export function cacheValues() {
  return _cache.values();
}

export function cacheEntries() {
  return _cache.entries();
}

/** 缓存大小 */
export function cacheSize() {
  return _cache.size;
}
