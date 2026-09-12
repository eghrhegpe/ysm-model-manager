// ===== 纹理字节估算测试（刀⑬：补齐 MMD/VRM 的字节维度）=====
// 覆盖：单张估算口径（mip / 未就绪 / 非法）/ 集合去重 / 材质九槽收集 /
// 场景图遍历（**含 MMD/VRM 这类不进 textureCache 的纹理**）/ 快照读写。

import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  MIPMAP_CHAIN_FACTOR,
  __resetSceneTextureBytesForTest,
  collectMaterialTextures,
  estimateSceneTextureBytes,
  estimateTextureBytes,
  estimateTextureSetBytes,
  getLastSceneTextureBytes,
  setLastSceneTextureBytes,
} from "./texture-bytes.ts";

/** 造一张带尺寸的假纹理（image 为 happy-dom 元素/普通对象均可——估算只读 width/height） */
const tex = (w?: number, h?: number, extra: Partial<THREE.Texture> = {}): THREE.Texture => {
  const t = new THREE.Texture();
  if (w !== undefined && h !== undefined) {
    (t as unknown as { image: { width: number; height: number } }).image = {
      width: w,
      height: h,
    };
  } else {
    (t as unknown as { image: null }).image = null;
  }
  Object.assign(t, extra);
  return t;
};

beforeEach(() => {
  __resetSceneTextureBytesForTest();
});

describe("estimateTextureBytes", () => {
  it("默认 generateMipmaps=true → 含 mip 链（×4/3）", () => {
    const t = tex(1024, 1024);
    expect(t.generateMipmaps).toBe(true); // three 默认值
    expect(estimateTextureBytes(t)).toBe(Math.round(1024 * 1024 * 4 * MIPMAP_CHAIN_FACTOR));
  });

  it("generateMipmaps=false → 不计 mip 系数", () => {
    expect(estimateTextureBytes(tex(1024, 1024, { generateMipmaps: false }))).toBe(1024 * 1024 * 4);
  });

  it("image 未就绪（null / 尺寸 0）→ 0，不误报", () => {
    expect(estimateTextureBytes(tex())).toBe(0);
    expect(estimateTextureBytes(tex(0, 0))).toBe(0);
    expect(estimateTextureBytes(tex(512, 0))).toBe(0);
  });

  it("null / undefined → 0", () => {
    expect(estimateTextureBytes(null)).toBe(0);
    expect(estimateTextureBytes(undefined)).toBe(0);
  });

  it("4 张 4K 含 mip → 确定超 256MB 默认预算（补 mip 前是踩线态）", () => {
    const one = estimateTextureBytes(tex(4096, 4096));
    expect(one * 4).toBeGreaterThan(256 * 1024 * 1024);
  });
});

describe("estimateTextureSetBytes", () => {
  it("按实例去重：同一 Texture 出现多次只计一次（数组入参也保证去重）", () => {
    const a = tex(1024, 1024);
    const b = tex(512, 512);
    const dup = [a, b, a, a, b];
    expect(estimateTextureSetBytes(dup)).toBe(
      estimateTextureBytes(a) + estimateTextureBytes(b),
    );
  });

  it("空集合 → 0", () => {
    expect(estimateTextureSetBytes([])).toBe(0);
    expect(estimateTextureSetBytes(new Set())).toBe(0);
  });
});

describe("collectMaterialTextures", () => {
  it("收集九贴图槽的纹理实例", () => {
    const map = tex(64, 64);
    const normalMap = tex(32, 32);
    const mat = new THREE.MeshStandardMaterial(); // standard 才有 normalMap 槽
    mat.map = map;
    mat.normalMap = normalMap;
    expect(collectMaterialTextures(mat)).toEqual([map, normalMap]);
  });

  it("null 材质 → 空数组", () => {
    expect(collectMaterialTextures(null)).toEqual([]);
    expect(collectMaterialTextures(undefined)).toEqual([]);
  });

  it("槽位上的非纹理值被忽略（不误收）", () => {
    const mat = new THREE.MeshBasicMaterial() as unknown as Record<string, unknown>;
    mat.map = { notATexture: true };
    mat.normalMap = null;
    expect(collectMaterialTextures(mat as unknown as THREE.Material)).toEqual([]);
  });
});

describe("estimateSceneTextureBytes（全格式口径，含 MMD/VRM）", () => {
  it("遍历多 mesh × 多材质槽，按实例去重", () => {
    const shared = tex(1024, 1024);
    const matA = new THREE.MeshBasicMaterial();
    matA.map = shared; // 两 mesh 共享同一纹理 → 只计一次
    const matB = new THREE.MeshBasicMaterial();
    matB.map = tex(256, 256);

    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), matA));
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), matA));
    root.add(new THREE.Mesh(new THREE.BufferGeometry(), matB));

    expect(estimateSceneTextureBytes(root)).toBe(
      estimateTextureBytes(shared) + estimateTextureBytes(matB.map),
    );
  });

  it("材质数组（多材质 mesh）逐槽收集", () => {
    const m1 = new THREE.MeshBasicMaterial();
    m1.map = tex(128, 128);
    const m2 = new THREE.MeshBasicMaterial();
    m2.map = tex(64, 64);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [m1, m2]);
    const root = new THREE.Group();
    root.add(mesh);
    expect(estimateSceneTextureBytes(root)).toBe(
      estimateTextureBytes(m1.map) + estimateTextureBytes(m2.map),
    );
  });

  it("非 Mesh 对象（Group/Bone/Light）不参与收集", () => {
    const root = new THREE.Group();
    root.add(new THREE.Bone());
    expect(estimateSceneTextureBytes(root)).toBe(0);
  });

  it("null / undefined 场景 → 0", () => {
    expect(estimateSceneTextureBytes(null)).toBe(0);
    expect(estimateSceneTextureBytes(undefined)).toBe(0);
  });
});

describe("场景字节快照", () => {
  it("读写往返", () => {
    expect(getLastSceneTextureBytes()).toBe(0);
    setLastSceneTextureBytes(1234);
    expect(getLastSceneTextureBytes()).toBe(1234);
  });

  it("非法值（负数/NaN/Infinity）不覆盖为脏值（回落 0）", () => {
    setLastSceneTextureBytes(500);
    setLastSceneTextureBytes(-1);
    expect(getLastSceneTextureBytes()).toBe(0);
    setLastSceneTextureBytes(Number.NaN);
    expect(getLastSceneTextureBytes()).toBe(0);
    setLastSceneTextureBytes(Number.POSITIVE_INFINITY);
    expect(getLastSceneTextureBytes()).toBe(0);
  });

  it("__resetSceneTextureBytesForTest 复位", () => {
    setLastSceneTextureBytes(999);
    __resetSceneTextureBytesForTest();
    expect(getLastSceneTextureBytes()).toBe(0);
  });
});
