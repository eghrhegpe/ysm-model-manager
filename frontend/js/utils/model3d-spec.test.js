// ===== model3d-spec 黄金样本测试（JS 兜底算法 ↔ Go threejs.Build 口径对齐）=====
// 用例镜像 go/threejs/spec_test.go：同名骨骼 overwrite、mergeCubes、相对坐标口径。
// 任一侧口径漂移都会使 Go/JS 其中一套测试失败，双边锁定。
import { describe, it, expect } from "vitest";
import { buildSpecFromModel } from "./model3d-spec.ts";

/** 便捷构造：单骨骼模型 */
function singleBoneModel(cube) {
  return {
    texWidth: 64,
    texHeight: 64,
    bones: [{ name: "b1", pivot: [0, 0, 0], cubes: [cube] }],
  };
}

describe("buildSpecFromModel 黄金样本（对齐 Go threejs.Build）", () => {
  it("单 cube：origin/pivot 均为相对骨骼 pivot 的坐标（镜像 Go TestBuildSingleCube）", () => {
    const r = buildSpecFromModel(
      singleBoneModel({
        origin: [0, 0, 0],
        size: [8, 8, 8],
        pivot: [4, 4, 4],
        uv: [0, 0],
      }),
    );
    expect(r.meshes).toHaveLength(1);
    const m = r.meshes[0];
    expect(m.boneID).toBe("b1");
    // origin - bonePivot = [0,0,0]
    expect(m.origin).toEqual([0, 0, 0]);
    // cubePivot - bonePivot = [4,4,4]（= Go mesh localPosition）
    expect(m.pivot).toEqual([4, 4, 4]);
    expect(m.size).toEqual([8, 8, 8]);
    expect(m.cubeIdx).toBe(0);
    expect(r.texWidth).toBe(64);
    expect(r.texHeight).toBe(64);
  });

  it("非零骨骼 pivot：mesh 坐标相对骨骼 pivot（防 pivot 平移回归）", () => {
    const r = buildSpecFromModel({
      bones: [
        {
          name: "b1",
          pivot: [5, 2, -3],
          cubes: [
            { origin: [6, 4, -1], size: [2, 2, 2], pivot: [7, 5, 0], uv: [0, 0] },
          ],
        },
      ],
    });
    const m = r.meshes[0];
    // origin - bonePivot = [1, 2, 2]
    expect(m.origin).toEqual([1, 2, 2]);
    // cubePivot - bonePivot = [2, 3, 3]
    expect(m.pivot).toEqual([2, 3, 3]);
  });

  it("同名骨骼「无 parent→有 parent」：cube 整体替换（镜像 Go TestBuildDuplicateBoneMerge）", () => {
    const r = buildSpecFromModel({
      bones: [
        {
          name: "b1",
          pivot: [0, 0, 0],
          cubes: [
            { origin: [0, 0, 0], size: [2, 2, 2], pivot: [0, 0, 0], uv: [0, 0] },
          ],
        },
        {
          name: "b1",
          parent: "p1",
          pivot: [10, 0, 0],
          cubes: [
            { origin: [10, 0, 0], size: [2, 2, 2], pivot: [11, 0, 0], uv: [0, 0] },
          ],
        },
        { name: "p1", pivot: [0, 0, 0] },
      ],
    });
    // 整体替换：只剩带 parent 版本的 cube，而非 merge 出 2 个
    expect(r.meshes).toHaveLength(1);
    const m = r.meshes[0];
    expect(m.boneID).toBe("b1");
    // groupPivot 取带 parent 版本的 pivot [10,0,0]
    expect(m.origin).toEqual([0, 0, 0]); // 10-10
    expect(m.pivot).toEqual([1, 0, 0]); // 11-10（= Go mesh localPosition [1,0,0]）
  });

  it("同名骨骼均无 parent、cube 不重叠 → 合并保留（镜像 Go TestMergeCubes 追加）", () => {
    const r = buildSpecFromModel({
      bones: [
        {
          name: "b1",
          pivot: [0, 0, 0],
          cubes: [
            { origin: [0, 0, 0], size: [2, 2, 2], pivot: [1, 1, 1], uv: [0, 0] },
          ],
        },
        {
          name: "b1",
          pivot: [0, 0, 0],
          cubes: [
            { origin: [10, 0, 0], size: [2, 2, 2], pivot: [11, 1, 1], uv: [0, 0] },
          ],
        },
      ],
    });
    expect(r.meshes).toHaveLength(2);
    expect(r.meshes[0].pivot).toEqual([1, 1, 1]);
    expect(r.meshes[1].pivot).toEqual([11, 1, 1]);
  });

  it("重叠 cube（origin/size/rotation 全等）→ 替换保留新 UV（镜像 Go TestMergeCubes 替换）", () => {
    const r = buildSpecFromModel({
      bones: [
        {
          name: "b1",
          pivot: [0, 0, 0],
          cubes: [
            { origin: [0, 0, 0], size: [2, 2, 2], pivot: [1, 1, 1], uv: [0, 0] },
          ],
        },
        {
          name: "b1",
          pivot: [0, 0, 0],
          cubes: [
            { origin: [0, 0, 0], size: [2, 2, 2], pivot: [1, 1, 1], uv: [4, 4] },
          ],
        },
      ],
    });
    expect(r.meshes).toHaveLength(1);
    // UV 数值口径（归一化/面序）尚未与 Go 对齐，见缺陷清单；此处仅锁结构
    expect(r.meshes[0].uv).toHaveLength(6);
    expect(r.meshes[0].faceUV).toBe(false);
    expect(r.meshes[0].texIdx).toBe(0);
  });

  it("缺省纹理尺寸回退 64×64", () => {
    const r = buildSpecFromModel(
      singleBoneModel({ origin: [0, 0, 0], size: [1, 1, 1], uv: [0, 0] }),
    );
    expect(r.texWidth).toBe(64);
    expect(r.texHeight).toBe(64);
  });
});
