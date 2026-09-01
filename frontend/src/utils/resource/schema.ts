// ===== 资源类型 schema（T2 收敛：唯一前端 ResourceType + 单一 JSON 解析点）=====
// 背景：此前 resource_types.json 被 4 份不完整的 TS 接口重复描述——
//   types.ts 的 ResourceTypeIdEntry（id/group/subtypes/variants）与 RawResourceType
//   （id/name/icon/extensions/preview/detector/instanceDir/zipEntries，两份互不完整）、
//   extensions.ts 的 ResourceTypeJsonEntry（id/extensions）、registry.ts 的
//   ResourceTypeEntry（id/storageSubDir/name + index signature）。
// 同一份 JSON 被 3 个文件各自 import、多份字段子集，改字段漏一处即行为分叉。
// 此处收为唯一 ResourceType：types.ts / extensions.ts 同源消费 allResourceTypes，
// registry.ts 的 ResourceTypeEntry extends 本类型（数据源仍走 Go RPC，不动）。
//
// 语义边界：本类型只建模「前端消费」的字段子集；完整 schema 事实源是 Go 端
// go/types/resource.go（+ 根 resource_types.json）。Go 新增未被前端消费的字段
// 不要求在此补声明；前端一旦消费新字段，再补进这里。
import resourceTypesJson from "#root/resource_types.json" with { type: "json" };

/** 压缩容器条目指纹（zipEntries）：name 为段模式，match 为 exact/prefix/suffix */
export interface ZipEntryMatch {
  name?: string;
  match?: string;
}

/** 预览变体（variants：.pmx→mmd / .vrm→vrm / .pmd→mmd 等适配器路由） */
export interface ResourceTypeVariant {
  ext: string;
  preview: string;
}

/** 资源类型（前端消费视图，resource_types.json 字段子集 — 单一事实来源） */
export interface ResourceType {
  id: string;
  name?: string;
  icon?: string;
  group?: string;
  groupLabel?: string;
  groupIcon?: string;
  extensions?: string[];
  storageSubDir?: string;
  configField?: string;
  instanceDir?: string;
  preview?: string;
  detector?: string;
  variants?: ResourceTypeVariant[];
  zipEntries?: ZipEntryMatch[];
}

/** JSON 顶层形状 */
interface ResourceTypeRegistryJson {
  resourceTypes?: ResourceType[];
}

/** 单一解析入口：整个前端只 import 这一处 resource_types.json */
const registryJson = resourceTypesJson as ResourceTypeRegistryJson;

/** 全部资源类型条目（types.ts / extensions.ts 共同消费，单一来源） */
export const allResourceTypes: ResourceType[] = registryJson.resourceTypes ?? [];

if (allResourceTypes.length === 0) {
  // 结构漂移（resourceTypes 缺失/为空）显式暴露，避免空表被误当"无资源类型"静默吞掉
  console.error("[resource] resource_types.json 解析为空或结构异常，前端资源类型派生降级为空表");
}