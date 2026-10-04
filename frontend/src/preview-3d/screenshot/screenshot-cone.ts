// ===== 离屏体积光锥桥（ADR-266-d1 D1）=====
// 把 `ScreenshotLights.volumetric` 落成离屏场景里的真锥体：复用预览同一实现
// （`VolumetricCone`：真锥体几何 + Fresnel 边缘辉光 + 轴向衰减），不写第二套
// 「截图专用光柱」——同一单源，预览调外观截图自动跟随。
//
// 定位/朝向与预览 `LightCapability.rebuildConeIfNeeded` 同式（三处孔位必须同源，
// 任一处手抄即两画面静默分叉）：
//   · 锥高 = radius（预览 targetHeight）
//   · 锥顶 = 模型中心 + 方位角/仰角 × radius（= 本目录 applyLights 的灯位公式）
//   · 射束方向 = 靶点（模型中心）− 锥顶（= 预览 getSpotDir）
import * as THREE from "three";
import { VolumetricCone } from "@/preview-3d/caps/light-cone.ts";
import { lightDirToPosition } from "@/preview-3d/caps/light-math.ts";
import type { ScreenshotLights } from "./screenshot-lights.ts";

/** 在离屏场景建锥并挂载；预览无光柱（volumetric 为 null）/ 体积光关 → null。
 *  返回值由调用方在 finally 释放（`dispose()` 连带几何/材质/贴图槽位，防离屏 GPU 资源累积）。 */
export function applyVolumetricCone(
  scene: THREE.Scene,
  lights: ScreenshotLights | undefined,
  origin: THREE.Vector3,
): VolumetricCone | null {
  if (!lights) return null;
  const vol = lights.volumetric;
  if (!vol?.params.enabled) return null;
  const cone = new VolumetricCone(scene);
  // 与 applyLights 同式：灯位 = 方位角/仰角 × radius + 模型中心
  const pos = lightDirToPosition(vol.spot, lights.radius).add(origin);
  // 靶点 = 模型中心（预览 spotTarget 同位）；VolumetricCone 内部归一化方向
  const dir = new THREE.Vector3().copy(origin).sub(pos);
  cone.rebuild(lights.radius, vol.spot, vol.params, pos, dir);
  if (!cone.hasGroup()) {
    // 未产出锥组（rebuild 内部另有 sp.enabled / vm.enabled 双门）：无资源可放，直接收口
    cone.dispose();
    return null;
  }
  if (!cone.isMounted()) cone.attach(pos, dir);
  return cone;
}
