// ===== 资源类型注册表（类型化版 — ADR-014 P2）=====
// 从 Go 端 resource_types.json 加载（异步 RPC，与 types.ts/extensions.ts 的静态内联
// JSON 是两套数据源；T2 仅归一「类型」，数据源保持现状）。
import { getApp } from "../../backend/app.ts";
import { safeErrorMessage } from "../safe-error-msg.ts";
import type { ResourceType } from "./schema.ts";

/** 资源类型注册表条目（对应 resource_types.json 结构）。extends ResourceType 共享已知字段，
 *  保留 index signature 以容忍 Go 端未来新增字段。 */
export interface ResourceTypeEntry extends ResourceType {
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
    const reg = await App.LoadResourceTypes();
    // Go 端返回 null 或空注册表 → 本次不缓存可重试（与 P2 修复语义一致）
    if (!reg || !Array.isArray(reg.resourceTypes) || reg.resourceTypes.length === 0) {
      console.warn("[registry] LoadResourceTypes 返回空注册表（Go 端可能失败），本次不缓存可重试");
      return {};
    }
    _registry = reg.resourceTypes.reduce<ResourceRegistry>((map, t) => {
      // Go 绑定 null → 省略字段（前端以 undefined 读取，schema 兼容性转换）
      const { extensions, variants, zipEntries, ...rest } = t;
      const entry: ResourceTypeEntry = {
        ...rest,
        ...(extensions ? { extensions } : {}),
        ...(variants ? { variants } : {}),
        ...(zipEntries ? { zipEntries } : {}),
      };
      map[t.id] = entry;
      return map;
    }, {});
    return _registry;
  } catch (e) {
    console.warn("[registry] LoadResourceTypes 失败: %s（本次不缓存，下次调用重试）", safeErrorMessage(e));
    return {};
  }
}
