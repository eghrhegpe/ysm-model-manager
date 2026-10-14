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
  /** 该类型条目是否可被几何分析管线（Go SearchModels 数值条件：AnalyzeBedrockModel + geoCache）
   * 解析。事实源 = resource_types.json 的 geometrySearchable 声明（Go registry 同字段）。
   * 前端消费：adv-filter 数值条件区展示门控（types.ts GEOMETRY_SEARCHABLE_TYPES）——
   * 无管线的类型禁用数值区 + 提示，避免「无几何可解析的条目被 BoneCount==0 硬排除」的静默蒸发
   * （2026-10-14 锐评 P1 修复 A 案）。 */
  geometrySearchable?: boolean;
  variants?: ResourceTypeVariant[];
  zipEntries?: ZipEntryMatch[];
}

/** JSON 顶层形状 */
interface ResourceTypeRegistryJson {
  /** 全局容器扩展名声明（.zip/.7z，小写带点）——ADR-269-d1：值集事实源在本 JSON，
   *  Go `registry.ContainerExts/IsContainerExt`、前端 types.ts、契约测试三端派生。 */
  containerExts?: string[];
  resourceTypes?: ResourceType[];
}

/** 单一解析入口：整个前端生产代码只 import 这一处 resource_types.json（测试文件直读
 *  JSON 做对账是故意为之，避免「用派生模块验证派生模块」的自证） */
const registryJson = resourceTypesJson as ResourceTypeRegistryJson;

/** 全部资源类型条目（types.ts / extensions.ts 共同消费，单一来源） */
export const allResourceTypes: ResourceType[] = registryJson.resourceTypes ?? [];

/**
 * 全局容器扩展名（小写带点，单源 = resource_types.json 顶层 containerExts，ADR-269-d1）。
 * 容器是可包裹任意资源类型的通用包装层，不是某类型的属性——故它是顶层字段而非类型字段。
 * 缺声明即回落内置对账集合并告警（同 allResourceTypes 空表 fail-loud 口径，不静默变空集：
 * 空集会让「.zip 是否容器」全线翻转）。
 */
function deriveContainerExts(declared: unknown): string[] {
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((e) => String(e).toLowerCase());
  }
  // fail-loud（同 allResourceTypes 空表口径）：缺声明回落内置对账集合并告警，
  // 不静默变空集——空集会让「.zip 是否容器」的判定全线翻转。
  console.error(
    "[resource] resource_types.json 缺 containerExts 顶层声明，回落内置对账集合（应与 Go/契约测试同源，勿长期靠回退）",
  );
  return [".zip", ".7z"];
}

export const containerExts: string[] = deriveContainerExts(registryJson.containerExts);

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
