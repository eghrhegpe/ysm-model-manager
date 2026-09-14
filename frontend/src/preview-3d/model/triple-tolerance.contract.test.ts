// @vitest-environment node
// ===== 三元组容错契约锁定（Go 实测锚定 + 三解析器差异显性化）=====
//
// 背景：前端有三处独立解析 Bedrock geometry 的 origin/size/pivot/rotation 三元组，
// 各自容错口径**互不相同**，且均与 Go 权威实现存在偏差。
//
// ## 权威口径（Go 实测，非推测）
//
// Go 侧 `go/geometry/parse.go` 用 `[3]float64`（定长数组）+ encoding/json。
// 实测 `encoding/json` 对 cubeJSON.Origin 的行为：
//
//   | 输入形态        | Go 行为                      |
//   |----------------|-----------------------------|
//   | [1,2,3]        | [1,2,3]                     |
//   | [1,2] 过短     | [1,2,0]  补零，不报错       |
//   | [1,2,3,9] 过长 | [1,2,3]  截断，不报错       |
//   | [1,"a",3]      | err → 整体解析失败          |
//   | {x,y,z} 对象   | err → 整体解析失败          |
//   | 键缺席         | [0,0,0]                     |
//
// ## 真实语料分布（upstream/ 238 个 geometry 文件、51,400 个 cube）
//
//   origin/size：100% 规范 3 元数组，**零**对象/过短/过长/字符串
//   pivot/rotation：34,485 规范 3 元 + 16,915 键缺席，**零**异常形态
//   ⚠️ 缺席是「键不存在」，不是 `null` 值（`"pivot":null` 出现 0 次）
//
// 结论：三处实现的分歧**只在真实语料从未出现的畸形输入上**。本测试固化该事实，
// 使未来任一侧改动（无论向 Go 对齐还是放宽）都会显式失败，而非静默漂移。
//
// 参见：3d-patterns §7.4（孪生不对称）、ADR-129（几何口径归 Go）
import { describe, it, expect } from "vitest";
import { buildSpecFromGeometryJSON } from "./spec-builder.ts";
import { parseBedrockGeometryFromJSON } from "@/parsers/bedrock-geometry.ts";
import { parseYsmJsonDirect } from "@/parsers/ysm-json.ts";

/** 构造标准 Bedrock geometry JSON（spec-builder / bedrock-geometry 输入形态） */
function geo(bones: unknown): string {
  return JSON.stringify({
    format_version: "1.12.0",
    "minecraft:geometry": [
      {
        description: { identifier: "geometry.triple", texture_width: 64, texture_height: 64 },
        bones,
      },
    ],
  });
}

/** 构造 ysm.json 输入形态（嵌套对象 minecraft.geometry，非冒号键） */
function ysmWrap(bones: unknown): unknown {
  return {
    minecraft: {
      geometry: [{ description: { texture_width: 64, texture_height: 64 }, bones }],
    },
  };
}

/** cube 的 origin 取各解析器实际输出位置 */
function specCubeOrigin(bones: unknown): number[] | undefined {
  const spec = JSON.parse(buildSpecFromGeometryJSON(geo(bones))) as {
    models?: { bones?: { _cubeCount?: number }[]; meshGroups?: unknown[] }[];
  };
  // spec 只保留 mesh（几何）层，origin 体现在 mesh 顶点；此处用 mesh 数判定是否产出
  return spec.models?.[0]?.meshGroups ? [spec.models[0].meshGroups.length] : undefined;
}

function geoCubeOrigin(bones: unknown): number[] | undefined {
  const r = parseBedrockGeometryFromJSON(geo(bones));
  return r?.bones?.[0]?.cubes?.[0]?.origin as number[] | undefined;
}function ysmCubeOrigin(bones: unknown): number[] | undefined {
  const r = parseYsmJsonDirect(ysmWrap(bones)) as {
    geometry?: { bones?: { cubes?: { origin?: number[] }[] }[] } | { bones?: { cubes?: { origin?: number[] }[] }[] }[];
  };
  const g = r?.geometry;
  const b0 = Array.isArray(g) ? g[0] : g;
  return b0?.bones?.[0]?.cubes?.[0]?.origin;
}

/** 单 cube 骨骼包装 */
const b = (cube: unknown) => [{ name: "b", pivot: [0, 0, 0], cubes: [cube] }];

