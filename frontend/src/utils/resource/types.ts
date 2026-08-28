// ===== 资源类型常量（类型化版 — ADR-014 P2）=====
// RESOURCE_TYPES / RESOURCE_TYPE_LABELS 保留手写：JSON 无「标签→ID」映射，且短标签
// （如 "模型"/"MMD"）≠ JSON 的 name 全名（"YSM 模型"/"MMD 角色模型"），短标签参与 Go 端
// ScanModelEntriesWithLabel 扫描匹配，语义由前端契约决定，不能从 JSON 派生。
// ALL_RESOURCE_TYPES 等派生表统一消费 schema.ts 的 allResourceTypes（T2 单点解析）。
import { allResourceTypes } from "./schema.ts";

/** 资源类型 ID（键为类型标签，值为内部 ID） */
export const RESOURCE_TYPES: Record<string, string> = {
  YSM: "ysm",
  MMD: "EntityPlayer",
  SCENE: "SceneModel",
  CUSTOM_ANIM: "CustomAnim",
  CUSTOM_MORPH: "CustomMorph",
  STAGE: "StageAnim",
  MMD_SHADER: "mmd-shader",
  DEFAULT_ANIM: "DefaultAnim",
  DEFAULT_MORPH: "DefaultMorph",
  PACK: "resourcepack",
  SHADER: "shaderpack",
  BLUEPRINT: "blueprint",
  LITEMATIC: "litematic",
  MAID: "maid-model",
  FBX: "fbx",
};

/** 资源类型显示标签（内部 ID → 中文名） */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ysm: "YSM 模型",
  EntityPlayer: "角色模型",
  SceneModel: "场景模型",
  CustomAnim: "自定义动画",
  CustomMorph: "自定义表情",
  StageAnim: "舞台动画",
  "mmd-shader": "MMD 着色器",
  DefaultAnim: "默认动画",
  DefaultMorph: "默认表情",
  resourcepack: "资源包",
  shaderpack: "光影包",
  blueprint: "蓝图",
  litematic: "投影",
  "maid-model": "车万女仆",
  "fbx": "FBX 模型/动画",
};

/** 全部资源类型 ID 列表（从 resource_types.json id 派生，单一事实来源） */
export const ALL_RESOURCE_TYPES: string[] = allResourceTypes
  .map((t) => t.id)
  .filter((id): id is string => typeof id === "string" && id.length > 0);

/**
 * 按 variants 解析预览路由 key（ADR-111：类别—格式分层）。
 * 同一 rtype 内不同格式变体（如 .pmx→mmd、.vrm→vrm）分发到不同适配器。
 * 无 variants 或未命中时回退 rtype 自身（兼容无变体类型）。
 */
export function resolvePreviewKey(filePath: string, rtype: string): string {
  const entry = allResourceTypes.find((t) => t.id === rtype);
  if (entry?.variants?.length) {
    // 复用 extOf 统一扩展名提取口径（split(".") 对无扩展名文件名会误产出 ".Makefile"）
    const variant = entry.variants.find((v) => v.ext === extOf(filePath));
    if (variant) return variant.preview;
  }
  return rtype;
}

/**
 * 预览键反解为资源类型 ID（ADR-111 逆向）。
 * 角色面板类型 tab 传入的是预览键（如 "mmd"），但 Go 侧 ScanModelEntriesFiltered
 * 需要真实资源类型 ID（如 "EntityPlayer"）才能命中扩展名白名单过滤。
 * 未命中时回退 previewKey 自身（兼容已是资源类型 ID 的场景）。
 */
export function resolvePreviewKeyToRtype(previewKey: string): string {
  const entry = allResourceTypes.find((t) =>
    t.variants?.some((v) => v.preview === previewKey),
  );
  return entry?.id ?? previewKey;
}

/**
 * 按扩展名解析预览 key 的全局兜底（ADR-111 兜底层）。
 * 场景：DetectResourceType 对歧义扩展名（如 .pmx 同时声明于 EntityPlayer/SceneModel）保守返回
 * "other"，而该扩展名在任一类型的 variants 中有明确预览适配器（如 .pmx→mmd）。
 * 此时预览路由不应直接判"暂不支持"——按扩展名取首个声明者的 preview key 兜底路由。
 * 注意：本函数只做「预览适配器路由」派生，不参与资源类型判定（类型判定唯一事实源仍是
 * resource_types.json + Go）；返回空串表示无任何 variants 声明该扩展名。
 */
export function resolvePreviewKeyByExt(filePath: string): string {
  const ext = extOf(filePath);
  if (!ext) return "";
  for (const t of allResourceTypes) {
    for (const v of t.variants ?? []) {
      if (v.ext === ext) return v.preview;
    }
  }
  return "";
}

