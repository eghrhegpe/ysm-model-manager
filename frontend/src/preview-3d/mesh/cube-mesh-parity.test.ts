// @vitest-environment node
// ===== 立方体几何双端对账（TS 消费侧）=====
// 黄金语料：tests/fixtures/parity/cube-mesh.golden.json（主源 = Go
// threejs/spec.go|buildCubeMeshData，regen：YSM_PARITY_REGEN=1 go test ./go/threejs
// -run TestCubeMeshParity）。本文件把同一 cube 入参喂给 TS 侧 buildCubeMeshData，
// 断言产出与黄金值一致——任一侧展开表漂移即对账失败。
//
// 为什么这块值得上机器守卫：cube UV 展开表 + 六面顶点序是**每个 cube 每面贴图方向**
// 的地基，且 JS/Go 各一份手抄。texture-order 的先例（cb1ce8d6d）已证明「两侧各有测试、
// 各自绿」证不了「两侧互等」——那一族真实分叉 3 处。cube 侧此前同样只有各自侧手算期望值。
//
// 口径（详见语料 $semantics，与 expectExact/sameRot 实现一致）：
//   · positions/normals/uvs/localPosition 及 indices/texIdx/id/boneId 走**逐位精确比对**：
//     全由加减乘构成，IEEE754 对同一运算顺序结果确定——有差异必然是两侧抄写的表达式/
//     结合序不同（非平台噪声），必须精确才抓得住。建语料初期（aaa3ac8b6）曾观测
//     zero-thickness-float-rounding 差 1 ULP 并以 1e-12 容差放行；后查明根因是 JS South
//     面结合序抄错（`u+z+x+z` vs Blockbench 权威 `u+sz+sz+sx`，c40c93040 对齐权威），
//     全语料恢复逐位相等，口径即恢复精确。
//   · 仅 localRotation 走 1e-9 相对容差（eulerToQuaternion 含 cos/sin/sqrt，跨实现可差
//     1 ULP，属真噪声）——见 sameRot 头注。
//   · 特殊浮点以字符串哨兵 "nan"/"inf"/"-inf" 表达（JSON 无此字面量），双端各自映射。
//   ⚠️ 勿为「让测试变绿」把精确项改回容差——那等于把抄写分叉永久藏起来。
import { describe, expect, it } from "vitest";
import { buildCubeMeshData } from "./cube-mesh.ts";
import type { Cube2D, Vec3 } from "@/preview-3d/model/spec-builder.ts";
import parityGolden from "../../../../tests/fixtures/parity/cube-mesh.golden.json" with { type: "json" };

type NumTok = number | "nan" | "inf" | "-inf";

interface GoldenMesh {
  id: string;
  boneId: string;
  localPosition: [number, number, number];
  localRotation: [number, number, number, number];
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  texIdx: number;
}

interface ParityCase {
  id: string;
  cube: {
    origin: NumTok[];
    size: NumTok[];
    pivot: NumTok[];
    pivotSet: boolean;
    uv: NumTok[];
    faceUV: string;
    rotation: NumTok[];
    texSlot: number;
    inflate: NumTok;
    mirror: boolean;
    cubeTexW: number;
    cubeTexH: number;
  };
  bonePivot: NumTok[];
  texW: NumTok;
  texH: NumTok;
  boneID: string;
  cubeIdx: number;
  golden: GoldenMesh | null;
}

/** 语料数值 → float：字符串哨兵映射为真实特殊值（与 Go fOf 同口径） */
function num(v: NumTok): number {
  if (typeof v === "number") return v;
  if (v === "nan") return Number.NaN;
  if (v === "inf") return Number.POSITIVE_INFINITY;
  if (v === "-inf") return Number.NEGATIVE_INFINITY;
  throw new Error(`cubeParity: 非法数值 ${String(v)}`);
}

function toVec3(a: NumTok[]): Vec3 {
  return { x: num(a[0]!), y: num(a[1]!), z: num(a[2]!) };
}