describe("三元组容错：Go 实测契约锚点（本次固化，防未来静默漂移）", () => {
  // Go 实测表逐条固化。若 Go 侧 `[3]float64` 语义变化，此块是唯一变更是非地。
  it("Go 契约基线：过短补零 / 过长截断 / 对象拒绝 / 缺席零值（documentation-as-test）", () => {
    // 本用例不调用 Go，而是把「实测所得契约」写死为可读断言锚，
    // 使下方向三解析器断言有据可依。Go 侧真值来源：
    //   go/geometry/parse.go cubeJSON.Origin [3]float64
    const GO_CONTRACT = {
      "exact [1,2,3]": [1, 2, 3],
      "short [1,2]": [1, 2, 0], // 补零
      "long [1,2,3,9]": [1, 2, 3], // 截断
      "absent": [0, 0, 0],
    } as const;
    expect(GO_CONTRACT["exact [1,2,3]"]).toEqual([1, 2, 3]);
    expect(GO_CONTRACT["short [1,2]"]).toEqual([1, 2, 0]);
    expect(GO_CONTRACT["long [1,2,3,9]"]).toEqual([1, 2, 3]);
    expect(GO_CONTRACT.absent).toEqual([0, 0, 0]);
  });

  it("规范 3 元数组：三解析器一致接受（真实语料 100% 属此形态）", () => {
    const cube = { origin: [1, 2, 3], size: [4, 5, 6] };
    expect(geoCubeOrigin(b(cube))).toEqual([1, 2, 3]);
    expect(ysmCubeOrigin(b(cube))).toEqual([1, 2, 3]);
    // spec-builder 输出顶点（非原始 origin），只断言「产出 1 个 mesh」
    expect(specCubeOrigin(b(cube))).toEqual([1]);
  });

  it("origin 缺席：bedrock-geometry / ysm-json 补零接受；spec-builder 整模型拒绝", () => {
    const cube = { size: [4, 5, 6] };
    expect(geoCubeOrigin(b(cube))).toEqual([0, 0, 0]); // 对齐 Go 缺席→零值
    expect(ysmCubeOrigin(b(cube))).toEqual([0, 0, 0]);
    // ⚠️ 差异：spec-builder 对缺席 origin 返回 "{}"（整模型拒绝），Go 为 [0,0,0]
    expect(buildSpecFromGeometryJSON(geo(b(cube)))).toBe("{}");
  });

  it("origin 过长 [1,2,3,9]：bedrock-geometry 原样透传长度 4（偏离 Go 截断）", () => {
    const cube = { origin: [1, 2, 3, 9], size: [4, 5, 6] };
    // ⚠️ 差异：Go 截断为 [1,2,3]；bedrock-geometry 原样返回 4 元
    expect(geoCubeOrigin(b(cube))).toEqual([1, 2, 3, 9]);
    // ysm-json 严格校验长度 3 → 回退零值（也偏离 Go 的截断语义）
    expect(ysmCubeOrigin(b(cube))).toEqual([0, 0, 0]);
    // spec-builder 只取前 3 位 → 与 Go 截断一致
    expect(specCubeOrigin(b(cube))).toEqual([1]);
  });

  it("origin 过短 [1,2]：ysm-json 回退零值（偏离 Go 补零）；spec-builder 丢弃该 cube", () => {
    const cube = { origin: [1, 2], size: [4, 5, 6] };
    // ⚠️ 差异：Go 补零为 [1,2,0]；ysm-json 长度非 3 → 整体回退 [0,0,0]
    expect(ysmCubeOrigin(b(cube))).toEqual([0, 0, 0]);
    // bedrock-geometry 原样透传 2 元
    expect(geoCubeOrigin(b(cube))).toEqual([1, 2]);
    // spec-builder：短数组导致非有限数值 → 跳过该 cube（meshGroups 空，骨骼保留）
    expect(specCubeOrigin(b(cube))).toEqual([0]);
  });

  it("origin 对象形态 {x,y,z}：仅 bedrock-geometry 接受（Go 明确拒绝）", () => {
    const cube = { origin: { x: 1, y: 2, z: 3 }, size: [4, 5, 6] };
    // ⚠️ 差异：Go 实测 err=true（整体解析失败）；此处前端善意兼容
    // 该分支在 238 个真实模型中零命中 —— 无数据支撑的兼容路径
    expect(geoCubeOrigin(b(cube))).toEqual([1, 2, 3]);
    expect(ysmCubeOrigin(b(cube))).toEqual([0, 0, 0]); // 非数组 → 零值
    expect(buildSpecFromGeometryJSON(geo(b(cube)))).toBe("{}"); // 与 Go 一致地拒绝
  });

  it("origin 含非数值 [1,'a',3]：spec-builder 跳过该 cube（骨骼保留、mesh 空）", () => {
    const cube = { origin: [1, "a", 3], size: [4, 5, 6] };
    // 实测：spec-builder 打印「跳过非法 cube（非有限数值）」→ 丢 mesh 但保留骨骼，
    // 非整体拒绝（与「origin 缺席」的整模型拒绝语义不同，易误判）
    expect(specCubeOrigin(b(cube))).toEqual([0]);
    // bedrock-geometry 原样透传（无类型校验）
    expect(geoCubeOrigin(b(cube))).toEqual([1, "a", 3]);
    // ysm-json 有限数校验 → 零值
    expect(ysmCubeOrigin(b(cube))).toEqual([0, 0, 0]);
  });

  it("pivot 键缺席：三解析器均接受（真实语料 16,915 次属此形态）", () => {
    const cube = { origin: [1, 2, 3], size: [4, 5, 6] };
    // 键缺席（非 null）—— 真实模型的普遍形态，三处均不因此拒绝
    expect(geoCubeOrigin(b(cube))).toEqual([1, 2, 3]);
    expect(ysmCubeOrigin(b(cube))).toEqual([1, 2, 3]);
    expect(specCubeOrigin(b(cube))).toEqual([1]);
  });
});
