#!/usr/bin/env node
/**
 * 契约测试：Go AppError 文案 × 前端 stripAppErrorPaths（ADR-207 D2 跨语言共享 fixture）。
 *
 * 共享事实源 = tests/fixtures/apperror-sample.json：
 *   - Go 侧 go/types/apperror_test.go 钉 AppError.Error() 全串 == fixture（文案漂移 → Go 红）；
 *   - 本测试读同一 fixture 跑 stripAppErrorPaths（前端漏剥 → 本测试红）。
 * 任一侧改 AppError 文案/正则 → 双端同 PR 同步，杜绝「Go 改词、前端静默漏剥路径」。
 *
 * 零依赖（仅 node:fs / node:path / node:url + 纯函数模块 apperror-text.ts）。
 * 运行：node tests/test_apperror_strip.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripAppErrorPaths } from "../frontend/src/utils/base/pure/apperror-text.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fx = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests", "fixtures", "apperror-sample.json"), "utf8"),
);

// withPaths：路径段剥离，描述/操作/建议保留
const out = stripAppErrorPaths(fx.withPaths);
assert.ok(!out.includes("源路径"), "源路径段应被剥离");
assert.ok(!out.includes("目标路径"), "目标路径段应被剥离");
assert.ok(!out.includes("C:\\Users"), "内部路径值不应残留");
assert.ok(out.includes("问题描述：文件读取失败"), "问题描述段应保留");
assert.ok(out.includes("操作：导入"), "操作段应保留");
assert.ok(out.includes("解决建议：检查文件权限"), "解决建议段应保留");

// noPaths：无路径段 → 原文不变
assert.strictEqual(stripAppErrorPaths(fx.noPaths), fx.noPaths, "无路径段文案应原样通过");

console.log("OK: AppError 文案 × stripAppErrorPaths 跨语言契约（fixture 双端一致）");
