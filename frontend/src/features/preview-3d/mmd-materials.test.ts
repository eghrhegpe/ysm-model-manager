// @vitest-environment node
// ===== MMD 材质工具层测试（features/preview-3d/mmd-materials.ts）=====
// 覆盖：列表（name + 索引）、显隐（set/toggle/越界）、透明度（opacity + transparent 联动）、
// 详情（name/visible/opacity/specular/shininess + 越界 null）。
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  listMmdMaterials,
  setMmdMaterialVisible,
  toggleMmdMaterialVisible,
  setMmdMaterialOpacity,
  getMmdMaterialDetail,
} from "./mmd-materials.ts";

const PMX_MATS = [{ name: "身体" }, { name: "头发" }, { name: "裙子" }];

/** 与 PMX 索引对齐的材质数组（MMDToonMaterial 继承 MeshPhongMaterial，用其验证 specular/shininess） */
function makeMaterials(): THREE.Material[] {
  return PMX_MATS.map(() => new THREE.MeshPhongMaterial({ color: 0xffffff }));
}

describe("listMmdMaterials", () => {
  it("pmx.materials name + 索引（与 mesh.material 对齐）", () => {
    expect(listMmdMaterials(PMX_MATS)).toEqual([
      { index: 0, name: "身体" },
      { index: 1, name: "头发" },
      { index: 2, name: "裙子" },
    ]);
  });
});

describe("setMmdMaterialVisible / toggle", () => {
  it("set 显隐 + toggle 切换返回新状态 + 越界 false", () => {
    const mats = makeMaterials();
    setMmdMaterialVisible(mats, 1, false);
    expect(mats[1].visible).toBe(false);
    expect(toggleMmdMaterialVisible(mats, 1)).toBe(true);
    expect(toggleMmdMaterialVisible(mats, 1)).toBe(false);
    expect(toggleMmdMaterialVisible(mats, 99)).toBe(false); // 越界
  });
});

describe("setMmdMaterialOpacity", () => {
  it("opacity 设置 + 夹取 0-1 + transparent 联动（<1 置 true）", () => {
    const mats = makeMaterials();
    setMmdMaterialOpacity(mats, 0, 0.5);
    expect(mats[0].opacity).toBe(0.5);
    expect(mats[0].transparent).toBe(true);
    setMmdMaterialOpacity(mats, 0, 2);
    expect(mats[0].opacity).toBe(1); // 夹取
    setMmdMaterialOpacity(mats, 99, 0.5); // 越界 no-op
    expect(mats[0].opacity).toBe(1);
  });
});

describe("getMmdMaterialDetail", () => {
  it("详情：name/visible/opacity/specular/shininess（MeshPhongMaterial 有 specular/shininess）", () => {
    const mats = makeMaterials();
    mats[0].visible = false;
    mats[1].opacity = 0.5;
    mats[1].transparent = true;
    const d = getMmdMaterialDetail(PMX_MATS, mats, 1)!;
    expect(d.name).toBe("头发");
    expect(d.visible).toBe(true);
    expect(d.opacity).toBe(0.5);
    expect(d.transparent).toBe(true);
    expect(d.specular).toBeInstanceOf(THREE.Color);
    expect(typeof d.shininess).toBe("number");
    expect(getMmdMaterialDetail(PMX_MATS, mats, 0)!.visible).toBe(false);
  });

  it("越界 index → null", () => {
    const mats = makeMaterials();
    expect(getMmdMaterialDetail(PMX_MATS, mats, 99)).toBeNull();
    expect(getMmdMaterialDetail(PMX_MATS, mats, -1)).toBeNull();
  });
});
