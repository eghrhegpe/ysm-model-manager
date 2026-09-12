// ===== 构建后场景注册统一管线（mount 初载 / switchTo 切换共用）=====
// ADR-066 收缴 vrm/litematic 脚手架后，mount（runBuild §4c）与 switch（registerSwitchScene）
// 又各自复刻了同一条「差量捕获 → 统计采集 → 菜单合并 → sceneRegistry.register」链，
// 8-9 字段的注册对象近逐字双写——本模块收编为单一实现（锐评 P1-2 收敛）。
// 注：switch 的无快照兜底分支（register({ path, rtype: "", roots: [], content })，
// 不携带菜单/骨骼元数据）语义不同，不在此收编范围。
import type * as THREE from "three";
import { collectSceneStats } from "@/preview-3d/infra/scene-stats.ts";
import {
  estimateSceneTextureBytes,
  setLastSceneTextureBytes,
} from "@/preview-3d/infra/texture-bytes.ts";
import type { PreviewMenuNode } from "@/preview-3d/menu/node-types.ts";
import { mergeStatsMenuItems } from "@/preview-3d/menu/stats.ts";
import type { PreviewScene } from "./mount-preview-core.ts";
import { sceneRegistry } from "./scene-registry.ts";

export interface RegisterBuiltSceneInput {
  path: string;
  /** 资源类型（mount: opts.rtype ?? adapter.id；switch: 前一活跃 entry 继承） */
  rtype: string;
  content: PreviewScene;
  /** 差量参照集（build 前 scene.children 快照）；scene 或快照缺失则 roots 落空数组 */
  scene: THREE.Scene | null | undefined;
  diffSet: Set<THREE.Object3D> | null;
  /** [ADR-159] 容器元数据透传（mount: opts；switch: 前一活跃 entry 继承） */
  displayName?: string | undefined;
  components?: string[] | undefined;
}

/**
 * 差量捕获 roots → 采集场景统计并合并统计面板进菜单（ADR-131 P1）→ 注册 sceneRegistry
 * （ADR-093 T2，注册即置活跃）。
 * @returns 合并后的 menuItems（含统计面板）——调用方据此刷新 dock（非空才 setAdapterItems）
 */
export function registerBuiltScene(input: RegisterBuiltSceneInput): PreviewMenuNode[] {
  const { scene, diffSet } = input;
  const added = scene && diffSet ? scene.children.filter((c) => !diffSet.has(c)) : [];
  const stats = collectSceneStats(added);
  // GPU 预算门的纹理字节快照：取**全场景**（而非本次差量）——预算门判的是
  // 「GPU 上现在压着多少」，追加语义下必须累计全部已注册模型。
  // 全场景口径同时覆盖 MMD/VRM（它们不进 textureCache，池口径对它们恒 0）。
  setLastSceneTextureBytes(estimateSceneTextureBytes(scene));
  const menuItems = mergeStatsMenuItems(input.content.menuItems, stats);
  sceneRegistry.register({
    path: input.path,
    rtype: input.rtype,
    roots: added,
    content: input.content,
    boneMaps: input.content.boneMaps ?? null,
    menuItems,
    onBonePick: input.content.onBonePick ?? null,
    displayName: input.displayName,
    components: input.components,
  });
  return menuItems;
}
