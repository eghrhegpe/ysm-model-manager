#!/usr/bin/env node
/**
 * 契约测试：check-path-hygiene.ts 路径卫生门禁（R5 同目录别名 / R6 测试神桶）。
 *
 * 覆盖（对应「极端测试防御」，锚定 LLM 手写 import 最爱踩的两类坑）：
 *   1. --json 输出合法 JSON，_summary 含 r5_same_dir_alias / r6_test_barrel 键；当前基线（存量全别名/无桶导入）应 r5=0 / r6=0
 *   2. 纯判定 classifyBarrelHygiene（单一事实源 = scripts/_lib/alias-resolve.ts）：
 *      - 极端 A「测试从桶入口拉起一整个模块」：裸 @/dir、@/views/x/index、./index → testBarrelEntry=true；且仅测试文件触发，非测试不触发
 *      - 极端 B「同目录还用别名写路径深度」：@/backend/同目录叶 → sameDirAlias=true；异目录/相对 ./ 不触发
 *      - 裸规范包（@wailsio/runtime 等）不得误报 / 不得抛错
 *   3. --json 退出码：当前基线内应立即 0
 *
 * 零依赖（仅 node:fs / node:path / node:child_process）。运行：node tests/test_check_path_hygiene.ts
 */
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBarrelHygiene, SRC_ROOT } from "../scripts/_lib/alias-resolve.ts";

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

// 真实 in-repo 文件路径（让 classifyImport 的别名能展开）
const BACKEND_FILE = path.join(SRC_ROOT, "backend", "runtime.ts"); // 同目录：backend/
const VIEW_TEST = path.join(SRC_ROOT, "views", "app-tree", "loader.test.ts"); // 测试文件，views/app-tree
const _UI_FILE = path.join(SRC_ROOT, "utils", "format", "bytes.ts"); // 异目录目标

function runHygiene(args) {
  try {
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, "scripts", "check-path-hygiene.ts"), ...args],
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

check("--json 输出合法且 _summary 含 R5/R6 键，当前基线 r5=0/r6=0", () => {
  const { rc, out } = runHygiene(["--json"]);
  const data = JSON.parse(out);
  assert.ok(data._summary, "缺 _summary");
  assert.equal(typeof data._summary.r5_same_dir_alias.hits, "number");
  assert.equal(typeof data._summary.r6_test_barrel.hits, "number");
  // rc!=0 时把具体违规（fails/warns，含 R3 文件清单）拼进断言，避免门禁只报一个数字、
  // 还要手动跑 --json 反查文件（commit-with-check 曾把 tail 截断吞掉详情）
  const list = [...(data.fails ?? []), ...(data.warns ?? [])]
    .map((v) => (typeof v === "string" ? v : `${v.rule} ${v.file}: ${v.detail ?? ""}`.trim()))
    .join("\n");
  assert.equal(rc, 0, `预期 rc=0，实际 ${rc}${list ? `：\n${list}` : ""}`);
  assert.equal(data._summary.fail, 0, "不应有 FAIL");
  // 存量已全别名 + 无桶导入（实证扫描）→ 观察期基线应零命中；命中即把违规样本拼进 message，
  // 避免门禁只报一个数字、还要手动跑 --json 反查文件
  assert.equal(
    data._summary.r5_same_dir_alias.hits,
    0,
    `R5 应有零命中，实际 ${data._summary.r5_same_dir_alias.hits}：${JSON.stringify(data._summary.r5_same_dir_alias.samples)}`,
  );
  assert.equal(
    data._summary.r6_test_barrel.hits,
    0,
    `R6 应有零命中，实际 ${data._summary.r6_test_barrel.hits}：${JSON.stringify(data._summary.r6_test_barrel.samples)}`,
  );
});

// ── 极端 A：测试神桶（R6）──
check("R6 极端-A1：测试裸导 @/dir 桶 → testBarrelEntry=true", () => {
  assert.equal(classifyBarrelHygiene("@/views", VIEW_TEST, true).testBarrelEntry, true);
  assert.equal(classifyBarrelHygiene("@/views", VIEW_TEST, true).isBarrelEntry, true);
});
check("R6 极端-A2：测试 @/dir/index 桶 → testBarrelEntry=true", () => {
  assert.equal(
    classifyBarrelHygiene("@/views/app-tree/index", VIEW_TEST, true).testBarrelEntry,
    true,
  );
});
check("R6 极端-A3：测试 ./index 桶 → testBarrelEntry=true", () => {
  assert.equal(classifyBarrelHygiene("./index", VIEW_TEST, true).testBarrelEntry, true);
});
check("R6 极端-A4：非测试裸导 @/dir 不触发 testBarrelEntry（区分测试/源码语境）", () => {
  assert.equal(classifyBarrelHygiene("@/views", BACKEND_FILE, false).testBarrelEntry, false);
  // 但仍是桶入口语义（防后续扩展误删）
  assert.equal(classifyBarrelHygiene("@/views", BACKEND_FILE, false).isBarrelEntry, true);
});

// ── 极端 B：同目录还用别名（R5）──
check("R5 极端-B1：backend 内 @/backend/runtime.ts 同目录别名 → sameDirAlias=true", () => {
  assert.equal(
    classifyBarrelHygiene("@/backend/runtime.ts", BACKEND_FILE, false).sameDirAlias,
    true,
  );
});
check("R5 极端-B2：异目录 @/utils/format/bytes.ts 合法别名 → sameDirAlias=false", () => {
  assert.equal(
    classifyBarrelHygiene("@/utils/format/bytes.ts", BACKEND_FILE, false).sameDirAlias,
    false,
  );
});
check("R5 极端-B3：相对 ./runtime.ts 同目录 → 合法相对，不触发（无别名可改）", () => {
  assert.equal(classifyBarrelHygiene("./runtime.ts", BACKEND_FILE, false).sameDirAlias, false);
});

// ── 误报护栏：规范包 / 异常输入不得抛错、不得误报 ──
check("裸规范包 @wailsio/runtime 不误报、不抛错", () => {
  const h = classifyBarrelHygiene("@wailsio/runtime", VIEW_TEST, true);
  assert.equal(h.isBarrelEntry, false);
  assert.equal(h.sameDirAlias, false);
  assert.equal(h.testBarrelEntry, false);
});

if (fails.length) {
  console.error(`\n❌ ${fails.length} 项失败`);
  process.exit(1);
}
console.log(`\n✅ 契约测试全绿（共 ${fails.length ? "" : "全部通过"}）`);
