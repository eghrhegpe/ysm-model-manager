// @vitest-environment node
// ===== 纹理序双端对账（TS 消费侧）=====
// 黄金语料：tests/fixtures/parity/texture-order.golden.json（主源 = Go
// internal/app/texture_order.go|orderTexItems，regen：YSM_PARITY_REGEN=1 go test
// ./internal/app -run TestTextureOrderParity）。本文件从同一段 ysm.json 文本走
// **生产提取链**（parseYsmMetaFromFiles → meta.ysmTexOrder/ysmDefaultTex）+ 生产
// matchTexKey（wasm-geometry 的小写折叠兜底），断言 buildOrderedTexKeys 产出同黄金值
// ——任何一侧实现漂移即对账失败。刻意不手搓 ysmTexOrder 入参：提取口径漂移也要被抓住。
import { describe, expect, it } from "vitest";
import { buildOrderedTexKeys } from "./texture-order.ts";
import { matchTexKey } from "./wasm-geometry.ts";
import { parseYsmMetaFromFiles } from "./ysm-meta-parser.ts";
import parityGolden from "../../../../tests/fixtures/parity/texture-order.golden.json" with { type: "json" };

interface TexSpec {
  name: string;
  w: number;
  h: number;
}
interface ParityCase {
  id: string;
  ysmContent: string | null;
  textures: TexSpec[];
  golden: string[];
}

describe("buildOrderedTexKeys 双端对账（黄金语料 tests/fixtures/parity，主源=Go）", () => {
  for (const c of parityGolden.cases as ParityCase[]) {
    it(c.id, () => {
      // ysm.json 走生产提取链（含单形态包数组、不可解析回退）
      const files =
        c.ysmContent === null
          ? []
          : [
              {
                path: "model/ysm.json",
                data: new TextEncoder().encode(c.ysmContent),
              },
            ];
      const { meta } = parseYsmMetaFromFiles(files);
      // 纹理键与匹配器按生产口径搭：textures=收集名→占位、texLowerMap=小写→收集名
      const textures: Record<string, string> = {};
      const texLowerMap: Record<string, string> = {};
      for (const t of c.textures) {
        textures[t.name] = "x";
        texLowerMap[t.name.toLowerCase()] = t.name;
      }
      const dims = new Map(c.textures.map((t) => [t.name, t.w * t.h]));
      const keys = buildOrderedTexKeys({
        texKeys: c.textures.map((t) => t.name),
        areaOf: (k) => dims.get(k) ?? 0,
        ysmTexOrder: meta.ysmTexOrder,
        ysmDefaultTex: meta.ysmDefaultTex,
        matchTexKey: (tn) => matchTexKey(tn, textures, texLowerMap),
      });
      expect(keys).toEqual(c.golden);
    });
  }
});
