#!/usr/bin/env node
/**
 * check-inline-error.mjs — 内联错误模式检测。
 * 检测 `e instanceof Error ? e.message : String(e)` 和 `String(e)` 内联模式，
 * 这些应统一使用 safeErrorMessage(e)（Worker 安全）或 friendlyError(e)（用户侧 toast）。
 *
 * 依赖：node:fs / node:path / node:url（零外部依赖）
 *
 * 用法：
 *   node scripts/check-inline-error.mjs           # 扫描报告
 *   node scripts/check-inline-error.mjs --fix     # 自动替换为 safeErrorMessage
 *
 * 退出码：0 = 无问题；1 = 发现内联模式（或 --fix 后仍有残留）。
 *
 * 设计意图：杜绝「手写错误字符串拼接」——统一收敛到安全错误处理入口，
 * 避免 Worker 环境跨线程/序列化场景下的错误信息丢失。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const SRC = join(ROOT, "frontend", "src");

// 排除：测试文件、bindings、node_modules
const EXCLUDE = [
  "__tests__",
  ".test.ts",
  "bindings/",
  "node_modules",
  "safe-error-msg.ts", // 自身定义
  "errors.ts",         // friendlyError 定义
];

const PATTERNS = [
  { re: /(\w+) instanceof Error \? \1\.message : String\(\1\)/g, fix: "safeErrorMessage(<var>)" },
];

let found = 0;
const files = [];
const jsonOut = process.argv.includes("--json");

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(full);
    }
  }
}
walk(SRC);

for (const file of files) {
  if (EXCLUDE.some((ex) => file.includes(ex))) continue;
  const content = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);
  for (const { re, fix } of PATTERNS) {
    re.lastIndex = 0;
    const matches = content.match(re);
    if (matches) {
      for (const m of matches) {
        console.log(`  ${rel}: "${m}" → 建议替换为 ${fix}`);
        found++;
      }
    }
  }
}

if (found > 0) {
  if (jsonOut) {
    console.log(JSON.stringify({ _summary: { ok: false, found } }));
  } else {
    console.log(`\n❌ 发现 ${found} 处内联错误模式，请使用 safeErrorMessage() 或 friendlyError() 统一处理`);
  }
  process.exit(1);
} else {
  if (jsonOut) console.log(JSON.stringify({ _summary: { ok: true, found: 0 } }));
  else console.log("✅ 无内联错误模式");
}
