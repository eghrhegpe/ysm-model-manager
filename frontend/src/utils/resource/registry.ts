// ===== 资源类型注册表（类型化版 — ADR-014 P2）=====
// 从 Go 端 resource_types.json 加载
import { getApp } from "../../wails/app.ts";

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
    // P2 修复：仅当拿到非空 resourceTypes 才写缓存——
    // Go 端 LoadResourceTypes 失败时返回 "{}"（resource_bindings.go:25），
    // 原实现 JSON.parse("{}") 成功 → _registry={} 被缓存（对象 truthy），
    // 整会话永远返回空注册表，违反「失败不缓存可重试」契约
    if (!Array.isArray(data.resourceTypes) || data.resourceTypes.length === 0) {
      // P3 修复：空/畸形响应补 warn——Go 端损坏 JSON 会回退嵌入基线并告警（go/types/resource.go），
      // 前端原静默返回 {} 无任何痕迹，消费方图标回退 📦 难排查；失败不缓存可重试语义不变
      console.warn("[registry] LoadResourceTypes 返回空注册表（Go 端可能失败），本次不缓存可重试");
      return {};
    }
    _registry = data.resourceTypes.reduce<ResourceRegistry>((map, t) => {
      map[t.id] = t;
      return map;
    }, {});
    return _registry;
  } catch (e) {
    console.warn("[registry] LoadResourceTypes 失败: %s（本次不缓存，下次调用重试）", e instanceof Error ? e.message : String(e));
    return {};
  }
}
