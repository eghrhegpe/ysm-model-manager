#!/usr/bin/env node
/**
 * rename-knowledge-cards.ts — 一次性迁移：59 张 snake_case 知识卡 → kebab-case（2026-10-05 治理 ④）。
 *
 * 背景：知识卡命名规定 kind = 文件名 kebab-case，但存量 59 张卡是 snake_case，查卡时
 * 两种习惯都得试。本脚本：
 *   1) 断言目标名无冲突后 `git mv` 全部 snake 卡 → kebab；
 *   2) 全仓 \b 边界文本替换（snake token → kebab token），覆盖：
 *      卡内 kind 字段、跨卡互链、根 AGENTS.md、ADR/审计文档入链、代码注释与报错文案
 *      （如 binding-check.ts 的文档指引）——单遍替换 + 最长优先，杜绝链式误替换；
 *      \b 边界保护 test_testid_contract 这类测试文件名（前缀 _ 挡住边界）不被误伤。
 *   3) 生成物（routes / index / sidebar.gen.mjs）不在本脚本内重生成——提交时 pre-commit
 *      GEN_CMDS 自动同步，提交前手动跑一遍供 doctor --docs 验证。
 * 留档 artifacts/ 作为审计记录，不再重跑（幂等：无 snake 卡时直接退出）。
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const KNOW = path.join(ROOT, "docs", "knowledge");
const NON_CARDS = new Set(["index.md", "README.md", "AGENTS.md", "routes.md", "routes-quick.md"]);
const EXTS = new Set([".md", ".ts", ".mjs", ".js", ".go", ".json", ".yml", ".yaml", ".html", ".css", ".txt"]);
const EXCLUDE_DIRS = new Set([".git", "node_modules", "dist", "coverage", "bindings", ".local", "upstream"]);

const snakeCards = fs
  .readdirSync(KNOW)
  .filter((f) => f.endsWith(".md") && !NON_CARDS.has(f) && f.includes("_"))
  .map((f) => f.slice(0, -3));
if (!snakeCards.length) {
  console.log("无 snake 卡，幂等退出。");
  process.exit(0);
}
const map = new Map(snakeCards.map((n) => [n, n.replaceAll("_", "-")]));

// 1) 目标冲突断言
for (const [from, to] of map) {
  if (fs.existsSync(path.join(KNOW, `${to}.md`))) {
    console.error(`❌ 目标冲突: ${to}.md 已存在，中止`);
    process.exit(1);
  }
}

// 2) git mv
for (const [from, to] of map) {
  execSync(`git mv "docs/knowledge/${from}.md" "docs/knowledge/${to}.md"`, { cwd: ROOT, stdio: "pipe" });
}
console.log(`git mv 完成：${map.size} 张卡`);

// 3) 全仓 \b 边界单遍替换（最长优先，防前缀包含误替换）
const sorted = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
const re = new RegExp(`\\b(${sorted.map(([k]) => k).join("|")})\\b`, "g");
let touched = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
      continue;
    }
    if (!EXTS.has(path.extname(e.name))) continue;
    const p = path.join(dir, e.name);
    const text = fs.readFileSync(p, "utf8");
    if (text.includes("\0")) continue; // 二进制保护
    const updated = text.replace(re, (m) => map.get(m) ?? m);
    if (updated !== text) {
      fs.writeFileSync(p, updated);
      touched++;
      console.log(`  sed: ${path.relative(ROOT, p)}`);
    }
  }
}
walk(ROOT);
console.log(`\n文本替换完成：${touched} 个文件含 snake token → kebab`);
console.log("下一步：跑 gen-vitepress-sidebar / gen-knowledge-index / gen-routes / gen-routes-quick 重生成产物，再 doctor --docs 验证。");