// ===== 资源分组派生（ADR-092：FilesRoot/{group}/{storageSubDir} 两层路由）=====
// 从各类型 group 字段派生，消除 resourceGroups 冗余源。
// 组 = 所有类型的 group 字段去重集合，新资源注册后自动入组。
// groupLabel/groupIcon 从注册表各类型的 groupLabel/groupIcon 字段读取（仅该组首个类型携带）。

/** 分组元数据（id → {name, icon, order}），从各类型 group 字段派生 */
export const GROUP_META: Record<string, { name: string; icon: string; order: number }> = {};
const groupSeen: string[] = [];
for (const t of allResourceTypes) {
  const gid = t.group || "";
  if (!gid || GROUP_META[gid]) continue;
  // 从注册表读取 groupLabel/groupIcon（仅该组首个类型携带）
  GROUP_META[gid] = {
    name: t.groupLabel || gid,
    icon: t.groupIcon || "📦",
    order: groupSeen.length,
  };
  groupSeen.push(gid);
}

/** 资源类型 → 所属分组 id（无 group 字段返回空串 = 单级平铺） */
export const GROUP_OF: Record<string, string> = {};
for (const t of allResourceTypes) {
  if (t.id) GROUP_OF[t.id] = t.group || "";
}

/** 分组 id → 显示名 */
export function groupLabelOf(group: string): string {
  return GROUP_META[group]?.name || "";
}

/**
 * 大类(group) → 其下资源类型选项（ADR-092 双下拉导航第二级）。
 * 从 resource_types.json 派生：每个 group 下挂的资源类型即选项，平铺展示。
 * 各 MMD 类型（EntityPlayer/SceneModel/CustomAnim 等）现为独立顶级类型，
 * 直接在所属 group 下平铺，不再通过 subtype 展开。
 */
export interface GroupTypeOption {
  rtype: string;
  label: string;
  subdir: string;
}
export const GROUP_TYPE_OPTIONS: Record<string, GroupTypeOption[]> = (() => {
  const result: Record<string, GroupTypeOption[]> = {};
  for (const t of allResourceTypes) {
    if (!t.id || !GROUP_OF[t.id]) continue;
    const g = GROUP_OF[t.id];
    const label = RESOURCE_TYPE_LABELS[t.id] || GROUP_META[g]?.name || t.id;
    (result[g] ||= []).push({ rtype: t.id, label, subdir: "" });
  }
  return result;
})();

/**
 * 资源类型在 FilesRoot 下的分组存储根目录（ADR-092 两层路由）。
 * 有 group：`{group}/{storageSubDir}`；无 group：`storageSubDir`（向后兼容）。
 * 返回相对 FilesRoot 的子路径，调用方自行拼接。
 */
export function groupStorageRootOf(typeId: string): string {
  const group = GROUP_OF[typeId];
  const rt = allResourceTypes.find((t) => t.id === typeId);
  const sub = rt?.storageSubDir || typeId;
  return group ? `${group}/${sub}` : sub;
}

// ===== 资源能力派生（ADR-066：解墙 — 预览/解码层统一查表）=====
// 此前 loader.ts / index.ts / litematic-meta.ts 散落扩展名正则与 Go RPC 字符串分支，
// 现全部从 resource_types.json 派生：新增格式只改 JSON，不散改前端代码。