function toCube(c: ParityCase["cube"]): Cube2D {
  return {
    origin: [num(c.origin[0]!), num(c.origin[1]!), num(c.origin[2]!)],
    size: [num(c.size[0]!), num(c.size[1]!), num(c.size[2]!)],
    pivot: [num(c.pivot[0]!), num(c.pivot[1]!), num(c.pivot[2]!)],
    pivotSet: c.pivotSet,
    uv: [num(c.uv[0]!), num(c.uv[1]!)],
    faceUV: c.faceUV,
    rotation: [num(c.rotation[0]!), num(c.rotation[1]!), num(c.rotation[2]!)],
    texSlot: c.texSlot,
    inflate: num(c.inflate),
    mirror: c.mirror,
    cubeTexW: c.cubeTexW,
    cubeTexH: c.cubeTexH,
  };
}

/**
 * 逐位精确比对（**刻意不用容差**）。
 *
 * positions/normals/uvs/localPosition 全由加减乘构成，IEEE754 对同一运算顺序结果确定
 * ——有差异必然是两侧抄写的表达式/结合序不同，不是平台噪声，必须精确才抓得住。
 * 本语料正是靠精确比对抓到 JS South 面 `u+z+x+z` vs Go `u+sz+sz+sx` 的 1 ULP 分叉
 * （z=8、x=0.001 时两种结合序落在不同舍入粒度上；Blockbench 权威为 size[2]*2+size[0]，
 * 即 Go 正确、JS 抄错结合序，已修 JS）。
 * ⚠️ 若有人为了「让测试变绿」把这里改成相对容差，等于把这类抄写分叉永久藏起来。
 */
function expectExact(label: string, got: number[], want: number[]): void {
  expect(got.length, `${label} 长度`).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(got[i], `${label}[${i}] got=${got[i]} want=${want[i]}`).toBe(want[i]);
  }
}

/** localRotation 唯一走容差：eulerToQuaternion 含 cos/sin/sqrt，跨实现可差 1 ULP。 */
const ROT_EPS = 1e-9;
function sameRot(a: number, b: number): boolean {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  if (a === b) return true;
  return Math.abs(a - b) <= ROT_EPS * Math.max(Math.abs(a), Math.abs(b), 1);
}

describe("buildCubeMeshData 双端对账（黄金语料 tests/fixtures/parity，主源=Go）", () => {
  for (const c of parityGolden.cases as ParityCase[]) {
    it(c.id, () => {
      const got = buildCubeMeshData(
        toCube(c.cube),
        toVec3(c.bonePivot),
        num(c.texW),
        num(c.texH),
        c.boneID,
        c.cubeIdx,
      );

      if (c.golden === null) {
        // 守卫用例：两侧都必须判定为「拒绝产出」
        expect(got, "Go 主源返回 null，TS 侧也必须 null（守卫口径漂移）").toBeNull();
        return;
      }
      expect(got, "TS 侧意外返回 null（Go 主源有产出）").not.toBeNull();
      const g = got!;

      expect(g.id).toBe(c.golden.id);
      expect(g.boneId).toBe(c.golden.boneId);
      expect(g.texIdx).toBe(c.golden.texIdx);
      expectExact("localPosition", [...g.localPosition], [...c.golden.localPosition]);
      expectExact("positions", g.positions, c.golden.positions);
      expectExact("normals", g.normals, c.golden.normals);
      expectExact("uvs", g.uvs, c.golden.uvs);
      expect(g.indices, "indices 长度").toEqual(c.golden.indices);

      // localRotation：唯一走容差的一项（含 cos/sin/sqrt，见 sameRot 注释）
      for (let i = 0; i < 4; i++) {
        expect(
          sameRot((g.localRotation as number[])[i]!, c.golden.localRotation[i]),
          `localRotation[${i}] got=${g.localRotation[i]} want=${c.golden.localRotation[i]}`,
        ).toBe(true);
      }
    });
  }
});
