// ===== ADR-174 D5：DetectContainerType 双端 fixture 对账（TS 消费侧）=====
// 黄金语料：tests/fixtures/parity/container-fingerprint.golden.json（黄金值由 Go 主源产出，
// regen：YSM_PARITY_REGEN=1 go test ./go/importer -run TestContainerFingerprintParity）。
// 本文件用 fflate 造同构 zip，断言 TS 平移实现（extract.ts detectContainerType → matchZipEntryTS
// 注册表指纹）产出同黄金值。空串 golden ↔ TS null（识别不出就是识别不出，不假装 YSM）。
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { detectContainerType } from "./extract.ts";
import parityGolden from "../../../tests/fixtures/parity/container-fingerprint.golden.json" with { type: "json" };

interface ParityCase {
  id: string;
  entries: string[];
  golden: string | null;
}

describe("DetectContainerType 双端对账（ADR-174 D5，黄金语料 tests/fixtures/parity）", () => {
  for (const c of parityGolden.cases as ParityCase[]) {
    it(c.id, () => {
      // level:0 = store 模式：local header 尺寸字段直写，detectContainerType 的
      // LFLH 游走（compSize 跳转）才能跨条目推进——与 Go archive/zip 同构
      const bytes = zipSync(
        Object.fromEntries(c.entries.map((name) => [name, strToU8("")])),
        { level: 0 },
      );
      const got = detectContainerType(bytes);
      expect(got ?? "").toBe(c.golden ?? "");
    });
  }
});
