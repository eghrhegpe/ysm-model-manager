// @vitest-environment node
// ===== VolumetricCone 测试 =====
// 契约：真锥体几何（不再两交叉平面）/ 锥顶贴光源的朝向不变量 / 材质混合契约 /
// shader 色调映射接线（防 ACES 旁路回归）。
// 挂载-卸载-重建状态机用例留在 light-capability.test.ts（ADR-177 既定契约位）。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { VolumetricCone } from "./light-cone.ts";
import { DEFAULT_LIGHT_PARAMS, type LightInstanceParams, type VolumetricParams } from "./light-presets.ts";

const CONE_NAME = "ysm-light-volumetric-cone";
const HEIGHT = 8;
const SPOT_POS = new THREE.Vector3(0, 8, 0);
const SP: LightInstanceParams = { ...DEFAULT_LIGHT_PARAMS.key, type: "spot", enabled: true };
const VM: VolumetricParams = { ...DEFAULT_LIGHT_PARAMS.volumetric, enabled: true };

/** 建锥 + 挂载，返回可直接做几何断言的 group（世界矩阵已刷新）。 */
function makeCone(dir?: THREE.Vector3): {
  scene: THREE.Scene;
  cone: VolumetricCone;
  group: THREE.Group;
} {
  const scene = new THREE.Scene();
  const cone = new VolumetricCone(scene);
  cone.rebuild(HEIGHT, SP, VM, SPOT_POS, dir);
  cone.attach(SPOT_POS, dir);
  const group = scene.getObjectByName(CONE_NAME) as THREE.Group;
  group.updateMatrixWorld(true);
  return { scene, cone, group };
}

function meshOf(group: THREE.Group): THREE.Mesh {
  return group.children[0] as THREE.Mesh;
}

/** 锥底半径（与 rebuild 内公式同源）：height · tan(半角) · (1 + penumbra/2) */
function expectedBaseRadius(height: number, sp: LightInstanceParams): number {
  return height * Math.tan(THREE.MathUtils.degToRad(sp.angle)) * (1 + sp.penumbra * 0.5);
}

describe("VolumetricCone — 真锥体几何", () => {
  it("单个 ConeGeometry（不再是两交叉 PlaneGeometry）", () => {
    const { group } = makeCone();
    expect(group.children).toHaveLength(1); // layout-assert: 锥体 = 恰 1 个 ConeGeometry mesh（产品决策：单锥体，非交叉面片）
    const mesh = meshOf(group);
    expect(mesh.geometry.type).toBe("ConeGeometry");
  });

  it("几何参数与锥角/半影/高度一致，且无底面封盖", () => {
    const { group } = makeCone();
    const params = (meshOf(group).geometry as THREE.ConeGeometry).parameters;
    expect(params.height).toBe(HEIGHT);
    expect(params.radius).toBeCloseTo(expectedBaseRadius(HEIGHT, SP), 5);
    expect(params.radialSegments).toBe(48);
    // openEnded：光柱不封底，否则对象上方浮出一片亮盘
    expect(params.openEnded).toBe(true);
  });

  it("高度/锥角变化反映到新几何", () => {
    const scene = new THREE.Scene();
    const cone = new VolumetricCone(scene);
    const sp40: LightInstanceParams = { ...SP, angle: 40 };
    cone.rebuild(12, sp40, VM, new THREE.Vector3(0, 12, 0));
    cone.attach(new THREE.Vector3(0, 12, 0));
    const params = (
      (scene.getObjectByName(CONE_NAME) as THREE.Group).children[0] as THREE.Mesh
    ).geometry as THREE.ConeGeometry;
    expect(params.parameters.height).toBe(12);
    expect(params.parameters.radius).toBeCloseTo(expectedBaseRadius(12, sp40), 5);
  });
});

describe("VolumetricCone — 朝向不变量", () => {
  it("默认（垂直向下）：锥顶贴光源、锥底落在靶点，且不引入旋转", () => {
    const { group } = makeCone();
    const apex = group.localToWorld(new THREE.Vector3(0, HEIGHT / 2, 0));
    const baseCenter = group.localToWorld(new THREE.Vector3(0, -HEIGHT / 2, 0));
    expect(apex.distanceTo(SPOT_POS)).toBeCloseTo(0, 6);
    // target 在 (0,0,0)：锥底恰落在对象所在平面
    expect(baseCenter.length()).toBeCloseTo(0, 6);
    // 旧行为逐像素等价：局部 +Y 正对下方射束反向 → 单位四元数
    expect(group.quaternion.w).toBeCloseTo(1, 6);
  });

  it("倾斜射束：锥体沿方向延伸（不再把「恒垂直向下」写死进几何）", () => {
    const dir = new THREE.Vector3(1, -1, 0.5).normalize();
    const { group } = makeCone(dir);
    const apex = group.localToWorld(new THREE.Vector3(0, HEIGHT / 2, 0));
    const baseCenter = group.localToWorld(new THREE.Vector3(0, -HEIGHT / 2, 0));
    // 锥顶恒在光源
    expect(apex.distanceTo(SPOT_POS)).toBeCloseTo(0, 6);
    // 锥底中心 = 光源 + 锥高 · 射束方向
    expect(baseCenter.distanceTo(SPOT_POS.clone().addScaledVector(dir, HEIGHT))).toBeCloseTo(0, 6);
    // 局部 +Y（锥顶指向）对齐射束反向
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    expect(localUp.distanceTo(dir.clone().negate())).toBeCloseTo(0, 6);
  });

  it("退化射束方向（光源与靶点重合）兜底为垂直向下", () => {
    const { group } = makeCone(new THREE.Vector3(0, 0, 0));
    expect(group.position.y).toBeCloseTo(SPOT_POS.y - HEIGHT / 2, 6);
    expect(group.quaternion.w).toBeCloseTo(1, 6);
  });

  it("syncPosition 同步位置与朝向（setTarget 路径）", () => {
    const { cone, group } = makeCone();
    const newPos = new THREE.Vector3(5, 9, -2);
    const dir = new THREE.Vector3(-0.3, -1, 0.2).normalize();
    cone.syncPosition(newPos, dir);
    group.updateMatrixWorld(true);
    const apex = group.localToWorld(new THREE.Vector3(0, HEIGHT / 2, 0));
    expect(apex.distanceTo(newPos)).toBeCloseTo(0, 6);
  });
});

