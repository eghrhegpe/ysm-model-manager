// @vitest-environment node
// ===== bone-list.ts 契约测试 =====
// 覆盖：getBoneList 组件索引三语义（缺省 0 = 第一组件 / >=0 指定组件 / <0 全合并）、
// 越界钳制、空 spec 防御、compKey groupId 口径（跨组件同名骨骼精确定位）。
import { describe, it, expect } from "vitest";
import { getBoneList } from "./bone-list.ts";
import type { Spec3D } from "./model3d.ts";

/** 最小合法 SpecBone3D（getBoneList 只消费 id/name/parentId） */
function bone(id: string, extra: { name?: string; parentId?: string } = {}) {
  return {
    id,
    name: extra.name ?? id,
    ...(extra.parentId ? { parentId: extra.parentId } : {}),
    localPosition: [0, 0, 0],
    localRotation: [0, 0, 0],
  };
}

const SPEC: Spec3D = {
  models: [
    { id: "main", bones: [bone("root"), bone("head", { parentId: "root" })] },
    { id: "arm", bones: [bone("root", { name: "rootArm" })] },
  ],
};

describe("getBoneList", () => {
  it("缺省 modelIdx=0 → 第一组件（向后兼容 v1 单组件语义），groupId = compKey(0,id)", () => {
    expect(getBoneList(SPEC)).toEqual([
      { id: "root", name: "root", parentId: undefined, groupId: "0:root" },
      { id: "head", name: "head", parentId: "root", groupId: "0:head" },
    ]);
  });

  it("modelIdx=1 → 指定第二组件，parentId 缺省透传 undefined", () => {
    expect(getBoneList(SPEC, 1)).toEqual([
      { id: "root", name: "rootArm", parentId: undefined, groupId: "1:root" },
    ]);
  });

  it("modelIdx=-1 → 全部组件合并（多组件「全部」视图）", () => {
    const list = getBoneList(SPEC, -1);
    expect(list).toHaveLength(3);
    expect(list.map((b) => b.groupId)).toEqual(["0:root", "0:head", "1:root"]);
    expect(list.map((b) => b.name)).toEqual(["root", "head", "rootArm"]);
  });

  it("modelIdx=-5 → 与 -1 同（<0 即全部）", () => {
    expect(getBoneList(SPEC, -5).map((b) => b.groupId)).toEqual([
      "0:root",
      "0:head",
      "1:root",
    ]);
  });

  it("modelIdx 越界 → 钳制到最后一个组件", () => {
    const list = getBoneList(SPEC, 99);
    expect(list).toHaveLength(1);
    expect(list[0].groupId).toBe("1:root");
  });

  it("跨组件同名骨骼靠 groupId 精确定位（compKey 唯一性）", () => {
    const spec: Spec3D = {
      models: [{ bones: [bone("b")] }, { bones: [bone("b")] }],
    };
    const list = getBoneList(spec, -1);
    expect(list.map((b) => b.groupId)).toEqual(["0:b", "1:b"]);
    expect(new Set(list.map((b) => b.groupId)).size).toBe(2);
  });

  it("空 spec / 空 models / 无 bones → 空列表（不抛）", () => {
    expect(getBoneList({})).toEqual([]);
    expect(getBoneList({ models: [] })).toEqual([]);
    expect(getBoneList({ models: [] }, -1)).toEqual([]);
    expect(getBoneList({ models: [{}] })).toEqual([]);
    expect(getBoneList({ models: [{ bones: [] }] }, -1)).toEqual([]);
  });
});
