// ===== ADR-174 D5：ExtractYsmSummary 双端 fixture 对账（TS 消费侧）=====
// 黄金语料：tests/fixtures/parity/ysm-summary.golden.json（黄金值由 Go 主源产出，
// regen：YSM_PARITY_REGEN=1 go test ./go/ysm -run TestYsmSummaryParity）。
// 本文件用 fflate 造同构语料（zipSync / TextEncoder），断言 TS 平移实现产出同黄金值——
// 任何一侧实现漂移即对账失败。镜像测试纪律参考 go/litematic parity_voxel_test。
// D3 声明制差异：size 双端排除（Go=os.Stat 实际磁盘字节；web=纯字节流固定 0）。
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractYsmSummaryFromBytes } from "./ysm-header.ts";
import parityGolden from "../../../tests/fixtures/parity/ysm-summary.golden.json" with { type: "json" };

interface ParityCase {
  id: string;
  kind: "zip" | "plain-json" | "raw";
  filename: string;
  entries?: Record<string, string>;
  content?: string;
  expectError?: boolean;
  golden: Record<string, unknown> | { error: true };
}

const enc = new TextEncoder();

// 归一化：JSON 往返抹平 undefined 键 + delete size（D3 双端排除，与 Go 侧同口径）
function normalize(summary: unknown): Record<string, unknown> {
  const m = JSON.parse(JSON.stringify(summary)) as Record<string, unknown>;
  delete m.size;
  return m;
}

describe("ExtractYsmSummary 双端对账（ADR-174 D5，黄金语料 tests/fixtures/parity）", () => {
  for (const c of parityGolden.cases as ParityCase[]) {
    it(c.id, () => {
      let bytes: Uint8Array;
      if (c.kind === "zip") {
        bytes = zipSync(Object.fromEntries(Object.entries(c.entries!).map(([k, v]) => [k, strToU8(v)])));
      } else {
        bytes = enc.encode(c.content!);
      }
      if (c.expectError) {
        // 双端契约 = 报错（不比对消息文案，与 Go 侧同口径）
        expect(() => extractYsmSummaryFromBytes(bytes, c.filename)).toThrow();
        return;
      }
      const s = extractYsmSummaryFromBytes(bytes, c.filename);
      expect(normalize(s)).toEqual(normalize(c.golden));
    });
  }
});
