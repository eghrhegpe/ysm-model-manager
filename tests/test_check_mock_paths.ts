#!/usr/bin/env node
/**
 * 契约测试：check-mock-paths.ts（ADR-224 mock 路径守卫）。
 *
 * 覆盖（对齐极端测试防御，锚定 vi.mock 路径因重构/rename 静默失效的两类坑）：
 *   1. --json 输出合法 JSON，_summary 含 m1_fail / m2_warn_or_strict_fail / m3_info 键；
 *      当前基线（存量已修净）应 m1=0 / m2=0
 *   2. 纯判定 classifyMock（单一事实源 = scripts/_lib/mock-path-resolve.ts）：
 *      - 内部 spec 真实命中 → ok；别名未登记 → M1
 *      - 内部 spec 目标不存在（sync 那类病灶）→ M1
 *      - .js 胶水兜底解析到 .ts（bindings app.js→app.ts）→ M3，resolvedAbs 指向 .ts
 *      - 裸包命中 package.json deps（three 等）→ ok
 *      - 裸包 deps / node_modules 皆无 → M2
 *   3. --json 退出码：当前基线内应立即 0
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。运行：node tests/test_check_mock_paths.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyMock, SRC_ROOT } from "../scripts/_lib/mock-path-resolve.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function check(name, fn) {
  try {
    fn();
    console.log("✓", name);
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.error("✗", name, "-", e.message);
  }
}

// 真实测试文件绝对路径（承载 vi.mock，fromFile 语境）
const BACKEND_TEST = path.join(SRC_ROOT, "backend", "app.test.ts"); // frontend/src/backend/app.test.ts
const IMPOR_TEST = path.join(SRC_ROOT, "features", "import", "executor.test.ts");

function runGuard(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-mock-paths.ts"), ...args],
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

check("--json 输出合法且 _summary 含 M1/M2/M3 键，当前基线 m1=0/m2=0", () => {
  const { rc, out } = runGuard(["--json"]);
  const data = JSON.parse(out);
  assert.ok(data._summary, "缺 _summary");
  assert.equal(typeof data._summary.m1_fail, "number");
  assert.equal(typeof data._summary.m2_warn_or_strict_fail, "number");
  assert.equal(typeof data._summary.m3_info, "number");
  const list = [...(data.fails ?? []), ...(data.warns ?? [])]
    .map((v) =>
      typeof v === "string" ? v : `${v.rule} ${v.file}:${v.line} ← ${v.spec}: ${v.detail}`.trim(),
    )
    .join("\n");
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}${list ? `：\n${list}` : ""}`);
  assert.equal(data._summary.fail, 0, "不应有 M1 FAIL");
  assert.equal(data._summary.m2_warn_or_strict_fail, 0, "不应有 M2（存量裸包漂移已清零）");
});

// ── 内部 spec ──
check("内部 spec 真实命中 → ok", () => {
  // executor.ts 生产导入 @/features/repo/repo-rtype.ts（executor.test.ts:37 的 mock 真身）
  const c = classifyMock("@/features/repo/repo-rtype.ts", IMPOR_TEST);
  assert.equal(c.level, "ok");
  assert.equal(c.kind, "internal");
  assert.ok(c.resolvedAbs, "应有解析绝对路径");
});

check("内部 spec 目标不存在（sync 那类病灶）→ M1", () => {
  const c = classifyMock("./ghost-模块-xyz.ts", IMPOR_TEST);
  assert.equal(c.level, "M1");
  assert.equal(c.kind, "internal");
});

check("别名未登记（catch-all 已禁）→ M1", () => {
  const c = classifyMock("@/totally/not-registered-xyz.ts", BACKEND_TEST);
  assert.equal(c.level, "M1");
  assert.equal(c.kind, "internal");
});

check(".js 胶水兜底解析到 .ts（bindings app.js→app.ts）→ M3，resolvedAbs 指向 .ts", () => {
  const c = classifyMock("../../bindings/ysm-model-manager/internal/app/app.js", BACKEND_TEST);
  assert.equal(c.level, "M3");
  assert.ok(c.resolvedAbs, "已解析到 .ts");
  assert.ok(String(c.resolvedAbs).endsWith(".ts"), `应指向 .ts：${c.resolvedAbs}`);
  assert.ok(c.m3, "M3 应带 m3 细节");
});

// ── 裸包 ──
check("裸包命中 package.json deps（three）→ ok", () => {
  const c = classifyMock("three", BACKEND_TEST);
  assert.equal(c.level, "ok");
  assert.equal(c.kind, "bare");
});

check("裸包 deps / node_modules 皆无 → M2（默认 WARN）", () => {
  const c = classifyMock("@fakecorp/notinstalled-xyz", BACKEND_TEST);
  assert.equal(c.level, "M2");
  assert.equal(c.kind, "bare");
});

// ── 误报护栏：非 mock 语句不得影响检索；豁免标记后的最严校验仍返回 ok（行内豁免由 CLI 处理）──
check("真实 web-fs mock 修复后（根 resource_types.json）→ ok", () => {
  const c = classifyMock(
    "../../../resource_types.json",
    path.join(SRC_ROOT, "backend", "web-fs.test.ts"),
  );
  assert.equal(c.level, "ok");
  assert.ok(c.resolvedAbs, "应解析到根 resource_types.json");
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 项失败`);
  process.exit(1);
}
console.log("\n✅ 契约测试全绿");
