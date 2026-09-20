// ===== 资源类型 schema（唯一前端 ResourceType + 单一 JSON 解析点）=====
// types.ts / extensions.ts 同源消费 allResourceTypes；键控消费方读 resourceTypesById。
// ADR-269 D3：本文件是前端资源类型的唯一同步入口，原 `services/resource-registry.ts`
// 异步 RPC 旁路已删除。
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
  /** CLI（go/cli benchmark 等）是否有该类型的解析链路；事实源 = resource_types.json 的
   * cliAnalyzable 声明（Go 侧 cliAnalyzable() 读同一字段）。前端只消费：目标集选择器据此
   * 只列可分析类型，不再自己判「哪些模型能跑 benchmark」（ADR-262 D3 / ADR-269 D3 同步通路）。 */
  cliAnalyzable?: boolean;
  variants?: ResourceTypeVariant[];
  zipEntries?: ZipEntryMatch[];
}

/** JSON 顶层形状 */
interface ResourceTypeRegistryJson {
  resourceTypes?: ResourceType[];
}

/** 单一解析入口：整个前端生产代码只 import 这一处 resource_types.json（测试文件直读
 *  JSON 做对账是故意为之，避免「用派生模块验证派生模块」的自证） */
const registryJson = resourceTypesJson as ResourceTypeRegistryJson;

/** 全部资源类型条目（types.ts / extensions.ts 共同消费，单一来源） */
export const allResourceTypes: ResourceType[] = registryJson.resourceTypes ?? [];

/**
 * 按 id 键控的同步资源类型视图（ADR-269 D3）。
 * 取代 `services/resource-registry.ts` 的异步 RPC 旁路：消费方从
 * `await loadResourceRegistry()` 改为直读此处，与 `allResourceTypes` 同源、无空表窗口。
 * 插入序 = JSON 序（`Object.fromEntries` 保序），需要稳定顺序时消费方自行排序。
 */
export const resourceTypesById: Record<string, ResourceType> = Object.fromEntries(
  allResourceTypes.map((t) => [t.id, t]),
);

if (allResourceTypes.length === 0) {
  // 结构漂移（resourceTypes 缺失/为空）显式暴露，避免空表被误当"无资源类型"静默吞掉
  console.error("[resource] resource_types.json 解析为空或结构异常，前端资源类型派生降级为空表");
}