describe("VolumetricCone — 材质与 shader 契约", () => {
  it("加色透明 + 不写深度 + 双面（体积感）", () => {
    const { group } = makeCone();
    const mat = meshOf(group).material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.depthWrite).toBe(false);
    expect(mat.depthTest).toBe(true);
    expect(mat.side).toBe(THREE.DoubleSide);
    // toneMapped 决定 renderer 是否注入 TONE_MAPPING 宏（关掉即回到 ACES 旁路）
    expect(mat.toneMapped).toBe(true);
  });

  it("片元 shader 补上 tonemapping + 输出色彩空间转换（ACES 旁路回归锁）", () => {
    const { group } = makeCone();
    const frag = (meshOf(group).material as THREE.ShaderMaterial).fragmentShader;
    expect(frag).toContain("#include <tonemapping_fragment>");
    expect(frag).toContain("#include <colorspace_fragment>");
  });

  it("片元 shader 用视角相关 Fresnel 边缘辉光（取代平面径向剪影 mask）", () => {
    const { group } = makeCone();
    const mat = meshOf(group).material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).toContain("cameraPosition");
    expect(mat.fragmentShader).toContain("fresnel");
    // 平面剪影时代的径向 mask 与配套 uniform 已退役（真锥体不需要 discard 抠形）
    expect(mat.fragmentShader).not.toContain("uBaseRadius");
    expect(mat.fragmentShader).not.toContain("rAtH");
    expect(mat.vertexShader).toContain("vWorldNormal");
  });

  it("updateUniforms 原地刷新 uniforms，不重建几何", () => {
    const { cone, group } = makeCone();
    const mesh = meshOf(group);
    const uuidBefore = mesh.geometry.uuid;
    cone.updateUniforms(
      { ...SP, color: 0xff8800 },
      { ...VM, opacity: 0.9, fogPower: 2.2, tipStrength: 0.5 },
    );
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    expect((u.uColor.value as THREE.Color).getHex()).toBe(0xff8800);
    expect(u.uMaxAlpha.value).toBe(0.9);
    expect(u.uFogPower.value).toBe(2.2);
    expect(u.uTipStrength.value).toBe(0.5);
    expect(mesh.geometry.uuid).toBe(uuidBefore);
  });
});

describe("VolumetricCone — 生命周期", () => {
  it("spotlight / volumetric 未双开时不产出锥组", () => {
    const scene = new THREE.Scene();
    const cone = new VolumetricCone(scene);
    cone.rebuild(HEIGHT, { ...SP, enabled: false }, VM, SPOT_POS);
    expect(cone.hasGroup()).toBe(false);
    cone.rebuild(HEIGHT, SP, { ...VM, enabled: false }, SPOT_POS);
    expect(cone.hasGroup()).toBe(false);
    expect(scene.getObjectByName(CONE_NAME)).toBeUndefined();
  });

  it("rebuild 换新实例后脱离场景，attach 幂等重挂，detach 可卸载", () => {
    const { cone } = makeCone();
    expect(cone.isMounted()).toBe(true);
    cone.rebuild(HEIGHT, SP, VM, SPOT_POS);
    expect(cone.hasGroup()).toBe(true);
    expect(cone.isMounted()).toBe(false); // 新实例默认脱离场景
    cone.attach(SPOT_POS);
    expect(cone.isMounted()).toBe(true);
    cone.attach(SPOT_POS); // 幂等
    expect(cone.isMounted()).toBe(true);
    cone.detach();
    expect(cone.isMounted()).toBe(false);
  });

  it("dispose 释放锥组且幂等", () => {
    const { scene, cone } = makeCone();
    cone.dispose();
    expect(cone.hasGroup()).toBe(false);
    expect(scene.getObjectByName(CONE_NAME)).toBeUndefined();
    expect(() => cone.dispose()).not.toThrow();
  });
});
