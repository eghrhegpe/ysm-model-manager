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
// 口径（详见语料 $semantics）：
//   · positions/normals/uvs/indices/localPosition/texIdx/id/boneId 精确比对
//     （IEEE754 加减乘除跨语言逐位一致）
//   · localRotation 走 1e-9 容差（eulerToQuaternion 含 cos/sin/sqrt，JS Math 由实现
//     定义，可差 1 ULP；1e-9 远小于任何真实公式改动量级，不影响抓漂移）
//   · 特殊浮点以字符串哨兵 "nan"/"inf"/"-inf" 表达（JSON 无此字面量），双端各自映射
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

/** 精确比对（IEEE754 四则运算跨语言逐位一致，无需容差） */
function expectExact(label: string, got: number[], want: number[]): void {
  expect(got.length, `${label} 长度`).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    expect(got[i], `${label}[${i}] got=${got[i]} want=${want[i]}`).toBe(want[i]);
  }
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

      // localRotation：唯一走容差的一项（见文件头口径）
      for (let i = 0; i < 4; i++) {
        expect(
          Math.abs((g.localRotation as number[])[i]! - c.golden.localRotation[i]),
          `localRotation[${i}] got=${g.localRotation[i]} want=${c.golden.localRotation[i]}`,
        ).toBeLessThanOrEqual(1e-9);
      }
    });
  }
});
