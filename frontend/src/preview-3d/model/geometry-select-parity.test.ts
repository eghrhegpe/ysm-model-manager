// @vitest-environment node
// ===== geometry 选择链双端对账（TS 消费侧，2026-10-11 审计 G-geometry 收口）=====
// 黄金语料：tests/fixtures/parity/geometry-select.golden.json（主源 = Go
// geometry/parse.go|ParseBedrockGeometry，regen：YSM_PARITY_REGEN=1 go test
// ./go/geometry -run TestGeometrySelectParity；沿 cube-mesh / texture-order
// parity 先例）。本文件把同一份 input 喂给**生产入口** buildSpecFromGeometryJSON
// （不手搓入参——选择链分叉的失效模式是「两侧各自改测试」，只有真入口+共享
// 语料才能锁住），断言选择链骨架与 Go 主源一致。
//
// 锁面 = 选择链骨架（选了哪条/哪个键、GUI 过滤后剩哪些骨、纹理尺寸钳制、
// null/空模型契约），不锁 cube 逐值（cube-mesh 语料射程）。
//
// 【为什么这块值得上机器守卫】spec-builder.ts|parseBedrockGeometry 是 Go
// parse.go 的手抄镜像（16db29a8d 已按 Go 四段同构对齐结构面），与
// texture-order/cube-mesh 同型的「两侧各有测试、不互对账」形态——那两族已被
// 实证出 3+1 处真实分叉。选择链分叉 = 桌面 Go 通道与网页兜底通道**渲染不同
// 模型**（同份 geometryRaw 跨通道选不同条目/键），比纹理序回退更严重。
import { describe, expect, it } from "vitest";
import { buildSpecFromGeometryJSON } from "./spec-builder.ts";
import type { ModelGroup } from "./spec-builder.ts";
import parityGolden from "../../../../tests/fixtures/parity/geometry-select.golden.json" with { type: "json" };

interface GSParityCase {
  id: string;
  $note?: string;
  input: string;
  expected: GSExpected | null;
}
interface GSBone {
  name: string;
  parent: string;
  cubeCount: number;
}
interface GSExpected {
  reject: boolean;
  texW?: number;
  texH?: number;
  textureId?: string | null;
  bones?: GSBone[];
  totalCubes?: number;
}

/** 从 spec 串提取选择链骨架（与 Go gsSkeleton 同字段面）。"{}" → null。
 *
 * 锁面含 textureId：D7 接线后双端语义对齐——TS `postProcessAndTextures` 复刻 Go
 * 条件下发 `tex_<idx>`，当前黄金语料走 ParseBedrockGeometry 不填 Textures、Go 侧产 nil，
 * 双端均 null，纳入锁面不会红。 */
function extractSkeleton(specStr: string): GSSkeleton | null {
  if (specStr === "{}") return null;
  const spec = JSON.parse(specStr) as { models?: ModelGroup[] };
  if (!spec.models || spec.models.length === 0) return null;
  const g = spec.models[0]!;
  const bones = (g.bones ?? []).map((b) => ({
    name: b.name,
    parent: b.parentId ?? "",
    cubeCount: b._cubeCount,
  }));
  return {
    texW: g.textureWidth,
    texH: g.textureHeight,
    textureId: g.textureId ?? null,
    bones,
    totalCubes: bones.reduce((s, b) => s + b.cubeCount, 0),
  };
}

interface GSSkeleton {
  texW: number;
  texH: number;
  textureId: string | null;
  bones: GSBone[];
  totalCubes: number;
}

describe("parseBedrockGeometry 选择链双端对账（黄金语料 tests/fixtures/parity，主源=Go）", () => {
  for (const c of parityGolden.cases as GSParityCase[]) {
    it(c.id, () => {
      const want = c.expected;
      if (want === null) {
        expect(want, `${c.id} 语料缺 expected（先 YSM_PARITY_REGEN=1 生成）`).not.toBeNull();
        return;
      }
      const got = extractSkeleton(buildSpecFromGeometryJSON(c.input));
      if (want.reject) {
        expect(got, `${c.id} 应为拒绝态（"{}"），实得骨架 ${JSON.stringify(got)}`).toBeNull();
        return;
      }
      expect(got, `${c.id} 非拒绝态却产出 "{}"`).not.toBeNull();
      // 逐位精确（字符串/整数/布尔，无容差——与 cube-mesh 语料同口径精神：
      // 骨架值若漂移必为两侧选择链抄写分叉，不是平台噪声）
      expect(got!.texW, "texW").toBe(want.texW ?? 0);
      expect(got!.texH, "texH").toBe(want.texH ?? 0);
      expect(got!.textureId, "textureId").toBe(want.textureId ?? null);
      const wantBones = want.bones ?? [];
      expect(got!.bones.map((b) => b.name), "bones 名序").toEqual(wantBones.map((b) => b.name));
      for (let i = 0; i < wantBones.length; i++) {
        const w = wantBones[i]!;
        const g = got!.bones[i]!;
        expect(g.parent, `bones[${i}].parent`).toBe(w.parent);
        expect(g.cubeCount, `bones[${i}].cubeCount`).toBe(w.cubeCount);
      }
      expect(got!.totalCubes, "totalCubes").toBe(want.totalCubes ?? 0);
    });
  }

  it("语料登记表未过期（新增用例须先 regen Go 侧）", () => {
    expect((parityGolden.cases as GSParityCase[]).length).toBeGreaterThan(0);
    // 全部用例必须带 expected（Go regen 产物）——「登记表未过期」的机器表达
    for (const c of parityGolden.cases as GSParityCase[]) {
      expect(c.expected, `${c.id} 语料缺 expected（先 YSM_PARITY_REGEN=1 生成）`).not.toBeNull();
    }
  });
});
