// @vitest-environment node
// ===== vrm-materials.ts 契约测试 =====
// 覆盖：listVrmMaterials（name 回退「材质 #N」）、setVrmMaterialVisible（越界 no-op）、
// setVrmMaterialOpacity（0-1 夹取 + transparent 联动不回退 + needsUpdate）、
// getVrmMaterialDetail（类型推断 mtoon/standard/basic/phong/unknown + 越界 null）。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  listVrmMaterials,
  setVrmMaterialVisible,
  setVrmMaterialOpacity,
  getVrmMaterialDetail,
} from "./vrm-materials.ts";

function makeMaterials(): THREE.Material[] {
  return [new THREE.MeshStandardMaterial({ name: "身体" }), new THREE.MeshBasicMaterial()];
}

describe("listVrmMaterials", () => {
  it("索引 + name 列表（与 scene 遍历顺序对齐）", () => {
    expect(listVrmMaterials(makeMaterials())).toEqual([
      { index: 0, name: "身体" },
      { index: 1, name: "材质 #2" }, // THREE.Material 默认 name 为空串 → 回退
    ]);
  });

  it("无名材质 → 回退「材质 #N」；空数组 → 空", () => {
    const mats = [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial({ name: "有名" })];
    expect(listVrmMaterials(mats)).toEqual([
      { index: 0, name: "材质 #1" },
      { index: 1, name: "有名" },
    ]);
    expect(listVrmMaterials([])).toEqual([]);
  });
});

describe("setVrmMaterialVisible", () => {
  it("设 true/false + 越界/负索引 no-op", () => {
    const mats = makeMaterials();
    setVrmMaterialVisible(mats, 0, false);
    expect(mats[0].visible).toBe(false);
    setVrmMaterialVisible(mats, 0, true);
    expect(mats[0].visible).toBe(true);

    setVrmMaterialVisible(mats, 99, false);
    setVrmMaterialVisible(mats, -1, false);
    expect(mats[0].visible).toBe(true);
    expect(mats[1].visible).toBe(true);
  });
});

describe("setVrmMaterialOpacity", () => {
  it("opacity 设置 + <1 联动 transparent + needsUpdate（version 自增，Material.needsUpdate 仅有 setter）", () => {
    const mats = makeMaterials();
    const versionBefore = mats[0].version;
    setVrmMaterialOpacity(mats, 0, 0.5);
    expect(mats[0].opacity).toBe(0.5);
    expect(mats[0].transparent).toBe(true);
    expect(mats[0].version).toBeGreaterThan(versionBefore); // needsUpdate=true → 重编译口径
  });

  it("夹取 0-1：>1 → 1（transparent 不误置）；<0 → 0；边界 0 触发 transparent", () => {
    const mats = makeMaterials();
    setVrmMaterialOpacity(mats, 0, 2);
    expect(mats[0].opacity).toBe(1);
    expect(mats[0].transparent).toBe(false); // opacity===1 不联动

    setVrmMaterialOpacity(mats, 0, -0.5);
    expect(mats[0].opacity).toBe(0);
    expect(mats[0].transparent).toBe(true);
  });

  it("transparent 不回退：0.5 → 1 后 transparent 仍 true", () => {
    const mats = makeMaterials();
    setVrmMaterialOpacity(mats, 0, 0.5);
    setVrmMaterialOpacity(mats, 0, 1);
    expect(mats[0].opacity).toBe(1);
    expect(mats[0].transparent).toBe(true);
  });

  it("越界 no-op（其余材质不受影响）", () => {
    const mats = makeMaterials();
    setVrmMaterialOpacity(mats, 99, 0.5);
    setVrmMaterialOpacity(mats, -1, 0.5);
    expect(mats[0].opacity).toBe(1);
    expect(mats[0].transparent).toBe(false);
    expect(mats[1].opacity).toBe(1);
  });
});

describe("getVrmMaterialDetail", () => {
  it("类型推断：name 含 mtoon 优先（ShaderMaterial + MToon 名）", () => {
    const mtoon = new THREE.ShaderMaterial();
    mtoon.name = "MToonBody";
    const d = getVrmMaterialDetail([mtoon], 0)!;
    expect(d.type).toBe("mtoon");
    expect(d.name).toBe("MToonBody");
  });

  it("type 推断：standard / basic / phong / unknown", () => {
    const mats: THREE.Material[] = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshBasicMaterial(),
      new THREE.MeshPhongMaterial(),
      new THREE.ShaderMaterial(),
    ];
    expect(getVrmMaterialDetail(mats, 0)!.type).toBe("standard");
    expect(getVrmMaterialDetail(mats, 1)!.type).toBe("basic");
    expect(getVrmMaterialDetail(mats, 2)!.type).toBe("phong");
    expect(getVrmMaterialDetail(mats, 3)!.type).toBe("unknown");
  });

  it("字段透传：visible/opacity/transparent + 无名回退「材质 #N」", () => {
    const mats = makeMaterials();
    mats[0].visible = false;
    mats[0].opacity = 0.25;
    mats[0].transparent = true;
    const d = getVrmMaterialDetail(mats, 0)!;
    expect(d).toEqual({
      index: 0,
      name: "身体",
      visible: false,
      opacity: 0.25,
      transparent: true,
      type: "standard",
    });
    expect(getVrmMaterialDetail([new THREE.MeshBasicMaterial()], 0)!.name).toBe("材质 #1");
  });

  it("越界 index → null", () => {
    const mats = makeMaterials();
    expect(getVrmMaterialDetail(mats, 99)).toBeNull();
    expect(getVrmMaterialDetail(mats, -1)).toBeNull();
    expect(getVrmMaterialDetail([], 0)).toBeNull();
  });
});
