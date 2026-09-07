// ===== 预览候选列表（同目录兄弟模型 / 场景 / 表情动画 / 舞台包）=====
// 视图壳数据准备：GetRepoRoot → ScanModelEntriesFiltered（ADR-044③ 对称范式）。
// 归位 views 层（ADR-072 根治：依赖 getApp 读仓库根，属视图壳数据能力，
// 不该被 preview-3d/adapters 反向 import —— 那会与 adapter → controls 形成循环依赖环）。
// 各格式（mmd / fbx / scene / morph / stage）共享同一底座，薄壳已合并回本文件
// （P1 修复：原 mmd-siblings / fbx-siblings / stage-siblings 三壳合并，消费者统一引 ./siblings.ts）。

import { getApp } from "@/backend/app.ts";
import {
  extOf,
  previewCandidateExtsOf,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
} from "@/utils/resource/types.ts";

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

/** 同类型 MMD 模型候选（委托共享底座 resolveSiblingsByType）；失败返回 []（下拉不渲染） */
export async function resolveMmdSiblings(): Promise<string[]> {
  return resolveSiblingsByType(RESOURCE_TYPES.MMD);
}

/** 同类型 FBX 模型候选（GetRepoRoot(fbx) → ScanModelEntriesFiltered 主文件 Path 列表）；失败返回 []（下拉不渲染） */
export async function resolveFbxSiblings(): Promise<string[]> {
  return resolveSiblingsByType(RESOURCE_TYPES.FBX);
}

// ===== StageAnim 舞台包资源扫描（只扫 StageAnim 目录的 VMD + 音频文件）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/StageAnim，无需前端回溯拼接
// StageAnim 目录结构：
//   StageAnim/<舞台包>/
//     ├── *.vmd      角色动画 / 相机轨道
//     ├── *.mp3      背景音乐
//     ├── *.ogg      （可选）
//     ├── *.wav      （可选）
//     └── stage_config.json

/** 扫描 StageAnim 目录下所有资源文件（VMD + 音频 + config）；失败返回 [] */
export async function resolveStageSiblings(): Promise<
  Array<{
    path: string;
    kind: "vmd" | "audio" | "config" | "other";
  }>
> {
  try {
    const App = await getApp();
    const stageRoot = await App.GetRepoRoot("StageAnim");
    if (!stageRoot) return [];
    const raw = await App.ScanModelEntriesFiltered(stageRoot, "StageAnim", "", "舞台动画");
    const results: Array<{ path: string; kind: "vmd" | "audio" | "config" | "other" }> = [];
    for (const e of raw || []) {
      const p = e.Path || "";
      if (!p) continue;
      const ext = (p.split(/[/\\]/).pop() || "").toLowerCase();
      if (ext.endsWith(".vmd")) results.push({ path: p, kind: "vmd" });
      else if (/\.(mp3|ogg|wav)$/i.test(p)) results.push({ path: p, kind: "audio" });
      else if (ext === "stage_config.json") results.push({ path: p, kind: "config" });
    }
    return results;
  } catch {
    return [];
  }
}
