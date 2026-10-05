#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * new-knowledge-card.ts — 生成知识卡模板。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 用法：
 *   node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]
 *
 * 示例：
 *   node scripts/new-knowledge-card.ts event-bus "事件总线 bus.ts" core frontend/src/bus.ts
 *   node scripts/new-knowledge-card.ts display-util "文件名渲染 display.ts" utils frontend/src/utils/display.ts --leaf
 * 设计意图：知识卡新建工具
 * 退出码：0（成功）/ 1（失败）。
 *
 * ⚠️ 回归坑（2026-09-14 修复）：TEMPLATE 的 frontmatter 区**禁止出现任何 `# 空格` 注释行**。
 *   check-knowledge-drift.ts 用 `text.match(/^#\s+(.+)$/m)` 取第一个 `# ` 开头的行当作 H1；
 *   frontmatter 内的 `# 注释` 会被误判为 H1 → 新卡必报「H1 与 name 不一致」。
 *   frontmatter 说明请写在 JS 头注释，不要写进 TEMPLATE 输出。
 *
 * ⚠️ 回归坑（2026-10-06 修复）：TEMPLATE 的 `invariant_anchors` **不得预填占位值**。
 *   旧模板硬写 `- {source}|TODO`——架构级卡必带机制锚校验，而 `TODO` 必然不存在
 *   → 新卡一落盘就报「机制锚失效」ERROR，而本脚本末尾又跑漂移检查要求你改，
 *   即「工具默认产出的卡天生不合规」（实证：建 gate-chain-map 卡时命中）。
 *   注：试过改为 `invariant_anchors: []` 仍 ERROR——校验器对**空数组同样判格式非法**
 *   （格式须 `文件|模式`），architecture 卡**缺失**该字段只报 WARN。
 *   故正解 = 模板**不输出该字段**：architecture 卡由 WARN 提示作者按实际机制补，
 *   leaf 卡本就豁免。宁可缺字段（WARN）不可有占位值（ERROR）。
 */
import fs from "node:fs";
import path from "node:path";
import { KNOWLEDGE_ORDER } from "./_lib/knowledge-cards.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { ROOT, toPosix } from "./_lib/scan-files.ts";

const KC_DIR = path.join(ROOT, "docs", "knowledge");

const KNOWN_CATEGORIES = KNOWLEDGE_ORDER;
// 与 check-knowledge-drift.ts KIND_RE 同款：小写字母开头，仅 a-z0-9_-
const KIND_RE = /^[a-z][a-z0-9_-]*$/;

const TEMPLATE = `---
kind: {kind}
name: {name}
tier: {tier}
category: {category}
status: draft
source_files:
  - {source}
use_when:
  - TODO
pitfalls:
  - TODO
quick_groups:
  - TODO
quick_intents:
  - TODO
quick_risk_lines:
  - TODO
---

# {name}

## 概览

TODO

## 核心职责

TODO

## 对外 API / 入口

TODO

## 与其他子系统关系

TODO

## 不变量

TODO

## 相关

- TODO
`;

/**
 * kind 归一为 kebab-case（仓规单一事实源：kind = 文件名 kebab-case，见
 * docs/knowledge/AGENTS.md 卡片格式 + gen-knowledge-index.ts 的目录说明）。
 *
 * 2026-10-06 修正：旧实现用 toSnakeCase 把分隔符归一为 `_`，产出 snake_case 卡——
 * 与仓内事实标准相反（实测 181 张 kebab-case : 1 张 snake_case，后者是 59 卡统一
 * 治理的漏网）。漂移检查的 KIND_RE 刻意「兼容历史 snake_case」故不拦，两处口径
 * 由此长期共存而无人察觉。现默认产出 kebab-case，不动校验的兼容逻辑（存量卡零影响）。
 * 配套契约测试 tests/test_new_knowledge_card.ts 锁死本行为。
 */