/** 提取路径扩展名（小写、含点；无扩展名返回空串） */
export function extOf(path: string): string {
  const base = path.split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

/** 单一资源类型的能力视图（派生自 resource_types.json + 短标签映射） */
interface ResourceCap {
  id: string;
  name: string;    // JSON 全名（如 "YSM 模型"）
  label: string;   // 短标签（如 "模型"，参与 Go 扫描匹配）
  icon: string;
  extensions: string[]; // 小写、含点，如 [".ysm",".zip",".json"]
  preview: string; // "3d" | "thumbnail" | "none" ...
}

/** 全部资源类型能力，从 resource_types.json 派生（单一事实来源）。内部派生层，外部用安全入口 resolveTypeSafe / matchTypeByExt */
const RESOURCE_CAPS: Record<string, ResourceCap> = {};
for (const t of allResourceTypes) {
  if (!t.id) continue;
  RESOURCE_CAPS[t.id] = {
    id: t.id,
    name: t.name || t.id,
    label: RESOURCE_TYPE_LABELS[t.id] || t.name || t.id,
    icon: t.icon || "📦",
    extensions: (t.extensions || []).map((e) => e.toLowerCase()),
    preview: t.preview || "none",
  };
}

/**
 * 无 3D 预览能力的资源类型集合（从 resource_types.json preview 字段派生）。
 * preview !== "3d" 的类型不走 3D opener 注册，由调用方自行处理回退。
 * 单一事实来源：新增类型只需改 JSON，测试/逻辑自动跟随，无需手改豁免列表。
 */
export const NO_3D_TYPES: ReadonlySet<string> = new Set(
  Object.values(RESOURCE_CAPS).filter((cap) => cap.preview !== "3d").map((cap) => cap.id),
);

/**
 * 3D 切换面板类型 tab 的单一事实来源（ADR-111 收口）。
 * 此前 preview-switch-tabs 由 `Object.keys(_openers)` 副作用派生——opener 注册 key 混用
 * preview key（"mmd"/"vrm"/"mmd-scene"）与真实 rtype ID（"ysm"/"fbx"），导致 tab 语义
 * 与 nav 下拉（走 GROUP_TYPE_OPTIONS 真实 rtype）双源不一致。
 *
 * 本函数统一从 resource_types.json 派生：筛选顶层 `preview === "3d"` 的类型，按 variants
 * 展开为适配器 key（EntityPlayer → ["mmd","vrm"]），无 variant 的类型用自己的 id（如 "ysm"）。
 * 标签统一走 RESOURCE_TYPE_LABELS，杜绝手写 HTML / opener 副作用两套口径。
 *
 * 返回顺序即 tab 展示顺序，由 resource_types.json 条目顺序决定（新增类型自动尾部追加）。
 */
export interface PreviewTab {
  /** 适配器路由 key（喂给 resolvePreviewKeyToRtype 反解为真实 rtype） */
  key: string;
  /** 展示标签 */
  label: string;
}

export function getPreviewableTypeTabs(): PreviewTab[] {
  const tabs: PreviewTab[] = [];
  const seen = new Set<string>();
  for (const t of allResourceTypes) {
    if (!t.id) continue;
    const cap = RESOURCE_CAPS[t.id];
    if (!cap || cap.preview !== "3d") continue;
    const variants = t.variants?.map((v) => v.preview).filter((p): p is string => !!p) ?? [];
    const keys = variants.length > 0 ? Array.from(new Set(variants)) : [t.id];
    const label = RESOURCE_TYPE_LABELS[t.id] || t.id;
    for (const key of keys) {
      // preview key 跨类型共享（如 vrm 同时归属 EntityPlayer / SceneModel），
      // 按 key 去重保留首个命中类型（JSON 顺序：EntityPlayer 在前 → vrm 标「角色模型」），
      // 点击该 key 时 resolvePreviewKeyToRtype 仍按文件路径反解到正确 rtype，能力不丢。
      if (seen.has(key)) continue;
      seen.add(key);
      tabs.push({ key, label });
    }
  }
  return tabs;
}

/** 路径是否属于指定类型（按注册表 extensions 判定，不处理歧义扩展名） */
export function matchTypeByExt(path: string, typeId: string): boolean {
  const cap = RESOURCE_CAPS[typeId];
  if (!cap) return false;
  return cap.extensions.includes(extOf(path));
}

/**
 * 按扩展名反解资源类型。歧义扩展名（如 .zip 同时归属 ysm/resourcepack/shaderpack）
 * 返回 null，调用方应回退到内容检测（Go DetectResourceType）。
 * 内部实现：外部统一走 resolveTypeSafe（带歧义守卫）。
 */
function resolveTypeByExt(path: string): string | null {
  const ext = extOf(path);
  if (!ext) return null;
  const hits = Object.values(RESOURCE_CAPS).filter((c) => c.extensions.includes(ext));
  return hits.length === 1 ? hits[0].id : null;
}

/** 压缩容器扩展名：走 Go 解包提取，不由前端 WASM 直接预览 */
const CONTAINER_EXTS = new Set([".zip", ".7z"]);

/** 是否为压缩容器扩展名（.zip/.7z；容器可包裹任意类型，类型判定仍以 Go 内容检测为准） */
export function isContainerExt(pathOrExt: string): boolean {
  return CONTAINER_EXTS.has(extOf(pathOrExt) || pathOrExt);
}

/**
 * 取 rtype 的默认预览 key（首个 variants 的 preview；无 variants 回退 rtype 自身）。
 * 场景：容器扩展名（.zip 打包的 PMX）被 Go 路径消歧归为 EntityPlayer 后，resolvePreviewKey
 * 对 .zip 无 variants 命中 → 回退 "EntityPlayer" → opener 注册表无此 key。此处按 rtype
 * 默认预览适配器（EntityPlayer→mmd）兜底路由。仅预览路由派生，不参与类型判定。
 */
export function resolveDefaultPreviewKey(rtype: string): string {
  const entry = allResourceTypes.find((t) => t.id === rtype);
  const first = entry?.variants?.find((v) => v.preview);
  return first?.preview ?? rtype;
}

/**
 * 资源类型图标（从 resource_types.json 的 icon 字段派生——扩展点残留清单 #3：
 * 原 icon.ts 手写 RTYPE_ICONS 与 JSON 漂移，新增类型须手改；现 JSON 加 icon 即自动生效）。
 */
export function typeIconOf(id: string): string {
  return RESOURCE_CAPS[id]?.icon || "📦";
}

/** ysm 单文件（.ysm/.json）走前端 WASM 预览；.zip/.7z 容器由 Go FindPreviewImage 兜底 */
export function isYsmWasmPreview(path: string): boolean {
  const ext = extOf(path);
  return matchTypeByExt(path, RESOURCE_TYPES.YSM) && !CONTAINER_EXTS.has(ext);
}

/** 体素类（蓝图/投影）Go 体素数据 RPC 名称，按扩展名单点映射（ADR-066 解墙） */
export const VOXEL_RPC_BY_EXT: Record<string, string> = {
  ".nbt": "GetNbtVoxelData",
  ".schematic": "GetSchematicVoxelData",
  ".litematic": "GetLitematicVoxelData",
};

/**
 * 歧义扩展名集合：同扩展名归属 ≥2 类型，禁止用 matchTypeByExt / resolveTypeByExt 直接定类型。
 * 根因（ADR-067）：所有资源都能被 .zip / .7z 包裹，扩展名不可信，必须回退内容检测。
 * 从 RESOURCE_CAPS 派生，新增类型自动纳入，无需手维护。
 */
export const AMBIGUOUS_EXTS: Set<string> = (() => {
  const count: Record<string, number> = {};
  for (const cap of Object.values(RESOURCE_CAPS)) {
    for (const e of cap.extensions) count[e] = (count[e] || 0) + 1;
  }
  return new Set(Object.keys(count).filter((e) => count[e] > 1));
})();

/**
 * 安全解析类型（ADR-067）：单归属扩展名直接命中；歧义扩展名（.zip/.7z 等可包裹任意资源）
 * 返回 null，调用方必须回退到 Go DetectResourceType 内容检测。
 * 新分发器（P1 VRM / P2 MMD 适配器）统一使用此函数，避免重蹈硬编码扩展名派发的覆辙。
 */
export function resolveTypeSafe(path: string): string | null {
  const ext = extOf(path);
  if (!ext) return null;
  return AMBIGUOUS_EXTS.has(ext) ? resolveTypeByPath(path) : resolveTypeByExt(path);
}

/**
 * 路径消歧（对齐 Go detectByPathDisambiguation）：遍历文件所有祖先目录，
 * 检查是否匹配某类型的 instanceDir。解决 MMD 子类型共享扩展名的歧义。
 * 仅在扩展名也匹配时才返回——确保不会跨组误判。
 */
function resolveTypeByPath(path: string): string | null {
  const ext = extOf(path);
  if (!ext) return null;

  const normPath = path.replace(/\\/g, "/").toLowerCase();
  const segments = normPath.split("/");
  // 收集祖先目录（从直接父目录到根）
  const ancestors: string[] = [];
  for (let i = segments.length - 1; i >= 1; i--) {
    ancestors.push(segments.slice(0, i).join("/"));
  }

  for (const t of allResourceTypes) {
    if (!t.id || !t.instanceDir) continue;
    if (!t.extensions?.includes(ext)) continue;
    const instDirNorm = t.instanceDir.toLowerCase();
    for (const anc of ancestors) {
      if (anc === instDirNorm || anc.endsWith("/" + instDirNorm)) {
        return t.id;
      }
    }
  }
  return null;
}

/** ZIP 条目任意层级段后缀（ADR-082 S1 前端同构）：a/b/c → [a/b/c, b/c, c] */
function segmentSuffixes(name: string): string[] {
  const segs = name.toLowerCase().split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(i).join("/"));
  return out;
}

/**
 * 按注册表 zipEntries 指纹匹配 ZIP 条目名，返回命中的资源类型 ID（ADR-082 S4：
 * 前端指纹注册表化，与 Go types.MatchZipEntry 同构——任意层级段后缀语义，
 * 新增类型只改 JSON）。命中规则来自 resource_types.json 的 zipEntries
 * （exact/prefix/suffix 三种模式），未命中返回 null。
 */
export function matchZipEntryTS(name: string): string | null {
  for (const t of allResourceTypes) {
    if (!t.id || !t.zipEntries || t.zipEntries.length === 0) continue;
    for (const m of t.zipEntries) {
      const mlow = (m.name || "").toLowerCase();
      if (!mlow) continue;
      for (const seg of segmentSuffixes(name)) {
        if (m.match === "prefix" && seg.startsWith(mlow)) return t.id;
        if (m.match === "suffix" && seg.endsWith(mlow)) return t.id;
        if (m.match !== "prefix" && m.match !== "suffix" && seg === mlow) return t.id;
      }
    }
  }
  return null;
}