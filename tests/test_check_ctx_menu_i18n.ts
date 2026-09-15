#!/usr/bin/env node
/**
 * 契约测试：check-ctx-menu-i18n.ts — 右键菜单 i18n key 存在性门禁。
 *
 * 覆盖：
 *   1. findMissingKeys 纯函数：在用的 key 缺失于 zh-CN 基准包 → 检出违规（含来源文件）。
 *   2. findMissingKeys 纯函数：key 全部存在 → 0 违规。
 *   3. **SOURCE_FILES 清单内文件全部存在**（路径漂移回归锁 —— 见块 3 头注）。
 *   4. 全量扫描当前仓库：0 违规 **且 扫描到了非 0 个文件 / 非 0 个 key**（防空转报绿）。
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。
 * 运行：node tests/test_check_ctx_menu_i18n.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectUsedKeys, findMissingKeys, SOURCE_FILES } from "../scripts/check-ctx-menu-i18n.ts";
import { check, finish } from "./_lib.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function runCheck(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-ctx-menu-i18n.ts"), ...args],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

check("findMissingKeys：在用的 key 缺失于 zh-CN → 检出违规（含来源文件）", () => {
  const used = new Map([
    ["menu.ok", "frontend/src/features/context-menu/menu-defs.ts"],
    ["ctx.missing", "frontend/src/features/context-menu/context-menu-handlers.ts"],
  ]);
  const base = new Set(["menu.ok"]); // ctx.missing 不在基准包
  const missing = findMissingKeys(used, base);
  assert.equal(missing.length, 1, "应检出 1 个缺失");
  assert.equal(missing[0].key, "ctx.missing");
  assert.equal(
    missing[0].file,
    "frontend/src/features/context-menu/context-menu-handlers.ts",
    "应带出来源文件便于定位",
  );
});

check("findMissingKeys：key 全部存在 → 0 违规", () => {
  const used = new Map([
    ["menu.ok", "frontend/src/features/context-menu/menu-defs.ts"],
    ["ctx.ok", "frontend/src/features/context-menu/context-menu-handlers.ts"],
  ]);
  const base = new Set(["menu.ok", "ctx.ok", "other.unrelated"]);
  const missing = findMissingKeys(used, base);
  assert.equal(
    missing.length,
    0,
    `全部存在应为 0 违规，实际缺失: ${missing.map((m) => m.key).join(", ")}`,
  );
});

check("findMissingKeys：注释里的伪 key（menu.xxx）不应被算作在用（由扫描端 strip 保证）", () => {
  // 该用例验证契约期望：扫描端已剥离注释，故 findMissingKeys 收到的 used 不含 menu.xxx。
  // 此处断言「若某 key 不在 used 则不会误报」，即函数只针对传入的 used 判缺失。
  const used = new Map([["menu.real", "frontend/src/features/context-menu/menu-defs.ts"]]);
  const base = new Set(["menu.real"]);
  const missReal = findMissingKeys(used, base);
  assert.equal(
    missReal.length,
    0,
    `真实 key 存在 → 不误报，实际缺失: ${missReal.map((m) => m.key).join(", ")}`,
  );
});

// ── 路径漂移回归锁（本次事故的正面防线）────────────────────────
// 事故（2026-09 实测）：SOURCE_FILES 整体指向已不存在的 `frontend/src/features/context-menu/*`
//（context-menu 代码迁到 features/context-menu/ 后未同步），叠加「文件不存在即 continue」
// 的容错 → 闸**扫零文件却报绿**（「✅ 全部 0 个 key 均存在」）。而它原先的端到端断言只查
// `violations === 0`——恰好把这个空转测成了绿，于是没人发现。
// 故此处正面锁「清单内文件必须全部存在」，块 4 再锁「必须真扫到东西」。
check("SOURCE_FILES：清单内每个文件都存在（路径漂移回归锁）", () => {
  const missingFiles = SOURCE_FILES.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert.equal(
    missingFiles.length,
    0,
    `SOURCE_FILES 有 ${missingFiles.length}/${SOURCE_FILES.length} 个路径不存在——` +
      `文件已迁移？请同步清单，否则闸会静默空转报绿：${missingFiles.join(", ")}`,
  );
  assert.ok(SOURCE_FILES.length > 0, "SOURCE_FILES 不得为空");
});

check("collectUsedKeys：真扫到文件与字面量键（防空转）", () => {
  const scan = collectUsedKeys();
  assert.equal(
    scan.filesScanned.length,
    SOURCE_FILES.length,
    `应扫描全部 ${SOURCE_FILES.length} 个文件，实际 ${scan.filesScanned.length}`,
  );
  assert.ok(scan.keys.size > 0, "应扫到非 0 个字面量键（0 意味着正则或路径失效——空转会报绿）");
});

check("全量扫描当前仓库应 0 违规（rc=0）且确实扫到了东西", () => {
  const { rc, out } = runCheck(["--json"]);
  let data: unknown;
  try {
    data = JSON.parse(out);
  } catch {
    assert.fail(`输出非 JSON：${out.slice(0, 500)}`);
  }
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}；输出：${out.slice(0, 500)}`);
  assert.equal(
    data._summary.violations,
    0,
    `预期 0 违规，实际 ${data._summary.violations}：${JSON.stringify(data._summary.missing)}`,
  );
  // ⚠️ 关键补强：只断言 violations===0 会被「扫零文件」蒙混过关（本次事故正是如此）——
  // 必须同时断言扫描面非空，否则这条测试给的是假信心。
  assert.equal(
    data._summary.filesScanned,
    SOURCE_FILES.length,
    `应扫 ${SOURCE_FILES.length} 个文件，实际 ${data._summary.filesScanned}——路径失效时空转会报绿`,
  );
  assert.ok(
    data._summary.total > 0,
    `应扫到非 0 个 key，实际 ${data._summary.total}——正则失效时空转会报绿`,
  );
});

finish("契约测试全过");
console.log("\n全部通过");
