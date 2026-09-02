// @vitest-environment node
// ===== Go-TS 识别层指纹契约对拍（ADR-154 pilot 1：双端互锁）=====
// 与 go/types/parity_zipentry_test.go 读取同一份 tests/parity/go-ts-zipentry.json，
// 锁死 utils/resource/types.ts matchZipEntryTS ↔ Go types.MatchZipEntry 逐条一致。
// 任一端改口径，另一端 go test / vitest 当场红。
// 期望值以 Go 为权威（ADR-154 §2.2）；本文件不改 fixture，只读。
//
// 读取方式：readFileSync 从仓库根定位（不走 import 语句——ADR-146 R4 冻结基线
// 禁止新增跨 frontend/src 边界的 import，越界 import 会触发 check-path-hygiene R4）。
// Go 侧 parity_test.go 用 os.ReadFile 逐级向上定位，TS 侧同思路。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchZipEntryTS } from "../utils/resource/types.ts";

// 定位仓库根：vitest 运行时 cwd = frontend/，仓库根 = cwd 上一级。
// 不走 import 语句（ADR-146 R4 冻结基线禁止新增跨 frontend/src 边界的 import）；
// Go 侧 parity_test.go 用 os.ReadFile 逐级向上定位，TS 侧同思路。
const repoRoot = join(process.cwd(), "..");
const fixturePath = join(repoRoot, "tests", "parity", "go-ts-zipentry.json");

interface ZipentryFixture {
  match_zip_entry: Array<[string, string]>;
}

const fixture: ZipentryFixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("识别层指纹契约对拍（ADR-154 pilot 1）", () => {
  it("fixture 非空（防空转守卫：语料为空时循环 0 断言静默通过）", () => {
    expect(fixture.match_zip_entry.length).toBeGreaterThan(0);
  });

  it.each(fixture.match_zip_entry)("matchZipEntryTS(%j) === %j（Go 权威）", (input, expected) => {
    // TS 未命中返回 null ↔ Go 返回 ""：归一为 "" 对拍
    const got = matchZipEntryTS(input) ?? "";
    expect(got).toBe(expected);
  });
});
