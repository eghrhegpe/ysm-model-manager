// @vitest-environment node
// ===== stripAppErrorPaths 测试：Go AppError 文案净化（ADR-207 D2 契约 fixture 驱动）=====
// fixture = tests/fixtures/apperror-sample.json（Go 侧 go/types/apperror_test.go 同钉，
// 文案漂移任一侧测试即红）。
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAppErrorPaths } from "./apperror-text.ts";

type Fixture = { withPaths: string; noPaths: string };
const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  // pure/ 比原 base/ 深一层（utils→base 迁移后二次下沉），相对路径多一层上跳
  "../../../../../tests/fixtures/apperror-sample.json",
);
const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Fixture;

describe("stripAppErrorPaths（Go AppError 文案净化）", () => {
  it("fixture withPaths：源路径/目标路径段剥离，描述/操作/建议保留", () => {
    const out = stripAppErrorPaths(fx.withPaths);
    expect(out).not.toContain("源路径");
    expect(out).not.toContain("目标路径");
    expect(out).not.toContain("C:\\Users");
    expect(out).toContain("问题描述：文件读取失败");
    expect(out).toContain("操作：导入");
    expect(out).toContain("解决建议：检查文件权限");
  });

  it("fixture noPaths：无路径段 → 原文不变", () => {
    expect(stripAppErrorPaths(fx.noPaths)).toBe(fx.noPaths);
  });

  it("尾部路径段（后无「解决建议」）也剥离（lookahead $ 分支）", () => {
    const out = stripAppErrorPaths("问题描述：失败 操作：导入 源路径：/x/y");
    expect(out).toBe("问题描述：失败 操作：导入");
  });

  it("路径段内容含全角冒号空格也不越界（懒惰匹配停在下一标签）", () => {
    const out = stripAppErrorPaths(
      "问题描述：r 操作：o 源路径：C:\\Users\\a：b 目标路径：C:\\Users\\c 解决建议：s",
    );
    expect(out).toBe("问题描述：r 操作：o 解决建议：s");
  });
});
