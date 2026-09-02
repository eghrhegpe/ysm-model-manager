// ===== 统一多模型拾取器（从 mount-preview-core.ts §5 抽出）=====
// 仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归。
// renderer/camera/scene 显式注入，语义骨骼映射经模块级导入消费。
import * as THREE from "three";
import { assembleBoneSelectInfo, getMeshBoneId } from "../bone-raycast.ts";
import { sceneRegistry } from "./scene-registry.ts";

/** 统一多模型拾取器工厂：点击命中模型 → 切活跃 + 换菜单 + 骨骼回调透传 */
export function mpMakeUnifiedPickHandler(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
): (e: MouseEvent) => void {
  const raycaster = new THREE.Raycaster();
  const pickPointer = new THREE.Vector2();
  return (e: MouseEvent): void => {
    if (sceneRegistry.count() < 2) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pickPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pickPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pickPointer, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      // THREE Raycaster 不检查 visible，手动跳过隐藏链
      let node: THREE.Object3D | null = hit.object;
      let hidden = false;
      while (node) {
        if (!node.visible) {
          hidden = true;
          break;
        }
        node = node.parent;
      }
      if (hidden) continue;
      const entry = sceneRegistry.pickModelByObject(hit.object);
      if (!entry) continue;
      // 切活跃模型 + 换菜单（菜单会话级共享、后建覆盖前建，故需按归属换项）
      sceneRegistry.setActive(entry.id);
      if (entry.boneMaps) {
        const boneId = getMeshBoneId(hit.object, entry.boneMaps.nameMap);
        if (boneId) {
          const info = assembleBoneSelectInfo(
            boneId,
            entry.boneMaps.boneGroupMap,
            entry.boneMaps.nameMap,
            entry.boneMaps.parentMap,
            entry.boneMaps.childrenMap,
            hit.object,
          );
          entry.content.onBoneSelect?.(info);
          entry.onBonePick?.(boneId);
        }
      }
      break;
    }
  };
}
