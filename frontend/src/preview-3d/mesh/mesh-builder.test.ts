import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { addMeshToBoneGroup } from "./mesh-builder.ts";
import type { SpecMeshGroup3D } from "./model3d.ts";

const meshData: SpecMeshGroup3D = {
  boneId: "root",
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  uvs: [0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2],
  localPosition: [0, 0, 0],
  localRotation: [0, 0, 0, 1],
};

function rgbaTexture(alpha: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, alpha]),
    1,
    1,
    THREE.RGBAFormat,
  );
  texture.needsUpdate = true;
  return texture;
}

describe("YSM material alpha partition", () => {
  it("keeps an opaque texture out of Three.js transparent sorting", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(255)], 0, false);

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const geometry = (bone.children[0] as THREE.Mesh).geometry;
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(geometry.boundingBox).not.toBeNull();
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it("keeps genuine partial alpha in the transparent render path", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false);

    // blend 双 pass：children[0]=BackSide depth, children[1]=FrontSide blend
    const material = (bone.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });

  it("renders binary alpha as an opaque cutout without transparent sorting", () => {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255, 255, 255, 255, 0]),
      2,
      1,
      THREE.RGBAFormat,
    );
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [texture], 0, false);

    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(false);
    expect(material.alphaTest).toBe(0.1);
    expect(material.depthWrite).toBe(true);
  });

  it("越界不静默贴错图：灰色占位 + console.error（兜底根除）", () => {
    const other = rgbaTexture(255);
    const bone = new THREE.Group();
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    try {
      // 全局回退路径（compTexArr 空）+ md.texIdx=2 越界 arr 长 2：旧行为扫数组贴第一张
      // （贴错皮肤还装没事，wine_fox 多组件渲染错乱的帮凶）；现行为灰色诚实占位 + 明确报错
      addMeshToBoneGroup(bone, { ...meshData, texIdx: 2 }, [], 0, true, [other, null]);
    } finally {
      spy.mockRestore();
    }
    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBeNull(); // 绝不贴别的图
    expect(material.color.getHex()).toBe(0xcccccc); // 灰色占位
    expect(errors).toHaveLength(1);
  });

  it("uses the per-component local slot 0 instead of the global md.texIdx (code review P3)", () => {
    const comp = rgbaTexture(255);
    const bone = new THREE.Group();
    const warnings: unknown[][] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    try {
      // compTexArr 非空（组件自己的纹理，长度 1）+ md.texIdx=6（全局槽位越界）：
      // 修复前混用索引空间 → 越界品红误报 + fallback 数组扫描；修复后局部索引 0 直接命中
      addMeshToBoneGroup(bone, { ...meshData, texIdx: 6 }, [comp], 0, true);
    } finally {
      spy.mockRestore();
    }
    const material = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(material.map).toBe(comp);
    expect(warnings).toHaveLength(0); // per-component 正常路径不误报 warning
  });

  it("applies the face-level mode override over the whole-texture mode", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(255)], 0, false, [], "blend");

    // blend 双 pass：children[0]=BackSide depth, children[1]=FrontSide blend
    const blendMat = (bone.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(blendMat.transparent).toBe(true);
    expect(blendMat.depthWrite).toBe(false);

    const cutoutBone = new THREE.Group();
    addMeshToBoneGroup(cutoutBone, meshData, [rgbaTexture(128)], 0, false, [], "cutout");
    const cutoutMat = (cutoutBone.children[0] as THREE.Mesh)
      .material as THREE.MeshBasicMaterial;
    expect(cutoutMat.transparent).toBe(false);
    expect(cutoutMat.alphaTest).toBe(0.1);
    expect(cutoutMat.depthWrite).toBe(true);
  });
});

describe("blend 双 pass 渲染层契约（方案 E）", () => {
  it("blend mode 创建 2 个 mesh：BackSide depth + FrontSide blend", () => {
    const bone = new THREE.Group();
    // alpha=128 → 真半透 → blend mode
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false, [], "blend");

    expect(bone.children).toHaveLength(2);
  });

  it("Pass 1: BackSide + depthWrite=true（写深度，挡背面）", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false, [], "blend");

    const depthMesh = bone.children[0] as THREE.Mesh;
    const depthMat = depthMesh.material as THREE.MeshBasicMaterial;
    expect(depthMat.side).toBe(THREE.BackSide);
    expect(depthMat.depthWrite).toBe(true);
    expect(depthMat.transparent).toBe(true);
    expect(depthMesh.renderOrder).toBe(1);
  });

  it("Pass 2: FrontSide + depthWrite=false（alpha 混合，不挡后续透明）", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false, [], "blend");

    const blendMesh = bone.children[1] as THREE.Mesh;
    const blendMat = blendMesh.material as THREE.MeshBasicMaterial;
    expect(blendMat.side).toBe(THREE.FrontSide);
    expect(blendMat.depthWrite).toBe(false);
    expect(blendMesh.renderOrder).toBe(2);
  });

  it("双 pass renderOrder 保证 depth pass 先于 blend pass 绘制", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false, [], "blend");

    const depthOrder = (bone.children[0] as THREE.Mesh).renderOrder;
    const blendOrder = (bone.children[1] as THREE.Mesh).renderOrder;
    expect(depthOrder).toBeLessThan(blendOrder);
  });

  it("opaque/cutout 保持单 mesh，不走双 pass", () => {
    const opaqueBone = new THREE.Group();
    addMeshToBoneGroup(opaqueBone, meshData, [rgbaTexture(255)], 0, false, [], "opaque");
    expect(opaqueBone.children).toHaveLength(1);

    const cutoutBone = new THREE.Group();
    // alpha=0 → 完全透明 → cutout path（alphaTest 剔除）
    const cutoutTex = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 0]),
      1,
      1,
      THREE.RGBAFormat,
    );
    cutoutTex.needsUpdate = true;
    addMeshToBoneGroup(cutoutBone, meshData, [cutoutTex], 0, false, [], "cutout");
    expect(cutoutBone.children).toHaveLength(1);
  });

  it("blend 双 pass 共享同一纹理（map 引用一致）", () => {
    const bone = new THREE.Group();
    const tex = rgbaTexture(128);
    addMeshToBoneGroup(bone, meshData, [tex], 0, false, [], "blend");

    const depthMat = (bone.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const blendMat = (bone.children[1] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(depthMat.map).toBe(tex);
    expect(blendMat.map).toBe(tex);
  });

  it("blend 双 pass 几何位置一致（同 localPosition/Rotation）", () => {
    const bone = new THREE.Group();
    addMeshToBoneGroup(bone, meshData, [rgbaTexture(128)], 0, false, [], "blend");

    const depthMesh = bone.children[0] as THREE.Mesh;
    const blendMesh = bone.children[1] as THREE.Mesh;
    expect(depthMesh.position).toEqual(blendMesh.position);
  });
});
