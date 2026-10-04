// ===== 灯光纯数学/几何工具（无 envState、无能力注册表副作用）=====
//
// 为什么独立成叶（2026-10-05 审查，见 docs/knowledge/volumetric_cone.md 截图渲染段）：
//   截图渲染只需 3 个纯函数，但直 import light-capability.ts 会级联触发
//   scene-capability-registry.ts 顶层 `sceneCapabilityRegistry.add(...)`，
//   连带实例化全部 9 个 capability + three 全库 + env-state 状态层 + ring-log。
//   与 ADR-177 的 flattenLightParams 下沉（→ light-params.ts）同一刀：
//   纯映射/几何样板离开 cap 状态，作为单一事实源叶被预览与截图共同消费。
//
// ⚠️ 本模块是叶：**不得**再 `export *` 转发自 light-capability.ts（那会重新把截图
//   拉回能力注册表副作用链，同 light-params.ts 旧 `export *` 转发之坑）。

import * as THREE from "three";
import type { LightInstanceParams } from "./light-params.ts";

/** 方位角 + 仰角 → 3D 位置（radius 为单位长度；预览灯光与截图渲染共用同一套公式——光系统统一性） */
export function lightDirToPosition(p: LightInstanceParams, radius: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(p.azimuth);
  const el = THREE.MathUtils.degToRad(p.elevation);
  const h = radius * Math.cos(el); // 水平分量
  const y = radius * Math.sin(el); // 垂直分量
  return new THREE.Vector3(h * Math.sin(az), y, h * Math.cos(az));
}

/** three.js 物理光照下 SpotLight 距离衰减。
 *  ⚠️ 这是**手抄快照**，非 three 导出 API：对齐 three r165+ 的
 *  `getDistanceAttenuation`（r165 已移除 useLegacyLights，SpotLight.intensity 单位是坎德拉）。
 *  three 历史上改过该公式——**升级 three 时必须复核本函数**，否则预览照度与实际渲染静默分叉。
 *  ✅ 已机器强制（非仅注释提醒）：`light-attenuation-mirror.test.ts` 直读 three 随包发布的
 *  GLSL 原文（lights_pars_begin.glsl）校验本镜像的三个结构锚点，升级后公式变动即测试红。
 *  falloff = 1/pow(d, decay) × cutoffWindow(distance, cutoff)。
 *  用途：把 UI 暴露的「到达目标处照度(lx)」反推回需设的 candela，使聚光灯强度不随目标高度漂移。 */
export function spotDistanceAttenuation(
  lightDistance: number,
  cutoff: number,
  decay: number,
): number {
  const base = 1 / Math.max(lightDistance ** decay, 0.01);
  const cutoffF = cutoff > 0 ? Math.max(0, Math.min(1, 1 - (lightDistance / cutoff) ** 4)) ** 2 : 1;
  return base * cutoffF;
}

/** PMREM 环境光开启时 ambient 让位系数（双间接光叠加防过亮/互相稀释——
 *  [doc:adr-126-p5] 光系统统一性 #3）。预览（refreshAmbientFromSky）与截图
 *  （preview-3d/screenshot-lights.ts toScreenshotLights，ADR-136 归位）共用——
 *  ×0.5 单一事实源，改一处两处同步。
 *  模块常量不导出：外部唯一入口是 attenuateAmbientForSky()（knip 零未引用导出） */
const SKY_ENV_AMBIENT_ATTENUATION = 0.5;

/** ambient 强度按 sky 环境开关套让位系数（镜像 AmbientParams 应用，公式单源） */
export function attenuateAmbientForSky(intensity: number, skyEnvOn: boolean): number {
  return intensity * (skyEnvOn ? SKY_ENV_AMBIENT_ATTENUATION : 1);
}
