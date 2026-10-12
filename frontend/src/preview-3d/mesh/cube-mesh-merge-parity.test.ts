// @vitest-environment node
// ===== 族②残余：mergeCubes / computeBoneLocalPos 双端对账（TS 消费侧）=====
// 黄金语料：tests/fixtures/parity/cube-mesh.golden.json（与 cube-mesh-parity.test.ts 同一份，
// 主源 = Go threejs/spec.go|mergeCubes + spec-bones.go|buildBoneLocalData；regen：
// YSM_PARITY_REGEN=1 go test ./go/threejs -run TestCubeMeshParity）。
//
// 为什么单开一个消费文件：buildCubeMeshData 的 golden 消费在 cube-mesh-parity.test.ts，
// 本文件只消费新增的 boneLocalPosCases / mergeCubesCases 两域，职责分离、互不纠缠。
//
// 口径（详见语料 $semanticsBoneLocalPos / $semanticsMergeCubes，与实现一致）：
//   · computeBoneLocalPos：全由加减构成，**逐位精确比对**（无容差），任一侧抄写
//     结合序/符号漂移即抓。parentPivot=null 同时覆盖「根骨骼」与「声明父但父 pivot
//     缺失」（后者 Go 回落根公式、TS 消费方传 null，两侧同输出）。
//   · mergeCubes：**重叠判据走 cubeEpsilon=0.001 容差**（origin/size/rotation 三元
//     全部在容差内才算重叠，非逐位）；**输出 cube 全字段逐位精确比对**——mergeCubes
//     只做「引用搬运」不做运算，输出 cube 是某个输入 cube 的原样拷贝，有差异必然是
//     某条被替换/追加错了，必须精确才抓得住。
//   · 精确比对用 IEEE 相等（`===`），**-0 与 0 视为相等**：根骨骼 X 翻号在 pivot.x=0
//     时两侧都产出 -0（golden 亦记 -0，见 root-bone-zero-pivot），-0 与 0 数学恒等、
//     非抄写漂移信号——与 cube-mesh-parity.test.ts 的 sameRot 首行约定一致。
//   ⚠️ 勿为「让测试变绿」把输出 cube 改成容差——那等于把替换/追加语义的漂移藏起来。
import { describe, expect, it } from "vitest";
import { computeBoneLocalPos, mergeCubes } from "./cube-mesh.ts";
import type { Cube2D } from "@/preview-3d/model/spec-builder.ts";
import parityGolden from "../../../../tests/fixtures/parity/cube-mesh.golden.json" with { type: "json" };

type NumTok = number;

interface GoldenCube {
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
}

interface BoneLocalPosCase {
  id: string;
  bonePivot: NumTok[];
  parentPivot: NumTok[] | null;
  declaredParent: boolean;
  golden: NumTok[];
}

interface MergeCubesCase {
  id: string;
  old: GoldenCube[];
  new: GoldenCube[];
  golden: GoldenCube[];
}

function toVec3(a: NumTok[]): { x: number; y: number; z: number } {
  return { x: a[0]!, y: a[1]!, z: a[2]! };
}

function toCube(c: GoldenCube): Cube2D {
  return {
    origin: [c.origin[0]!, c.origin[1]!, c.origin[2]!],
    size: [c.size[0]!, c.size[1]!, c.size[2]!],
    pivot: [c.pivot[0]!, c.pivot[1]!, c.pivot[2]!],
    pivotSet: c.pivotSet,
    uv: [c.uv[0]!, c.uv[1]!],
    faceUV: c.faceUV,
    rotation: [c.rotation[0]!, c.rotation[1]!, c.rotation[2]!],
    texSlot: c.texSlot,
    inflate: c.inflate,
    mirror: c.mirror,
    cubeTexW: c.cubeTexW,
    cubeTexH: c.cubeTexH,
  };
}

/**
 * 逐位精确比对（刻意不用容差——mergeCubes 输出是输入 cube 的原样拷贝）。
 *
 * 用 IEEE 相等（`===`）而非 Object.is：`===` 把 -0 与 0 视为相等——这正是正确口径。
 * 例：根骨骼 X 翻号 `-bonePivot.x` 在 pivot.x=0 时两侧都产出 **-0**，golden 里 Go 也
 * 如实记 "-0"（root-bone-zero-pivot 用例）；而 -0 与 0 数学恒等、非抄写漂移信号。
 * 这同 cube-mesh-parity.test.ts 的 sameRot 首行约定（`if (a === b) return true`）
 * ——该侧 localRotation 同样在 golden 里出现 -0。真漂移（结合序/符号/表达式不同）
 * 在非零值上必然产生非零差，`===` 照样抓得住；NaN 单独守卫。
 */
function expectExact(label: string, got: number, want: number): void {
  if (Number.isNaN(got) || Number.isNaN(want)) {
    expect(Number.isNaN(got) && Number.isNaN(want), `${label} NaN 性 got=${got} want=${want}`).toBe(true);
    return;
  }
  expect(got === want, `${label} got=${got} want=${want}`).toBe(true);
}

describe("computeBoneLocalPos 双端对账（黄金语料，主源=Go buildBoneLocalData）", () => {
  for (const c of parityGolden.boneLocalPosCases as BoneLocalPosCase[]) {
    it(c.id, () => {
      const got = computeBoneLocalPos(
        toVec3(c.bonePivot),
        c.parentPivot === null ? null : toVec3(c.parentPivot),
      );
      const want = c.golden;
      expect(want.length, `${c.id} golden 长度`).toBe(3);
      expectExact(`${c.id}[0]`, got[0], want[0]!);
      expectExact(`${c.id}[1]`, got[1], want[1]!);
      expectExact(`${c.id}[2]`, got[2], want[2]!);
    });
  }
});

describe("mergeCubes 双端对账（黄金语料，主源=Go spec.go mergeCubes）", () => {
  for (const c of parityGolden.mergeCubesCases as MergeCubesCase[]) {
    it(c.id, () => {
      const got = mergeCubes(c.old.map(toCube), c.new.map(toCube));
      const want = c.golden;
      expect(got.length, `${c.id} 长度`).toBe(want.length);
      for (let i = 0; i < want.length; i++) {
        const label = `${c.id}[${i}]`;
        const g = got[i]!;
        const w = toCube(want[i]!);
        for (let k = 0; k < 3; k++) {
          expectExact(`${label}.origin[${k}]`, g.origin[k]!, w.origin[k]!);
          expectExact(`${label}.size[${k}]`, g.size[k]!, w.size[k]!);
          expectExact(`${label}.pivot[${k}]`, g.pivot[k]!, w.pivot[k]!);
          expectExact(`${label}.rotation[${k}]`, g.rotation[k]!, w.rotation[k]!);
        }
        expect(g.pivotSet, `${label}.pivotSet`).toBe(w.pivotSet);
        expectExact(`${label}.uv[0]`, g.uv[0]!, w.uv[0]!);
        expectExact(`${label}.uv[1]`, g.uv[1]!, w.uv[1]!);
        expect(g.faceUV, `${label}.faceUV`).toBe(w.faceUV);
        expect(g.texSlot, `${label}.texSlot`).toBe(w.texSlot);
        expectExact(`${label}.inflate`, g.inflate, w.inflate);
        expect(g.mirror, `${label}.mirror`).toBe(w.mirror);
        expect(g.cubeTexW, `${label}.cubeTexW`).toBe(w.cubeTexW);
        expect(g.cubeTexH, `${label}.cubeTexH`).toBe(w.cubeTexH);
      }
    });
  }
});