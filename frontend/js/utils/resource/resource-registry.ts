// ===== 资源类型注册表（类型化版 — ADR-014 P2）=====
// 从 Go 端 resource_types.json 加载
import { getApp } from "../wails/app.ts";

/** 资源类型注册表条目（对应 resource_types.json 结构） */
export interface ResourceTypeEntry {
  id: string;
  storageSubDir?: string;
  label?: string;
  // 其余字段随 Go 端演进
  [key: string]: unknown;
}

type ResourceRegistry = Record<string, ResourceTypeEntry>;

let _registry: ResourceRegistry | null = null;

/** 加载资源类型注册表（失败不缓存：Go 桥瞬断后下次调用重试，避免整会话降级） */
export async function loadResourceRegistry(): Promise<ResourceRegistry> {
  if (_registry) return _registry;
  try {
    const App = await getApp();
    const raw = await App.LoadResourceTypes();
    const data = JSON.parse(raw || "{}") as { resourceTypes?: ResourceTypeEntry[] };
    _registry = (data.resourceTypes || []).reduce<ResourceRegistry>((map, t) => {
      map[t.id] = t;
      return map;
    }, {});
    return _registry;
  } catch {
    return {};
  }
}