function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function main() {
  // 统一走共享 parseArgs：bools:['leaf'] 识别 --leaf，未知 flag 收进 unknown（陷阱 #12），
  // --help/-h 置 help，位置参数在 _（此前手写 filter 三遍）
  const args = parseArgs(process.argv.slice(2), { bools: ["leaf"] });

  // --help / -h：输出用法退出，绝不创建卡片（防 --help 被当 kind）
  if (args.help) {
    console.error(
      "用法: node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]",
    );
    return 0;
  }
  // 未知 flag：拒绝而非当 kind（防 --foo 类误用，与 new-adr.ts 同款防护）
  if (args.unknown.length) {
    console.error(`[FAIL] 未知参数: ${args.unknown.join(", ")}（--help 查看用法）`);
    console.error(
      "用法: node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]",
    );
    return 1;
  }

  const positional = args._;
  if (positional.length < 4) {
    console.error(
      "用法: node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]",
    );
    process.exit(1);
  }

  const [kindRaw, name, categoryRaw, sourceRaw] = positional;
  if (!kindRaw || !name || !categoryRaw || !sourceRaw) {
    // 空字符串位置参数会产出病态卡（kind='' → .md / name 空值 / source 空列表项），必挂漂移 ERROR（code_review P2）
    console.error("[FAIL] kind/name/category/source_file 不能为空字符串");
    return 1;
  }
  const isLeaf = args.leaf;
  const kind = toKebabCase(kindRaw);
  if (!KIND_RE.test(kind)) {
    // 与 check-knowledge-drift.ts KIND_RE 同款校验：中文/camelCase/前导数字会静默归一成必挂卡的命名（code_review P2）
    console.error(`[FAIL] kind 非法: ${kind}（须小写字母开头，仅 a-z0-9_-）`);
    return 1;
  }
  if (kindRaw !== kind) console.warn(`[提示] kind 已归一化: ${kindRaw} → ${kind}`);
  const source = toPosix(sourceRaw); // Windows 反斜杠路径归一化为 POSIX，防 ROOT_ESCAPE_RE 误报（code_review P3）
  if (!fs.existsSync(path.join(ROOT, source))) {
    // source_files 必须真实存在（docs/knowledge/AGENTS.md 约束）：拼错路径立即报错而非产出硬 404 卡（code_review P2）
    console.error(`[FAIL] source_file 不存在: ${source}`);
    return 1;
  }
  const category = KNOWN_CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
  if (!category) {
    console.error(`category 无效: ${categoryRaw}，应为 ${KNOWN_CATEGORIES.join(" | ")}`);
    process.exit(1);
  }

  const fileName = `${kind}.md`;
  const fullPath = path.join(KC_DIR, fileName);

  if (fs.existsSync(fullPath)) {
    console.error(`[ERROR] ${fullPath} 已存在`);
    process.exit(1);
  }

  fs.mkdirSync(KC_DIR, { recursive: true });

  // 单遍函数替换：链式 .replace 会让 name/source 中的 `{tier}` 等占位符与 `$` 序列被二次替换/错替（code_review P3）
  const content = TEMPLATE.replace(
    /\{(kind|name|tier|category|source)\}/g,
    (_m, k) =>
      (
        ({ kind, name, tier: isLeaf ? "leaf" : "architecture", category, source }) as Record<
          string,
          string
        >
      )[k]!,
  );

  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`[OK] 已创建 ${fullPath}`);

  // 创建后对账（与 new-adr.ts 写后立即 spawnSync(adr-check) 同族闭环，code_review P2-4）：
  // 漂移检查（source_files/必填字段契约）失败或索引不同步时提示，避免 commit/pre-push 才暴露。
  const driftRes = spawnSync(process.execPath, [path.join("scripts", "check-knowledge-drift.ts")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(driftRes.stdout || "");
  process.stderr.write(driftRes.stderr || "");
  if (driftRes.status !== 0) {
    console.error(
      `[FAIL] 新卡未通过知识卡漂移检查，请修正后重跑 node scripts/check-knowledge-drift.ts`,
    );
    return 1;
  }
  const idxRes = spawnSync(process.execPath, [path.join("scripts", "gen-knowledge-index.ts")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(idxRes.stdout || "");
  process.stderr.write(idxRes.stderr || "");
  if (idxRes.status !== 0) {
    console.error(`[FAIL] 知识卡索引未同步，请重跑 node scripts/gen-knowledge-index.ts`);
    return 1;
  }
}

process.exit(main());
