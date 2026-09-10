// ===== materials-shared 骨架测试（ADR-180；语义迁移自 mmd/vrm materials 双测试）=====
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  getMaterialDetailBase,
  listMaterials,
  setMaterialOpacity,
  setMaterialVisible,
  toggleMaterialVisible,
} from "./materials-shared.ts";

function makeMats(names: string[]): THREE.Material[] {
  return names.map((n) => {
    const m = new THREE.MeshStandardMaterial();
    if (n) m.name = n;
    return m;
  });
}

describe("listMaterials", () => {
  it("索引 + 名称（无 nameFn 取 mat.name）", () => {
    expect(listMaterials(makeMats(["头部", "身体"]))).toEqual([
      { index: 0, name: "头部" },
      { index: 1, name: "身体" },
    ]);
  });

  it("nameFn 参数化（VRM 回退「材质 #N」）", () => {
    const mats = makeMats(["", "身体"]);
    expect(
      listMaterials(mats, (m, i) => m.name || `材质 #${i + 1}`),
    ).toEqual([
      { index: 0, name: "材质 #1" },
      { index: 1, name: "身体" },
    ]);
  });

  it("空数组 → 空列表", () => {
    expect(listMaterials([])).toEqual([]);
  });
});

describe("setMaterialVisible / toggle", () => {
  it("设置 visible（越界 no-op 不崩）", () => {
    const mats = makeMats(["a"]);
    setMaterialVisible(mats, 0, false);
    expect(mats[0]!.visible).toBe(false);
    expect(() => setMaterialVisible(mats, 99, false)).not.toThrow();
    expect(() => setMaterialVisible(mats, -1, false)).not.toThrow();
  });

  it("toggle 返回切换后状态；越界返回 false", () => {
    const mats = makeMats(["a", "b"]);
    expect(toggleMaterialVisible(mats, 0)).toBe(false);
    expect(mats[0]!.visible).toBe(false);
    expect(toggleMaterialVisible(mats, 0)).toBe(true);
    expect(toggleMaterialVisible(mats, 99)).toBe(false);
  });
});

describe("setMaterialOpacity", () => {
  it("clamp 0-1 + transparent 联动；越界 no-op", () => {
    const mats = makeMats(["a"]);
    setMaterialOpacity(mats, 0, 0.5);
    expect(mats[0]!.opacity).toBe(0.5);
    expect(mats[0]!.transparent).toBe(true);
    setMaterialOpacity(mats, 0, 2);
    expect(mats[0]!.opacity).toBe(1);
    expect(mats[0]!.transparent).toBe(false); // 恢复 ≥1 → transparent 重置 false
    setMaterialOpacity(mats, 0, -0.5);
    expect(mats[0]!.opacity).toBe(0);
    expect(() => setMaterialOpacity(mats, 99, 0.5)).not.toThrow();
    expect(() => setMaterialOpacity(mats, -1, 0.5)).not.toThrow();
  });

  it("onChanged 回调（VRM needsUpdate 注入点）：带回调触发、不带不触发", () => {
    const mats = makeMats(["a"]);
    let calls = 0;
    setMaterialOpacity(mats, 0, 0.5, () => {
      calls++;
    });
    setMaterialOpacity(mats, 0, 0.3);
    setMaterialOpacity(mats, 0, 0.4, undefined);
    expect(calls).toBe(1); // 仅带回调的那次触发
    expect(mats[0]!.opacity).toBe(0.4);
  });
});

describe("getMaterialDetailBase", () => {
  it("提取共享字段", () => {
    const mats = makeMats(["a"]);
    mats[0]!.visible = false;
    mats[0]!.opacity = 0.3;
    mats[0]!.transparent = true;
    expect(getMaterialDetailBase(mats, 0)).toEqual({
      index: 0,
      name: "a",
      visible: false,
      opacity: 0.3,
      transparent: true,
    });
  });

  it("越界 / 空数组 → null", () => {
    const mats = makeMats(["a"]);
    expect(getMaterialDetailBase(mats, 99)).toBeNull();
    expect(getMaterialDetailBase(mats, -1)).toBeNull();
    expect(getMaterialDetailBase([], 0)).toBeNull();
  });
});
