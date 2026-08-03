// ===== 资源类型注册表（从 Go 端 resource_types.json 加载） =====
import { getApp } from "../wails/app.ts";

let _registry = null;

/** 加载资源类型注册表 */
export async function loadResourceRegistry() {
  if (_registry) return _registry;
  try {
    const App = await getApp();
    const raw = await App.LoadResourceTypes();
    const data = JSON.parse(raw || "{}");
    _registry = (data.resourceTypes || []).reduce((map, t) => {
      map[t.id] = t;
      return map;
    }, {});
  } catch {
    _registry = {};
  }
  return _registry;
}

/** 获取某资源类型的注册表条目 */
export function getResourceType(rtype) {
  return _registry ? _registry[rtype] : null;
}

/** 获取存储子目录（对应 resource_types.json 的 storageSubDir 字段） */
export function getStorageSubDir(rtype) {
  if (!_registry) return rtype;
  const t = _registry[rtype];
  return t && t.storageSubDir ? t.storageSubDir : rtype;
}
