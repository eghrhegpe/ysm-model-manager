// ===== 统一多模型拾取器（从 mount-preview-core.ts §5 抽出）=====
// 仅 count>=2 激活，单模型完全沿用逐模型 registerBoneRaycast，零回归。
// renderer/camera/scene 显式注入，语义骨骼映射经模块级导入消费。
import * as THREE from "three";
import { assembleBoneSelectInfo, getMeshBoneId } from "@/preview-3d/bone/bone-raycast.ts";
import { sceneRegistry } from "./scene-registry.ts";

/** 拖拽误触阈值（px）：orbit 旋转/平移结束的松手也触发 click，位移超过此值不算点击 */
const DRAG_CLICK_THRESHOLD_PX = 5;

/** 统一多模型拾取器工厂：点击命中模型 → 切活跃 + 换菜单 + 骨骼回调透传。
 *  返回 handle + dispose（内部另注册 pointerdown 记拖拽起点，cleanup 需成对解绑——
 *  canvas 是共享单例，漏解绑会跨会话累积监听器）。 */
export function makeUnifiedPickHandler(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  scene: THREE.Scene,
): { handle: (e: MouseEvent) => void; dispose: () => void } {
  const raycaster = new THREE.Raycaster();
  const pickPointer = new THREE.Vector2();
  // click 事件不带位移信息：pointerdown 记起点，click 时比对——拖完相机松手不应切模型
  let downX = 0;
  let downY = 0;
  const onPointerDown = (e: PointerEvent): void => {
    downX = e.clientX;
    downY = e.clientY;
  };
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  const handle = (e: MouseEvent): void => {
    if (sceneRegistry.count() < 2) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_CLICK_THRESHOLD_PX) return;
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
  return {
    handle,
    dispose: (): void => {
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    },
  };
}
