#!/usr/bin/env node
/**
 * 契约测试：check-knowledge-drift.mjs --affected 主动防御模式。
 *
 * 验证「源码变更 → 列出受影响知识卡」的精确匹配：
 *   - 文件精确命中（source_files 含该文件）
 *   - 目录前缀命中（source_files 含该目录）
 *   - 无关文件不命中（应输出 ✅ 无需复核）
 *
 * 用法：node tests/check-knowledge-drift-affected.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const SCRIPTS = path.join(process.cwd(), "scripts");
const NODE = process.execPath;
const errors = [];

function runAffected(...files) {
  // Windows 高并发下 spawn 可能瞬时 ENOENT（进程表饱和，进程根本没起来），
  // 与脚本逻辑无关、重试即可恢复。仅当 spawn 自身失败（r.error）重试，
  // 进程正常跑完却退出码非 0 → 不重试，交断言判真实回归（2026-08-31 审计加固）。
  let r = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = spawnSync(NODE, [path.join(SCRIPTS, "check-knowledge-drift.ts"), "--affected", ...files], {
      encoding: "utf-8",
      timeout: 30000,
    });
    if (!(r.error && /ENOENT|EMFILE|spawn/i.test(r.error.message || ""))) break;
  }
  if (r.status !== 0)
    errors.push(`--affected 退出码非 0: ${r.status} | stderr=${r.stderr?.slice(0, 120)}`);
  return r.stdout || "";
}

function assert(stdout, needle, label) {
  if (!stdout.includes(needle)) {
    errors.push(`[${label}] 期望输出含 "${needle}"，实际:\n${stdout.trim().slice(0, 200)}`);
  } else {
    console.log(`   ✓ ${label}`);
  }
}

function assertNot(stdout, needle, label) {
  if (stdout.includes(needle)) {
    errors.push(`[${label}] 期望输出不含 "${needle}"，实际:\n${stdout.trim().slice(0, 200)}`);
  } else {
    console.log(`   ✓ ${label}`);
  }
}

console.log("=== check-knowledge-drift --affected 契约 ===");

// 1. 文件精确命中
const out1 = runAffected("frontend/src/utils/resource/schema.ts");
assert(out1, "utils-resource-types", "文件精确命中 → utils-resource-types");

// 2. 目录前缀命中
const out2 = runAffected("go/avatar/");
assert(out2, "go-avatar", "目录前缀命中 → go-avatar");

// 3. 多文件混合
const out3 = runAffected("frontend/src/utils/resource/schema.ts", "go/avatar/");
assert(out3, "utils-resource-types", "多文件 → utils-resource-types");
assert(out3, "go-avatar", "多文件 → go-avatar");

// 4. 无关文件不命中
const out4 = runAffected("package.json");
assert(out4, "✅", "无关文件 → 无需复核");

// 5. 无参数 → 用法提示（退出码仍 0）
const out5 = runAffected();
assert(out5, "用法", "无参数 → 打印用法提示");

// ── 分级连带（ADR-338 刀 1）：表层改动白名单 ──
// 纯样式 / i18n 文案数据 / 静态资产 属表层改动，默认跳过（收窄触发面，非弱化闸）。

// 6. 纯样式 CSS（theme 卡覆盖 frontend/css/variables.css）→ 跳过，不提示复核
const out6 = runAffected("frontend/css/variables.css");
assertNot(out6, "建议复核", "纯样式 CSS → 不提示复核");
assert(out6, "theme", "纯样式 CSS → 跳过 theme（白名单可观测）");

// 7. i18n 文案（i18n 卡覆盖 frontend/src/locales/zh-CN.ts）→ 跳过，不提示复核
const out7 = runAffected("frontend/src/locales/zh-CN.ts");
assertNot(out7, "建议复核", "i18n 文案 → 不提示复核");
assert(out7, "i18n", "i18n 文案 → 跳过 i18n");

// 8. i18n 引擎逻辑（frontend/src/core/i18n/locale.ts，非数据目录）→ 白名单不误吞，仍提示
const out8 = runAffected("frontend/src/core/i18n/locale.ts");
assert(out8, "建议复核", "i18n 引擎逻辑 → 仍提示复核");
assert(out8, "i18n", "i18n 引擎逻辑 → i18n 命中");

// 9. 混合（逻辑 + 表层）→ 仍提示，表层卡标注跳过
const out9 = runAffected("frontend/src/core/i18n/locale.ts", "frontend/css/variables.css");
assert(out9, "建议复核", "混合（逻辑+表层）→ 仍提示");
assert(out9, "theme", "混合 → 表层卡 theme 标注跳过");

// 10. --no-surface-skip 关闭白名单 → 回到旧行为（两周观察期对照/回滚验证）
const out10 = runAffected("--no-surface-skip", "frontend/css/variables.css");
assert(out10, "建议复核", "--no-surface-skip → CSS 恢复提示");
assert(out10, "theme", "--no-surface-skip → theme 命中");

// 11. quiet 机读模式：仅表层改动 → 零输出（钩子可读性不被 skip 说明污染）
const out11 = runAffected("--quiet", "frontend/css/variables.css");
assertNot(out11, "theme", "quiet + 纯样式 → 不输出卡 stem");

if (errors.length) {
  console.log(`FAILED: ${errors.length} issue(s)`);
  for (const e of errors) console.log(`  ✗ ${e}`);
  process.exit(1);
}
console.log("OK: check-knowledge-drift --affected 契约全过");
