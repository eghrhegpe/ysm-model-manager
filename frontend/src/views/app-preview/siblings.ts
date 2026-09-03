// ===== 同类型候选列表通用底座（视图壳数据准备：GetRepoRoot → ScanModelEntriesFiltered）=====
// 各格式（mmd / fbx / scene / ...）共享同一链路，Go 按注册表白名单过滤（ADR-044③ 对称范式）。
// 归位 views 层（ADR-072 根治：依赖 getApp 读仓库根，属视图壳数据能力，
// 不该被 preview-3d/adapters 反向 import —— 那会与 adapter → controls 形成循环依赖环）。
import { getApp } from "../../backend/app.ts";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  extOf,
  previewCandidateExtsOf,
} from "../../utils/resource/types.ts";

/**
 * 解析某资源类型的同目录候选主文件路径列表。
 * @param rtype  资源类型 id（RESOURCE_TYPES.*），传给 Go `GetRepoRoot` + `ScanModelEntriesFiltered`
 * @param filterExts  预览候选 ext 白名单（previewCandidateExtsOf 派生；缺省 = 不过滤）。
 *   Go 白名单语义 = 类型归属全 extensions；此处白名单表达「本预览适配器可加载的裸文件」子集
 *   （锐评 G2 收口：ext 数组由 resource_types.json 派生，替代原手写正则）。
 * @returns 候选绝对路径列表；根为空 / 扫描失败 → []（调用方下拉不渲染，不阻断）
 */
export async function resolveSiblingsByType(
  rtype: string,
  filterExts?: readonly string[],
): Promise<string[]> {
  try {
    const app = await getApp();
    const root = await app.GetRepoRoot(rtype);
    if (!root) return [];
    const label = RESOURCE_TYPE_LABELS[rtype] || rtype;
    const entries = await app.ScanModelEntriesFiltered(root, rtype, "", label);
    const paths = (entries || []).map((e) => e.Path || "");
    return filterExts ? paths.filter((p) => filterExts.includes(extOf(p))) : paths;
  } catch {
    return [];
  }
}

// 场景模型候选（只扫 SceneModel 子目录）：预览候选 = SceneModel variants 的 mmd-scene 组
// （.pmx/.pmd）——Go 白名单含 .vrm（VRM 预览形态）与容器，此处剔除加载不了的条目
export async function resolveSceneSiblings(): Promise<string[]> {
  return resolveSiblingsByType(
    RESOURCE_TYPES.SCENE,
    previewCandidateExtsOf(RESOURCE_TYPES.SCENE, "mmd-scene"),
  );
}

// CustomMorph 候选（只扫 CustomMorph 子目录的 VPD）：无 variants → extensions 剔容器
// = [.vpd]；zip 容器条目（.vpd.zip 等）不可直接应用，剔除
export async function resolveMorphSiblings(): Promise<string[]> {
  return resolveSiblingsByType(
    RESOURCE_TYPES.CUSTOM_MORPH,
    previewCandidateExtsOf(RESOURCE_TYPES.CUSTOM_MORPH),
  );
}
