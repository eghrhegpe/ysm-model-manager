// @vitest-environment node
// ===== 离屏体积光锥桥测试（ADR-266-d1 D1）=====
// 用**真 three**（几何/材质构建全在 CPU 侧，无需 GPU）锁定三件事：
//  ① 无光柱/体积光关 → 不产锥（null，场景零新增）
//  ② 有光柱 → 场景里出现 `ysm-light-volumetric-cone`，且锥顶 ≡ 离屏灯位
//     （= 与预览 applyLights 同式：模型中心 + 方位角/仰角 × radius）——斜射也必须成立，
//      垂直灯下切线等价会掩盖「方向没跟随」的错
//  ③ dispose 把锥组从场景摘除（离屏资源显式释放纪律）
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { applyVolumetricCone } from "./screenshot-cone.ts";
import type { ScreenshotLights, ScreenshotVolumetric } from "./screenshot-lights.ts";
import { lightDirToPosition } from "@/preview-3d/caps/light-capability.ts";
import { DEFAULT_LIGHT_PARAMS, type LightInstanceParams } from "@/preview-3d/caps/light-params.ts";

const CONE_NAME = "ysm-light-volumetric-cone";

/** 斜射 spot（方位 30°/仰角 45°）——非垂直，能暴露方向未跟随的实现 */
const SPOT: LightInstanceParams = {
  ...DEFAULT_LIGHT_PARAMS.key,
  type: "spot",
  enabled: true,
  azimuth: 30,
  elevation: 45,
  angle: 25,
  penumbra: 0.3,
};

function makeVolumetric(enabled = true): ScreenshotVolumetric {
  return {
    slot: "key",
    spot: SPOT,
    params: { ...DEFAULT_LIGHT_PARAMS.volumetric, enabled },
  };
}

function makeLights(volumetric: ScreenshotVolumetric | null, radius = 8): ScreenshotLights {
  return {
    ambient: { color: 0xffffff, intensity: 0.15 },
    radius,
    key: SPOT,
    fill: DEFAULT_LIGHT_PARAMS.fill,
    rim: DEFAULT_LIGHT_PARAMS.rim,
    volumetric,
    output: null,
  };
}

function findCone(scene: THREE.Scene): THREE.Object3D | undefined {
  return scene.children.find((c) => c.name === CONE_NAME);
}

describe("applyVolumetricCone — 无光柱不产锥", () => {
  it("lights 缺省（回退标准灯路径）→ null 且场景零新增", () => {
    const scene = new THREE.Scene();
    expect(applyVolumetricCone(scene, undefined, new THREE.Vector3())).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it("volumetric 为 null（预览此刻无光柱）→ null", () => {
    const scene = new THREE.Scene();
    expect(applyVolumetricCone(scene, makeLights(null), new THREE.Vector3())).toBeNull();
    expect(scene.children).toHaveLength(0);
  });

  it("volumetric 块在但体积光关 → null（双门之一）", () => {
    const scene = new THREE.Scene();
    const lights = makeLights(makeVolumetric(false));
    expect(applyVolumetricCone(scene, lights, new THREE.Vector3())).toBeNull();
    expect(scene.children).toHaveLength(0);
  });
});

describe("applyVolumetricCone — 有光柱则锥顶落位与预览同式", () => {
  it("锥组入场景，锥顶 ≡ 模型中心 + 方向 × radius（斜射亦然）", () => {
    const scene = new THREE.Scene();
    const origin = new THREE.Vector3(1.5, -2, 3);
    const radius = 8;
    const cone = applyVolumetricCone(scene, makeLights(makeVolumetric(), radius), origin);
    expect(cone).not.toBeNull();

    const group = findCone(scene);
    expect(group, "锥组必须挂进离屏场景").toBeDefined();
    group!.updateMatrixWorld(true);

    // 期望锥顶 = applyLights 的灯位公式（与预览 lightPosition 同源）
    const expectedApex = lightDirToPosition(SPOT, radius).add(origin.clone());
    const worldApex = new THREE.Vector3(0, 1, 0)
      .multiplyScalar(radius / 2) // ConeGeometry(radius, height) 锥顶在局部 +Y 半高
      .applyMatrix4(group!.matrixWorld);
    expect(worldApex.distanceTo(expectedApex)).toBeLessThan(1e-6);

    // 锥底中心 = 锥顶 + 射束方向 × 高 → 即靶点（模型中心）附近
    const worldBase = new THREE.Vector3(0, -1, 0)
      .multiplyScalar(radius / 2)
      .applyMatrix4(group!.matrixWorld);
    expect(worldBase.distanceTo(origin)).toBeLessThan(1e-6);
  });

  it("dispose 后锥组脱离场景（离屏资源释放）", () => {
    const scene = new THREE.Scene();
    const cone = applyVolumetricCone(scene, makeLights(makeVolumetric()), new THREE.Vector3());
    expect(findCone(scene)).toBeDefined();
    cone!.dispose();
    expect(findCone(scene)).toBeUndefined();
  });
});
